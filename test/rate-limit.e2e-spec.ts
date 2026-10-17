// The auth throttle limit is read when the controller module loads, so set it first.
process.env.AUTH_RATE_LIMIT_PER_MINUTE = '3';

import request from 'supertest';

const { closeApp, getApp } = require('./helpers') as typeof import('./helpers');

describe('auth rate limiting', () => {
  afterAll(closeApp);

  it('returns 429 in the standard error format after the per-IP limit', async () => {
    const server = (await getApp()).getHttpServer();
    const attempt = () => request(server).post('/api/v1/auth/login').send({ email: 'x@example.com', password: 'Wrong1234' });
    for (let i = 0; i < 3; i++) expect((await attempt()).status).toBe(401);
    const blocked = await attempt();
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
  });

  it('does not throttle non-auth routes at the auth limit', async () => {
    const server = (await getApp()).getHttpServer();
    for (let i = 0; i < 5; i++) await request(server).get('/api/v1/health').expect(200);
  });
});
