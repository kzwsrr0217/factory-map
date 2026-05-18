/**
 * floors.test.ts — Integration tests for floor CRUD.
 *
 * Covers:
 *   - GET  /api/floors               — list all floors, filter by building_id
 *   - GET  /api/floors/:id           — get by id; 404 on unknown
 *   - POST /api/floors               — create: success, duplicate floor_number
 *   - PATCH /api/floors/:id          — update name, floor_number; duplicate number rejection
 *   - DELETE /api/floors/:id         — delete: success; 404 on unknown
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
