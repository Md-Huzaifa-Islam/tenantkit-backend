import request from 'supertest';
import type { App } from 'supertest/types';
import { ownerDb, resetDb } from './db';
import { addMember, as, createOwner } from './fixtures';
import { closeApp, getApp } from './helpers';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

describe('workspaces', () => {
  let server: App;

  beforeAll(async () => {
    await resetDb();
    server = (await getApp()).getHttpServer();
  });
  afterAll(closeApp);

  it('creates an additional workspace owned by the caller', async () => {
    const owner = await createOwner(server, 'First');
    const res = await request(server)
      .post('/api/v1/workspaces')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Second Co' })
      .expect(201);
    expect(res.body.slug).toBe('second-co');
    const mine = await request(server).get('/api/v1/me/workspaces').set('Authorization', `Bearer ${owner.token}`).expect(200);
    expect(mine.body.map((w: { name: string }) => w.name)).toEqual(['First', 'Second Co']);
  });

  it('rejects an explicitly requested slug that is taken', async () => {
    const owner = await createOwner(server, 'Taken Slug');
    await request(server)
      .post('/api/v1/workspaces')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ name: 'Copy', slug: 'taken-slug' })
      .expect(409);
  });

  it('never derives or accepts a reserved slug', async () => {
    const owner = await createOwner(server, 'Admin');
    const ws = await ownerDb.workspace.findUniqueOrThrow({ where: { id: owner.workspaceId } });
    expect(ws.slug).toMatch(/^admin-[a-f0-9]{6}$/);
    await as(server, owner).patch(`/workspaces/${owner.workspaceId}`, { slug: 'login' }).expect(400);
  });

  it('returns details with plan usage', async () => {
    const owner = await createOwner(server, 'Usage Co');
    const res = await as(server, owner).get(`/workspaces/${owner.workspaceId}`).expect(200);
    expect(res.body).toMatchObject({
      name: 'Usage Co',
      plan: 'FREE',
      role: 'OWNER',
      usage: { projects: { used: 0, limit: 3 }, members: { used: 1, limit: 2 } },
    });
  });

  it('updates settings and records only real changes in the audit log', async () => {
    const owner = await createOwner(server, 'Rename Me');
    await as(server, owner).patch(`/workspaces/${owner.workspaceId}`, { name: 'Renamed' }).expect(200);
    await as(server, owner).patch(`/workspaces/${owner.workspaceId}`, { name: 'Renamed' }).expect(200);
    const logs = await ownerDb.auditLog.findMany({ where: { workspaceId: owner.workspaceId, action: 'workspace.updated' } });
    expect(logs).toHaveLength(1);
    expect(logs[0].metadata).toEqual({ name: { from: 'Rename Me', to: 'Renamed' } });
    expect(logs[0].ip).toBeTruthy();
  });

  it('uploads a PNG logo and rejects files that are not really images', async () => {
    const owner = await createOwner(server, 'Logo Co');
    const ok = await request(server)
      .post(`/api/v1/workspaces/${owner.workspaceId}/logo`)
      .set('Authorization', `Bearer ${owner.token}`)
      .attach('file', PNG, { filename: 'logo.png', contentType: 'image/png' })
      .expect(200);
    expect(ok.body.logoUrl).toMatch(new RegExp(`^/uploads/logos/${owner.workspaceId}/.+\\.png$`));
    const served = await request(server).get(ok.body.logoUrl).expect(200);
    expect(served.headers['content-type']).toBe('image/png');

    const fake = await request(server)
      .post(`/api/v1/workspaces/${owner.workspaceId}/logo`)
      .set('Authorization', `Bearer ${owner.token}`)
      .attach('file', Buffer.from('<svg onload="alert(1)"/>'), { filename: 'x.png', contentType: 'image/png' })
      .expect(400);
    expect(fake.body.error.code).toBe('VALIDATION_FAILED');
    expect(await ownerDb.auditLog.count({ where: { workspaceId: owner.workspaceId, action: 'workspace.logo_updated' } })).toBe(1);
  });

  it('transfers ownership: target becomes owner, previous owner becomes admin', async () => {
    const owner = await createOwner(server, 'Transfer Co');
    const member = await addMember(server, owner.workspaceId, 'MEMBER');
    await as(server, owner).post(`/workspaces/${owner.workspaceId}/transfer`, { userId: member.userId }).expect(200);
    const roles = await ownerDb.membership.findMany({ where: { workspaceId: owner.workspaceId }, orderBy: { role: 'asc' } });
    expect(roles.map((r) => [r.userId, r.role])).toEqual([
      [member.userId, 'OWNER'],
      [owner.userId, 'ADMIN'],
    ]);
    expect(await ownerDb.auditLog.count({ where: { workspaceId: owner.workspaceId, action: 'workspace.ownership_transferred' } })).toBe(1);
  });

  it('cannot transfer to a non-member', async () => {
    const owner = await createOwner(server, 'No Transfer');
    const outsider = await createOwner(server, 'Outsider');
    await as(server, owner).post(`/workspaces/${owner.workspaceId}/transfer`, { userId: outsider.userId }).expect(404);
  });

  it('deletes the workspace and everything in it', async () => {
    const owner = await createOwner(server, 'Delete Me');
    await as(server, owner).delete(`/workspaces/${owner.workspaceId}`).expect(204);
    expect(await ownerDb.workspace.count({ where: { id: owner.workspaceId } })).toBe(0);
    expect(await ownerDb.membership.count({ where: { workspaceId: owner.workspaceId } })).toBe(0);
    expect(await ownerDb.auditLog.count({ where: { workspaceId: owner.workspaceId } })).toBe(0);
  });

  it('requires the X-Workspace-Id header on header-scoped routes', async () => {
    const owner = await createOwner(server, 'Header Co');
    const res = await request(server)
      .patch('/api/v1/members/7d8f7f0c-6a3e-4f0f-9a37-3c1a2a2b6c11')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ role: 'ADMIN' })
      .expect(400);
    expect(res.body.error.code).toBe('WORKSPACE_REQUIRED');
  });
});
