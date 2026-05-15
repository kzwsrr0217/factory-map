/**
 * itsm.test.ts — Integration tests for /api/itsm endpoints (mock mode).
 */
import request from 'supertest';
import { setupTests } from './helpers/testApp';

let app: any; // eslint-disable-line @typescript-eslint/no-explicit-any
let token: string;

beforeAll(async () => {
  let getAdminToken: () => Promise<string>;
  ({ app, getAdminToken } = await setupTests());
  token = await getAdminToken();
}, 30000);

describe('GET /api/itsm/hardware/search', () => {
  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/itsm/hardware/search?q=test');
    expect(res.status).toBe(401);
  });

  it('returns hardware records for a search term', async () => {
    const res = await request(app)
      .get('/api/itsm/hardware/search?q=IPC')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('requires a q parameter', async () => {
    const res = await request(app)
      .get('/api/itsm/hardware/search')
      .set('Authorization', `Bearer ${token}`);
    // Should either return empty array or 400
    expect([200, 400]).toContain(res.status);
  });
});

describe('POST /api/itsm/sync/all', () => {
  it('returns a sync report', async () => {
    const res = await request(app)
      .post('/api/itsm/sync/all')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('GET /api/alerts/config', () => {
  it('returns the default alert config', async () => {
    const res = await request(app)
      .get('/api/alerts/config')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('days_before_alert');
    expect(res.body.data).toHaveProperty('email_enabled');
    expect(res.body.data).toHaveProperty('teams_enabled');
  });
});

describe('GET /api/alerts/logs', () => {
  it('returns paginated alert log', async () => {
    const res = await request(app)
      .get('/api/alerts/logs')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});
