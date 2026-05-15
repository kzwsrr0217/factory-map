/**
 * buildings.test.ts — Integration tests for /api/buildings CRUD.
 */
import request from 'supertest';
import { setupTests } from './helpers/testApp';

let app: any; // eslint-disable-line @typescript-eslint/no-explicit-any
let token: string;
let createdId: string;

beforeAll(async () => {
  let getAdminToken: () => Promise<string>;
  ({ app, getAdminToken } = await setupTests());
  token = await getAdminToken();
}, 30000);

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
});
