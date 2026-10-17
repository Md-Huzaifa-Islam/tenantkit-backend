import request from 'supertest';
import type { App } from 'supertest/types';
import { ownerDb, resetDb } from './db';
import { addMember, as, createOwner, PASSWORD, setPlan } from './fixtures';
import { closeApp, getApp } from './helpers';
import { refreshCookie, uniqueEmail } from './http';

async function inviteToken(email: string): Promise<string> {
  const mail = await ownerDb.devEmail.findFirstOrThrow({ where: { to: email }, orderBy: { createdAt: 'desc' } });
  const match = mail.html.match(/\/invite\/([^"<\s]+)/);
  return decodeURIComponent(match![1]);
}

describe('members and invites', () => {
  let server: App;

  beforeAll(async () => {
    await resetDb();
    server = (await getApp()).getHttpServer();
  });
  afterAll(closeApp);

  describe('members', () => {
    it('lists members with their roles', async () => {
      const owner = await createOwner(server, 'List Co');
      await addMember(server, owner.workspaceId, 'ADMIN');
      const res = await as(server, owner).get(`/workspaces/${owner.workspaceId}/members`).expect(200);
      expect(res.body.map((m: { role: string }) => m.role)).toEqual(['OWNER', 'ADMIN']);
      expect(res.body[0].user).toHaveProperty('email');
      expect(res.body[0].user).not.toHaveProperty('passwordHash');
    });

    it('changes a role and audits it', async () => {
      const owner = await createOwner(server, 'Role Co');
      const member = await addMember(server, owner.workspaceId, 'MEMBER');
      const res = await as(server, owner).patch(`/members/${member.membershipId}`, { role: 'ADMIN' }).expect(200);
      expect(res.body.role).toBe('ADMIN');
      const log = await ownerDb.auditLog.findFirstOrThrow({ where: { workspaceId: owner.workspaceId, action: 'member.role_changed' } });
      expect(log).toMatchObject({ actorId: owner.userId, metadata: { from: 'MEMBER', to: 'ADMIN', userId: member.userId } });
    });

    it('does not allow granting OWNER through a role change', async () => {
      const owner = await createOwner(server, 'No Owner Grant');
      const member = await addMember(server, owner.workspaceId, 'MEMBER');
      await as(server, owner).patch(`/members/${member.membershipId}`, { role: 'OWNER' }).expect(400);
    });

    it('removes a member, unassigns their tasks and audits it', async () => {
      const owner = await createOwner(server, 'Remove Co');
      const member = await addMember(server, owner.workspaceId, 'MEMBER');
      const project = await ownerDb.project.create({ data: { workspaceId: owner.workspaceId, name: 'P', createdById: owner.userId } });
      const task = await ownerDb.task.create({
        data: { workspaceId: owner.workspaceId, projectId: project.id, title: 'T', createdById: owner.userId, assigneeId: member.userId },
      });
      await as(server, owner).delete(`/members/${member.membershipId}`).expect(204);
      expect(await ownerDb.membership.count({ where: { id: member.membershipId } })).toBe(0);
      expect((await ownerDb.task.findUniqueOrThrow({ where: { id: task.id } })).assigneeId).toBeNull();
      expect(await ownerDb.auditLog.count({ where: { workspaceId: owner.workspaceId, action: 'member.removed' } })).toBe(1);
      // The removed member loses access immediately.
      await as(server, member).get(`/workspaces/${owner.workspaceId}/members`).expect(403);
    });

    it('rejects a non-UUID member id cleanly', async () => {
      const owner = await createOwner(server, 'Bad Id Co');
      const res = await as(server, owner).delete('/members/not-a-uuid').expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('invites', () => {
    it('invites a new user who accepts, creates an account and is signed in', async () => {
      const owner = await createOwner(server, 'Invite Co');
      await setPlan(owner.workspaceId, 'PRO');
      const email = uniqueEmail('newbie');
      const inv = await as(server, owner).post(`/workspaces/${owner.workspaceId}/invites`, { email, role: 'MEMBER' }).expect(201);
      expect(inv.body).toMatchObject({ email, role: 'MEMBER', status: 'PENDING' });

      const token = await inviteToken(email);
      const stored = await ownerDb.invite.findUniqueOrThrow({ where: { id: inv.body.id } });
      expect(stored.tokenHash).not.toContain(token.split('.')[1]);

      const preview = await request(server).post('/api/v1/invites/preview').send({ token }).expect(200);
      expect(preview.body).toMatchObject({ email, role: 'MEMBER', accountExists: false, workspace: { name: 'Invite Co' } });

      const missing = await request(server).post('/api/v1/invites/accept').send({ token }).expect(400);
      expect(missing.body.error.details.issues.map((i: { path: string }) => i.path)).toEqual(['name', 'password']);

      const accepted = await request(server)
        .post('/api/v1/invites/accept')
        .send({ token, name: 'New Person', password: 'Welcome123' })
        .expect(200);
      expect(accepted.body.accessToken).toBeTruthy();
      expect(accepted.body.user.emailVerified).toBe(true);
      expect(refreshCookie(accepted)).toBeTruthy();

      const membership = await ownerDb.membership.findFirstOrThrow({ where: { workspaceId: owner.workspaceId, user: { email } } });
      expect(membership.role).toBe('MEMBER');
      expect(await ownerDb.auditLog.count({ where: { workspaceId: owner.workspaceId, action: { in: ['member.invited', 'member.joined'] } } })).toBe(2);
    });

    it('lets an existing user accept via the magic link alone', async () => {
      const owner = await createOwner(server, 'Magic Co');
      const existing = await createOwner(server, 'Elsewhere');
      await as(server, owner).post(`/workspaces/${owner.workspaceId}/invites`, { email: existing.email, role: 'ADMIN' }).expect(201);
      const token = await inviteToken(existing.email);
      const res = await request(server).post('/api/v1/invites/accept').send({ token }).expect(200);
      expect(res.body.user.email).toBe(existing.email);
      const mine = await request(server).get('/api/v1/me/workspaces').set('Authorization', `Bearer ${res.body.accessToken}`).expect(200);
      expect(mine.body.map((w: { name: string; role: string }) => [w.name, w.role])).toEqual([
        ['Elsewhere', 'OWNER'],
        ['Magic Co', 'ADMIN'],
      ]);
    });

    it('invite links are single use', async () => {
      const owner = await createOwner(server, 'Single Use');
      const email = uniqueEmail();
      await as(server, owner).post(`/workspaces/${owner.workspaceId}/invites`, { email, role: 'MEMBER' }).expect(201);
      const token = await inviteToken(email);
      await request(server).post('/api/v1/invites/accept').send({ token, name: 'A', password: PASSWORD }).expect(200);
      const again = await request(server).post('/api/v1/invites/accept').send({ token }).expect(400);
      expect(again.body.error.code).toBe('TOKEN_INVALID');
    });

    it('rejects tampered and expired tokens', async () => {
      const owner = await createOwner(server, 'Tamper Co');
      const email = uniqueEmail();
      const inv = await as(server, owner).post(`/workspaces/${owner.workspaceId}/invites`, { email, role: 'MEMBER' }).expect(201);
      const token = await inviteToken(email);
      const [wsId, secret] = token.split('.');
      await request(server).post('/api/v1/invites/preview').send({ token: `${wsId}.${secret}x` }).expect(400);
      await request(server).post('/api/v1/invites/preview').send({ token: `not-a-uuid.${secret}` }).expect(400);
      await ownerDb.invite.update({ where: { id: inv.body.id }, data: { expiresAt: new Date(Date.now() - 1) } });
      await request(server).post('/api/v1/invites/preview').send({ token }).expect(400);
    });

    it('a token presented under another workspace id finds nothing', async () => {
      const a = await createOwner(server, 'Token A');
      const b = await createOwner(server, 'Token B');
      const email = uniqueEmail();
      await as(server, a).post(`/workspaces/${a.workspaceId}/invites`, { email, role: 'MEMBER' }).expect(201);
      const secret = (await inviteToken(email)).split('.')[1];
      await request(server).post('/api/v1/invites/accept').send({ token: `${b.workspaceId}.${secret}`, name: 'X', password: PASSWORD }).expect(400);
      expect(await ownerDb.membership.count({ where: { workspaceId: b.workspaceId } })).toBe(1);
    });

    it('resending issues a new link and invalidates the old one', async () => {
      const owner = await createOwner(server, 'Resend Co');
      const email = uniqueEmail();
      const inv = await as(server, owner).post(`/workspaces/${owner.workspaceId}/invites`, { email, role: 'MEMBER' }).expect(201);
      const first = await inviteToken(email);
      await as(server, owner).post(`/invites/${inv.body.id}/resend`).expect(200);
      const second = await inviteToken(email);
      expect(second).not.toBe(first);
      await request(server).post('/api/v1/invites/preview').send({ token: first }).expect(400);
      await request(server).post('/api/v1/invites/preview').send({ token: second }).expect(200);
    });

    it('revoking makes the link unusable and hides it from the list', async () => {
      const owner = await createOwner(server, 'Revoke Co');
      const email = uniqueEmail();
      const inv = await as(server, owner).post(`/workspaces/${owner.workspaceId}/invites`, { email, role: 'MEMBER' }).expect(201);
      const token = await inviteToken(email);
      await as(server, owner).delete(`/invites/${inv.body.id}`).expect(204);
      await request(server).post('/api/v1/invites/preview').send({ token }).expect(400);
      const list = await as(server, owner).get(`/workspaces/${owner.workspaceId}/invites`).expect(200);
      expect(list.body).toEqual([]);
      expect(await ownerDb.auditLog.count({ where: { workspaceId: owner.workspaceId, action: 'member.invite_revoked' } })).toBe(1);
    });

    it('rejects inviting an existing member or a duplicate pending invite', async () => {
      const owner = await createOwner(server, 'Dupes Co');
      await setPlan(owner.workspaceId, 'PRO');
      const member = await addMember(server, owner.workspaceId, 'MEMBER');
      await as(server, owner).post(`/workspaces/${owner.workspaceId}/invites`, { email: member.email, role: 'MEMBER' }).expect(409);
      const email = uniqueEmail();
      await as(server, owner).post(`/workspaces/${owner.workspaceId}/invites`, { email, role: 'MEMBER' }).expect(201);
      await as(server, owner).post(`/workspaces/${owner.workspaceId}/invites`, { email, role: 'ADMIN' }).expect(409);
    });

    it('counts pending invites against the Free plan member limit', async () => {
      const owner = await createOwner(server, 'Limit Co'); // Free: 2 members
      await as(server, owner).post(`/workspaces/${owner.workspaceId}/invites`, { email: uniqueEmail(), role: 'MEMBER' }).expect(201);
      const res = await as(server, owner)
        .post(`/workspaces/${owner.workspaceId}/invites`, { email: uniqueEmail(), role: 'MEMBER' })
        .expect(402);
      expect(res.body.error).toMatchObject({
        code: 'PLAN_LIMIT_REACHED',
        details: { kind: 'members', limit: 2, current: 2, plan: 'FREE' },
      });
    });
  });
});
