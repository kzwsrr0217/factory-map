/**
 * rbac.test.ts — Role-based access control enforcement tests.
 *
 * Actual RBAC in this app:
 *   - /api/users      — admin only (requireAdmin)
 *   - /api/assets     — GET open to all; POST/PATCH/DELETE require operator+
 *   - /api/buildings  — all authenticated (no role gate)
 *   - /api/audit      — all authenticated (no role gate)
 *
 * Verifies:
 *   - Unauthenticated → 401 on all protected routes
 *   - Viewer → can read assets/buildings/audit but cannot POST/PATCH/DELETE assets
 *   - Viewer → cannot manage users (403)
 *   - Operator → can create/update assets but not manage users
 *   - Admin → full access
 */
import request from 'supertest';
import { AppDataSource } from '../config/database';
import { User } from '../entities/User.entity';
import { setupTests } from './helpers/testApp';

let app: any; // eslint-disable-line @typescript-eslint/no-explicit-any
let adminToken: string;
let viewerToken: string;
let operatorToken: string;
const createdAssetIds: string[] = [];

const RBAC_PREFIX = `rbac_${Date.now()}`;
const VIEWER_USER = `${RBAC_PREFIX}_viewer`;
const OPERATOR_USER = `${RBAC_PREFIX}_operator`;
const COMMON_PASS = 'Rbac@9999Test';

beforeAll(async () => {
  let getAdminToken: () => Promise<string>;
  ({ app, getAdminToken } = await setupTests());
  adminToken = await getAdminToken();

  const vRes = await request(app)
    .post('/api/users')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ username: VIEWER_USER, password: COMMON_PASS, role: 'viewer' });
  if (vRes.status !== 201) throw new Error(`Viewer setup failed: ${JSON.stringify(vRes.body)}`);

  const vLogin = await request(app).post('/api/auth/login').send({ username: VIEWER_USER, password: COMMON_PASS });
  viewerToken = vLogin.body.data.token;

  const oRes = await request(app)
    .post('/api/users')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ username: OPERATOR_USER, password: COMMON_PASS, role: 'operator' });
  if (oRes.status !== 201) throw new Error(`Operator setup failed: ${JSON.stringify(oRes.body)}`);

  const oLogin = await request(app).post('/api/auth/login').send({ username: OPERATOR_USER, password: COMMON_PASS });
  operatorToken = oLogin.body.data.token;
}, 30000);

afterAll(async () => {
  for (const id of createdAssetIds) {
    await request(app).delete(`/api/assets/${id}`).set('Authorization', `Bearer ${adminToken}`).catch(() => {});
  }
  await AppDataSource.getRepository(User)
    .createQueryBuilder()
    .delete()
    .where('username LIKE :prefix', { prefix: `${RBAC_PREFIX}%` })
    .execute();
});

// ── Unauthenticated ───────────────────────────────────────────────────────────

describe('Unauthenticated access', () => {
  it('GET /api/assets returns 401', async () => {
    const res = await request(app).get('/api/assets');
    expect(res.status).toBe(401);
  });

  it('GET /api/buildings returns 401', async () => {
    const res = await request(app).get('/api/buildings');
    expect(res.status).toBe(401);
  });

  it('GET /api/users returns 401', async () => {
    const res = await request(app).get('/api/users');
    expect(res.status).toBe(401);
  });

  it('GET /api/audit returns 401', async () => {
    const res = await request(app).get('/api/audit');
    expect(res.status).toBe(401);
  });
});

// ── Viewer role ───────────────────────────────────────────────────────────────

describe('Viewer role', () => {
  it('can list assets', async () => {
    const res = await request(app).get('/api/assets').set('Authorization', `Bearer ${viewerToken}`);
    expect(res.status).toBe(200);
  });

  it('can list buildings', async () => {
    const res = await request(app).get('/api/buildings').set('Authorization', `Bearer ${viewerToken}`);
    expect(res.status).toBe(200);
  });

  it('can read the audit log', async () => {
    const res = await request(app).get('/api/audit').set('Authorization', `Bearer ${viewerToken}`);
    expect(res.status).toBe(200);
  });

  it('cannot create an asset (403)', async () => {
    const res = await request(app)
      .post('/api/assets')
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ basic_info: { display_name: 'Viewer Asset Attempt' } });
    expect(res.status).toBe(403);
  });

  it('cannot update an asset (403)', async () => {
    // Create a real asset first as admin so we have a valid ID to attempt updating
    const createRes = await request(app)
      .post('/api/assets')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ basic_info: { display_name: 'RBAC Viewer Target Asset' } });
    const assetId = createRes.body.data?._id ?? createRes.body.data?.id;
    if (assetId) createdAssetIds.push(assetId);

    const res = await request(app)
      .patch(`/api/assets/${assetId}`)
      .set('Authorization', `Bearer ${viewerToken}`)
      .send({ basic_info: { display_name: 'Attempted Update' } });
    expect(res.status).toBe(403);
  });

  it('cannot access user management (403)', async () => {
    const res = await request(app).get('/api/users').set('Authorization', `Bearer ${viewerToken}`);
    expect(res.status).toBe(403);
  });
});

// ── Operator role ─────────────────────────────────────────────────────────────

describe('Operator role', () => {
  it('can list assets', async () => {
    const res = await request(app).get('/api/assets').set('Authorization', `Bearer ${operatorToken}`);
    expect(res.status).toBe(200);
  });

  it('can create an asset', async () => {
    const res = await request(app)
      .post('/api/assets')
      .set('Authorization', `Bearer ${operatorToken}`)
      .send({ basic_info: { display_name: 'Operator Test Asset' } });
    expect(res.status).toBe(201);
    const id = res.body.data?._id ?? res.body.data?.id;
    if (id) createdAssetIds.push(id);
  });

  it('can read the audit log', async () => {
    const res = await request(app).get('/api/audit').set('Authorization', `Bearer ${operatorToken}`);
    expect(res.status).toBe(200);
  });

  it('cannot manage users (403)', async () => {
    const res = await request(app).get('/api/users').set('Authorization', `Bearer ${operatorToken}`);
    expect(res.status).toBe(403);
  });
});

// ── Admin role (spot-check) ───────────────────────────────────────────────────

describe('Admin role', () => {
  it('can access user management', async () => {
    const res = await request(app).get('/api/users').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  it('can access the audit log', async () => {
    const res = await request(app).get('/api/audit').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  it('can create a building', async () => {
    const res = await request(app)
      .post('/api/buildings')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `RBAC Admin Building ${Date.now()}` });
    expect(res.status).toBe(201);
    // Delete immediately — this test only verifies the 201, not persistence
    await request(app)
      .delete(`/api/buildings/${res.body.data._id}`)
      .set('Authorization', `Bearer ${adminToken}`);
  });
});
