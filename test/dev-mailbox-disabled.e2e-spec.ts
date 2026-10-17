// The flag is read when the app boots, so set it before loading the app.
process.env.ENABLE_DEV_MAILBOX = 'false';

import request from 'supertest';

const { closeApp, getApp } = require('./helpers') as typeof import('./helpers');

describe('dev mailbox when disabled', () => {
  afterAll(closeApp);

  it('responds 404 so it cannot leak links in production', async () => {
    const server = (await getApp()).getHttpServer();
    const res = await request(server).get('/api/v1/dev/mailbox').expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
