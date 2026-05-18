/**
 * sections.test.ts — Integration tests for section CRUD.
 *
 * Covers:
 *   - GET  /api/sections              — list all; filter by workarea_id
 *   - GET  /api/sections/:id          — get by id; 404 on unknown
 *   - POST /api/sections              — create with optional capacity/shift_schedule
 *   - PATCH /api/sections/:id         — update name, capacity
 *   - DELETE /api/sections/:id        — delete; 404 on unknown
 *
 * Creates building → floor → work area → sections in beforeAll.
 */
import request from 'supertest';
import { AppDataSource } from '../config/database';
import { Building } from '../entities/Building.entity';
import { Floor } from '../entities/Floor.entity';
import { WorkArea } from '../entities/WorkArea.entity';
import { Section } from '../entities/Section.entity';
import { setupTests } from './helpers/testApp';

let app: any; // eslint-disable-line @typescript-eslint/no-explicit-any
let adminToken: string;
let workAreaId: string;
let floorId: string;
let buildingId: string;

const SEC_PREFIX = `sec_${Date.now()}`;

beforeAll(async () => {
  let getAdminToken: () => Promise<string>;
  ({ app, getAdminToken } = await setupTests());
  adminToken = await getAdminToken();

  const bRes = await request(app)
    .post('/api/buildings')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: SEC_PREFIX });
  buildingId = bRes.body.data._id;

  const fRes = await request(app)
    .post('/api/floors')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ building_id: buildingId, floor_number: 1, name: 'Sec Test Floor' });
  floorId = fRes.body.data._id;

  const waRes = await request(app)
    .post('/api/workareas')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ floor_id: floorId, name: 'Sec Test Work Area' });
  workAreaId = waRes.body.data._id;
}, 30000);

afterAll(async () => {
  await AppDataSource.getRepository(Section).createQueryBuilder().delete().where('workarea_id = :id', { id: workAreaId }).execute();
  await AppDataSource.getRepository(WorkArea).delete({ id: workAreaId });
  await AppDataSource.getRepository(Floor).delete({ id: floorId });
  await AppDataSource.getRepository(Building).delete({ id: buildingId });
});

// ── List ──────────────────────────────────────────────────────────────────────

describe('GET /api/sections', () => {
  it('returns an array of sections', async () => {
    const res = await request(app).get('/api/sections').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('filters by workarea_id', async () => {
    await request(app)
      .post('/api/sections')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ workarea_id: workAreaId, name: 'Filter Section' });

    const res = await request(app)
      .get(`/api/sections?workarea_id=${workAreaId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    for (const sec of res.body.data) {
      expect(sec.workarea_id).toBe(workAreaId);
    }
  });
});

// ── Get by id ─────────────────────────────────────────────────────────────────

describe('GET /api/sections/:id', () => {
  let sectionId: string;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/sections')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ workarea_id: workAreaId, name: 'Get By Id Section' });
    sectionId = res.body.data._id;
  });

  it('returns the section by id', async () => {
    const res = await request(app)
      .get(`/api/sections/${sectionId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data._id).toBe(sectionId);
  });

  it('returns 404 for unknown id', async () => {
    const res = await request(app)
      .get('/api/sections/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });
});

// ── Create ────────────────────────────────────────────────────────────────────

describe('POST /api/sections', () => {
  it('creates a section with minimal data', async () => {
    const res = await request(app)
      .post('/api/sections')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ workarea_id: workAreaId, name: 'Line A' });
    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('Line A');
    expect(res.body.data.workarea_id).toBe(workAreaId);
  });

  it('creates a section with capacity and shift_schedule', async () => {
    const res = await request(app)
      .post('/api/sections')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        workarea_id: workAreaId,
        name: 'Line B',
        capacity: 12,
        shift_schedule: '06:00-14:00',
      });
    expect(res.status).toBe(201);
    expect(res.body.data.capacity).toBe(12);
    expect(res.body.data.shift_schedule).toBe('06:00-14:00');
  });
});

// ── Update ────────────────────────────────────────────────────────────────────

describe('PATCH /api/sections/:id', () => {
  let sectionId: string;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/sections')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ workarea_id: workAreaId, name: 'Update Me Section' });
    sectionId = res.body.data._id;
  });

  it('updates the section name', async () => {
    const res = await request(app)
      .patch(`/api/sections/${sectionId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Updated Section Name' });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Updated Section Name');
  });

  it('updates the capacity', async () => {
    const res = await request(app)
      .patch(`/api/sections/${sectionId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ capacity: 20 });
    expect(res.status).toBe(200);
    expect(res.body.data.capacity).toBe(20);
  });

  it('returns 404 for unknown id', async () => {
    const res = await request(app)
      .patch('/api/sections/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Ghost' });
    expect(res.status).toBe(404);
  });
});

// ── Delete ────────────────────────────────────────────────────────────────────

describe('DELETE /api/sections/:id', () => {
  it('deletes a section', async () => {
    const createRes = await request(app)
      .post('/api/sections')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ workarea_id: workAreaId, name: 'Delete Me Section' });
    const sectionId = createRes.body.data._id;

    const res = await request(app)
      .delete(`/api/sections/${sectionId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const getRes = await request(app)
      .get(`/api/sections/${sectionId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(getRes.status).toBe(404);
  });

  it('returns 404 for unknown id', async () => {
    const res = await request(app)
      .delete('/api/sections/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });
});
