/**
 * buildings.test.ts — Integration tests for /api/buildings CRUD.
 */
import request from 'supertest';
import { AppDataSource } from '../config/database';
import { Building } from '../entities/Building.entity';
import { setupTests } from './helpers/testApp';

let app: any; // eslint-disable-line @typescript-eslint/no-explicit-any
let token: string;
let createdId: string;

beforeAll(async () => {
  let getAdminToken: () => Promise<string>;
  ({ app, getAdminToken } = await setupTests());
  token = await getAdminToken();
}, 30000);

afterAll(async () => {
  // Fallback cleanup: remove __test_building__ if the DELETE test was skipped or failed
  await AppDataSource.getRepository(Building)
    .createQueryBuilder()
    .delete()
    .where('name IN (:...names)', { names: ['__test_building__', '__test_building_updated__'] })
    .execute();
});

describe('GET /api/buildings', () => {
  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/buildings');
    expect(res.status).toBe(401);
  });

  it('returns an array of buildings', async () => {
    const res = await request(app)
      .get('/api/buildings')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data ?? res.body)).toBe(true);
  });
});

describe('POST /api/buildings', () => {
  it('creates a building', async () => {
    const res = await request(app)
      .post('/api/buildings')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '__test_building__', address: 'Test Street 1' });
    expect(res.status).toBe(201);
    expect(res.body.data?.name ?? res.body.name).toBe('__test_building__');
    createdId = res.body.data?.id ?? res.body.id ?? res.body.data?._id ?? res.body._id;
    expect(createdId).toBeDefined();
  });

  it('returns 400 when name is missing', async () => {
    const res = await request(app)
      .post('/api/buildings')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe('GET /api/buildings/:id', () => {
  it('returns the building by id', async () => {
    if (!createdId) return;
    const res = await request(app)
      .get(`/api/buildings/${createdId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it('returns 404 for unknown id', async () => {
    const res = await request(app)
      .get('/api/buildings/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/buildings/:id', () => {
  it('updates the building', async () => {
    if (!createdId) return;
    const res = await request(app)
      .patch(`/api/buildings/${createdId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '__test_building_updated__' });
    expect(res.status).toBe(200);
  });
});

describe('DELETE /api/buildings/:id', () => {
  it('deletes the building', async () => {
    if (!createdId) return;
    const res = await request(app)
      .delete(`/api/buildings/${createdId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
  });

  it('cascades delete through floors/workareas/sections/workstations', async () => {
    // Build a full hierarchy inside a dedicated building
    const bRes = await request(app)
      .post('/api/buildings')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: `cascade_bldg_${Date.now()}` });
    const bId = bRes.body.data._id;

    const fRes = await request(app)
      .post('/api/floors')
      .set('Authorization', `Bearer ${token}`)
      .send({ building_id: bId, floor_number: 1, name: 'Cascade Floor' });
    const fId = fRes.body.data._id;

    const waRes = await request(app)
      .post('/api/workareas')
      .set('Authorization', `Bearer ${token}`)
      .send({ floor_id: fId, name: 'Cascade WA' });
    const waId = waRes.body.data._id;

    await request(app)
      .post('/api/sections')
      .set('Authorization', `Bearer ${token}`)
      .send({ workarea_id: waId, name: 'Cascade Section' });

    // Delete the building — should cascade cleanly (200)
    const delRes = await request(app)
      .delete(`/api/buildings/${bId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(delRes.status).toBe(200);

    // Floor should be gone
    const floorRes = await request(app)
      .get(`/api/floors/${fId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(floorRes.status).toBe(404);
  });

  it('returns 400 when building has assets assigned', async () => {
    const bRes = await request(app)
      .post('/api/buildings')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: `blocked_bldg_${Date.now()}` });
    const bId = bRes.body.data._id;

    // Assign an asset to this building
    const aRes = await request(app)
      .post('/api/assets')
      .set('Authorization', `Bearer ${token}`)
      .send({ basic_info: { display_name: 'Blocking Asset' }, hierarchy: { building_id: bId } });
    const aId = aRes.body.data._id ?? aRes.body.data.id;

    const res = await request(app)
      .delete(`/api/buildings/${bId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/asset/i);

    // Clean up asset then building
    await request(app).delete(`/api/assets/${aId}`).set('Authorization', `Bearer ${token}`);
    await request(app).delete(`/api/buildings/${bId}`).set('Authorization', `Bearer ${token}`);
  });

  it('returns 404 for unknown id', async () => {
    const res = await request(app)
      .delete('/api/buildings/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});
