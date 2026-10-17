import request from 'supertest';
import type { App } from 'supertest/types';
import { ownerDb, resetDb } from './db';
import { addMember, as, createOwner, type Actor } from './fixtures';
import { closeApp, getApp } from './helpers';
import { uniqueEmail } from './http';

/**
 * Tenant isolation at the API layer. Attacker A owns workspace 1; victim B owns
 * workspace 2. A tries every route against workspace 2, both by naming workspace 2
 * (the membership guard must refuse) and by passing workspace 2's record ids while
 * acting in workspace 1 (RLS must make them invisible).
 */
describe('tenant isolation (API layer)', () => {
  let server: App;
  let a: Actor;
  let b: Actor;
  let bMember: Actor;
  let bInviteId: string;
  let bProjectId: string;
  let bTaskId: string;

  beforeAll(async () => {
    await resetDb();
    server = (await getApp()).getHttpServer();
    a = await createOwner(server, 'Attacker');
    b = await createOwner(server, 'Victim');
    await ownerDb.workspace.update({ where: { id: b.workspaceId }, data: { plan: 'PRO' } });
    bMember = await addMember(server, b.workspaceId, 'MEMBER');
    const inv = await as(server, b).post(`/workspaces/${b.workspaceId}/invites`, { email: uniqueEmail(), role: 'MEMBER' }).expect(201);
    bInviteId = inv.body.id;
    const p = await as(server, b).post('/projects', { name: 'Secret roadmap' }).expect(201);
    bProjectId = p.body.id;
    const t = await as(server, b).post(`/projects/${bProjectId}/tasks`, { title: 'Secret task' }).expect(201);
    bTaskId = t.body.id;
  });
  afterAll(closeApp);

  const bWs = () => b.workspaceId;

  describe('naming the other workspace is refused by the membership guard', () => {
    it.each([
      ['GET workspace', () => as(server, a, bWs()).get(`/workspaces/${bWs()}`)],
      ['PATCH workspace', () => as(server, a, bWs()).patch(`/workspaces/${bWs()}`, { name: 'pwned' })],
      ['DELETE workspace', () => as(server, a, bWs()).delete(`/workspaces/${bWs()}`)],
      ['transfer ownership', () => as(server, a, bWs()).post(`/workspaces/${bWs()}/transfer`, { userId: a.userId })],
      ['list members', () => as(server, a, bWs()).get(`/workspaces/${bWs()}/members`)],
      ['list invites', () => as(server, a, bWs()).get(`/workspaces/${bWs()}/invites`)],
      ['create invite', () => as(server, a, bWs()).post(`/workspaces/${bWs()}/invites`, { email: uniqueEmail(), role: 'ADMIN' })],
      ['change role via header', () => as(server, a, bWs()).patch(`/members/${bMember.membershipId}`, { role: 'ADMIN' })],
      ['list projects', () => as(server, a, bWs()).get('/projects')],
      ['create project', () => as(server, a, bWs()).post('/projects', { name: 'planted' })],
      ['list tasks', () => as(server, a, bWs()).get(`/projects/${bProjectId}/tasks`)],
      ['read audit log', () => as(server, a, bWs()).get('/audit-logs')],
      ['billing status', () => as(server, a, bWs()).get('/billing/status')],
      ['start checkout', () => as(server, a, bWs()).post('/billing/checkout', { plan: 'BUSINESS' })],
    ])('%s → 403', async (_label, call) => {
      const res = await call().expect(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('upload logo → 403', async () => {
      await request(server)
        .post(`/api/v1/workspaces/${bWs()}/logo`)
        .set('Authorization', `Bearer ${a.token}`)
        .attach('file', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), { filename: 'x.png', contentType: 'image/png' })
        .expect(403);
    });
  });

  describe('using the other workspace’s record ids from your own workspace finds nothing', () => {
    it('change role of a member of workspace 2 → 404', async () => {
      await as(server, a).patch(`/members/${bMember.membershipId}`, { role: 'ADMIN' }).expect(404);
    });

    it('remove a member of workspace 2 → 404', async () => {
      await as(server, a).delete(`/members/${bMember.membershipId}`).expect(404);
    });

    it('resend an invite of workspace 2 → 404', async () => {
      await as(server, a).post(`/invites/${bInviteId}/resend`).expect(404);
    });

    it('revoke an invite of workspace 2 → 404', async () => {
      await as(server, a).delete(`/invites/${bInviteId}`).expect(404);
    });

    it('read a project of workspace 2 → 404', async () => {
      await as(server, a).get(`/projects/${bProjectId}`).expect(404);
    });

    it('update a project of workspace 2 → 404', async () => {
      await as(server, a).patch(`/projects/${bProjectId}`, { name: 'pwned' }).expect(404);
    });

    it('delete a project of workspace 2 → 404', async () => {
      await as(server, a).delete(`/projects/${bProjectId}`).expect(404);
    });

    it('list tasks of a workspace 2 project → 404', async () => {
      await as(server, a).get(`/projects/${bProjectId}/tasks`).expect(404);
    });

    it('add a task to a workspace 2 project → 404', async () => {
      await as(server, a).post(`/projects/${bProjectId}/tasks`, { title: 'planted' }).expect(404);
    });

    it('update a task of workspace 2 → 404', async () => {
      await as(server, a).patch(`/tasks/${bTaskId}`, { title: 'pwned' }).expect(404);
    });

    it('delete a task of workspace 2 → 404', async () => {
      await as(server, a).delete(`/tasks/${bTaskId}`).expect(404);
    });

    it('reorder workspace 2 tasks → 404', async () => {
      await as(server, a).post('/tasks/reorder', { projectId: bProjectId, columns: [{ status: 'DONE', taskIds: [bTaskId] }] }).expect(404);
    });

    it('reorder workspace 2 tasks inside your own project → 404', async () => {
      const own = await as(server, a).post('/projects', { name: 'Mine' }).expect(201);
      await as(server, a).post('/tasks/reorder', { projectId: own.body.id, columns: [{ status: 'DONE', taskIds: [bTaskId] }] }).expect(404);
    });

    it('assign a workspace 2 user to your task → 400', async () => {
      const own = await as(server, a).post('/projects', { name: 'Mine 2' }).expect(201);
      await as(server, a).post(`/projects/${own.body.id}/tasks`, { title: 'x', assigneeId: bMember.userId }).expect(400);
    });

    it('transfer ownership to a member of workspace 2 → 404', async () => {
      await as(server, a).post(`/workspaces/${a.workspaceId}/transfer`, { userId: bMember.userId }).expect(404);
    });
  });

  it('workspace 2 is untouched after every attack', async () => {
    const ws = await ownerDb.workspace.findUniqueOrThrow({ where: { id: bWs() }, include: { memberships: true, invites: true } });
    expect(ws.name).toBe('Victim');
    expect(ws.memberships.map((m) => m.role).sort()).toEqual(['MEMBER', 'OWNER']);
    expect(ws.invites).toHaveLength(1);
    expect(ws.invites[0].revokedAt).toBeNull();
    expect(await ownerDb.devEmail.count({ where: { to: ws.invites[0].email } })).toBe(1); // no resend
    const project = await ownerDb.project.findUniqueOrThrow({ where: { id: bProjectId } });
    const task = await ownerDb.task.findUniqueOrThrow({ where: { id: bTaskId } });
    expect(project.name).toBe('Secret roadmap');
    expect(task).toMatchObject({ title: 'Secret task', status: 'TODO' });
    expect(await ownerDb.project.count({ where: { workspaceId: bWs() } })).toBe(1);
  });

  it('your own audit log contains nothing from workspace 2', async () => {
    const res = await as(server, a).get('/audit-logs?pageSize=100').expect(200);
    const targets = res.body.items.map((i: { targetId: string }) => i.targetId);
    expect(targets).not.toContain(bProjectId);
    expect(targets).not.toContain(bWs());
    expect(await ownerDb.auditLog.count({ where: { workspaceId: a.workspaceId } })).toBe(res.body.total);
  });

  it('the workspace switcher lists only your own workspaces', async () => {
    const res = await request(server).get('/api/v1/me/workspaces').set('Authorization', `Bearer ${a.token}`).expect(200);
    expect(res.body.map((w: { id: string }) => w.id)).toEqual([a.workspaceId]);
  });
});
