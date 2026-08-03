/**
 * assets.test.ts — Integration tests for /api/assets CRUD.
 *
 * Asset creation uses the nested body format required by applyBodyToAsset():
 *   { basic_info: { display_name: '...' }, location: { building_id: '...' } }
 */
import request from 'supertest';
import { AppDataSource } from '../config/database';
import { MasterAsset } from '../entities/MasterAsset.entity';
import { EntityKind } from '../entities/EntityKind.entity';
import { setupTests } from './helpers/testApp';

let app: any; // eslint-disable-line @typescript-eslint/no-explicit-any
let token: string;
let createdId: string;

beforeAll(async () => {
  let getAdminToken: () => Promise<string>;
  ({ app, getAdminToken } = await setupTests());
  token = await getAdminToken();
}, 30000);

describe('GET /api/assets', () => {
  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/assets');
    expect(res.status).toBe(401);
  });

  it('returns an asset list', async () => {
    const res = await request(app)
      .get('/api/assets')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('supports search query parameter', async () => {
    const res = await request(app)
      .get('/api/assets?search=test')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });
});

describe('GET /api/assets/lookups', () => {
  it('returns lookup arrays', async () => {
    const res = await request(app)
      .get('/api/assets/lookups')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

describe('POST /api/assets', () => {
  it('does not count an asset as placed just because it has a floor', async () => {
    // Regression: loc_x/loc_y carry a DB default of 0, so on a freshly created
    // entity they are still undefined in memory - and `undefined !== 0` is true.
    // That marked every asset created with a floor but no coordinates as placed,
    // which put it in the map's top-left corner and kept it out of the unplaced
    // tray, i.e. invisible in the one list that exists to surface it. This is
    // exactly what the inventory survey produces: a room, but no position.
    const building = await request(app)
      .post('/api/buildings')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: `__placed_probe_${Date.now()}__` });
    const floor = await request(app)
      .post('/api/floors')
      .set('Authorization', `Bearer ${token}`)
      .send({ building_id: building.body.data._id, floor_number: 1, name: 'Probe Floor' });

    const res = await request(app)
      .post('/api/assets')
      .set('Authorization', `Bearer ${token}`)
      .send({
        basic_info: { display_name: '__test_unplaced__' },
        hierarchy: { building_id: building.body.data._id, floor_id: floor.body.data._id },
      });

    expect(res.status).toBe(201);
    expect(res.body.data.is_placed).toBe(false);

    await request(app).delete(`/api/assets/${res.body.data._id}`).set('Authorization', `Bearer ${token}`);
    await request(app).delete(`/api/floors/${floor.body.data._id}`).set('Authorization', `Bearer ${token}`);
    await request(app).delete(`/api/buildings/${building.body.data._id}`).set('Authorization', `Bearer ${token}`);
  });

  it('creates an asset with nested body', async () => {
    const res = await request(app)
      .post('/api/assets')
      .set('Authorization', `Bearer ${token}`)
      .send({
        basic_info: {
          display_name: '__test_asset__',
          asset_type: 'IPC',
          status: 'active',
        },
      });
    expect(res.status).toBe(201);
    const data = res.body.data ?? res.body;
    expect(data.basic_info?.display_name ?? data.display_name).toBe('__test_asset__');
    createdId = data._id ?? data.id;
    expect(createdId).toBeDefined();
  });

  it('returns 400 when display_name is missing', async () => {
    const res = await request(app)
      .post('/api/assets')
      .set('Authorization', `Bearer ${token}`)
      .send({ basic_info: {} });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe('GET /api/assets/:id', () => {
  it('returns the created asset by id', async () => {
    if (!createdId) return;
    const res = await request(app)
      .get(`/api/assets/${createdId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('returns 404 for unknown id', async () => {
    const res = await request(app)
      .get('/api/assets/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/assets/:id', () => {
  it('updates asset fields', async () => {
    if (!createdId) return;
    const res = await request(app)
      .patch(`/api/assets/${createdId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ basic_info: { display_name: '__test_asset_updated__' } });
    expect(res.status).toBe(200);
  });
});

describe('DELETE /api/assets/:id', () => {
  it('deletes the asset', async () => {
    if (!createdId) return;
    const res = await request(app)
      .delete(`/api/assets/${createdId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });
});

// ── Master data join (MasterAsset, see MasterAsset.entity.ts) + entity_kind ──
// No live IFS/Databricks connection — MasterAsset rows are inserted directly
// via the repository, mirroring how the seed script populates it.

describe('Asset master_ifs_id join and entity_kind', () => {
  const IFS_ID = `test_ifs_${Date.now()}`;
  let assetId: string;

  beforeAll(async () => {
    await AppDataSource.getRepository(MasterAsset).save(
      AppDataSource.getRepository(MasterAsset).create({
        ifs_id: IFS_ID,
        ifs_site: 'TESTSITE',
        cmdb_status: 'Deployed',
        cmdb_id: 'HWA00000',
      })
    );

    const res = await request(app)
      .post('/api/assets')
      .set('Authorization', `Bearer ${token}`)
      .send({
        basic_info: { display_name: '__test_master_join_asset__' },
        master_ifs_id: IFS_ID,
        entity_kind: 'shopfloorCockpit',
      });
    assetId = res.body.data._id;
  });

  afterAll(async () => {
    if (assetId) await request(app).delete(`/api/assets/${assetId}`).set('Authorization', `Bearer ${token}`);
    await AppDataSource.getRepository(MasterAsset).delete({ ifs_id: IFS_ID });
  });

  it('resolves the joined master data and entity_kind on GET /api/assets/:id', async () => {
    const res = await request(app).get(`/api/assets/${assetId}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.master_ifs_id).toBe(IFS_ID);
    expect(res.body.data.entity_kind).toBe('shopfloorCockpit');
    expect(res.body.data.master).not.toBeNull();
    expect(res.body.data.master.ifs_id).toBe(IFS_ID);
    expect(res.body.data.master.cmdb_status).toBe('Deployed');
  });

  it('resolves the joined master data via GET /api/assets?include_master=true', async () => {
    const res = await request(app)
      .get(`/api/assets?q=__test_master_join_asset__&include_master=true`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const found = res.body.data.find((a: { _id: string }) => a._id === assetId);
    expect(found).toBeDefined();
    expect(found.master?.ifs_id).toBe(IFS_ID);
  });

  it('does not delete the asset when master_ifs_id points to a non-existent MasterAsset row (orphan-safe)', async () => {
    const patchRes = await request(app)
      .patch(`/api/assets/${assetId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ master_ifs_id: 'nonexistent-orphan-ifs-id' });
    expect(patchRes.status).toBe(200);

    const getRes = await request(app).get(`/api/assets/${assetId}`).set('Authorization', `Bearer ${token}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.data.master_ifs_id).toBe('nonexistent-orphan-ifs-id');
    expect(getRes.body.data.master).toBeNull();
  });
});

// ── Footprint pre-fill from EntityKind (see asset.controller.ts
// fillFootprintFromEntityKind) — mirrors shopfloor_visualizer's
// objectTypeTemplates convention (FR-6b): first placement only.

describe('Asset footprint pre-fill from EntityKind', () => {
  const EK_VALUE = `test_footprint_kind_${Date.now()}`;
  const FOOTPRINT = [[-50, -20], [50, -20], [50, 20], [-50, 20]];
  let assetId: string;

  beforeAll(async () => {
    await AppDataSource.getRepository(EntityKind).save(
      AppDataSource.getRepository(EntityKind).create({
        value: EK_VALUE, label: 'Footprint Test Kind', geometry_type: 'point', footprint: FOOTPRINT,
      })
    );
  });

  afterAll(async () => {
    if (assetId) await request(app).delete(`/api/assets/${assetId}`).set('Authorization', `Bearer ${token}`);
    await AppDataSource.getRepository(EntityKind).delete({ value: EK_VALUE });
  });

  it('does not fill a footprint for an unplaced asset', async () => {
    const res = await request(app)
      .post('/api/assets')
      .set('Authorization', `Bearer ${token}`)
      .send({ basic_info: { display_name: '__test_footprint_unplaced__' }, entity_kind: EK_VALUE });
    assetId = res.body.data._id;
    expect(res.body.data.location.footprint).toBeNull();
  });

  it('fills the footprint from the EntityKind on first placement', async () => {
    const res = await request(app)
      .patch(`/api/assets/${assetId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ location: { coordinates: { x: 100, y: 200 } } });
    expect(res.status).toBe(200);
    expect(res.body.data.location.footprint).toEqual(FOOTPRINT);
  });

  it('does not overwrite the footprint on a later move', async () => {
    const res = await request(app)
      .patch(`/api/assets/${assetId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ location: { coordinates: { x: 150, y: 250 } } });
    expect(res.status).toBe(200);
    expect(res.body.data.location.footprint).toEqual(FOOTPRINT);
  });

  it('never overwrites an explicitly-set footprint', async () => {
    const customFootprint = [[0, 0], [10, 0], [10, 10]];
    const createRes = await request(app)
      .post('/api/assets')
      .set('Authorization', `Bearer ${token}`)
      .send({
        basic_info: { display_name: '__test_footprint_explicit__' },
        entity_kind: EK_VALUE,
        location: { coordinates: { x: 1, y: 1 }, footprint: customFootprint },
      });
    expect(createRes.body.data.location.footprint).toEqual(customFootprint);
    await request(app).delete(`/api/assets/${createRes.body.data._id}`).set('Authorization', `Bearer ${token}`);
  });
});
