/**
 * workareas.test.ts — Integration tests for work area CRUD.
 *
 * Covers:
 *   - GET  /api/workareas               — list all; filter by floor_id
 *   - GET  /api/workareas/:id           — get by id; 404 on unknown
 *   - POST /api/workareas               — create with position/dimensions
 *   - PATCH /api/workareas/:id          — update name, coordinates
 *   - DELETE /api/workareas/:id         — delete; 404 on unknown
 *
 * Creates its own building → floor → work areas in beforeAll.
 */
import request from 'supertest';
import { AppDataSource } from '../config/database';
import { Building } from '../entities/Building.entity';
import { Floor } from '../entities/Floor.entity';
import { WorkArea } from '../entities/WorkArea.entity';
import { setupTests } from './helpers/testApp';

let app: any; // eslint-disable-line @typescript-eslint/no-explicit-any
let adminToken: string;
let floorId: string;
let buildingId: string;

const WA_PREFIX = `wa_${Date.now()}`;

beforeAll(async () => {
  let getAdminToken: () => Promise<string>;
  ({ app, getAdminToken } = await setupTests());
  adminToken = await getAdminToken();

  const bRes = await request(app)
    .post('/api/buildings')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: WA_PREFIX });
  buildingId = bRes.body.data._id;

  const fRes = await request(app)
    .post('/api/floors')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ building_id: buildingId, floor_number: 1, name: 'WA Test Floor' });
  floorId = fRes.body.data._id;
}, 30000);

afterAll(async () => {
  await AppDataSource.getRepository(WorkArea).createQueryBuilder().delete().where('floor_id = :id', { id: floorId }).execute();
  await AppDataSource.getRepository(Floor).delete({ id: floorId });
  await AppDataSource.getRepository(Building).delete({ id: buildingId });
});

// ── List ──────────────────────────────────────────────────────────────────────

describe('GET /api/workareas', () => {
  it('returns an array of work areas', async () => {
    const res = await request(app).get('/api/workareas').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('filters by floor_id', async () => {
    await request(app)
      .post('/api/workareas')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ floor_id: floorId, name: 'Filter WA' });

    const res = await request(app)
      .get(`/api/workareas?floor_id=${floorId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    for (const wa of res.body.data) {
      expect(wa.floor_id).toBe(floorId);
    }
  });
});

// ── Get by id ─────────────────────────────────────────────────────────────────

describe('GET /api/workareas/:id', () => {
  let waId: string;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/workareas')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ floor_id: floorId, name: 'Get By Id WA' });
    waId = res.body.data._id;
  });

  it('returns the work area by id', async () => {
    const res = await request(app)
      .get(`/api/workareas/${waId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data._id).toBe(waId);
  });

  it('returns 404 for unknown id', async () => {
    const res = await request(app)
      .get('/api/workareas/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });
});

// ── Create ────────────────────────────────────────────────────────────────────

describe('POST /api/workareas', () => {
  it('creates a work area with default position', async () => {
    const res = await request(app)
      .post('/api/workareas')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ floor_id: floorId, name: 'Assembly Area' });
    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('Assembly Area');
    expect(res.body.data.floor_id).toBe(floorId);
  });

  it('creates a work area with explicit coordinates and dimensions', async () => {
    const res = await request(app)
      .post('/api/workareas')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        floor_id: floorId,
        name: 'Precise WA',
        coordinates: { x: 100, y: 200 },
        dimensions: { width: 300, height: 150 },
      });
    expect(res.status).toBe(201);
    expect(res.body.data.coordinates.x).toBe(100);
    expect(res.body.data.coordinates.y).toBe(200);
    expect(res.body.data.dimensions.width).toBe(300);
    expect(res.body.data.dimensions.height).toBe(150);
  });
});

// ── Update ────────────────────────────────────────────────────────────────────

describe('PATCH /api/workareas/:id', () => {
  let waId: string;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/workareas')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ floor_id: floorId, name: 'Update Me WA' });
    waId = res.body.data._id;
  });

  it('updates the name', async () => {
    const res = await request(app)
      .patch(`/api/workareas/${waId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Updated WA Name' });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Updated WA Name');
  });

  it('updates coordinates', async () => {
    const res = await request(app)
      .patch(`/api/workareas/${waId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ coordinates: { x: 50, y: 75 } });
    expect(res.status).toBe(200);
    expect(res.body.data.coordinates.x).toBe(50);
    expect(res.body.data.coordinates.y).toBe(75);
  });

  it('returns 404 for unknown id', async () => {
    const res = await request(app)
      .patch('/api/workareas/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Ghost' });
    expect(res.status).toBe(404);
  });
});

// ── Delete ────────────────────────────────────────────────────────────────────

describe('DELETE /api/workareas/:id', () => {
  it('deletes a work area', async () => {
    const createRes = await request(app)
      .post('/api/workareas')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ floor_id: floorId, name: 'Delete Me WA' });
    const waId = createRes.body.data._id;

    const res = await request(app)
      .delete(`/api/workareas/${waId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const getRes = await request(app)
      .get(`/api/workareas/${waId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(getRes.status).toBe(404);
  });

  it('returns 404 for unknown id', async () => {
    const res = await request(app)
      .delete('/api/workareas/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });
});
