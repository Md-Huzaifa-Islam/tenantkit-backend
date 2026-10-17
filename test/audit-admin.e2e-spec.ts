import request from 'supertest';
import type { App } from 'supertest/types';
import { hashPassword } from '../src/auth/password';
import { ownerDb, resetDb } from './db';
import { addMember, as, createOwner, PASSWORD, type Actor } from './fixtures';
import { closeApp, getApp } from './helpers';
import { uniqueEmail } from './http';

describe('audit log, admin and dev mailbox', () => {
  let server: App;

  beforeAll(async () => {
    await resetDb();
    server = (await getApp()).getHttpServer();
  });
  afterAll(closeApp);

  async function superAdmin() {
    const email = uniqueEmail('root');
    await ownerDb.user.create({ data: { email, name: 'Root', passwordHash: await hashPassword(PASSWORD), isSuperAdmin: true } });
    const res = await request(server).post('/api/v1/auth/login').send({ email, password: PASSWORD }).expect(200);
    const token = res.body.accessToken as string;
    return {
      token,
      email,
      get: (url: string) => request(server).get(`/api/v1${url}`).set('Authorization', `Bearer ${token}`),
      post: (url: string, body?: object) => request(server).post(`/api/v1${url}`).set('Authorization', `Bearer ${token}`).send(body),
    };
  }

  describe('audit log coverage', () => {
    it('records every membership, role, billing and settings change with actor and IP', async () => {
      const owner = await createOwner(server, 'Audit Coverage');
      const member = await addMember(server, owner.workspaceId, 'MEMBER');
      const api = as(server, owner);

      await api.patch(`/workspaces/${owner.workspaceId}`, { name: 'Audit Coverage 2' }).expect(200); // settings
      await api.patch(`/members/${member.membershipId}`, { role: 'ADMIN' }).expect(200); // role
      await api.delete(`/members/${member.membershipId}`).expect(204); // membership
      const inv = await api.post(`/workspaces/${owner.workspaceId}/invites`, { email: uniqueEmail(), role: 'MEMBER' }).expect(201);
      await api.post(`/invites/${inv.body.id}/resend`).expect(200);
      await api.delete(`/invites/${inv.body.id}`).expect(204);
      const checkout = await api.post('/billing/checkout', { plan: 'PRO' }).expect(201); // billing
      const session = decodeURIComponent(new URL(checkout.body.url).searchParams.get('session')!);
      await api.post('/billing/mock/checkout/complete', { session }).expect(200);
      const other = await addMember(server, owner.workspaceId, 'MEMBER');
      await api.post(`/workspaces/${owner.workspaceId}/transfer`, { userId: other.userId }).expect(200);

      const res = await api.get('/audit-logs?pageSize=100').expect(200);
      const actions = res.body.items.map((i: { action: string }) => i.action);
      expect(actions).toEqual(
        expect.arrayContaining([
          'workspace.created',
          'workspace.updated',
          'member.role_changed',
          'member.removed',
          'member.invited',
          'member.invite_resent',
          'member.invite_revoked',
          'billing.checkout_started',
          'billing.plan_changed',
          'workspace.ownership_transferred',
        ]),
      );
      const roleChange = res.body.items.find((i: { action: string }) => i.action === 'member.role_changed');
      expect(roleChange.actor).toMatchObject({ id: owner.userId, email: owner.email });
      expect(roleChange.ip).toBeTruthy();
    });
  });

  describe('audit log querying', () => {
    let owner: Actor;
    let admin: Actor;

    beforeAll(async () => {
      owner = await createOwner(server, 'Audit Query');
      admin = await addMember(server, owner.workspaceId, 'ADMIN');
      const rows = Array.from({ length: 30 }, (_, i) => ({
        workspaceId: owner.workspaceId,
        actorId: i % 2 === 0 ? owner.userId : admin.userId,
        action: i % 3 === 0 ? 'member.invited' : 'workspace.updated',
        createdAt: new Date(Date.UTC(2026, 0, 1 + i)),
      }));
      await ownerDb.auditLog.createMany({ data: rows });
    });

    it('paginates newest first', async () => {
      const page1 = await as(server, owner).get('/audit-logs?pageSize=10').expect(200);
      expect(page1.body).toMatchObject({ page: 1, pageSize: 10, total: 31, totalPages: 4 });
      const page2 = await as(server, owner).get('/audit-logs?pageSize=10&page=2').expect(200);
      expect(new Date(page1.body.items[9].createdAt).getTime()).toBeGreaterThanOrEqual(new Date(page2.body.items[0].createdAt).getTime());
    });

    it('filters by action, actor and an inclusive date range', async () => {
      const byAction = await as(server, owner).get('/audit-logs?action=member.invited&pageSize=100').expect(200);
      expect(byAction.body.total).toBe(10);
      const byPrefix = await as(server, owner).get('/audit-logs?action=member.*&pageSize=100').expect(200);
      expect(byPrefix.body.total).toBe(10);
      const byActor = await as(server, owner).get(`/audit-logs?actor=${admin.userId}&pageSize=100`).expect(200);
      expect(byActor.body.items.every((i: { actor: { id: string } }) => i.actor.id === admin.userId)).toBe(true);
      const byDate = await as(server, owner).get('/audit-logs?from=2026-01-05&to=2026-01-07&pageSize=100').expect(200);
      expect(byDate.body.total).toBe(3);
    });

    it('validates query parameters', async () => {
      await as(server, owner).get('/audit-logs?actor=not-a-uuid').expect(400);
      await as(server, owner).get('/audit-logs?pageSize=1000').expect(400);
    });

    it('is not readable by members', async () => {
      const member = await addMember(server, owner.workspaceId, 'MEMBER');
      await as(server, member).get('/audit-logs').expect(403);
      await as(server, admin).get('/audit-logs').expect(200);
    });

    it('never returns another workspace’s entries', async () => {
      const other = await createOwner(server, 'Audit Other');
      await as(server, owner).get('/audit-logs').set('X-Workspace-Id', other.workspaceId).expect(403);
      const mine = await as(server, other).get('/audit-logs?pageSize=100').expect(200);
      expect(mine.body.total).toBe(1);
      expect(mine.body.items[0].action).toBe('workspace.created');
    });
  });

  describe('super admin', () => {
    it('rejects non-admins on every admin route', async () => {
      const owner = await createOwner(server, 'Not Admin');
      const auth = { Authorization: `Bearer ${owner.token}` };
      await request(server).get('/api/v1/admin/workspaces').set(auth).expect(403);
      await request(server).get('/api/v1/admin/metrics').set(auth).expect(403);
      await request(server).post(`/api/v1/admin/workspaces/${owner.workspaceId}/suspend`).set(auth).send({ suspended: true }).expect(403);
      await request(server).post(`/api/v1/admin/workspaces/${owner.workspaceId}/impersonate`).set(auth).expect(403);
    });

    it('re-checks super admin status in the database, not just the token', async () => {
      const root = await superAdmin();
      await root.get('/admin/metrics').expect(200);
      await ownerDb.user.update({ where: { email: root.email }, data: { isSuperAdmin: false } });
      await root.get('/admin/metrics').expect(403);
    });

    it('lists workspaces with counts and owner, with search', async () => {
      const root = await superAdmin();
      const owner = await createOwner(server, 'Listed Workspace');
      await addMember(server, owner.workspaceId, 'MEMBER');
      await as(server, owner).post('/projects', { name: 'P' }).expect(201);
      const res = await root.get('/admin/workspaces?q=listed').expect(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0]).toMatchObject({
        name: 'Listed Workspace',
        plan: 'FREE',
        status: 'ACTIVE',
        memberCount: 2,
        projectCount: 1,
        owner: { email: owner.email },
      });
    });

    it('suspends and unsuspends a workspace, audited in that workspace', async () => {
      const root = await superAdmin();
      const owner = await createOwner(server, 'To Suspend');
      await root.post(`/admin/workspaces/${owner.workspaceId}/suspend`, { suspended: true }).expect(200);
      const blocked = await as(server, owner).get('/projects').expect(403);
      expect(blocked.body.error.code).toBe('WORKSPACE_SUSPENDED');
      await root.post(`/admin/workspaces/${owner.workspaceId}/suspend`, { suspended: false }).expect(200);
      await as(server, owner).get('/projects').expect(200);
      const actions = (await ownerDb.auditLog.findMany({ where: { workspaceId: owner.workspaceId } })).map((a) => a.action);
      expect(actions).toEqual(expect.arrayContaining(['workspace.suspended', 'workspace.unsuspended']));
    });

    it('reports platform metrics including MRR and 7-day active users', async () => {
      const root = await superAdmin();
      const paid = await createOwner(server, 'Paying Co');
      await ownerDb.workspace.update({ where: { id: paid.workspaceId }, data: { plan: 'BUSINESS' } });
      const res = await root.get('/admin/metrics').expect(200);
      expect(res.body.workspaces.total).toBeGreaterThan(0);
      expect(res.body.mrrCents).toBeGreaterThanOrEqual(4900);
      expect(res.body.activeUsers7d).toBeGreaterThan(0);
      expect(res.body.signups30d).toHaveLength(30);
    });

    it('impersonates a workspace owner read-only, and the session is audited', async () => {
      const root = await superAdmin();
      const owner = await createOwner(server, 'Support Case');
      const res = await root.post(`/admin/workspaces/${owner.workspaceId}/impersonate`).expect(200);
      expect(res.body).toMatchObject({ readOnly: true, user: { email: owner.email }, workspace: { id: owner.workspaceId } });
      const view = { token: res.body.accessToken, workspaceId: owner.workspaceId };

      await as(server, view).get('/projects').expect(200);
      const me = await request(server).get('/api/v1/me').set('Authorization', `Bearer ${view.token}`).expect(200);
      expect(me.body).toMatchObject({ readOnly: true, email: owner.email });

      const write = await as(server, view).post('/projects', { name: 'nope' }).expect(403);
      expect(write.body.error.message).toMatch(/read-only/);
      await as(server, view).patch(`/workspaces/${owner.workspaceId}`, { name: 'nope' }).expect(403);

      const audit = await ownerDb.auditLog.findFirstOrThrow({ where: { workspaceId: owner.workspaceId, action: 'workspace.impersonated' } });
      expect(audit.metadata).toMatchObject({ readOnly: true, viewedAs: owner.email });
    });
  });

  describe('dev mailbox', () => {
    it('lists captured emails and returns one with its HTML', async () => {
      const owner = await createOwner(server, 'Mailbox Co');
      const list = await request(server).get(`/api/v1/dev/mailbox?to=${encodeURIComponent(owner.email)}`).expect(200);
      expect(list.body).toHaveLength(1);
      expect(list.body[0].subject).toBe('Verify your email address');
      expect(list.body[0]).not.toHaveProperty('html');
      const one = await request(server).get(`/api/v1/dev/mailbox/${list.body[0].id}`).expect(200);
      expect(one.body.html).toContain('/verify?token=');
    });
  });

});
