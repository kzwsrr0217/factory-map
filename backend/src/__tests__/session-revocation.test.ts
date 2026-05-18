/**
 * session-revocation.test.ts — Tests for per-session revocation.
 *
 * Covers:
 *   - GET  /api/auth/sessions        — lists active sessions with jti field
 *   - DELETE /api/auth/sessions/:jti — revokes one session; subsequent use returns 401
 *   - Revoking a session that doesn't belong to the user returns 404
 */
import request from 'supertest';
import { AppDataSource } from '../config/database';
import { User } from '../entities/User.entity';
import { setupTests } from './helpers/testApp';

let app: any; // eslint-disable-line @typescript-eslint/no-explicit-any
let adminToken: string;

const REV_PREFIX = `rev_${Date.now()}`;
const REV_USER = `${REV_PREFIX}_user`;
const REV_PASS = 'Revoke@9999';

beforeAll(async () => {
  let getAdminToken: () => Promise<string>;
  ({ app, getAdminToken } = await setupTests());
  adminToken = await getAdminToken();

  const res = await request(app)
    .post('/api/users')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ username: REV_USER, password: REV_PASS, role: 'operator' });
  if (res.status !== 201) throw new Error(`Setup failed: ${JSON.stringify(res.body)}`);
}, 30000);

afterAll(async () => {
  await AppDataSource.getRepository(User).delete({ username: REV_USER });
});

// ── Session list ──────────────────────────────────────────────────────────────

describe('GET /api/auth/sessions', () => {
  it('lists active sessions for the current user', async () => {
    const login = await request(app).post('/api/auth/login').send({ username: REV_USER, password: REV_PASS });
    const token = login.body.data.token as string;

    const res = await request(app)
      .get('/api/auth/sessions')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThan(0);
    const session = res.body.data[0];
    expect(session).toHaveProperty('jti');
    expect(session).toHaveProperty('issued_at');
    expect(session).toHaveProperty('expires_at');
    expect(session).toHaveProperty('is_current');
  });

  it('marks the current session with is_current: true', async () => {
    const login = await request(app).post('/api/auth/login').send({ username: REV_USER, password: REV_PASS });
    const token = login.body.data.token as string;

    const res = await request(app)
      .get('/api/auth/sessions')
      .set('Authorization', `Bearer ${token}`);

    const current = res.body.data.find((s: any) => s.is_current === true);
    expect(current).toBeDefined();
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/auth/sessions');
    expect(res.status).toBe(401);
  });
});

// ── Session revocation ────────────────────────────────────────────────────────

describe('DELETE /api/auth/sessions/:jti', () => {
  it('revokes a session so the token can no longer be used', async () => {
    // Login to get a fresh session
    const login = await request(app).post('/api/auth/login').send({ username: REV_USER, password: REV_PASS });
    const token = login.body.data.token as string;

    // Get sessions and find the current one's jti
    const sessions = await request(app)
      .get('/api/auth/sessions')
      .set('Authorization', `Bearer ${token}`);
    const currentSession = sessions.body.data.find((s: any) => s.is_current);
    expect(currentSession).toBeDefined();
    const jti = currentSession.jti;

    // Revoke the current session
    const revokeRes = await request(app)
      .delete(`/api/auth/sessions/${jti}`)
      .set('Authorization', `Bearer ${token}`);
    expect(revokeRes.status).toBe(200);
    expect(revokeRes.body.success).toBe(true);

    // The same token should now be rejected
    const afterRevoke = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(afterRevoke.status).toBe(401);
  });

  it('returns 404 when the jti does not belong to the user', async () => {
    // Login as admin and get a session jti
    const adminSessions = await request(app)
      .get('/api/auth/sessions')
      .set('Authorization', `Bearer ${adminToken}`);
    const adminJti = adminSessions.body.data[0]?.jti;

    if (!adminJti) {
      // No admin sessions to steal — skip
      return;
    }

    // Login as REV_USER and try to revoke admin's session
    const login = await request(app).post('/api/auth/login').send({ username: REV_USER, password: REV_PASS });
    const token = login.body.data.token as string;

    const res = await request(app)
      .delete(`/api/auth/sessions/${adminJti}`)
      .set('Authorization', `Bearer ${token}`);
    // Should be 404 (not found for this user) — not 200
    expect(res.status).toBe(404);
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).delete('/api/auth/sessions/fake-jti');
    expect(res.status).toBe(401);
  });
});
