import { createHash, createHmac } from 'node:crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { ownerDb, resetDb } from './db';
import { addMember, as, createOwner, type Actor } from './fixtures';
import { closeApp, getApp } from './helpers';

/** Same signing scheme as MockBillingProvider. */
function signMock(body: string) {
  const key = createHash('sha256').update(`mock-billing:${process.env.JWT_ACCESS_SECRET}`).digest();
  return createHmac('sha256', key).update(body).digest('hex');
}

describe('billing (mock provider)', () => {
  let server: App;

  beforeAll(async () => {
    await resetDb();
    server = (await getApp()).getHttpServer();
  });
  afterAll(closeApp);

  const sessionFrom = (url: string) => decodeURIComponent(new URL(url).searchParams.get('session')!);

  async function upgrade(owner: Actor, plan: 'PRO' | 'BUSINESS' = 'PRO') {
    const res = await as(server, owner).post('/billing/checkout', { plan }).expect(201);
    const session = sessionFrom(res.body.url);
    const done = await as(server, owner).post('/billing/mock/checkout/complete', { session }).expect(200);
    return { session, done };
  }

  const webhook = (event: object) => {
    const body = JSON.stringify(event);
    return request(server)
      .post('/api/v1/billing/webhook')
      .set('Content-Type', 'application/json')
      .set('x-mock-signature', signMock(body))
      .send(body);
  };

  describe('access control', () => {
    it('only the owner can start checkout or open the portal; admins can view status', async () => {
      const owner = await createOwner(server, 'Billing RBAC');
      const admin = await addMember(server, owner.workspaceId, 'ADMIN');
      const member = await addMember(server, owner.workspaceId, 'MEMBER');
      await as(server, admin).post('/billing/checkout', { plan: 'PRO' }).expect(403);
      await as(server, admin).post('/billing/portal').expect(403);
      await as(server, member).post('/billing/checkout', { plan: 'PRO' }).expect(403);
      await as(server, admin).get('/billing/status').expect(200);
      await as(server, member).get('/billing/status').expect(403);
    });

    it('an admin cannot complete a mock checkout session started by the owner', async () => {
      const owner = await createOwner(server, 'Billing Session');
      const admin = await addMember(server, owner.workspaceId, 'ADMIN');
      const res = await as(server, owner).post('/billing/checkout', { plan: 'PRO' }).expect(201);
      await as(server, admin).post('/billing/mock/checkout/complete', { session: sessionFrom(res.body.url) }).expect(403);
    });

    it('rejects a forged checkout session', async () => {
      const owner = await createOwner(server, 'Forged');
      const res = await as(server, owner).post('/billing/mock/checkout/complete', { session: 'eyJmb28iOiJiYXIifQ.deadbeef' }).expect(400);
      expect(res.body.error.code).toBe('TOKEN_INVALID');
    });
  });

  describe('upgrade via mock checkout', () => {
    it('upgrades the plan, records audit entries and reports status', async () => {
      const owner = await createOwner(server, 'Upgrade Co');
      const { done } = await upgrade(owner);
      expect(done.body).toMatchObject({ status: 'processed', plan: 'PRO' });
      expect(done.body.redirectUrl).toMatch(/\/settings\/billing\?checkout=success$/);

      const status = await as(server, owner).get('/billing/status').expect(200);
      expect(status.body).toMatchObject({ plan: 'PRO', provider: 'mock', hasSubscription: true, usage: { projects: { limit: null }, members: { limit: 10 } } });
      expect(new Date(status.body.currentPeriodEnd).getTime()).toBeGreaterThan(Date.now());

      const actions = (await ownerDb.auditLog.findMany({ where: { workspaceId: owner.workspaceId } })).map((a) => a.action);
      expect(actions).toEqual(expect.arrayContaining(['billing.checkout_started', 'billing.plan_changed']));
    });

    it('submitting the same checkout twice processes it once', async () => {
      const owner = await createOwner(server, 'Double Submit');
      const { session } = await upgrade(owner);
      const again = await as(server, owner).post('/billing/mock/checkout/complete', { session }).expect(200);
      expect(again.body.status).toBe('duplicate');
      expect(await ownerDb.auditLog.count({ where: { workspaceId: owner.workspaceId, action: 'billing.plan_changed' } })).toBe(1);
    });

    it('refuses a second checkout while a subscription exists', async () => {
      const owner = await createOwner(server, 'Already Paid');
      await upgrade(owner);
      await as(server, owner).post('/billing/checkout', { plan: 'BUSINESS' }).expect(409);
    });

    it('lifts the Free project limit after upgrading', async () => {
      const owner = await createOwner(server, 'Limit Lift');
      for (let i = 0; i < 3; i++) await as(server, owner).post('/projects', { name: `P${i}` }).expect(201);
      await as(server, owner).post('/projects', { name: 'blocked' }).expect(402);
      await upgrade(owner);
      await as(server, owner).post('/projects', { name: 'now allowed' }).expect(201);
    });
  });

  describe('portal: plan changes, cancellation, failed payments', () => {
    it('switches plan, then cancels back to Free and re-applies limits', async () => {
      const owner = await createOwner(server, 'Portal Co');
      await upgrade(owner);
      for (let i = 0; i < 4; i++) await as(server, owner).post('/projects', { name: `P${i}` }).expect(201);

      const portal = await as(server, owner).post('/billing/portal').expect(200);
      const session = sessionFrom(portal.body.url);
      const switched = await as(server, owner).post('/billing/mock/portal/action', { session, action: 'change_plan', plan: 'BUSINESS' }).expect(200);
      expect(switched.body.plan).toBe('BUSINESS');

      const cancelled = await as(server, owner).post('/billing/mock/portal/action', { session, action: 'cancel' }).expect(200);
      expect(cancelled.body.plan).toBe('FREE');
      // Existing data is kept, but the Free limit applies to new projects.
      expect(await ownerDb.project.count({ where: { workspaceId: owner.workspaceId } })).toBe(4);
      await as(server, owner).post('/projects', { name: 'over limit' }).expect(402);

      const actions = (await ownerDb.auditLog.findMany({ where: { workspaceId: owner.workspaceId }, orderBy: { createdAt: 'asc' } })).map((a) => a.action);
      expect(actions.filter((a) => a.startsWith('billing.'))).toEqual([
        'billing.checkout_started',
        'billing.plan_changed',
        'billing.plan_changed',
        'billing.subscription_canceled',
      ]);
    });

    it('a failed payment is audited and emails the owner', async () => {
      const owner = await createOwner(server, 'Failing Card');
      await upgrade(owner);
      const portal = await as(server, owner).post('/billing/portal').expect(200);
      await as(server, owner).post('/billing/mock/portal/action', { session: sessionFrom(portal.body.url), action: 'fail_payment' }).expect(200);
      expect(await ownerDb.auditLog.count({ where: { workspaceId: owner.workspaceId, action: 'billing.payment_failed' } })).toBe(1);
      const mail = await ownerDb.devEmail.findFirstOrThrow({ where: { to: owner.email }, orderBy: { createdAt: 'desc' } });
      expect(mail.subject).toContain('Payment failed');
    });

    it('the portal requires an existing subscription', async () => {
      const owner = await createOwner(server, 'No Sub');
      await as(server, owner).post('/billing/portal').expect(400);
    });
  });

  describe('webhook endpoint', () => {
    it('processes a signed event once even when delivered twice', async () => {
      const owner = await createOwner(server, 'Webhook Co');
      const event = {
        id: 'evt_test_dup_1',
        rawType: 'checkout.session.completed',
        type: 'checkout.completed',
        workspaceId: owner.workspaceId,
        customerId: 'cus_test_dup',
        subscriptionId: 'sub_test_dup',
        plan: 'BUSINESS',
      };
      const first = await webhook(event).expect(200);
      const second = await webhook(event).expect(200);
      expect(first.body.status).toBe('processed');
      expect(second.body.status).toBe('duplicate');
      expect(await ownerDb.stripeEvent.count({ where: { id: 'evt_test_dup_1' } })).toBe(1);
      expect(await ownerDb.auditLog.count({ where: { workspaceId: owner.workspaceId, action: 'billing.plan_changed' } })).toBe(1);
      expect((await ownerDb.workspace.findUniqueOrThrow({ where: { id: owner.workspaceId } })).plan).toBe('BUSINESS');
    });

    it('processes concurrent duplicate deliveries exactly once', async () => {
      const owner = await createOwner(server, 'Concurrent Hooks');
      const event = {
        id: 'evt_test_concurrent',
        rawType: 'checkout.session.completed',
        type: 'checkout.completed',
        workspaceId: owner.workspaceId,
        customerId: 'cus_test_conc',
        subscriptionId: 'sub_test_conc',
        plan: 'PRO',
      };
      const results = await Promise.all(Array.from({ length: 5 }, () => webhook(event)));
      const statuses = results.map((r) => r.body.status ?? r.body.error?.code);
      expect(statuses.filter((s) => s === 'processed')).toHaveLength(1);
      expect(await ownerDb.auditLog.count({ where: { workspaceId: owner.workspaceId, action: 'billing.plan_changed' } })).toBe(1);
    });

    it('downgrades to Free when a subscription becomes canceled or unpaid', async () => {
      const owner = await createOwner(server, 'Unpaid Co');
      await webhook({ id: 'evt_up_1', rawType: 'checkout.session.completed', type: 'checkout.completed', workspaceId: owner.workspaceId, customerId: 'cus_unpaid', subscriptionId: 'sub_unpaid', plan: 'PRO' }).expect(200);
      await webhook({ id: 'evt_up_2', rawType: 'customer.subscription.updated', type: 'subscription.updated', customerId: 'cus_unpaid', subscriptionId: 'sub_unpaid', plan: 'PRO', status: 'unpaid', currentPeriodEnd: null }).expect(200);
      const ws = await ownerDb.workspace.findUniqueOrThrow({ where: { id: owner.workspaceId } });
      expect(ws.plan).toBe('FREE');
      expect(ws.stripeSubscriptionId).toBeNull();
    });

    it('rejects unsigned or tampered webhooks', async () => {
      const body = JSON.stringify({ id: 'evt_forged', type: 'checkout.completed' });
      await request(server).post('/api/v1/billing/webhook').set('Content-Type', 'application/json').send(body).expect(400);
      await request(server)
        .post('/api/v1/billing/webhook')
        .set('Content-Type', 'application/json')
        .set('x-mock-signature', signMock(body))
        .send(body.replace('evt_forged', 'evt_forged2'))
        .expect(400);
      expect(await ownerDb.stripeEvent.count({ where: { id: { startsWith: 'evt_forged' } } })).toBe(0);
    });

    it('acknowledges events for unknown customers without changing anything', async () => {
      const res = await webhook({ id: 'evt_unknown', rawType: 'customer.subscription.deleted', type: 'subscription.deleted', customerId: 'cus_nobody', subscriptionId: 'sub_nobody' }).expect(200);
      expect(res.body.status).toBe('ignored');
    });
  });
});
