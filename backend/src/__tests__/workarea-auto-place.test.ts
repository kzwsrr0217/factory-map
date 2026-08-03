/**
 * workarea-auto-place.test.ts — Integration tests for
 * POST /api/workareas/:id/auto-place.
 *
 * The inventory survey assigns a work area but no coordinates, so imported
 * assets sit in the map's unplaced tray. This endpoint lays them out on a grid
 * inside the room — the normal placement path, not a bulk shortcut, because the
 * exact spot inside a room carries no information (see
 * docs/CONNECTIONS_WORKFLOW.md for the same reasoning applied to sockets).
 *
 * What these tests pin down is the set of things it must NOT do, since those are
 * what a well-meaning refactor would break:
 *   - never move an asset that is already on the map;
 *   - never touch a rack-mounted asset (it lives in a rack diagram) or one that
 *     has been superseded by a replacement;
 *   - never place anything outside the room's rectangle;
 *   - never quietly produce fewer placements than it claims;
 *   - say so when the room is too small for the icons not to overlap, rather
 *     than silently producing a pile.
 */
import request from 'supertest';
import { AppDataSource } from '../config/database';
import { Building } from '../entities/Building.entity';
import { Floor } from '../entities/Floor.entity';
import { WorkArea } from '../entities/WorkArea.entity';
import { Asset } from '../entities/Asset.entity';
import { setupTests } from './helpers/testApp';

let app: any; // eslint-disable-line @typescript-eslint/no-explicit-any
let adminToken: string;
let buildingId: string;
let floorId: string;

const PREFIX = `ap_${Date.now()}`;
const auth = () => ({ Authorization: `Bearer ${adminToken}` });
const createdAssetIds: string[] = [];

/** Room geometry the assertions below are written against. */
const AREA = { x: 200, y: 200, width: 300, height: 200 };

async function createArea(name: string, geometry = AREA): Promise<any> {
  const res = await request(app).post('/api/workareas').set(auth()).send({
    floor_id: floorId,
    name: `${PREFIX} ${name}`,
    coordinates: { x: geometry.x, y: geometry.y },
    dimensions: { width: geometry.width, height: geometry.height },
  });
  expect(res.status).toBe(201);
  return res.body.data;
}

/** An asset assigned to a work area but with no position — what the survey produces. */
async function createUnplacedAsset(name: string, workareaId: string, extra: Record<string, unknown> = {}) {
  const res = await request(app).post('/api/assets').set(auth()).send({
    basic_info: { display_name: `${PREFIX}-${name}`, type: 'workstation' },
    hierarchy: { building_id: buildingId, floor_id: floorId, workarea_id: workareaId },
    ...extra,
  });
  expect(res.status).toBe(201);
  const id = res.body.data._id ?? res.body.data.id;
  createdAssetIds.push(id);
  return res.body.data;
}

async function getAsset(id: string) {
  const res = await request(app).get(`/api/assets/${id}`).set(auth());
  expect(res.status).toBe(200);
  return res.body.data;
}

async function autoPlace(areaId: string) {
  return request(app).post(`/api/workareas/${areaId}/auto-place`).set(auth());
}

const insideArea = (p: { x: number; y: number }, area = AREA) =>
  p.x >= area.x && p.x <= area.x + area.width && p.y >= area.y && p.y <= area.y + area.height;

beforeAll(async () => {
  let getAdminToken: () => Promise<string>;
  ({ app, getAdminToken } = await setupTests());
  adminToken = await getAdminToken();

  const b = await request(app).post('/api/buildings').set(auth()).send({ name: PREFIX });
  buildingId = b.body.data._id;
  const f = await request(app).post('/api/floors').set(auth())
    .send({ building_id: buildingId, floor_number: 1, name: 'Auto Place Floor' });
  floorId = f.body.data._id;
}, 30000);

afterAll(async () => {
  if (createdAssetIds.length > 0) {
    await AppDataSource.getRepository(Asset)
      .createQueryBuilder().delete().whereInIds(createdAssetIds).execute();
  }
  await AppDataSource.getRepository(WorkArea)
    .createQueryBuilder().delete().where('floor_id = :id', { id: floorId }).execute();
  await AppDataSource.getRepository(Floor).delete({ id: floorId });
  await AppDataSource.getRepository(Building).delete({ id: buildingId });
});

describe('POST /api/workareas/:id/auto-place', () => {
  it('places every unplaced asset inside the rectangle, on distinct cells', async () => {
    const area = await createArea('grid room');
    for (let i = 1; i <= 6; i++) await createUnplacedAsset(`grid${i}`, area._id);

    const res = await autoPlace(area._id);
    expect(res.status).toBe(200);
    expect(res.body.data.placed).toHaveLength(6);
    expect(res.body.data.skipped).toEqual([]);
    expect(res.body.data.crowded).toBe(false);

    for (const p of res.body.data.placed) expect(insideArea(p)).toBe(true);
    const cells = new Set(res.body.data.placed.map((p: any) => `${p.x},${p.y}`));
    expect(cells.size).toBe(6);
  });

  it('marks them placed in the database, not just in the response', async () => {
    const area = await createArea('persisted room');
    const asset = await createUnplacedAsset('persisted', area._id);
    expect(asset.is_placed).toBe(false);

    await autoPlace(area._id);

    const after = await getAsset(asset._id);
    expect(after.is_placed).toBe(true);
    expect(after.location.coordinates.x).toBeGreaterThan(AREA.x);
    expect(after.location.coordinates.y).toBeGreaterThan(AREA.y);
  });

  it('reports nothing to do on a second run instead of reshuffling', async () => {
    const area = await createArea('idempotent room');
    const asset = await createUnplacedAsset('idem', area._id);

    await autoPlace(area._id);
    const first = await getAsset(asset._id);

    const second = await autoPlace(area._id);
    expect(second.status).toBe(200);
    expect(second.body.data.placed).toEqual([]);
    expect(second.body.data.skipped).toEqual([]);
    expect(second.body.message).toMatch(/nothing to place/i);

    const after = await getAsset(asset._id);
    expect(after.location.coordinates).toEqual(first.location.coordinates);
  });

  it('leaves an already-placed asset exactly where it was', async () => {
    const area = await createArea('mixed room');
    const pinned = await createUnplacedAsset('pinned', area._id);
    // Put it somewhere deliberate inside the room, the way a drag would.
    await request(app).patch(`/api/assets/${pinned._id}`).set(auth()).send({
      basic_info: { display_name: pinned.basic_info.display_name },
      location: { coordinates: { x: 260, y: 260 } },
    });
    await createUnplacedAsset('newcomer', area._id);

    const res = await autoPlace(area._id);
    expect(res.body.data.placed).toHaveLength(1);
    expect(res.body.data.placed[0].display_name).toBe(`${PREFIX}-newcomer`);

    const after = await getAsset(pinned._id);
    expect(after.location.coordinates).toEqual({ x: 260, y: 260 });
  });

  it('ignores rack-mounted assets', async () => {
    // Those live in a rack diagram; a floor-plan coordinate would be meaningless
    // and would also make them show up on the map.
    const area = await createArea('rack room');
    const room = await request(app).post('/api/network/rooms').set(auth())
      .send({ name: `${PREFIX}-IDF`, type: 'idf', building_id: buildingId, floor_id: floorId });
    const rack = await request(app).post('/api/network/racks').set(auth())
      .send({ name: `${PREFIX}-RACK`, network_room_id: room.body.data._id, u_count: 42 });

    const mounted = await createUnplacedAsset('mounted', area._id, {
      hierarchy: {
        building_id: buildingId, floor_id: floorId, workarea_id: area._id,
        rack_id: rack.body.data._id, u_position: 5,
      },
    });

    const res = await autoPlace(area._id);
    expect(res.body.data.placed.map((p: any) => p._id)).not.toContain(mounted._id);

    await AppDataSource.getRepository(Asset).delete({ id: mounted._id });
    await request(app).delete(`/api/network/rooms/${room.body.data._id}`).set(auth());
  });

  it('ignores an asset that has been superseded by a replacement', async () => {
    const area = await createArea('replaced room');
    const oldAsset = await createUnplacedAsset('old', area._id);
    const newAsset = await createUnplacedAsset('new', area._id);

    // successor_id is what marks the old row as no longer the live one.
    await request(app).patch(`/api/assets/${oldAsset._id}`).set(auth()).send({
      basic_info: { display_name: oldAsset.basic_info.display_name },
      successor_id: newAsset._id,
    });

    const res = await autoPlace(area._id);
    const placedIds = res.body.data.placed.map((p: any) => p._id);
    expect(placedIds).toContain(newAsset._id);
    expect(placedIds).not.toContain(oldAsset._id);
  });

  it('warns when the room is too small for the icons not to overlap', async () => {
    const small = { x: 600, y: 600, width: 150, height: 100 };
    const area = await createArea('crowded room', small);
    for (let i = 1; i <= 20; i++) await createUnplacedAsset(`crowd${i}`, area._id);

    const res = await autoPlace(area._id);
    expect(res.body.data.placed).toHaveLength(20);
    expect(res.body.data.crowded).toBe(true);
    expect(res.body.message).toMatch(/overlap/i);
    // Crowded or not, nothing may land outside the room.
    for (const p of res.body.data.placed) expect(insideArea(p, small)).toBe(true);
  });

  it('says there is nothing to place for an empty room', async () => {
    const area = await createArea('empty room');
    const res = await autoPlace(area._id);
    expect(res.status).toBe(200);
    expect(res.body.data.placed).toEqual([]);
    expect(res.body.message).toMatch(/nothing to place/i);
  });

  it('404s on an unknown work area', async () => {
    const res = await autoPlace('00000000-0000-0000-0000-000000000000');
    expect(res.status).toBe(404);
  });
});
