import type { App } from 'supertest/types';
import { ownerDb, resetDb } from './db';
import { addMember, as, createOwner, type Actor } from './fixtures';
import { closeApp, getApp } from './helpers';
import { uniqueEmail } from './http';

describe('RBAC', () => {
  let server: App;
  let owner: Actor;
  let admin: Actor;
  let admin2: Actor;
  let member: Actor;
  let member2: Actor;

  beforeAll(async () => {
    await resetDb();
    server = (await getApp()).getHttpServer();
    owner = await createOwner(server, 'RBAC Co');
    await ownerDb.workspace.update({ where: { id: owner.workspaceId }, data: { plan: 'BUSINESS' } });
    admin = await addMember(server, owner.workspaceId, 'ADMIN');
    admin2 = await addMember(server, owner.workspaceId, 'ADMIN');
    member = await addMember(server, owner.workspaceId, 'MEMBER');
    member2 = await addMember(server, owner.workspaceId, 'MEMBER');
  });
  afterAll(closeApp);

  const ws = () => owner.workspaceId;

  it('a member cannot invite', async () => {
    const res = await as(server, member).post(`/workspaces/${ws()}/invites`, { email: uniqueEmail(), role: 'MEMBER' }).expect(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('a member cannot list invites, change roles or remove members', async () => {
    await as(server, member).get(`/workspaces/${ws()}/invites`).expect(403);
    await as(server, member).patch(`/members/${member2.membershipId}`, { role: 'ADMIN' }).expect(403);
    await as(server, member).delete(`/members/${member2.membershipId}`).expect(403);
  });

  it('a member cannot update workspace settings', async () => {
    await as(server, member).patch(`/workspaces/${ws()}`, { name: 'Nope' }).expect(403);
  });

  it('an admin can invite and manage members', async () => {
    await as(server, admin).post(`/workspaces/${ws()}/invites`, { email: uniqueEmail(), role: 'MEMBER' }).expect(201);
    await as(server, admin).patch(`/members/${member2.membershipId}`, { role: 'ADMIN' }).expect(200);
    await as(server, admin).patch(`/members/${member2.membershipId}`, { role: 'MEMBER' }).expect(200);
  });

  it('only the owner can transfer ownership', async () => {
    await as(server, admin).post(`/workspaces/${ws()}/transfer`, { userId: admin.userId }).expect(403);
    await as(server, member).post(`/workspaces/${ws()}/transfer`, { userId: member.userId }).expect(403);
  });

  it('only the owner can delete the workspace', async () => {
    await as(server, admin).delete(`/workspaces/${ws()}`).expect(403);
  });

  it('nobody can change the owner’s role or remove the owner', async () => {
    await as(server, admin).patch(`/members/${owner.membershipId}`, { role: 'MEMBER' }).expect(403);
    await as(server, admin).delete(`/members/${owner.membershipId}`).expect(403);
  });

  it('members cannot change their own role', async () => {
    await as(server, admin).patch(`/members/${admin.membershipId}`, { role: 'MEMBER' }).expect(403);
  });

  it('admins can manage other admins but nobody can remove themselves', async () => {
    await as(server, admin).patch(`/members/${admin2.membershipId}`, { role: 'MEMBER' }).expect(200);
    await as(server, admin).patch(`/members/${admin2.membershipId}`, { role: 'ADMIN' }).expect(200);
    await as(server, admin).delete(`/members/${admin.membershipId}`).expect(403);
  });

  it('every role can read the workspace and member list', async () => {
    for (const actor of [owner, admin, member]) {
      await as(server, actor).get(`/workspaces/${ws()}`).expect(200);
      await as(server, actor).get(`/workspaces/${ws()}/members`).expect(200);
    }
  });

  it('a suspended workspace returns 403 on tenant routes for every role', async () => {
    const other = await createOwner(server, 'Suspended Co');
    await ownerDb.workspace.update({ where: { id: other.workspaceId }, data: { status: 'SUSPENDED' } });
    const res = await as(server, other).get(`/workspaces/${other.workspaceId}`).expect(403);
    expect(res.body.error.code).toBe('WORKSPACE_SUSPENDED');
    await as(server, other).get(`/workspaces/${other.workspaceId}/members`).expect(403);
  });
});
