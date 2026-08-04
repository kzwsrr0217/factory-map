/**
 * floors.test.ts — Integration tests for floor CRUD.
 *
 * Covers:
 *   - GET  /api/floors               — list all floors, filter by building_id
 *   - GET  /api/floors/:id           — get by id; 404 on unknown
 *   - POST /api/floors               — create: success, duplicate floor_number
 *   - PATCH /api/floors/:id          — update name, floor_number; duplicate number rejection
 *   - DELETE /api/floors/:id         — delete: success; 404 on unknown
 *   - GET  /api/floors/progress      — survey state per floor, counted server-side
 *
 * Each test creates its own building and floor so there are no cross-test dependencies.
 */
import request from 'supertest';
import { AppDataSource } from '../config/database';
import { Building } from '../entities/Building.entity';
import { Floor } from '../entities/Floor.entity';
import { setupTests } from './helpers/testApp';

let app: any; // eslint-disable-line @typescript-eslint/no-explicit-any
let adminToken: string;
let buildingId: string;

const FLOOR_PREFIX = `fl_bldg_${Date.now()}`;

beforeAll(async () => {
  let getAdminToken: () => Promise<string>;
  ({ app, getAdminToken } = await setupTests());
  adminToken = await getAdminToken();

  // Create a shared building for floor tests
  const res = await request(app)
    .post('/api/buildings')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: FLOOR_PREFIX });
  if (res.status !== 201) throw new Error(`Building setup failed: ${JSON.stringify(res.body)}`);
  buildingId = res.body.data._id;
}, 30000);

afterAll(async () => {
  // Delete floors then the building
  await AppDataSource.getRepository(Floor)
    .createQueryBuilder()
    .delete()
    .where('building_id = :id', { id: buildingId })
    .execute();
  await AppDataSource.getRepository(Building).delete({ id: buildingId });
});

// ── List floors ───────────────────────────────────────────────────────────────

describe('GET /api/floors', () => {
  it('returns a list of floors', async () => {
    const res = await request(app)
      .get('/api/floors')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('filters by building_id', async () => {
    // Create a floor so there is at least one result
    await request(app)
      .post('/api/floors')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ building_id: buildingId, floor_number: 50, name: 'Filter Test Floor' });

    const res = await request(app)
      .get(`/api/floors?building_id=${buildingId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    for (const floor of res.body.data) {
      expect(floor.building_id).toBe(buildingId);
    }
  });
});

// ── Get floor by id ───────────────────────────────────────────────────────────

describe('GET /api/floors/:id', () => {
  let floorId: string;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/floors')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ building_id: buildingId, floor_number: 60, name: 'Get By Id Floor' });
    floorId = res.body.data._id;
  });

  it('returns the floor by id', async () => {
    const res = await request(app)
      .get(`/api/floors/${floorId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data._id).toBe(floorId);
    expect(res.body.data.floor_number).toBe(60);
  });

  it('returns 404 for a non-existent id', async () => {
    const res = await request(app)
      .get('/api/floors/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });
});

// ── Create floor ──────────────────────────────────────────────────────────────

describe('POST /api/floors', () => {
  it('creates a floor successfully', async () => {
    const res = await request(app)
      .post('/api/floors')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ building_id: buildingId, floor_number: 1, name: 'Ground Floor' });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.floor_number).toBe(1);
    expect(res.body.data.building_id).toBe(buildingId);
  });

  it('returns 400 for duplicate floor_number in the same building', async () => {
    // floor_number 1 was already created above
    const res = await request(app)
      .post('/api/floors')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ building_id: buildingId, floor_number: 1, name: 'Dupe Floor' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already exists/i);
  });

  it('allows the same floor_number in a different building', async () => {
    const b2 = await request(app)
      .post('/api/buildings')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: `${FLOOR_PREFIX}_b2` });
    const b2Id = b2.body.data._id;

    const res = await request(app)
      .post('/api/floors')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ building_id: b2Id, floor_number: 1, name: 'Ground Floor B2' });
    expect(res.status).toBe(201);

    // Clean up — building cascade-deletes its floors
    await request(app)
      .delete(`/api/buildings/${b2Id}`)
      .set('Authorization', `Bearer ${adminToken}`);
  });
});

// ── Update floor ──────────────────────────────────────────────────────────────

describe('PATCH /api/floors/:id', () => {
  let floorId: string;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/floors')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ building_id: buildingId, floor_number: 10, name: 'Update Me' });
    floorId = res.body.data._id;
  });

  it('updates the floor name', async () => {
    const res = await request(app)
      .patch(`/api/floors/${floorId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Updated Name' });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Updated Name');
  });

  it('updates the floor_number', async () => {
    const res = await request(app)
      .patch(`/api/floors/${floorId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ floor_number: 11 });
    expect(res.status).toBe(200);
    expect(res.body.data.floor_number).toBe(11);
  });

  it('returns 400 when setting floor_number to an existing one', async () => {
    // floor_number 1 exists in this building from the create test
    const res = await request(app)
      .patch(`/api/floors/${floorId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ floor_number: 1 });
    expect(res.status).toBe(400);
  });

  it('returns 404 for a non-existent id', async () => {
    const res = await request(app)
      .patch('/api/floors/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Ghost' });
    expect(res.status).toBe(404);
  });
});

// ── Delete floor ──────────────────────────────────────────────────────────────

describe('DELETE /api/floors/:id', () => {
  it('deletes an empty floor', async () => {
    const createRes = await request(app)
      .post('/api/floors')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ building_id: buildingId, floor_number: 99, name: 'Delete Me' });
    const floorId = createRes.body.data._id;

    const res = await request(app)
      .delete(`/api/floors/${floorId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // Confirm it's gone
    const getRes = await request(app)
      .get(`/api/floors/${floorId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(getRes.status).toBe(404);
  });

  it('returns 400 when the floor has assets assigned', async () => {
    const createRes = await request(app)
      .post('/api/floors')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ building_id: buildingId, floor_number: 98, name: 'Floor With Asset' });
    const floorId = createRes.body.data._id;

    // Assign an asset to this floor
    const aRes = await request(app)
      .post('/api/assets')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ basic_info: { display_name: 'Floor Blocking Asset' }, hierarchy: { floor_id: floorId } });
    const assetId = aRes.body.data._id ?? aRes.body.data.id;

    const res = await request(app)
      .delete(`/api/floors/${floorId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/asset/i);

    // Clean up
    await request(app).delete(`/api/assets/${assetId}`).set('Authorization', `Bearer ${adminToken}`);
    await request(app).delete(`/api/floors/${floorId}`).set('Authorization', `Bearer ${adminToken}`);
  });

  it('returns 404 for a non-existent floor', async () => {
    const res = await request(app)
      .delete('/api/floors/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });
});

// ── Floor plan file serving (svg_ref) ────────────────────────────────────────
// See backend/src/controllers/floor.controller.ts getFloorSvg and
// docs/DATA_MODEL_MIGRATION.md (phase 4/6) — files live under
// backend/src/floorplans/, checked into the repo.

describe('GET /api/floors/:id/svg', () => {
  let floorWithSvgId: string;
  let floorWithoutSvgId: string;

  beforeAll(async () => {
    const withSvg = await request(app)
      .post('/api/floors')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ building_id: buildingId, floor_number: 70, name: 'Floor With SVG' });
    floorWithSvgId = withSvg.body.data._id;
    await request(app)
      .patch(`/api/floors/${floorWithSvgId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ svg_ref: 'werk1-ground-floor.svg', scale_meters_per_unit: 1 });

    const withoutSvg = await request(app)
      .post('/api/floors')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ building_id: buildingId, floor_number: 71, name: 'Floor Without SVG' });
    floorWithoutSvgId = withoutSvg.body.data._id;
  });

  it('serves the SVG file content when svg_ref is set', async () => {
    const res = await request(app)
      .get(`/api/floors/${floorWithSvgId}/svg`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/svg\+xml/);
    // superagent only populates res.text for 'text/*' content types — for
    // 'image/svg+xml' the body arrives as a Buffer in res.body instead.
    const body = res.text || (Buffer.isBuffer(res.body) ? res.body.toString('utf8') : '');
    expect(body).toContain('<svg');
    expect(body).toContain('work-centers');
  });

  it('returns 404 when the floor has no svg_ref', async () => {
    const res = await request(app)
      .get(`/api/floors/${floorWithoutSvgId}/svg`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });

  it('returns 404 for a non-existent floor', async () => {
    const res = await request(app)
      .get('/api/floors/00000000-0000-0000-0000-000000000000/svg')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });

  it('rejects a path-traversal svg_ref instead of serving an arbitrary file', async () => {
    await request(app)
      .patch(`/api/floors/${floorWithSvgId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ svg_ref: '../../../.env' });

    const res = await request(app)
      .get(`/api/floors/${floorWithSvgId}/svg`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(400);
  });
});


// ── Survey progress ───────────────────────────────────────────────────────────

describe('GET /api/floors/progress', () => {
  const auth = () => ({ Authorization: `Bearer ${adminToken}` });
  const created: { assets: string[]; sockets: string[]; areas: string[]; floors: string[] } =
    { assets: [], sockets: [], areas: [], floors: [] };

  afterAll(async () => {
    for (const id of created.assets) {
      await request(app).delete(`/api/assets/${id}`).set(auth());
    }
    for (const id of created.sockets) {
      await request(app).delete(`/api/network/wall-ports/${id}`).set(auth());
    }
    for (const id of created.areas) {
      await request(app).delete(`/api/workareas/${id}`).set(auth());
    }
    for (const id of created.floors) {
      await request(app).delete(`/api/floors/${id}`).set(auth());
    }
  });

  it('counts rooms, placed devices and socket states for a floor', async () => {
    const floorRes = await request(app).post('/api/floors').set(auth())
      .send({ building_id: buildingId, floor_number: 91, name: `${FLOOR_PREFIX}_progress` });
    const floorId = floorRes.body.data._id;
    created.floors.push(floorId);

    const areaRes = await request(app).post('/api/workareas').set(auth())
      .send({ name: `${FLOOR_PREFIX}_area`, floor_id: floorId, coordinates: { x: 10, y: 10 }, dimensions: { width: 100, height: 80 } });
    created.areas.push(areaRes.body.data._id);

    // One device standing on the plan, one only assigned to the floor.
    const placed = await request(app).post('/api/assets').set(auth()).send({
      basic_info: { display_name: `${FLOOR_PREFIX}_placed` },
      hierarchy: { building_id: buildingId, floor_id: floorId },
      location: { coordinates: { x: 40, y: 40 } },
    });
    created.assets.push(placed.body.data._id);
    const assigned = await request(app).post('/api/assets').set(auth()).send({
      basic_info: { display_name: `${FLOOR_PREFIX}_assigned` },
      hierarchy: { building_id: buildingId, floor_id: floorId },
    });
    created.assets.push(assigned.body.data._id);

    const socket = await request(app).post('/api/network/wall-ports').set(auth())
      .send({ label: `${FLOOR_PREFIX}/001`, floor_id: floorId });
    created.sockets.push(socket.body.data._id);

    const res = await request(app).get('/api/floors/progress').set(auth());
    expect(res.status).toBe(200);
    const row = res.body.data.find((f: any) => f.floor_id === floorId);
    expect(row).toBeDefined();
    expect(row.building_name).toBe(FLOOR_PREFIX);
    expect(row.work_areas).toBe(1);
    // `total` is what belongs on this plan; `placed` is what actually stands on it.
    expect(row.assets).toEqual({ total: 2, placed: 1 });
    // An unpatched socket counts as recorded but neither patched nor live — the
    // distinction the whole cabling workflow rests on.
    expect(row.sockets.total).toBe(1);
    expect(row.sockets.patched).toBe(0);
    expect(row.sockets.live).toBe(0);
    expect(row.sockets.occupied).toBe(0);
  });

  it('reports devices belonging to no floor as the backlog', async () => {
    const homeless = await request(app).post('/api/assets').set(auth())
      .send({ basic_info: { display_name: `${FLOOR_PREFIX}_nofloor` } });
    created.assets.push(homeless.body.data._id);

    const res = await request(app).get('/api/floors/progress').set(auth());
    expect(res.status).toBe(200);
    // Counted in meta rather than as a floor row: a per-floor table alone would look
    // finished while the estate sits outside the building.
    expect(res.body.meta.unassigned_assets).toBeGreaterThanOrEqual(1);
    expect(res.body.data.some((f: any) => f.floor_id === null)).toBe(false);
  });

  it('is not read as a floor id', async () => {
    // The route sits before /:id; without that ordering "progress" would 404 here.
    const res = await request(app).get('/api/floors/progress').set(auth());
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});
