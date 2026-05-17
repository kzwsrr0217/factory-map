/**
 * network.test.ts — Integration tests for /api/network CRUD:
 *   rooms, racks, patch panels (incl. cable_type 'mixed'), wall ports,
 *   and the wall_port_id FK on assets.
 */
import request from 'supertest';
import { setupTests } from './helpers/testApp';

let app: any; // eslint-disable-line @typescript-eslint/no-explicit-any
let token: string;

let buildingId: string;
let floorId: string;
let roomId: string;
let rackId: string;
let panelId: string;
let wallPortId: string;
let testAssetId: string;

beforeAll(async () => {
  let getAdminToken: () => Promise<string>;
  ({ app, getAdminToken } = await setupTests());
  token = await getAdminToken();

  // Resolve an existing building + floor from seed data
  const bRes = await request(app).get('/api/buildings').set('Authorization', `Bearer ${token}`);
  const buildings = bRes.body.data as { _id: string }[];
  buildingId = buildings[0]._id;

  const fRes = await request(app).get(`/api/floors?building_id=${buildingId}`).set('Authorization', `Bearer ${token}`);
  const floors = fRes.body.data as { _id: string }[];
  floorId = floors[0]._id;
}, 30000);

// ── Network Rooms ──────────────────────────────────────────────────────────────

describe('GET /api/network/rooms', () => {
  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/network/rooms');
    expect(res.status).toBe(401);
  });

  it('returns an array of rooms', async () => {
    const res = await request(app)
      .get('/api/network/rooms')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('filters rooms by building_id', async () => {
    const res = await request(app)
      .get(`/api/network/rooms?building_id=${buildingId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    const rooms = res.body.data as { building_id: string }[];
    rooms.forEach(r => expect(r.building_id).toBe(buildingId));
  });
});

describe('POST /api/network/rooms', () => {
  it('creates a network room', async () => {
    const res = await request(app)
      .post('/api/network/rooms')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '__test_room__', type: 'idf', building_id: buildingId, floor_id: floorId });
    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('__test_room__');
    expect(res.body.data.type).toBe('idf');
    roomId = res.body.data._id;
    expect(roomId).toBeDefined();
  });

  it('returns 400 when name is missing', async () => {
    const res = await request(app)
      .post('/api/network/rooms')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'idf', building_id: buildingId });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });
});

describe('GET /api/network/rooms/:id', () => {
  it('returns the room by id', async () => {
    if (!roomId) return;
    const res = await request(app)
      .get(`/api/network/rooms/${roomId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data._id).toBe(roomId);
  });

  it('returns 404 for unknown id', async () => {
    const res = await request(app)
      .get('/api/network/rooms/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/network/rooms/:id', () => {
  it('updates the room', async () => {
    if (!roomId) return;
    const res = await request(app)
      .patch(`/api/network/rooms/${roomId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '__test_room_updated__' });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('__test_room_updated__');
  });
});

// ── Network Racks ──────────────────────────────────────────────────────────────

describe('POST /api/network/racks', () => {
  it('creates a rack inside the test room', async () => {
    if (!roomId) return;
    const res = await request(app)
      .post('/api/network/racks')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '__test_rack__', network_room_id: roomId, u_count: 12 });
    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('__test_rack__');
    rackId = res.body.data._id;
    expect(rackId).toBeDefined();
  });
});

describe('GET /api/network/racks/:id', () => {
  it('returns the rack by id', async () => {
    if (!rackId) return;
    const res = await request(app)
      .get(`/api/network/racks/${rackId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data._id).toBe(rackId);
  });
});

// ── Patch Panels (incl. cable_type: 'mixed') ───────────────────────────────────

describe('POST /api/network/patch-panels', () => {
  it('creates a copper panel', async () => {
    if (!rackId) return;
    const res = await request(app)
      .post('/api/network/patch-panels')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '__test_panel_copper__', rack_id: rackId, port_count: 24, cable_type: 'copper' });
    expect(res.status).toBe(201);
    expect(res.body.data.cable_type).toBe('copper');
    panelId = res.body.data._id;
    expect(panelId).toBeDefined();
  });

  it('creates a fiber panel', async () => {
    if (!rackId) return;
    const res = await request(app)
      .post('/api/network/patch-panels')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '__test_panel_fiber__', rack_id: rackId, port_count: 12, cable_type: 'fiber' });
    expect(res.status).toBe(201);
    expect(res.body.data.cable_type).toBe('fiber');
  });

  it('creates a mixed panel (copper + fiber ports)', async () => {
    if (!rackId) return;
    const res = await request(app)
      .post('/api/network/patch-panels')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '__test_panel_mixed__', rack_id: rackId, port_count: 24, cable_type: 'mixed' });
    expect(res.status).toBe(201);
    expect(res.body.data.cable_type).toBe('mixed');
  });
});

describe('PATCH /api/network/patch-panels/:id', () => {
  it('updates cable_type from copper to mixed', async () => {
    if (!panelId) return;
    const res = await request(app)
      .patch(`/api/network/patch-panels/${panelId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ cable_type: 'mixed' });
    expect(res.status).toBe(200);
    expect(res.body.data.cable_type).toBe('mixed');
  });

  it('reverts cable_type back to copper', async () => {
    if (!panelId) return;
    const res = await request(app)
      .patch(`/api/network/patch-panels/${panelId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ cable_type: 'copper' });
    expect(res.status).toBe(200);
    expect(res.body.data.cable_type).toBe('copper');
  });
});

// ── Wall Ports ─────────────────────────────────────────────────────────────────

describe('POST /api/network/wall-ports', () => {
  it('creates a wall port on the test floor', async () => {
    if (!floorId) return;
    const res = await request(app)
      .post('/api/network/wall-ports')
      .set('Authorization', `Bearer ${token}`)
      .send({
        label: '__TEST-WP-01__',
        floor_id: floorId,
        pos_x: 100,
        pos_y: 200,
        patch_panel_id: panelId ?? null,
        patch_port: 1,
      });
    expect(res.status).toBe(201);
    expect(res.body.data.label).toBe('__TEST-WP-01__');
    wallPortId = res.body.data._id;
    expect(wallPortId).toBeDefined();
  });
});

describe('GET /api/network/wall-ports', () => {
  it('filters wall ports by floor_id', async () => {
    if (!floorId) return;
    const res = await request(app)
      .get(`/api/network/wall-ports?floor_id=${floorId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const ports = res.body.data as { floor_id: string }[];
    expect(ports.length).toBeGreaterThan(0);
  });
});

describe('PATCH /api/network/wall-ports/:id', () => {
  it('updates wall port position', async () => {
    if (!wallPortId) return;
    const res = await request(app)
      .patch(`/api/network/wall-ports/${wallPortId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ pos_x: 150, pos_y: 250 });
    expect(res.status).toBe(200);
    expect(res.body.data.pos_x).toBe(150);
    expect(res.body.data.pos_y).toBe(250);
  });
});

// ── wall_port_id FK on Asset ──────────────────────────────────────────────────

describe('Asset wall_port_id assignment', () => {
  it('creates a test asset to use for wall port assignment', async () => {
    const res = await request(app)
      .post('/api/assets')
      .set('Authorization', `Bearer ${token}`)
      .send({ basic_info: { display_name: '__test_asset_wp__', status: 'active' } });
    expect(res.status).toBe(201);
    testAssetId = (res.body.data ?? res.body)._id;
    expect(testAssetId).toBeDefined();
  });

  it('assigns a wall_port_id to the asset', async () => {
    if (!testAssetId || !wallPortId) return;
    const res = await request(app)
      .patch(`/api/assets/${testAssetId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ wall_port_id: wallPortId });
    expect(res.status).toBe(200);
    const asset = res.body.data ?? res.body;
    expect(asset.wall_port_id).toBe(wallPortId);
  });

  it('GET /api/assets/:id includes wall_port details', async () => {
    if (!testAssetId || !wallPortId) return;
    const res = await request(app)
      .get(`/api/assets/${testAssetId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const asset = res.body.data ?? res.body;
    expect(asset.wall_port_id).toBe(wallPortId);
    expect(asset.wall_port).toBeDefined();
    expect(asset.wall_port._id).toBe(wallPortId);
    expect(asset.wall_port.label).toBe('__TEST-WP-01__');
  });

  it('clears wall_port_id by setting it to null', async () => {
    if (!testAssetId) return;
    const res = await request(app)
      .patch(`/api/assets/${testAssetId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ wall_port_id: null });
    expect(res.status).toBe(200);
    const asset = res.body.data ?? res.body;
    expect(asset.wall_port_id).toBeNull();
  });
});

// ── Cleanup ────────────────────────────────────────────────────────────────────

afterAll(async () => {
  if (testAssetId) await request(app).delete(`/api/assets/${testAssetId}`).set('Authorization', `Bearer ${token}`);
  if (wallPortId) await request(app).delete(`/api/network/wall-ports/${wallPortId}`).set('Authorization', `Bearer ${token}`);
  if (panelId) await request(app).delete(`/api/network/patch-panels/${panelId}`).set('Authorization', `Bearer ${token}`);
  // Clean up the fiber and mixed panels created by name (best-effort)
  const panelsRes = await request(app)
    .get(`/api/network/patch-panels?rack_id=${rackId}`)
    .set('Authorization', `Bearer ${token}`);
  if (panelsRes.status === 200) {
    for (const p of panelsRes.body.data ?? []) {
      if (['__test_panel_fiber__', '__test_panel_mixed__'].includes(p.name)) {
        await request(app).delete(`/api/network/patch-panels/${p._id}`).set('Authorization', `Bearer ${token}`);
      }
    }
  }
  if (rackId) await request(app).delete(`/api/network/racks/${rackId}`).set('Authorization', `Bearer ${token}`);
  if (roomId) await request(app).delete(`/api/network/rooms/${roomId}`).set('Authorization', `Bearer ${token}`);
});
