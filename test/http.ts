import request from 'supertest';
import type { App } from 'supertest/types';
import { ownerDb } from './db';

export function refreshCookie(res: request.Response): string | undefined {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  const cookie = raw?.find((c) => c.startsWith('tk_refresh='));
  const value = cookie?.split(';')[0].slice('tk_refresh='.length);
  return value ? value : undefined;
}

let counter = 0;
export function uniqueEmail(prefix = 'user') {
  counter++;
  return `${prefix}-${Date.now()}-${counter}@example.com`;
}

export async function signup(server: App, overrides: Partial<Record<string, string>> = {}) {
  const body = {
    name: 'Test User',
    email: uniqueEmail(),
    password: 'Passw0rd!',
    workspaceName: 'Test Workspace',
    ...overrides,
  };
  const res = await request(server).post('/api/v1/auth/signup').send(body).expect(201);
  return {
    body,
    accessToken: res.body.accessToken as string,
    refresh: refreshCookie(res)!,
    user: res.body.user as { id: string; email: string },
    workspaceSlug: res.body.workspaceSlug as string,
  };
}

/** Pulls the token out of the most recent dev-mailbox email sent to `to`. */
export async function tokenFromEmail(to: string, path: string): Promise<string> {
  const email = await ownerDb.devEmail.findFirstOrThrow({ where: { to }, orderBy: { createdAt: 'desc' } });
  const match = email.html.match(new RegExp(`${path}\\?token=([^"&<\\s]+)`));
  if (!match) throw new Error(`No ${path} link in email to ${to}`);
  return decodeURIComponent(match[1]);
}
