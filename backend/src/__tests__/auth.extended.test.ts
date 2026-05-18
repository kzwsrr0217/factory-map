/**
 * auth.extended.test.ts — Integration tests for auth flows beyond basic login.
 *
 * Covers:
 *   - POST /api/auth/refresh — issues a new JWT from a valid existing token
 *   - POST /api/auth/logout — records audit entry and returns success
 *   - PATCH /api/auth/password — validates current password, enforces policy, changes password
 *   - PATCH /api/auth/profile — updates the current user's email address
 *   - GET /api/auth/sessions — returns active sessions list
 */
import request from 'supertest';
import { AppDataSource } from '../config/database';
import { User } from '../entities/User.entity';
import { setupTests } from './helpers/testApp';

let app: any; // eslint-disable-line @typescript-eslint/no-explicit-any
let adminToken: string;

const EXT_USER = `ext_${Date.now()}`;
const EXT_PASS = 'Extended@9999';
let extToken: string;

beforeAll(async () => {
  let getAdminToken: () => Promise<string>;
  ({ app, getAdminToken } = await setupTests());
  adminToken = await getAdminToken();

  // Create a dedicated user for these tests
  const res = await request(app)
    .post('/api/users')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ username: EXT_USER, password: EXT_PASS, role: 'operator' });
  if (res.status !== 201) throw new Error(`Setup failed: ${JSON.stringify(res.body)}`);

  const loginRes = await request(app)
    .post('/api/auth/login')
    .send({ username: EXT_USER, password: EXT_PASS });
  if (!loginRes.body?.data?.token) throw new Error('Login failed in setup');
  extToken = loginRes.body.data.token as string;
}, 30000);

afterAll(async () => {
  await AppDataSource.getRepository(User).delete({ username: EXT_USER });
});

// ── Token refresh ─────────────────────────────────────────────────────────────

describe('POST /api/auth/refresh', () => {
  it('issues a new token for a valid existing token', async () => {
    const res = await request(app)
      .post('/api/auth/refresh')
      .set('Authorization', `Bearer ${extToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('token');
    expect(typeof res.body.data.token).toBe('string');
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).post('/api/auth/refresh');
    expect(res.status).toBe(401);
  });
});

// ── Logout ────────────────────────────────────────────────────────────────────

describe('POST /api/auth/logout', () => {
  it('returns success and does not require a body', async () => {
    const res = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${extToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).post('/api/auth/logout');
    expect(res.status).toBe(401);
  });
});

// ── Password change ───────────────────────────────────────────────────────────

describe('PATCH /api/auth/password', () => {
  const NEW_PASS = 'NewExtended@1234';

  afterAll(async () => {
    // Restore original password so other tests using EXT_USER still work
    await request(app)
      .patch('/api/auth/password')
      .set('Authorization', `Bearer ${extToken}`)
      .send({ currentPassword: NEW_PASS, newPassword: EXT_PASS })
      .catch(() => {
        // If extToken was revoked by the logout test, reset via admin
        return AppDataSource.getRepository(User)
          .createQueryBuilder()
          .update(User)
          .set({ password: EXT_PASS } as any)
          .where('username = :u', { u: EXT_USER })
          .execute();
      });
  });

  it('returns 401 without a token', async () => {
    const res = await request(app)
      .patch('/api/auth/password')
      .send({ currentPassword: EXT_PASS, newPassword: NEW_PASS });
    expect(res.status).toBe(401);
  });

  it('returns 400 when currentPassword or newPassword is missing', async () => {
    // Re-login since the token might have been revoked by logout test
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ username: EXT_USER, password: EXT_PASS });
    const token = loginRes.body.data?.token ?? extToken;

    const res = await request(app)
      .patch('/api/auth/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: EXT_PASS });
    expect(res.status).toBe(400);
  });

  it('returns 401 when currentPassword is wrong', async () => {
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ username: EXT_USER, password: EXT_PASS });
    const token = loginRes.body.data?.token ?? extToken;

    const res = await request(app)
      .patch('/api/auth/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'WrongPassword1!', newPassword: NEW_PASS });
    expect(res.status).toBe(401);
  });

  it('rejects a new password that does not meet the policy', async () => {
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ username: EXT_USER, password: EXT_PASS });
    const token = loginRes.body.data?.token ?? extToken;

    const res = await request(app)
      .patch('/api/auth/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: EXT_PASS, newPassword: 'short' });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  it('changes the password successfully with valid credentials', async () => {
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ username: EXT_USER, password: EXT_PASS });
    const token = loginRes.body.data?.token as string;

    const res = await request(app)
      .patch('/api/auth/password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: EXT_PASS, newPassword: NEW_PASS });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Old password should no longer work
    const oldLogin = await request(app)
      .post('/api/auth/login')
      .send({ username: EXT_USER, password: EXT_PASS });
    expect(oldLogin.status).toBe(401);

    // New password should work
    const newLogin = await request(app)
      .post('/api/auth/login')
      .send({ username: EXT_USER, password: NEW_PASS });
    expect(newLogin.status).toBe(200);

    // Restore for afterAll
    await request(app)
      .patch('/api/auth/password')
      .set('Authorization', `Bearer ${newLogin.body.data.token}`)
      .send({ currentPassword: NEW_PASS, newPassword: EXT_PASS });
  });
});

// ── Profile update ────────────────────────────────────────────────────────────

describe('PATCH /api/auth/profile', () => {
  it('updates the current user\'s email', async () => {
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ username: EXT_USER, password: EXT_PASS });
    const token = loginRes.body.data?.token as string;

    const res = await request(app)
      .patch('/api/auth/profile')
      .set('Authorization', `Bearer ${token}`)
      .send({ email: 'ext@example.com' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 401 without a token', async () => {
    const res = await request(app)
      .patch('/api/auth/profile')
      .send({ email: 'x@example.com' });
    expect(res.status).toBe(401);
  });
});

// ── Active sessions ───────────────────────────────────────────────────────────

describe('GET /api/auth/sessions', () => {
  it('returns an array of active sessions', async () => {
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ username: EXT_USER, password: EXT_PASS });
    const token = loginRes.body.data?.token as string;

    const res = await request(app)
      .get('/api/auth/sessions')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    if (res.body.data.length > 0) {
      const session = res.body.data[0];
      expect(session).toHaveProperty('jti');
      expect(session).toHaveProperty('issued_at');
      expect(session).toHaveProperty('expires_at');
    }
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/auth/sessions');
    expect(res.status).toBe(401);
  });
});
