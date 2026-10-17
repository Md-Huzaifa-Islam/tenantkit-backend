import request from 'supertest';
import { closeApp, getApp } from './helpers';

describe('health', () => {
  afterAll(closeApp);

  it('reports liveness', async () => {
    const app = await getApp();
    const res = await request(app.getHttpServer()).get('/api/v1/health').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.headers['x-request-id']).toBeDefined();
  });

  it('reports database readiness', async () => {
    const app = await getApp();
    const res = await request(app.getHttpServer()).get('/api/v1/health/ready').expect(200);
    expect(res.body).toEqual({ status: 'ok', database: 'up' });
  });

  it('renders unknown routes in the standard error format', async () => {
    const app = await getApp();
    const res = await request(app.getHttpServer()).get('/api/v1/does-not-exist').expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('serves OpenAPI docs', async () => {
    const app = await getApp();
    const res = await request(app.getHttpServer()).get('/api/docs/json').expect(200);
    expect(res.body.info.title).toBe('TenantKit API');
  });
});
