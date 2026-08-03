/**
 * wall-ports.test.ts — Integration tests for the socket chain: the physical
 * network path Asset > WallPort > PatchPanel > Rack > NetworkRoom.
 *
 * Covers:
 *   - POST   /api/network/wall-ports/range              — create a label range
 *   - GET    /api/network/wall-ports                    — patch_status, occupied_by,
 *                                                         room resolution, filters
 *   - POST   /api/network/wall-ports                    — single create, label uniqueness
 *   - PATCH  /api/network/wall-ports/:id                — patching, collision guards
 *   - GET    /api/network/wall-ports/patch-suggestions  — derive panel+port from labels
 *   - POST   /api/network/wall-ports/apply-patch-suggestions
 *   - GET    /api/network/switches/:id/impact           — what goes dark
 *
 * The decisions worth pinning down (see docs/CONNECTIONS_WORKFLOW.md):
 *   - `patch_status` and `occupied_by` are independent axes. A socket that is
 *     free but unpatched has no network at all, so collapsing them into one
 *     "available" flag would make assigning a device to a dead socket look done.
 *   - Socket labels are unique per BUILDING, not globally: rack names repeat
 *     across buildings but never inside one.
 *   - Patching is derived from the label (`R1/025` -> second panel, port 1) and
 *     is read-only until the caller posts back the subset it accepts. Replaying
 *     an already-applied suggestion must be rejected, not applied twice.
 *   - Two sockets can never claim the same panel port or the same switch port.
 */
import request from 'supertest';
import { AppDataSource } from '../config/database';
import { Building } from '../entities/Building.entity';
import { Floor } from '../entities/Floor.entity';
import { WorkArea } from '../entities/WorkArea.entity';
import { WallPort } from '../entities/WallPort.entity';
import { NetworkRoom } from '../entities/NetworkRoom.entity';
import { Asset } from '../entities/Asset.entity';
import { setupTests } from './helpers/testApp';

let app: any; // eslint-disable-line @typescript-eslint/no-explicit-any
let adminToken: string;
let buildingId: string;
let floorId: string;
let otherBuildingId: string;
let otherFloorId: string;
let workareaId: string;
let roomId: string;
let rackId: string;
/** 24-port panel at U1, then a 48-port panel at U3 — so port 25 rolls over. */
let panel1Id: string;
let panel2Id: string;
let switchAssetId: string;
let deviceAssetId: string;

const PREFIX = `wp_${Date.now()}`;
const RACK_NAME = 'R1';
const auth = () => ({ Authorization: `Bearer ${adminToken}` });
const createdAssetIds: string[] = [];

async function createSocket(body: Record<string, unknown>) {
  return request(app).post('/api/network/wall-ports').set(auth()).send(body);
}

async function listSockets(query = `?floor_id=${floorId}`) {
  const res = await request(app).get(`/api/network/wall-ports${query}`).set(auth());
  expect(res.status).toBe(200);
  return res.body.data as any[];
}

async function socketByLabel(label: string) {
  const found = (await listSockets()).find((p) => p.label === label);
  if (!found) throw new Error(`No socket labelled ${label}`);
  return found;
}

async function createAsset(name: string, type: string): Promise<string> {
  const res = await request(app).post('/api/assets').set(auth())
    .send({ basic_info: { display_name: name, type } });
  expect(res.status).toBe(201);
  const id = res.body.data._id ?? res.body.data.id;
  createdAssetIds.push(id);
  return id;
}

/** Clears every socket on the test floors, so each describe starts from scratch. */
async function wipeSockets() {
  for (const id of [floorId, otherFloorId]) {
    await AppDataSource.getRepository(WallPort)
      .createQueryBuilder().delete().where('floor_id = :id', { id }).execute();
  }
}

beforeAll(async () => {
  let getAdminToken: () => Promise<string>;
  ({ app, getAdminToken } = await setupTests());
  adminToken = await getAdminToken();

  const b = await request(app).post('/api/buildings').set(auth()).send({ name: PREFIX });
  buildingId = b.body.data._id;
  const f = await request(app).post('/api/floors').set(auth())
    .send({ building_id: buildingId, floor_number: 1, name: 'Socket Test Floor' });
  floorId = f.body.data._id;

  // A second building, to prove label uniqueness is per building and not global.
  const b2 = await request(app).post('/api/buildings').set(auth()).send({ name: `${PREFIX}_other` });
  otherBuildingId = b2.body.data._id;
  const f2 = await request(app).post('/api/floors').set(auth())
    .send({ building_id: otherBuildingId, floor_number: 1, name: 'Other Building Floor' });
  otherFloorId = f2.body.data._id;

  const wa = await request(app).post('/api/workareas').set(auth())
    .send({ floor_id: floorId, name: `${PREFIX} HR Office` });
  workareaId = wa.body.data._id;

  const room = await request(app).post('/api/network/rooms').set(auth())
    .send({ name: `${PREFIX}-IDF`, type: 'idf', building_id: buildingId, floor_id: floorId });
  roomId = room.body.data._id;
  const rack = await request(app).post('/api/network/racks').set(auth())
    .send({ name: RACK_NAME, network_room_id: roomId, u_count: 42 });
  rackId = rack.body.data._id;
  const p1 = await request(app).post('/api/network/patch-panels').set(auth())
    .send({ name: 'PP-R1-1', rack_id: rackId, port_count: 24, u_position: 1 });
  panel1Id = p1.body.data._id;
  const p2 = await request(app).post('/api/network/patch-panels').set(auth())
    .send({ name: 'PP-R1-2', rack_id: rackId, port_count: 48, u_position: 3 });
  panel2Id = p2.body.data._id;

  switchAssetId = await createAsset(`${PREFIX}-SW01`, 'switch');
  deviceAssetId = await createAsset(`${PREFIX}-PC01`, 'workstation');
}, 30000);

afterAll(async () => {
  await wipeSockets();
  if (createdAssetIds.length > 0) {
    await AppDataSource.getRepository(Asset)
      .createQueryBuilder().delete().whereInIds(createdAssetIds).execute();
  }
  // Deleting the room cascades to racks and panels via real FKs.
  await AppDataSource.getRepository(NetworkRoom).delete({ id: roomId });
  for (const id of [floorId, otherFloorId]) {
    await AppDataSource.getRepository(WorkArea)
      .createQueryBuilder().delete().where('floor_id = :id', { id }).execute();
    await AppDataSource.getRepository(Floor).delete({ id });
  }
  await AppDataSource.getRepository(Building).delete({ id: buildingId });
  await AppDataSource.getRepository(Building).delete({ id: otherBuildingId });
});

// ── Range creation ────────────────────────────────────────────────────────────

describe('POST /api/network/wall-ports/range', () => {
  beforeEach(wipeSockets);

  it('creates a zero-padded label range', async () => {
    const res = await request(app).post('/api/network/wall-ports/range').set(auth())
      .send({ floor_id: floorId, prefix: `${RACK_NAME}/`, from: 1, to: 5, workarea_id: workareaId });
    expect(res.status).toBe(201);
    expect(res.body.data.created.map((p: any) => p.label))
      .toEqual(['R1/001', 'R1/002', 'R1/003', 'R1/004', 'R1/005']);
    expect(res.body.data.skipped).toEqual([]);
    expect(res.body.data.created[0].workarea_id).toBe(workareaId);
  });

  it('honours a custom pad width', async () => {
    const res = await request(app).post('/api/network/wall-ports/range').set(auth())
      .send({ floor_id: floorId, prefix: `${RACK_NAME}/`, from: 7, to: 8, pad: 2 });
    expect(res.body.data.created.map((p: any) => p.label)).toEqual(['R1/07', 'R1/08']);
  });

  it('skips labels that already exist instead of failing the batch', async () => {
    // Re-running a range after adding a few sockets by hand is normal; failing
    // the whole call would punish it.
    await request(app).post('/api/network/wall-ports/range').set(auth())
      .send({ floor_id: floorId, prefix: `${RACK_NAME}/`, from: 1, to: 3 });
    const again = await request(app).post('/api/network/wall-ports/range').set(auth())
      .send({ floor_id: floorId, prefix: `${RACK_NAME}/`, from: 2, to: 5 });

    expect(again.status).toBe(201);
    expect(again.body.data.created.map((p: any) => p.label)).toEqual(['R1/004', 'R1/005']);
    expect(again.body.data.skipped).toEqual(['R1/002', 'R1/003']);
  });

  it('rejects a backwards range and a missing prefix', async () => {
    const backwards = await request(app).post('/api/network/wall-ports/range').set(auth())
      .send({ floor_id: floorId, prefix: `${RACK_NAME}/`, from: 10, to: 2 });
    expect(backwards.status).toBe(400);

    const noPrefix = await request(app).post('/api/network/wall-ports/range').set(auth())
      .send({ floor_id: floorId, from: 1, to: 2 });
    expect(noPrefix.status).toBe(400);
  });

  it('refuses a range larger than the per-request cap', async () => {
    const res = await request(app).post('/api/network/wall-ports/range').set(auth())
      .send({ floor_id: floorId, prefix: 'R9/', from: 1, to: 600 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/maximum/i);
  });
});

// ── Labels are unique per building ────────────────────────────────────────────

describe('socket label uniqueness', () => {
  beforeEach(wipeSockets);

  it('rejects the same label in the same building, ignoring case and padding whitespace', async () => {
    expect((await createSocket({ label: 'R1/001', floor_id: floorId })).status).toBe(201);
    const dup = await createSocket({ label: ' r1/001 ', floor_id: floorId });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toMatch(/already exists in this building/i);
  });

  it('allows the same label in a different building', async () => {
    // Every building has its own R1; the label only has to be unique within one.
    expect((await createSocket({ label: 'R1/001', floor_id: floorId })).status).toBe(201);
    expect((await createSocket({ label: 'R1/001', floor_id: otherFloorId })).status).toBe(201);
  });

  it('requires a label and a floor', async () => {
    expect((await createSocket({ floor_id: floorId })).status).toBe(400);
    expect((await createSocket({ label: 'R1/999' })).status).toBe(400);
  });
});

// ── Status is two independent axes ─────────────────────────────────────────────

describe('GET /api/network/wall-ports — status and occupancy', () => {
  beforeEach(wipeSockets);

  it('walks unpatched -> patched -> live as the chain is filled in', async () => {
    const created = await createSocket({ label: 'R1/001', floor_id: floorId, workarea_id: workareaId });
    const id = created.body.data._id;

    expect((await socketByLabel('R1/001')).patch_status).toBe('unpatched');

    await request(app).patch(`/api/network/wall-ports/${id}`).set(auth())
      .send({ patch_panel_id: panel1Id, patch_port: 1 });
    expect((await socketByLabel('R1/001')).patch_status).toBe('patched');

    await request(app).patch(`/api/network/wall-ports/${id}`).set(auth())
      .send({ switch_asset_id: switchAssetId, switch_port: 'Gi1/0/1' });
    const live = await socketByLabel('R1/001');
    expect(live.patch_status).toBe('live');
    // The whole chain should be resolved for the trace, in one request.
    expect(live.patch_panel_name).toBe('PP-R1-1');
    expect(live.rack_name).toBe(RACK_NAME);
    expect(live.room_name).toBe(`${PREFIX}-IDF`);
    expect(live.room_type).toBe('idf');
    expect(live.workarea).toEqual({ _id: workareaId, name: `${PREFIX} HR Office` });
  });

  it('reports occupancy separately from patch status', async () => {
    // A socket can be live and free, or occupied and unpatched. Collapsing the
    // two would hide a device plugged into something that has no network.
    const created = await createSocket({ label: 'R1/002', floor_id: floorId });
    const socketId = created.body.data._id;

    expect((await socketByLabel('R1/002')).occupied_by).toBeNull();

    await request(app).patch(`/api/assets/${deviceAssetId}`).set(auth())
      .send({ basic_info: { display_name: `${PREFIX}-PC01` }, wall_port_id: socketId });

    const taken = await socketByLabel('R1/002');
    expect(taken.occupied_by._id).toBe(deviceAssetId);
    expect(taken.patch_status).toBe('unpatched');

    // Unplugging frees it again.
    await request(app).patch(`/api/assets/${deviceAssetId}`).set(auth())
      .send({ basic_info: { display_name: `${PREFIX}-PC01` }, wall_port_id: null });
    expect((await socketByLabel('R1/002')).occupied_by).toBeNull();
  });

  it('filters to one room', async () => {
    await createSocket({ label: 'R1/010', floor_id: floorId, workarea_id: workareaId });
    await createSocket({ label: 'R1/011', floor_id: floorId });

    const inRoom = await listSockets(`?workarea_id=${workareaId}`);
    expect(inRoom.map((p) => p.label)).toEqual(['R1/010']);
  });
});

// ── One physical port, one socket ─────────────────────────────────────────────

describe('port collision guards', () => {
  beforeEach(wipeSockets);

  it('refuses a second socket on the same panel port', async () => {
    const a = await createSocket({ label: 'R1/001', floor_id: floorId, patch_panel_id: panel1Id, patch_port: 1 });
    expect(a.status).toBe(201);
    const b = await createSocket({ label: 'R1/002', floor_id: floorId, patch_panel_id: panel1Id, patch_port: 1 });
    expect(b.status).toBe(409);
    expect(b.body.error).toMatch(/patch panel port/i);
  });

  it('refuses a second socket on the same switch port', async () => {
    await createSocket({
      label: 'R1/003', floor_id: floorId, switch_asset_id: switchAssetId, switch_port: 'Gi1/0/9',
    });
    const b = await createSocket({
      label: 'R1/004', floor_id: floorId, switch_asset_id: switchAssetId, switch_port: 'Gi1/0/9',
    });
    expect(b.status).toBe(409);
    expect(b.body.error).toMatch(/switch port/i);
  });

  it('lets a socket keep its own port when updated', async () => {
    const created = await createSocket({
      label: 'R1/005', floor_id: floorId, patch_panel_id: panel1Id, patch_port: 5,
    });
    const res = await request(app).patch(`/api/network/wall-ports/${created.body.data._id}`).set(auth())
      .send({ patch_panel_id: panel1Id, patch_port: 5, description: 'unchanged port' });
    expect(res.status).toBe(200);
  });

  it('ignores fields the client should not be able to set', async () => {
    // The body is client-supplied; a blanket assign would let it move a socket
    // to another floor or overwrite its id.
    const created = await createSocket({ label: 'R1/006', floor_id: floorId });
    const res = await request(app).patch(`/api/network/wall-ports/${created.body.data._id}`).set(auth())
      .send({ floor_id: otherFloorId, id: '00000000-0000-0000-0000-000000000000' });
    expect(res.status).toBe(200);
    expect(res.body.data._id).toBe(created.body.data._id);
    expect(res.body.data.floor_id).toBe(floorId);
  });
});

// ── Patching derived from labels ──────────────────────────────────────────────

describe('GET /api/network/wall-ports/patch-suggestions', () => {
  beforeEach(wipeSockets);

  it('derives panel and port from the label, rolling over between panels', async () => {
    await request(app).post('/api/network/wall-ports/range').set(auth())
      .send({ floor_id: floorId, prefix: `${RACK_NAME}/`, from: 1, to: 30, workarea_id: workareaId });

    const res = await request(app).get(`/api/network/wall-ports/patch-suggestions?rack_id=${rackId}`).set(auth());
    expect(res.status).toBe(200);
    expect(res.body.data.rack_name).toBe(RACK_NAME);

    const byLabel = new Map(res.body.data.suggestions.map((s: any) => [s.label, s]));
    // 24-port panel first, so 24 is its last port and 25 starts the next panel.
    expect(byLabel.get('R1/001')).toMatchObject({ patch_panel_id: panel1Id, patch_port: 1 });
    expect(byLabel.get('R1/024')).toMatchObject({ patch_panel_id: panel1Id, patch_port: 24 });
    expect(byLabel.get('R1/025')).toMatchObject({ patch_panel_id: panel2Id, patch_port: 1 });
    expect(byLabel.get('R1/030')).toMatchObject({ patch_panel_id: panel2Id, patch_port: 6 });
    expect(res.body.data.suggestions).toHaveLength(30);
  });

  it('names the reason for each socket it cannot place, and ignores other racks', async () => {
    await createSocket({ label: 'R1/999', floor_id: floorId });   // past the last panel port
    await createSocket({ label: 'WP-LEGACY-1', floor_id: floorId }); // not the R<rack>/<port> form
    await createSocket({ label: 'R7/001', floor_id: floorId });    // another rack's socket

    const res = await request(app).get(`/api/network/wall-ports/patch-suggestions?rack_id=${rackId}`).set(auth());
    const reasons = new Map(res.body.data.problems.map((p: any) => [p.label, p.reason]));
    expect(reasons.get('R1/999')).toBe('port-beyond-last-panel');
    expect(reasons.get('WP-LEGACY-1')).toBe('label-not-parseable');
    // A socket belonging to another rack is not this rack's problem, so it is
    // left out entirely rather than reported as an error.
    expect(reasons.has('R7/001')).toBe(false);
    expect(res.body.data.suggestions).toHaveLength(0);
  });

  it('flags a suggestion whose target port is already taken', async () => {
    await createSocket({ label: 'R1/002', floor_id: floorId });
    // R1/500 is past this rack's last port, so it can never be derived here —
    // which makes it a clean way to occupy the port R1/002 would land on.
    await createSocket({ label: 'R1/500', floor_id: floorId, patch_panel_id: panel1Id, patch_port: 2 });

    const res = await request(app).get(`/api/network/wall-ports/patch-suggestions?rack_id=${rackId}`).set(auth());
    const s = res.body.data.suggestions.find((x: any) => x.label === 'R1/002');
    expect(s.conflict).toBe('R1/500');
  });

  it('requires rack_id and 404s on an unknown rack', async () => {
    expect((await request(app).get('/api/network/wall-ports/patch-suggestions').set(auth())).status).toBe(400);
    const unknown = await request(app)
      .get('/api/network/wall-ports/patch-suggestions?rack_id=00000000-0000-0000-0000-000000000000')
      .set(auth());
    expect(unknown.status).toBe(404);
  });
});

describe('POST /api/network/wall-ports/apply-patch-suggestions', () => {
  beforeEach(wipeSockets);

  it('applies the accepted subset and then has nothing left to suggest', async () => {
    await request(app).post('/api/network/wall-ports/range').set(auth())
      .send({ floor_id: floorId, prefix: `${RACK_NAME}/`, from: 1, to: 6 });

    const suggested = await request(app)
      .get(`/api/network/wall-ports/patch-suggestions?rack_id=${rackId}`).set(auth());
    const assignments = suggested.body.data.suggestions.map((s: any) => ({
      wall_port_id: s.wall_port_id, patch_panel_id: s.patch_panel_id, patch_port: s.patch_port,
    }));

    const applied = await request(app).post('/api/network/wall-ports/apply-patch-suggestions')
      .set(auth()).send({ assignments });
    expect(applied.status).toBe(200);
    expect(applied.body.data.applied).toHaveLength(6);
    expect(applied.body.data.rejected).toEqual([]);

    const after = await request(app)
      .get(`/api/network/wall-ports/patch-suggestions?rack_id=${rackId}`).set(auth());
    expect(after.body.data.suggestions).toHaveLength(0);
    expect((await socketByLabel('R1/003')).patch_status).toBe('patched');
  });

  it('rejects a replayed assignment rather than patching twice', async () => {
    // The list may have been on screen while someone else patched the port, so
    // every assignment is re-checked rather than trusted.
    await request(app).post('/api/network/wall-ports/range').set(auth())
      .send({ floor_id: floorId, prefix: `${RACK_NAME}/`, from: 1, to: 2 });
    const suggested = await request(app)
      .get(`/api/network/wall-ports/patch-suggestions?rack_id=${rackId}`).set(auth());
    const assignments = suggested.body.data.suggestions.map((s: any) => ({
      wall_port_id: s.wall_port_id, patch_panel_id: s.patch_panel_id, patch_port: s.patch_port,
    }));

    await request(app).post('/api/network/wall-ports/apply-patch-suggestions').set(auth()).send({ assignments });
    const replay = await request(app).post('/api/network/wall-ports/apply-patch-suggestions')
      .set(auth()).send({ assignments });

    expect(replay.status).toBe(200);
    expect(replay.body.data.applied).toEqual([]);
    expect(replay.body.data.rejected).toHaveLength(2);
    expect(replay.body.data.rejected[0].reason).toMatch(/already patched/i);
  });

  it('requires a non-empty assignments array', async () => {
    expect((await request(app).post('/api/network/wall-ports/apply-patch-suggestions')
      .set(auth()).send({ assignments: [] })).status).toBe(400);
    expect((await request(app).post('/api/network/wall-ports/apply-patch-suggestions')
      .set(auth()).send({})).status).toBe(400);
  });
});

// ── Maintenance impact ────────────────────────────────────────────────────────

describe('GET /api/network/switches/:id/impact', () => {
  beforeEach(wipeSockets);

  it('lists the sockets, devices and rooms behind a switch', async () => {
    const a = await createSocket({
      label: 'R1/001', floor_id: floorId, workarea_id: workareaId,
      patch_panel_id: panel1Id, patch_port: 1,
      switch_asset_id: switchAssetId, switch_port: 'Gi1/0/1',
    });
    await createSocket({
      label: 'R1/002', floor_id: floorId, workarea_id: workareaId,
      switch_asset_id: switchAssetId, switch_port: 'Gi1/0/2',
    });
    await request(app).patch(`/api/assets/${deviceAssetId}`).set(auth())
      .send({ basic_info: { display_name: `${PREFIX}-PC01` }, wall_port_id: a.body.data._id });

    const res = await request(app).get(`/api/network/switches/${switchAssetId}/impact`).set(auth());
    expect(res.status).toBe(200);
    expect(res.body.data.socket_count).toBe(2);
    // Empty sockets still count as sockets — they are capacity that goes away
    // during the window — but only one has a device behind it.
    expect(res.body.data.device_count).toBe(1);
    expect(res.body.data.rooms).toEqual([`${PREFIX} HR Office`]);
    const first = res.body.data.sockets.find((s: any) => s.label === 'R1/001');
    expect(first.device.display_name).toBe(`${PREFIX}-PC01`);
    expect(first.switch_port).toBe('Gi1/0/1');
    const second = res.body.data.sockets.find((s: any) => s.label === 'R1/002');
    expect(second.device).toBeNull();

    await request(app).patch(`/api/assets/${deviceAssetId}`).set(auth())
      .send({ basic_info: { display_name: `${PREFIX}-PC01` }, wall_port_id: null });
  });

  it('returns an empty impact for a switch nothing is patched to', async () => {
    const lonely = await createAsset(`${PREFIX}-SW02`, 'switch');
    const res = await request(app).get(`/api/network/switches/${lonely}/impact`).set(auth());
    expect(res.status).toBe(200);
    expect(res.body.data.socket_count).toBe(0);
    expect(res.body.data.sockets).toEqual([]);
  });

  it('404s on an unknown asset', async () => {
    const res = await request(app)
      .get('/api/network/switches/00000000-0000-0000-0000-000000000000/impact').set(auth());
    expect(res.status).toBe(404);
  });
});
