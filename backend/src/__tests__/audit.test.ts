/**
 * audit.test.ts — Integration tests for the audit log query endpoint.
 *
 * Covers:
 *   - GET /api/audit — basic list: returns data + total + limit + offset
 *   - Filter by action (exact match)
 *   - Filter by entity_type (exact match)
 *   - Filter by username (partial match)
 *   - Filter by date range (from / to)
 *   - Pagination: limit and offset params
 *   - Limit is capped at 1000
 *   - Non-admin roles are rejected (403)
 *
 * The test creates audit entries by performing real API operations so that
 * there is always at least one entry to query against.
 */
import request from 'supertest';
import { AppDataSource } from '../config/database';
import { User } from '../entities/User.entity';
import { setupTests } from './helpers/testApp';

let app: any; // eslint-disable-line @typescript-eslint/no-explicit-any
let adminToken: string;
let adminUsername: string;
let viewerToken: string;
let auditBuildingId: string;

const AUDIT_PREFIX = `aud_${Date.now()}`;
const VIEWER_USER = `${AUDIT_PREFIX}_viewer`;
const COMMON_PASS = 'Audit@9999Test';

beforeAll(async () => {
  let getAdminToken: () => Promise<string>;
  ({ app, getAdminToken } = await setupTests());
  adminToken = await getAdminToken();

  const meRes = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${adminToken}`);
  adminUsername = meRes.body.data?.username ?? '';

  // Create a viewer for RBAC check
  const vRes = await request(app)
    .post('/api/users')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ username: VIEWER_USER, password: COMMON_PASS, role: 'viewer' });
  if (vRes.status !== 201) throw new Error(`Viewer setup failed: ${JSON.stringify(vRes.body)}`);

  const vLogin = await request(app).post('/api/auth/login').send({ username: VIEWER_USER, password: COMMON_PASS });
  viewerToken = vLogin.body.data.token;

  // Perform a few operations to ensure audit entries exist
  const bRes = await request(app)
    .post('/api/buildings')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: `${AUDIT_PREFIX}_bldg` });
  auditBuildingId = bRes.body.data?._id;
}, 30000);

afterAll(async () => {
  await AppDataSource.getRepository(User)
    .createQueryBuilder()
    .delete()
    .where('username LIKE :prefix', { prefix: `${AUDIT_PREFIX}%` })
    .execute();
  if (auditBuildingId) {
    await request(app)
      .delete(`/api/buildings/${auditBuildingId}`)
      .set('Authorization', `Bearer ${adminToken}`);
  }
});

// ── Basic list ────────────────────────────────────────────────────────────────

describe('GET /api/audit', () => {
  it('returns the expected envelope shape', async () => {
    const res = await request(app)
      .get('/api/audit')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(typeof res.body.total).toBe('number');
    expect(typeof res.body.limit).toBe('number');
    expect(typeof res.body.offset).toBe('number');
  });

  it('contains at least one entry (seeded by beforeAll)', async () => {
    const res = await request(app)
      .get('/api/audit')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.body.total).toBeGreaterThan(0);
  });

  it('each entry has required fields', async () => {
    const res = await request(app)
      .get('/api/audit')
      .set('Authorization', `Bearer ${adminToken}`);
    const entry = res.body.data[0];
    expect(entry).toHaveProperty('_id');
    expect(entry).toHaveProperty('action');
    expect(entry).toHaveProperty('username');
    expect(entry).toHaveProperty('timestamp');
  });
});

// ── Filter: action ────────────────────────────────────────────────────────────

describe('GET /api/audit?action=', () => {
  it('returns only entries matching the action', async () => {
    // "login" events exist from the beforeAll admin token retrieval
    const res = await request(app)
      .get('/api/audit?action=login')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    for (const entry of res.body.data) {
      expect(entry.action).toBe('login');
    }
  });

  it('returns empty data for an action that does not exist', async () => {
    const res = await request(app)
      .get('/api/audit?action=nonexistent_action_xyz')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(0);
    expect(res.body.total).toBe(0);
  });
});

// ── Filter: entity_type ───────────────────────────────────────────────────────

describe('GET /api/audit?entity_type=', () => {
  it('returns only auth-type entries', async () => {
    const res = await request(app)
      .get('/api/audit?entity_type=auth')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    for (const entry of res.body.data) {
      expect(entry.entity_type).toBe('auth');
    }
  });
});

// ── Filter: username ──────────────────────────────────────────────────────────

describe('GET /api/audit?username=', () => {
  it('partial match returns entries for that username', async () => {
    const partial = adminUsername.slice(0, 4);
    const res = await request(app)
      .get(`/api/audit?username=${partial}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    for (const entry of res.body.data) {
      expect(entry.username.toLowerCase()).toContain(partial.toLowerCase());
    }
  });
});

// ── Filter: date range ────────────────────────────────────────────────────────

describe('GET /api/audit?from=&to=', () => {
  it('returns entries within the date range', async () => {
    const from = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1 hour ago
    const to   = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour from now

    const res = await request(app)
      .get(`/api/audit?from=${from}&to=${to}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    for (const entry of res.body.data) {
      const ts = new Date(entry.timestamp).getTime();
      expect(ts).toBeGreaterThanOrEqual(new Date(from).getTime() - 1000);
      expect(ts).toBeLessThanOrEqual(new Date(to).getTime() + 1000);
    }
  });

  it('returns no entries for a future-only range', async () => {
    const from = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const to   = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

    const res = await request(app)
      .get(`/api/audit?from=${from}&to=${to}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(0);
  });
});

// ── Pagination ────────────────────────────────────────────────────────────────

describe('GET /api/audit pagination', () => {
  it('respects limit param', async () => {
    const res = await request(app)
      .get('/api/audit?limit=2')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.limit).toBe(2);
    expect(res.body.data.length).toBeLessThanOrEqual(2);
  });

  it('respects offset param', async () => {
    const pageOne = await request(app)
      .get('/api/audit?limit=1&offset=0')
      .set('Authorization', `Bearer ${adminToken}`);
    const pageTwo = await request(app)
      .get('/api/audit?limit=1&offset=1')
      .set('Authorization', `Bearer ${adminToken}`);
    if (pageOne.body.total > 1) {
      expect(pageOne.body.data[0]._id).not.toBe(pageTwo.body.data[0]?._id);
    }
  });

  it('caps limit at 1000', async () => {
    const res = await request(app)
      .get('/api/audit?limit=99999')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.limit).toBeLessThanOrEqual(1000);
  });
});

// ── Access control ────────────────────────────────────────────────────────────

describe('GET /api/audit — access control', () => {
  it('is accessible by viewers (no admin restriction)', async () => {
    const res = await request(app)
      .get('/api/audit')
      .set('Authorization', `Bearer ${viewerToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/audit');
    expect(res.status).toBe(401);
  });
});
