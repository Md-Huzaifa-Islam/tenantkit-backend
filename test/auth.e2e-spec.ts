import request from 'supertest';
import type { App } from 'supertest/types';
import { ownerDb, resetDb } from './db';
import { closeApp, getApp } from './helpers';
import { refreshCookie, signup, tokenFromEmail, uniqueEmail } from './http';

describe('auth', () => {
  let server: App;

  beforeAll(async () => {
    await resetDb();
    server = (await getApp()).getHttpServer();
  });
  afterAll(closeApp);

  const refresh = (token: string) =>
    request(server).post('/api/v1/auth/refresh').set('Cookie', `tk_refresh=${token}`);

  describe('signup', () => {
    it('creates the user, first workspace, owner membership and audit entry', async () => {
      const s = await signup(server, { workspaceName: 'Rocket Labs' });
      expect(s.accessToken).toBeTruthy();
      expect(s.refresh).toBeTruthy();
      expect(s.workspaceSlug).toBe('rocket-labs');

      const ws = await ownerDb.workspace.findUniqueOrThrow({
        where: { slug: 'rocket-labs' },
        include: { memberships: true, auditLogs: true },
      });
      expect(ws.plan).toBe('FREE');
      expect(ws.memberships).toEqual([expect.objectContaining({ userId: s.user.id, role: 'OWNER' })]);
      expect(ws.auditLogs.map((a) => a.action)).toEqual(['workspace.created']);
    });

    it('stores an argon2id hash, never the password', async () => {
      const s = await signup(server);
      const user = await ownerDb.user.findUniqueOrThrow({ where: { id: s.user.id } });
      expect(user.passwordHash.startsWith('$argon2id$')).toBe(true);
      expect(user.passwordHash).not.toContain(s.body.password);
    });

    it('sets an httpOnly refresh cookie scoped to the auth endpoints', async () => {
      const res = await request(server)
        .post('/api/v1/auth/signup')
        .send({ name: 'C', email: uniqueEmail(), password: 'Passw0rd!', workspaceName: 'Cookie Co' })
        .expect(201);
      const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('tk_refresh='))!;
      expect(cookie).toMatch(/HttpOnly/);
      expect(cookie).toMatch(/Path=\/api\/v1\/auth/);
      expect(cookie).toMatch(/SameSite=Lax/);
      const hint = (res.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('tk_session='))!;
      expect(hint).toMatch(/^tk_session=1;/);
      expect(hint).not.toMatch(/HttpOnly/);
    });

    it('suffixes the slug when the workspace name is taken', async () => {
      const a = await signup(server, { workspaceName: 'Same Name' });
      const b = await signup(server, { workspaceName: 'Same Name' });
      expect(a.workspaceSlug).toBe('same-name');
      expect(b.workspaceSlug).toMatch(/^same-name-[a-f0-9]{6}$/);
    });

    it('rejects a duplicate email with 409', async () => {
      const s = await signup(server);
      const res = await request(server)
        .post('/api/v1/auth/signup')
        .send({ ...s.body, workspaceName: 'Other' })
        .expect(409);
      expect(res.body.error.code).toBe('CONFLICT');
    });

    it('validates input and reports issues in the standard format', async () => {
      const res = await request(server)
        .post('/api/v1/auth/signup')
        .send({ name: '', email: 'nope', password: 'short', workspaceName: '' })
        .expect(400);
      expect(res.body.error.code).toBe('VALIDATION_FAILED');
      const paths = res.body.error.details.issues.map((i: { path: string }) => i.path);
      expect(paths).toEqual(expect.arrayContaining(['name', 'email', 'password', 'workspaceName']));
    });
  });

  describe('login and /me', () => {
    it('logs in with valid credentials and returns the profile', async () => {
      const s = await signup(server);
      const res = await request(server)
        .post('/api/v1/auth/login')
        .send({ email: s.body.email.toUpperCase(), password: s.body.password })
        .expect(200);
      const me = await request(server).get('/api/v1/me').set('Authorization', `Bearer ${res.body.accessToken}`).expect(200);
      expect(me.body).toMatchObject({ email: s.body.email, emailVerified: false, isSuperAdmin: false });
    });

    it('rejects a wrong password and an unknown email identically', async () => {
      const s = await signup(server);
      const wrong = await request(server).post('/api/v1/auth/login').send({ email: s.body.email, password: 'Wrong1234' }).expect(401);
      const unknown = await request(server).post('/api/v1/auth/login').send({ email: uniqueEmail(), password: 'Wrong1234' }).expect(401);
      expect(wrong.body).toEqual(unknown.body);
    });

    it('requires a valid bearer token on protected routes', async () => {
      await request(server).get('/api/v1/me').expect(401);
      const res = await request(server).get('/api/v1/me').set('Authorization', 'Bearer not-a-jwt').expect(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
    });

    it('lists the user’s workspaces with role and permissions', async () => {
      const s = await signup(server, { workspaceName: 'Listing Co' });
      const res = await request(server).get('/api/v1/me/workspaces').set('Authorization', `Bearer ${s.accessToken}`).expect(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0]).toMatchObject({ name: 'Listing Co', role: 'OWNER', plan: 'FREE' });
      expect(res.body[0].permissions).toContain('billing.manage');
    });
  });

  describe('refresh token rotation', () => {
    it('rotates the refresh token and issues a new access token', async () => {
      const s = await signup(server);
      const res = await refresh(s.refresh).expect(200);
      const next = refreshCookie(res);
      expect(res.body.accessToken).toBeTruthy();
      expect(next).toBeTruthy();
      expect(next).not.toBe(s.refresh);
      await refresh(next!).expect(200);
    });

    it('detects reuse of a rotated token and revokes the whole family', async () => {
      const s = await signup(server);
      const second = refreshCookie(await refresh(s.refresh).expect(200))!;

      // An attacker replays the first (already rotated) token.
      await refresh(s.refresh).expect(401);

      // The legitimate holder's newer token is now revoked too.
      await refresh(second).expect(401);
      const live = await ownerDb.refreshToken.count({ where: { userId: s.user.id, revokedAt: null } });
      expect(live).toBe(0);
    });

    it('treats concurrent use of the same token as reuse (only one rotation can win)', async () => {
      const s = await signup(server);
      const results = await Promise.all([refresh(s.refresh), refresh(s.refresh)]);
      const statuses = results.map((r) => r.status).sort();
      expect(statuses).toContain(401);
      const live = await ownerDb.refreshToken.count({ where: { userId: s.user.id, revokedAt: null } });
      expect(live).toBe(0);
    });

    it('rejects an expired refresh token', async () => {
      const s = await signup(server);
      await ownerDb.refreshToken.updateMany({ where: { userId: s.user.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
      await refresh(s.refresh).expect(401);
    });

    it('rejects a missing or unknown refresh token', async () => {
      await request(server).post('/api/v1/auth/refresh').expect(401);
      await refresh('totally-made-up').expect(401);
    });

    it('logout revokes the session', async () => {
      const s = await signup(server);
      await request(server).post('/api/v1/auth/logout').set('Cookie', `tk_refresh=${s.refresh}`).expect(204);
      await refresh(s.refresh).expect(401);
    });
  });

  describe('password reset', () => {
    it('emails a single-use link that changes the password and signs out other sessions', async () => {
      const s = await signup(server);
      await request(server).post('/api/v1/auth/forgot').send({ email: s.body.email }).expect(202);
      const token = await tokenFromEmail(s.body.email, '/reset');

      const stored = await ownerDb.passwordResetToken.findFirstOrThrow({ where: { userId: s.user.id } });
      expect(stored.tokenHash).not.toBe(token); // only the hash is stored

      await request(server).post('/api/v1/auth/reset').send({ token, password: 'NewPassw0rd' }).expect(200);
      await request(server).post('/api/v1/auth/reset').send({ token, password: 'Another1234' }).expect(400);

      await request(server).post('/api/v1/auth/login').send({ email: s.body.email, password: s.body.password }).expect(401);
      await request(server).post('/api/v1/auth/login').send({ email: s.body.email, password: 'NewPassw0rd' }).expect(200);
      await refresh(s.refresh).expect(401);
    });

    it('rejects an expired reset token', async () => {
      const s = await signup(server);
      await request(server).post('/api/v1/auth/forgot').send({ email: s.body.email }).expect(202);
      const token = await tokenFromEmail(s.body.email, '/reset');
      await ownerDb.passwordResetToken.updateMany({ where: { userId: s.user.id }, data: { expiresAt: new Date(Date.now() - 1) } });
      const res = await request(server).post('/api/v1/auth/reset').send({ token, password: 'NewPassw0rd' }).expect(400);
      expect(res.body.error.code).toBe('TOKEN_INVALID');
    });

    it('responds the same for unknown emails and sends nothing', async () => {
      const email = uniqueEmail('ghost');
      const res = await request(server).post('/api/v1/auth/forgot').send({ email }).expect(202);
      expect(res.body).toEqual({ ok: true });
      expect(await ownerDb.devEmail.count({ where: { to: email } })).toBe(0);
    });
  });

  describe('email verification', () => {
    it('verifies the email with the link from the welcome email', async () => {
      const s = await signup(server);
      const token = await tokenFromEmail(s.body.email, '/verify');
      await request(server).post('/api/v1/auth/verify').send({ token }).expect(200);
      const me = await request(server).get('/api/v1/me').set('Authorization', `Bearer ${s.accessToken}`).expect(200);
      expect(me.body.emailVerified).toBe(true);
      await request(server).post('/api/v1/auth/verify').send({ token }).expect(400);
    });

    it('can resend the verification email', async () => {
      const s = await signup(server);
      await request(server).post('/api/v1/auth/verify/resend').set('Authorization', `Bearer ${s.accessToken}`).expect(202);
      expect(await ownerDb.devEmail.count({ where: { to: s.body.email } })).toBe(2);
    });
  });
});
