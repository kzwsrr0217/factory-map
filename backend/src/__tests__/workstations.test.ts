/**
 * workstations.test.ts — Integration tests for workstation CRUD.
 *
 * Covers:
 *   - GET  /api/workstations              — list all; filter by section_id
 *   - GET  /api/workstations/:id          — get by id; 404 on unknown
 *   - POST /api/workstations              — create with type, coordinates, rotation
 *   - PATCH /api/workstations/:id         — update name, rotation, status
 *   - DELETE /api/workstations/:id        — delete; 404 on unknown
 *
 * Creates building → floor → work area → section → workstations in beforeAll.
 */
import request from 'supertest';
import { AppDataSource } from '../config/database';
import { Building } from '../entities/Building.entity';
import { Floor } from '../entities/Floor.entity';
import { WorkArea } from '../entities/WorkArea.entity';
import { Section } from '../entities/Section.entity';
import { Workstation } from '../entities/Workstation.entity';
import { setupTests } from './helpers/testApp';

let app: any; // eslint-disable-line @typescript-eslint/no-explicit-any
let adminToken: string;
let sectionId: string;
let workAreaId: string;
let floorId: string;
let buildingId: string;

const WS_PREFIX = `ws_${Date.now()}`;

beforeAll(async () => {
  let getAdminToken: () => Promise<string>;
  ({ app, getAdminToken } = await setupTests());
  adminToken = await getAdminToken();

  const bRes = await request(app)
    .post('/api/buildings')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: WS_PREFIX });
  buildingId = bRes.body.data._id;

  const fRes = await request(app)
    .post('/api/floors')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ building_id: buildingId, floor_number: 1, name: 'WS Test Floor' });
  floorId = fRes.body.data._id;

  const waRes = await request(app)
    .post('/api/workareas')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ floor_id: floorId, name: 'WS Test Work Area' });
  workAreaId = waRes.body.data._id;

  const secRes = await request(app)
    .post('/api/sections')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ workarea_id: workAreaId, name: 'WS Test Section' });
  sectionId = secRes.body.data._id;
}, 30000);

afterAll(async () => {
  await AppDataSource.getRepository(Workstation).createQueryBuilder().delete().where('section_id = :id', { id: sectionId }).execute();
  await AppDataSource.getRepository(Section).delete({ id: sectionId });
  await AppDataSource.getRepository(WorkArea).delete({ id: workAreaId });
  await AppDataSource.getRepository(Floor).delete({ id: floorId });
  await AppDataSource.getRepository(Building).delete({ id: buildingId });
});

// ── List ──────────────────────────────────────────────────────────────────────

describe('GET /api/workstations', () => {
  it('returns an array of workstations', async () => {
    const res = await request(app).get('/api/workstations').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('filters by section_id', async () => {
    await request(app)
      .post('/api/workstations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ section_id: sectionId, name: 'Filter WS', type: 'machine' });

    const res = await request(app)
      .get(`/api/workstations?section_id=${sectionId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    for (const ws of res.body.data) {
      expect(ws.section_id).toBe(sectionId);
    }
  });
});

// ── Get by id ─────────────────────────────────────────────────────────────────

describe('GET /api/workstations/:id', () => {
  let wsId: string;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/workstations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ section_id: sectionId, name: 'Get By Id WS', type: 'desk' });
    wsId = res.body.data._id;
  });

  it('returns the workstation by id', async () => {
    const res = await request(app)
      .get(`/api/workstations/${wsId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data._id).toBe(wsId);
  });

  it('returns 404 for unknown id', async () => {
    const res = await request(app)
      .get('/api/workstations/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });
});

// ── Create ────────────────────────────────────────────────────────────────────

describe('POST /api/workstations', () => {
  it('creates a workstation with minimal data', async () => {
    const res = await request(app)
      .post('/api/workstations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ section_id: sectionId, name: 'Station 1', type: 'machine' });
    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('Station 1');
    expect(res.body.data.section_id).toBe(sectionId);
    expect(res.body.data.type).toBe('machine');
  });

  it('creates a workstation with coordinates and rotation', async () => {
    const res = await request(app)
      .post('/api/workstations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        section_id: sectionId,
        name: 'Station 2',
        type: 'desk',
        coordinates: { x: 50, y: 100 },
        rotation: 90,
      });
    expect(res.status).toBe(201);
    expect(res.body.data.coordinates.x).toBe(50);
    expect(res.body.data.coordinates.y).toBe(100);
    expect(res.body.data.rotation).toBe(90);
  });
});

// ── Update ────────────────────────────────────────────────────────────────────

describe('PATCH /api/workstations/:id', () => {
  let wsId: string;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/workstations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ section_id: sectionId, name: 'Update Me WS', type: 'panel' });
    wsId = res.body.data._id;
  });

  it('updates the workstation name', async () => {
    const res = await request(app)
      .patch(`/api/workstations/${wsId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Updated WS Name' });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Updated WS Name');
  });

  it('updates the rotation', async () => {
    const res = await request(app)
      .patch(`/api/workstations/${wsId}`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ rotation: 180 });
    expect(res.status).toBe(200);
    expect(res.body.data.rotation).toBe(180);
  });

  it('returns 404 for unknown id', async () => {
    const res = await request(app)
      .patch('/api/workstations/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ name: 'Ghost' });
    expect(res.status).toBe(404);
  });
});

// ── Delete ────────────────────────────────────────────────────────────────────

describe('DELETE /api/workstations/:id', () => {
  it('deletes a workstation', async () => {
    const createRes = await request(app)
      .post('/api/workstations')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ section_id: sectionId, name: 'Delete Me WS', type: 'machine' });
    const wsId = createRes.body.data._id;

    const res = await request(app)
      .delete(`/api/workstations/${wsId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const getRes = await request(app)
      .get(`/api/workstations/${wsId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(getRes.status).toBe(404);
  });

  it('returns 404 for unknown id', async () => {
    const res = await request(app)
      .delete('/api/workstations/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });
});
