import type { Role } from '@prisma/client';
import request from 'supertest';
import type { App } from 'supertest/types';
import { hashPassword } from '../src/auth/password';
import { ownerDb } from './db';
import { signup, uniqueEmail } from './http';

export const PASSWORD = 'Passw0rd!';
let hash: Promise<string> | undefined;

export interface Actor {
  token: string;
  userId: string;
  email: string;
  workspaceId: string;
  membershipId: string;
}

/** Signs up through the API: the user owns a fresh FREE workspace. */
export async function createOwner(server: App, workspaceName = 'Owner Workspace'): Promise<Actor> {
  const s = await signup(server, { workspaceName, password: PASSWORD });
  const ws = await ownerDb.workspace.findUniqueOrThrow({ where: { slug: s.workspaceSlug } });
  const m = await ownerDb.membership.findFirstOrThrow({ where: { workspaceId: ws.id, userId: s.user.id } });
  return { token: s.accessToken, userId: s.user.id, email: s.body.email, workspaceId: ws.id, membershipId: m.id };
}

/** Adds a member directly in the DB, then logs them in through the API. */
export async function addMember(server: App, workspaceId: string, role: Role): Promise<Actor> {
  hash ??= hashPassword(PASSWORD);
  const email = uniqueEmail(role.toLowerCase());
  const user = await ownerDb.user.create({ data: { email, name: `${role} user`, passwordHash: await hash } });
  const m = await ownerDb.membership.create({ data: { userId: user.id, workspaceId, role } });
  const res = await request(server).post('/api/v1/auth/login').send({ email, password: PASSWORD }).expect(200);
  return { token: res.body.accessToken, userId: user.id, email, workspaceId, membershipId: m.id };
}

/** Request helpers that attach the bearer token and active workspace. */
export function as(server: App, actor: Pick<Actor, 'token' | 'workspaceId'>, workspaceId = actor.workspaceId) {
  const withHeaders = (r: request.Test) =>
    r.set('Authorization', `Bearer ${actor.token}`).set('X-Workspace-Id', workspaceId);
  return {
    get: (url: string) => withHeaders(request(server).get(`/api/v1${url}`)),
    post: (url: string, body?: object) => withHeaders(request(server).post(`/api/v1${url}`)).send(body),
    patch: (url: string, body?: object) => withHeaders(request(server).patch(`/api/v1${url}`)).send(body),
    put: (url: string, body?: object) => withHeaders(request(server).put(`/api/v1${url}`)).send(body),
    delete: (url: string) => withHeaders(request(server).delete(`/api/v1${url}`)),
  };
}

export async function setPlan(workspaceId: string, plan: 'FREE' | 'PRO' | 'BUSINESS') {
  await ownerDb.workspace.update({ where: { id: workspaceId }, data: { plan } });
}
