/**
 * auth.test.ts — Integration tests for POST /api/auth/login and related endpoints.
 */
import request from 'supertest';
import { setupTests } from './helpers/testApp';

let app: any; // eslint-disable-line @typescript-eslint/no-explicit-any

beforeAll(async () => {
  ({ app } = await setupTests());
}, 30000);

describe('GET /api/auth/capabilities', () => {
  it('returns auth provider flags without a token', async () => {
    const res = await request(app).get('/api/auth/capabilities');
    expect(res.status).toBe(200);
    // Response is wrapped: { success: true, data: { local, ldap, azure } }
    const caps = res.body.data ?? res.body;
    expect(caps).toHaveProperty('local');
  });
});

describe('POST /api/auth/login', () => {
  it('returns a token for valid credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'Admin@1234' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('token');
    expect(res.body.data).toHaveProperty('user');
    expect(res.body.data.user.username).toBe('admin');
  });

  it('returns 4xx/5xx for wrong password', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'wrong' });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('returns 401 for non-existent user', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ username: 'nosuchuser', password: 'anything' });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/auth/me', () => {
  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('returns the current user with a valid token', async () => {
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ username: 'admin', password: 'Admin@1234' });
    const token = loginRes.body.data.token;

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.username).toBe('admin');
  });
});
