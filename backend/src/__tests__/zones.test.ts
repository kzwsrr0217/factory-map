/**
 * zones.test.ts — Integration tests for the Zone level of the hierarchy
 * (Building > Floor > Zone > WorkArea).
 *
 * Covers:
 *   - GET    /api/zones                — list; filter by floor_id; workarea_count
 *   - POST   /api/zones                — create; name unique per floor, folded
 *   - GET    /api/zones/:id            — get; 404 on unknown
 *   - PATCH  /api/zones/:id            — rename, recolour; uniqueness on rename
 *   - DELETE /api/zones/:id            — deletes the zone, DETACHES its rooms
 *   - GET    /api/workareas            — the zone soft join is resolved and the
 *                                        colour travels with it
 *
 * The behaviours worth pinning down here are the ones that were deliberate
 * decisions rather than obvious defaults, because those are what a future
 * refactor would quietly undo:
 *   - Zone names are unique per floor after case/whitespace folding, so "HR" and
 *     " hr " cannot become two groups.
 *   - Deleting a zone ungroups its rooms instead of refusing or cascading —
 *     losing a grouping is recoverable, losing the rooms is not.
 *   - `work_areas.zone_id` is a soft join with no FK (a real one gives `floors`
 *     two cascade paths to `work_areas`, which SQL Server rejects), so the zone
 *     is resolved in the controller — that resolution is what these tests check.
 */
import request from 'supertest';
import { AppDataSource } from '../config/database';
import { Building } from '../entities/Building.entity';
import { Floor } from '../entities/Floor.entity';
import { WorkArea } from '../entities/WorkArea.entity';
import { Zone } from '../entities/Zone.entity';
import { setupTests } from './helpers/testApp';

let app: any; // eslint-disable-line @typescript-eslint/no-explicit-any
let adminToken: string;
let buildingId: string;
let floorId: string;
let otherFloorId: string;

const PREFIX = `zone_${Date.now()}`;
const auth = () => ({ Authorization: `Bearer ${adminToken}` });

async function createZone(body: Record<string, unknown>) {
  return request(app).post('/api/zones').set(auth()).send(body);
}

async function createWorkArea(name: string, zoneId: string | null, floor = floorId) {
  const res = await request(app).post('/api/workareas').set(auth()).send({
    floor_id: floor, name, zone_id: zoneId,
  });
  expect(res.status).toBe(201);
  return res.body.data;
}

beforeAll(async () => {
  let getAdminToken: () => Promise<string>;
  ({ app, getAdminToken } = await setupTests());
  adminToken = await getAdminToken();

  const b = await request(app).post('/api/buildings').set(auth()).send({ name: PREFIX });
  buildingId = b.body.data._id;

  const f = await request(app).post('/api/floors').set(auth())
    .send({ building_id: buildingId, floor_number: 1, name: 'Zone Test Floor' });
  floorId = f.body.data._id;

  const f2 = await request(app).post('/api/floors').set(auth())
    .send({ building_id: buildingId, floor_number: 2, name: 'Zone Test Floor 2' });
  otherFloorId = f2.body.data._id;
}, 30000);

afterAll(async () => {
  const waRepo = AppDataSource.getRepository(WorkArea);
  const zoneRepo = AppDataSource.getRepository(Zone);
  for (const id of [floorId, otherFloorId]) {
    await waRepo.createQueryBuilder().delete().where('floor_id = :id', { id }).execute();
    await zoneRepo.createQueryBuilder().delete().where('floor_id = :id', { id }).execute();
    await AppDataSource.getRepository(Floor).delete({ id });
  }
  await AppDataSource.getRepository(Building).delete({ id: buildingId });
});

// ── Create ────────────────────────────────────────────────────────────────────

describe('POST /api/zones', () => {
  it('creates a zone with a colour', async () => {
    const res = await createZone({ floor_id: floorId, name: 'Cummins', color: '#a7f3d0' });
    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('Cummins');
    expect(res.body.data.color).toBe('#a7f3d0');
    expect(res.body.data.floor_id).toBe(floorId);
  });

  it('defaults colour to null so the map can pick one', async () => {
    const res = await createZone({ floor_id: floorId, name: 'Maintenance' });
    expect(res.status).toBe(201);
    expect(res.body.data.color).toBeNull();
  });

  it('requires floor_id and name', async () => {
    expect((await createZone({ name: 'No Floor' })).status).toBe(400);
    expect((await createZone({ floor_id: floorId })).status).toBe(400);
  });

  it('rejects a duplicate name on the same floor', async () => {
    expect((await createZone({ floor_id: floorId, name: 'Duplicate Me' })).status).toBe(201);
    const again = await createZone({ floor_id: floorId, name: 'Duplicate Me' });
    expect(again.status).toBe(400);
    expect(again.body.error).toMatch(/already exists/i);
  });

  it('treats case and surrounding whitespace as the same name', async () => {
    // The whole point of the Zone level: "HR" typed three ways must be one group.
    expect((await createZone({ floor_id: floorId, name: 'HR' })).status).toBe(201);
    expect((await createZone({ floor_id: floorId, name: ' hr ' })).status).toBe(400);
    expect((await createZone({ floor_id: floorId, name: 'Hr' })).status).toBe(400);
  });

  it('allows the same name on a different floor', async () => {
    const res = await createZone({ floor_id: otherFloorId, name: 'HR' });
    expect(res.status).toBe(201);
  });
});

// ── List ──────────────────────────────────────────────────────────────────────

describe('GET /api/zones', () => {
  it('filters by floor_id', async () => {
    const res = await request(app).get(`/api/zones?floor_id=${floorId}`).set(auth());
    expect(res.status).toBe(200);
    expect(res.body.data.every((z: any) => z.floor_id === floorId)).toBe(true);
    expect(res.body.data.map((z: any) => z.name)).toContain('Cummins');
  });

  it('reports how many work areas each zone holds', async () => {
    const zone = (await createZone({ floor_id: floorId, name: 'Counted' })).body.data;
    await createWorkArea(`${PREFIX} counted room 1`, zone._id);
    await createWorkArea(`${PREFIX} counted room 2`, zone._id);

    const res = await request(app).get(`/api/zones?floor_id=${floorId}`).set(auth());
    const counted = res.body.data.find((z: any) => z._id === zone._id);
    expect(counted.workarea_count).toBe(2);
  });
});

// ── Get one ───────────────────────────────────────────────────────────────────

describe('GET /api/zones/:id', () => {
  it('returns the zone', async () => {
    const zone = (await createZone({ floor_id: floorId, name: 'Fetch Me' })).body.data;
    const res = await request(app).get(`/api/zones/${zone._id}`).set(auth());
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Fetch Me');
  });

  it('404s on an unknown id', async () => {
    const res = await request(app).get('/api/zones/00000000-0000-0000-0000-000000000000').set(auth());
    expect(res.status).toBe(404);
  });
});

// ── Update ────────────────────────────────────────────────────────────────────

describe('PATCH /api/zones/:id', () => {
  it('renames and recolours', async () => {
    const zone = (await createZone({ floor_id: floorId, name: 'Before Rename' })).body.data;
    const res = await request(app).patch(`/api/zones/${zone._id}`).set(auth())
      .send({ name: 'After Rename', color: '#fde68a' });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('After Rename');
    expect(res.body.data.color).toBe('#fde68a');
  });

  it('clears the colour back to automatic', async () => {
    const zone = (await createZone({ floor_id: floorId, name: 'Auto Colour', color: '#bfdbfe' })).body.data;
    const res = await request(app).patch(`/api/zones/${zone._id}`).set(auth()).send({ color: null });
    expect(res.status).toBe(200);
    expect(res.body.data.color).toBeNull();
  });

  it('rejects a rename onto another zone on the same floor', async () => {
    await createZone({ floor_id: floorId, name: 'Taken Name' });
    const zone = (await createZone({ floor_id: floorId, name: 'Renaming Zone' })).body.data;
    const res = await request(app).patch(`/api/zones/${zone._id}`).set(auth()).send({ name: 'taken name' });
    expect(res.status).toBe(400);
  });

  it('allows renaming a zone to its own name in different casing', async () => {
    // Otherwise fixing the capitalisation of a zone would be impossible.
    const zone = (await createZone({ floor_id: floorId, name: 'selfrename' })).body.data;
    const res = await request(app).patch(`/api/zones/${zone._id}`).set(auth()).send({ name: 'SelfRename' });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('SelfRename');
  });
});

// ── Delete ────────────────────────────────────────────────────────────────────

describe('DELETE /api/zones/:id', () => {
  it('deletes the zone and leaves its rooms on the floor, ungrouped', async () => {
    const zone = (await createZone({ floor_id: floorId, name: 'Doomed Zone' })).body.data;
    const room = await createWorkArea(`${PREFIX} orphan room`, zone._id);
    expect(room.zone_id).toBe(zone._id);

    const del = await request(app).delete(`/api/zones/${zone._id}`).set(auth());
    expect(del.status).toBe(200);
    expect(del.body.message).toMatch(/ungrouped/i);

    // The room must survive — losing a grouping is recoverable, losing the
    // rectangle someone drew is not.
    const after = await request(app).get(`/api/workareas/${room._id}`).set(auth());
    expect(after.status).toBe(200);
    expect(after.body.data.zone_id).toBeNull();
    expect(after.body.data.zone).toBeNull();
  });

  it('404s on an unknown id', async () => {
    const res = await request(app).delete('/api/zones/00000000-0000-0000-0000-000000000000').set(auth());
    expect(res.status).toBe(404);
  });
});

// ── The soft join, as seen from the work areas ─────────────────────────────────

describe('work areas carry their zone', () => {
  it('resolves the zone name and colour onto each work area', async () => {
    const zone = (await createZone({ floor_id: floorId, name: 'Joined Zone', color: '#ddd6fe' })).body.data;
    const room = await createWorkArea(`${PREFIX} joined room`, zone._id);

    const list = await request(app).get(`/api/workareas?floor_id=${floorId}`).set(auth());
    const found = list.body.data.find((w: any) => w._id === room._id);
    expect(found.zone).toEqual({ _id: zone._id, name: 'Joined Zone', color: '#ddd6fe' });
  });

  it('reflects a recolour without touching the work area', async () => {
    // The colour lives on the zone precisely so two rooms of one zone cannot
    // disagree; this is the check that nothing caches a stale copy.
    const zone = (await createZone({ floor_id: floorId, name: 'Recolour Zone', color: '#a7f3d0' })).body.data;
    const room = await createWorkArea(`${PREFIX} recolour room`, zone._id);

    await request(app).patch(`/api/zones/${zone._id}`).set(auth()).send({ color: '#fecaca' });

    const after = await request(app).get(`/api/workareas/${room._id}`).set(auth());
    expect(after.body.data.zone.color).toBe('#fecaca');
  });

  it('leaves zone null for an ungrouped room', async () => {
    const room = await createWorkArea(`${PREFIX} ungrouped room`, null);
    const res = await request(app).get(`/api/workareas/${room._id}`).set(auth());
    expect(res.body.data.zone_id).toBeNull();
    expect(res.body.data.zone).toBeNull();
  });

  it('moves a room to another zone', async () => {
    const from = (await createZone({ floor_id: floorId, name: 'Move From' })).body.data;
    const to = (await createZone({ floor_id: floorId, name: 'Move To' })).body.data;
    const room = await createWorkArea(`${PREFIX} moving room`, from._id);

    const res = await request(app).patch(`/api/workareas/${room._id}`).set(auth())
      .send({ zone_id: to._id });
    expect(res.status).toBe(200);
    expect(res.body.data.zone.name).toBe('Move To');
  });
});
