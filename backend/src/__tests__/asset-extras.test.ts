/**
 * asset-extras.test.ts — Tests for asset endpoints not covered by assets.test.ts.
 *
 * Covers:
 *   - GET  /api/assets/maintenance-counts — overdue / due_soon counts
 *   - POST /api/assets/:id/sync           — ITSM sync (mock mode)
 *   - GET  /api/assets?page=&limit=       — pagination: totalPages, page in meta
 *   - POST /api/assets/bulk               — bulk create 2+ assets, validate order
 */
import request from 'supertest';
import { AppDataSource } from '../config/database';
import { Asset } from '../entities/Asset.entity';
import { setupTests } from './helpers/testApp';

let app: any; // eslint-disable-line @typescript-eslint/no-explicit-any
let adminToken: string;
const createdAssetIds: string[] = [];

beforeAll(async () => {
  let getAdminToken: () => Promise<string>;
  ({ app, getAdminToken } = await setupTests());
  adminToken = await getAdminToken();
}, 30000);

afterAll(async () => {
  if (createdAssetIds.length > 0) {
    await AppDataSource.getRepository(Asset)
      .createQueryBuilder()
      .delete()
      .whereInIds(createdAssetIds)
      .execute();
  }
});

// ── Maintenance counts ────────────────────────────────────────────────────────

describe('GET /api/assets/maintenance-counts', () => {
  it('returns overdue and due_soon counts', async () => {
    const res = await request(app)
      .get('/api/assets/maintenance-counts')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('overdue');
    expect(res.body.data).toHaveProperty('due_soon');
    expect(typeof res.body.data.overdue).toBe('number');
    expect(typeof res.body.data.due_soon).toBe('number');
  });

  it('counts an asset with a past maint_next_date as overdue', async () => {
    const yesterday = new Date(Date.now() - 86400_000).toISOString().split('T')[0];
    const res = await request(app)
      .post('/api/assets')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ basic_info: { display_name: 'Overdue Asset' }, maintenance: { next_date: yesterday } });
    if (res.status === 201) createdAssetIds.push(res.body.data._id ?? res.body.data.id);

    const counts = await request(app)
      .get('/api/assets/maintenance-counts')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(counts.status).toBe(200);
    expect(counts.body.data.overdue).toBeGreaterThan(0);
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/assets/maintenance-counts');
    expect(res.status).toBe(401);
  });
});

// ── ITSM sync ─────────────────────────────────────────────────────────────────

describe('POST /api/assets/:id/sync', () => {
  it('returns 400 when asset is not ITSM-managed', async () => {
    const createRes = await request(app)
      .post('/api/assets')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ basic_info: { display_name: 'Unmanaged Asset For Sync' } });
    const assetId = createRes.body.data._id ?? createRes.body.data.id;
    createdAssetIds.push(assetId);

    const res = await request(app)
      .post(`/api/assets/${assetId}/sync`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not.*ITSM managed/i);
  });

  it('returns 404 for a non-existent asset', async () => {
    const res = await request(app)
      .post('/api/assets/00000000-0000-0000-0000-000000000000/sync')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });

  it('syncs successfully for an ITSM-managed asset', async () => {
    const createRes = await request(app)
      .post('/api/assets')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        basic_info: { display_name: 'Managed Asset For Sync', type: 'workstation' },
        itsm: { is_managed: true, hardware_asset_id: 'HW-9999' },
      });
    const assetId = createRes.body.data._id ?? createRes.body.data.id;
    createdAssetIds.push(assetId);

    const res = await request(app)
      .post(`/api/assets/${assetId}/sync`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toMatch(/synced/i);
  });
});

// ── Pagination ────────────────────────────────────────────────────────────────

describe('GET /api/assets — pagination', () => {
  it('returns meta.page, meta.limit, meta.totalPages with explicit params', async () => {
    const res = await request(app)
      .get('/api/assets?page=1&limit=5')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.meta.page).toBe(1);
    expect(res.body.meta.limit).toBe(5);
    expect(typeof res.body.meta.totalPages).toBe('number');
    expect(res.body.meta.totalPages).toBeGreaterThanOrEqual(1);
  });

  it('page 2 returns a different first item than page 1 (when total > limit)', async () => {
    const p1 = await request(app)
      .get('/api/assets?page=1&limit=1')
      .set('Authorization', `Bearer ${adminToken}`);
    const p2 = await request(app)
      .get('/api/assets?page=2&limit=1')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(p1.status).toBe(200);
    expect(p2.status).toBe(200);
    if (p1.body.meta.totalPages > 1 && p2.body.data.length > 0) {
      expect(p1.body.data[0]._id).not.toBe(p2.body.data[0]._id);
    }
  });

  it('returns data and meta.total for no-pagination request', async () => {
    const res = await request(app)
      .get('/api/assets')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.meta).toHaveProperty('total');
    expect(typeof res.body.meta.total).toBe('number');
  });
});

// ── Bulk create ───────────────────────────────────────────────────────────────

describe('POST /api/assets/bulk', () => {
  it('creates multiple assets in one request (207 Multi-Status)', async () => {
    // bulkCreateAssets returns 207 with { data: { succeeded, failed, results: [{index, success, id}] } }
    const res = await request(app)
      .post('/api/assets/bulk')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        assets: [
          { basic_info: { display_name: 'Bulk IPC-001', type: 'IPC', status: 'active' } },
          { basic_info: { display_name: 'Bulk IPC-002', type: 'IPC', status: 'active' } },
          { basic_info: { display_name: 'Bulk SRV-001', type: 'Server', status: 'maintenance' } },
        ],
      });
    expect(res.status).toBe(207);
    expect(Array.isArray(res.body.data.results)).toBe(true);
    expect(res.body.data.results.length).toBe(3);
    expect(res.body.data.succeeded).toBe(3);
    for (const item of res.body.data.results) {
      if (item.success && item.id) createdAssetIds.push(item.id);
    }
  });

  it('all bulk assets are created successfully', async () => {
    const res = await request(app)
      .post('/api/assets/bulk')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        assets: [
          { basic_info: { display_name: 'Named-Alpha' } },
          { basic_info: { display_name: 'Named-Beta' } },
        ],
      });
    expect(res.status).toBe(207);
    expect(res.body.data.succeeded).toBe(2);
    expect(res.body.data.failed).toBe(0);
    for (const item of res.body.data.results) {
      if (item.success && item.id) createdAssetIds.push(item.id);
    }
  });

  it('returns 400 for an empty assets array', async () => {
    const res = await request(app)
      .post('/api/assets/bulk')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ assets: [] });
    expect(res.status).toBe(400);
  });

  it('returns 403 for a viewer token', async () => {
    // Create a viewer
    const vUser = `bulk_viewer_${Date.now()}`;
    await request(app)
      .post('/api/users')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ username: vUser, password: 'Viewer@9999', role: 'viewer' });
    const vLogin = await request(app).post('/api/auth/login').send({ username: vUser, password: 'Viewer@9999' });
    const vToken = vLogin.body.data.token;

    const res = await request(app)
      .post('/api/assets/bulk')
      .set('Authorization', `Bearer ${vToken}`)
      .send({ assets: [{ basic_info: { display_name: 'Viewer Bulk Attempt' } }] });
    expect(res.status).toBe(403);
  });
});
