/**
 * users.test.ts — Integration tests for user management (admin-only).
 *
 * Covers:
 *   - GET  /api/users             — list all users (admin only)
 *   - POST /api/users             — create user: success, duplicate, policy rejection, missing fields
 *   - PATCH /api/users/:id/role   — change role: success, invalid role, self-demotion prevention
 *   - PATCH /api/users/:id/email  — update email
 *   - POST  /api/users/:id/reset-password — admin force password reset
 *   - POST  /api/users/:id/deactivate     — deactivate; blocks self-deactivation
 *   - POST  /api/users/:id/activate       — re-enable account, clears lockout
 */
import request from 'supertest';
import { AppDataSource } from '../config/database';
import { User } from '../entities/User.entity';
import { setupTests } from './helpers/testApp';

let app: any; // eslint-disable-line @typescript-eslint/no-explicit-any
let adminToken: string;
let adminUserId: string;

const USERS_PREFIX = `ut_${Date.now()}`;

/** Create a unique username for this suite to avoid collisions. */
const uname = (suffix: string) => `${USERS_PREFIX}_${suffix}`;

beforeAll(async () => {
  let getAdminToken: () => Promise<string>;
  ({ app, getAdminToken } = await setupTests());
  adminToken = await getAdminToken();

  // Discover admin user id from /api/auth/me
  const meRes = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${adminToken}`);
  adminUserId = meRes.body.data?.id ?? meRes.body.data?._id;
}, 30000);

afterAll(async () => {
  // Clean up all test users created by this suite
  await AppDataSource.getRepository(User)
    .createQueryBuilder()
    .delete()
    .where('username LIKE :prefix', { prefix: `${USERS_PREFIX}%` })
    .execute();
});

// ── List users ────────────────────────────────────────────────────────────────

describe('GET /api/users', () => {
  it('returns a list of users for admin', async () => {
    const res = await request(app)
      .get('/api/users')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    const firstUser = res.body.data[0];
    expect(firstUser).toHaveProperty('_id');
    expect(firstUser).toHaveProperty('username');
    expect(firstUser).toHaveProperty('role');
    expect(firstUser).not.toHaveProperty('password');
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/users');
    expect(res.status).toBe(401);
  });
});

// ── Create user ───────────────────────────────────────────────────────────────

describe('POST /api/users', () => {
  it('creates a new operator user', async () => {
    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: uname('create'), password: 'Create@9999', role: 'operator' });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.username).toBe(uname('create'));
    expect(res.body.data.role).toBe('operator');
    expect(res.body.data).not.toHaveProperty('password');
    expect(res.body.data).toHaveProperty('_id');
  });

  it('returns 409 for duplicate username', async () => {
    const dupeUser = uname('dupe');
    await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: dupeUser, password: 'Dupe@9999', role: 'viewer' });

    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: dupeUser, password: 'Dupe@9999', role: 'viewer' });
    expect(res.status).toBe(409);
  });

  it('returns 422 when password does not meet policy', async () => {
    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: uname('weakpw'), password: 'short', role: 'viewer' });
    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: uname('nopass') });
    expect(res.status).toBe(400);
  });

  it('returns 401 without a token', async () => {
    const res = await request(app)
      .post('/api/users')
      .send({ username: uname('unauth'), password: 'Test@9999', role: 'viewer' });
    expect(res.status).toBe(401);
  });
});

// ── Update role ───────────────────────────────────────────────────────────────

describe('PATCH /api/users/:id/role', () => {
  let targetUserId: string;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: uname('role_target'), password: 'RoleTest@9999', role: 'viewer' });
    targetUserId = res.body.data._id;
  });

  it('changes role from viewer to operator', async () => {
    const res = await request(app)
      .patch(`/api/users/${targetUserId}/role`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'operator' });
    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe('operator');
  });

  it('returns 400 for an invalid role value', async () => {
    const res = await request(app)
      .patch(`/api/users/${targetUserId}/role`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'superuser' });
    expect(res.status).toBe(400);
  });

  it('prevents an admin from demoting their own account', async () => {
    const res = await request(app)
      .patch(`/api/users/${adminUserId}/role`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ role: 'viewer' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/demot|own account/i);
  });
});

// ── Update email ──────────────────────────────────────────────────────────────

describe('PATCH /api/users/:id/email', () => {
  let emailUserId: string;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: uname('emailup'), password: 'Email@9999', role: 'viewer' });
    emailUserId = res.body.data._id;
  });

  it('updates the user email', async () => {
    const res = await request(app)
      .patch(`/api/users/${emailUserId}/email`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ email: 'updated@example.com' });
    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe('updated@example.com');
  });
});

// ── Admin password reset ──────────────────────────────────────────────────────

describe('POST /api/users/:id/reset-password', () => {
  let resetUserId: string;
  const resetUsername = uname('pwreset');

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: resetUsername, password: 'Original@9999', role: 'viewer' });
    resetUserId = res.body.data._id;
  });

  it('returns 400 when newPassword is missing', async () => {
    const res = await request(app)
      .post(`/api/users/${resetUserId}/reset-password`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('returns 422 when new password fails policy', async () => {
    const res = await request(app)
      .post(`/api/users/${resetUserId}/reset-password`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ newPassword: 'short' });
    expect(res.status).toBe(422);
  });

  it('resets password and allows login with new password', async () => {
    const newPw = 'NewAdmin@9999';
    const res = await request(app)
      .post(`/api/users/${resetUserId}/reset-password`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ newPassword: newPw });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ username: resetUsername, password: newPw });
    expect(loginRes.status).toBe(200);
    expect(loginRes.body.data).toHaveProperty('token');
  });
});

// ── Deactivate / Activate ─────────────────────────────────────────────────────

describe('POST /api/users/:id/deactivate and /activate', () => {
  let toggleUserId: string;
  const toggleUsername = uname('toggle');

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: toggleUsername, password: 'Toggle@9999', role: 'viewer' });
    toggleUserId = res.body.data._id;
  });

  it('prevents deactivating one\'s own account', async () => {
    const res = await request(app)
      .post(`/api/users/${adminUserId}/deactivate`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/own account/i);
  });

  it('deactivates the target user account', async () => {
    const res = await request(app)
      .post(`/api/users/${toggleUserId}/deactivate`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.active).toBe(false);

    // Login should now be rejected (403)
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ username: toggleUsername, password: 'Toggle@9999' });
    expect(loginRes.status).toBe(403);
  });

  it('activates the target user account and allows login again', async () => {
    const res = await request(app)
      .post(`/api/users/${toggleUserId}/activate`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.active).toBe(true);

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ username: toggleUsername, password: 'Toggle@9999' });
    expect(loginRes.status).toBe(200);
  });
});
