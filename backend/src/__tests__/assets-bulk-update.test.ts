/**
 * assets-bulk-update.test.ts — Integration tests for PATCH /api/assets/bulk.
 *
 * Corrections after the inventory survey import arrive in groups ("these twelve
 * are actually in the other room"), and without this every one of them is a full
 * form round-trip — `POST /assets/bulk` is no help, it only creates.
 *
 * What matters here is the narrowness, not the breadth:
 *   - identity and ITSM-owned fields must stay out of reach, because a bulk edit
 *     that can overwrite fifty serial numbers is a data-loss tool;
 *   - floor and building are DERIVED from the work area, never accepted, so they
 *     cannot end up contradicting it;
 *   - moving an asset to another room drops its coordinates, because they were
 *     relative to the old rectangle — otherwise it renders inside one room while
 *     belonging to another.
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
let roomAId: string;
let roomBId: string;

const PREFIX = `bulk_${Date.now()}`;
const auth = () => ({ Authorization: `Bearer ${adminToken}` });
const createdAssetIds: string[] = [];

async function createAsset(name: string, body: Record<string, unknown> = {}) {
  const res = await request(app).post('/api/assets').set(auth()).send({
    basic_info: { display_name: `${PREFIX}-${name}`, type: 'workstation', serial_number: `${PREFIX}-${name}-SN` },
    ...body,
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

const bulk = (assetIds: string[], changes: Record<string, unknown>) =>
  request(app).patch('/api/assets/bulk').set(auth()).send({ asset_ids: assetIds, changes });

beforeAll(async () => {
  let getAdminToken: () => Promise<string>;
  ({ app, getAdminToken } = await setupTests());
  adminToken = await getAdminToken();

  const b = await request(app).post('/api/buildings').set(auth()).send({ name: PREFIX });
  buildingId = b.body.data._id;
  const f = await request(app).post('/api/floors').set(auth())
    .send({ building_id: buildingId, floor_number: 1, name: 'Bulk Floor' });
  floorId = f.body.data._id;

  const a = await request(app).post('/api/workareas').set(auth()).send({
    floor_id: floorId, name: `${PREFIX} Room A`,
    coordinates: { x: 100, y: 100 }, dimensions: { width: 200, height: 200 },
  });
  roomAId = a.body.data._id;
  const bRoom = await request(app).post('/api/workareas').set(auth()).send({
    floor_id: floorId, name: `${PREFIX} Room B`,
    coordinates: { x: 400, y: 100 }, dimensions: { width: 200, height: 200 },
  });
  roomBId = bRoom.body.data._id;
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

describe('PATCH /api/assets/bulk', () => {
  it('applies the same changes to every listed asset', async () => {
    const one = await createAsset('one');
    const two = await createAsset('two');

    const res = await bulk([one._id, two._id], {
      person_full_name: 'Bulk Person', status: 'maintenance',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.updated).toHaveLength(2);
    expect(res.body.data.skipped).toEqual([]);

    for (const id of [one._id, two._id]) {
      const after = await getAsset(id);
      // A bare name with no ITSM id must still surface — that is what the survey
      // produces for people it couldn't match.
      expect(after.assigned_person.full_name).toBe('Bulk Person');
      expect(after.basic_info.status).toBe('maintenance');
    }
  });

  it('surfaces a person known only by name, with no ITSM id', async () => {
    // Regression: assigned_person used to require person_itsm_id or person_id, so
    // every person the inventory survey contributes — informal names that mostly
    // don't match an ITSM Person and are kept as free text on purpose — showed as
    // no person at all, which reads as "nobody's" rather than "not linked yet".
    const asset = await createAsset('nameonly');
    await bulk([asset._id], { person_full_name: 'Csak Nev' });

    const after = await getAsset(asset._id);
    expect(after.assigned_person).not.toBeNull();
    expect(after.assigned_person.full_name).toBe('Csak Nev');
    expect(after.assigned_person.itsm_id).toBeNull();
  });

  it('derives floor and building from the work area rather than trusting the caller', async () => {
    const asset = await createAsset('derive');
    const res = await bulk([asset._id], { workarea_id: roomAId });
    expect(res.status).toBe(200);

    const after = await getAsset(asset._id);
    expect(after.hierarchy.workarea_id).toBe(roomAId);
    expect(after.hierarchy.floor_id).toBe(floorId);
    expect(after.hierarchy.building_id).toBe(buildingId);
  });

  it('returns a moved asset to the unplaced tray, since its coordinates were relative to the old room', async () => {
    const asset = await createAsset('mover', {
      hierarchy: { building_id: buildingId, floor_id: floorId, workarea_id: roomAId },
      location: { coordinates: { x: 150, y: 150 } },
    });
    expect((await getAsset(asset._id)).is_placed).toBe(true);

    const res = await bulk([asset._id], { workarea_id: roomBId });
    expect(res.body.data.unplaced).toHaveLength(1);
    expect(res.body.message).toMatch(/unplaced tray/i);

    const after = await getAsset(asset._id);
    expect(after.hierarchy.workarea_id).toBe(roomBId);
    expect(after.is_placed).toBe(false);
    expect(after.location.coordinates).toEqual({ x: 0, y: 0 });
  });

  it('leaves a placed asset alone when the room is not actually changing', async () => {
    const asset = await createAsset('stayer', {
      hierarchy: { building_id: buildingId, floor_id: floorId, workarea_id: roomAId },
      location: { coordinates: { x: 160, y: 170 } },
    });

    const res = await bulk([asset._id], { workarea_id: roomAId, status: 'active' });
    expect(res.body.data.unplaced).toEqual([]);

    const after = await getAsset(asset._id);
    expect(after.is_placed).toBe(true);
    expect(after.location.coordinates).toEqual({ x: 160, y: 170 });
  });

  it('clears the placement but keeps the room when asked', async () => {
    const asset = await createAsset('clearer', {
      hierarchy: { building_id: buildingId, floor_id: floorId, workarea_id: roomAId },
      location: { coordinates: { x: 180, y: 180 } },
    });

    await bulk([asset._id], { clear_placement: true });

    const after = await getAsset(asset._id);
    expect(after.is_placed).toBe(false);
    expect(after.hierarchy.workarea_id).toBe(roomAId);
  });

  it('ungroups assets when the work area is set to null', async () => {
    const asset = await createAsset('ungrouped', {
      hierarchy: { building_id: buildingId, floor_id: floorId, workarea_id: roomAId },
    });
    await bulk([asset._id], { workarea_id: null });
    expect((await getAsset(asset._id)).hierarchy.workarea_id).toBeNull();
  });

  it('ignores fields outside the whitelist', async () => {
    // The point of the whitelist: identity and ITSM-owned data are never wrong
    // in groups, and a bulk edit able to rewrite them is a data-loss tool.
    const asset = await createAsset('protected');
    const originalName = asset.basic_info.display_name;
    const originalSerial = asset.basic_info.serial_number;

    const res = await request(app).patch('/api/assets/bulk').set(auth()).send({
      asset_ids: [asset._id],
      changes: {
        status: 'inactive',
        display_name: 'HACKED',
        serial_number: 'HACKED-SN',
        hardware_asset_id: 'HWA-HACKED',
      },
    });
    expect(res.status).toBe(200);

    const after = await getAsset(asset._id);
    expect(after.basic_info.status).toBe('inactive');
    expect(after.basic_info.display_name).toBe(originalName);
    expect(after.basic_info.serial_number).toBe(originalSerial);
    expect(after.itsm?.hardware_asset_id ?? null).toBeNull();
  });

  it('reports unknown ids instead of failing the whole request', async () => {
    const asset = await createAsset('mixed');
    const res = await bulk([asset._id, '00000000-0000-0000-0000-000000000001'], { status: 'active' });

    expect(res.status).toBe(200);
    expect(res.body.data.updated).toHaveLength(1);
    expect(res.body.data.skipped).toEqual([
      { _id: '00000000-0000-0000-0000-000000000001', reason: 'No such asset' },
    ]);
  });

  it('rejects an empty selection, an empty change set, and an unknown work area', async () => {
    const asset = await createAsset('guards');
    expect((await bulk([], { status: 'active' })).status).toBe(400);
    expect((await bulk([asset._id], {})).status).toBe(400);

    const badArea = await bulk([asset._id], { workarea_id: '00000000-0000-0000-0000-000000000000' });
    expect(badArea.status).toBe(422);
    expect(badArea.body.error).toMatch(/work area/i);
  });

  it('refuses a selection larger than the per-request cap', async () => {
    const ids = Array.from({ length: 501 }, (_, i) => `00000000-0000-0000-0000-${String(i).padStart(12, '0')}`);
    const res = await bulk(ids, { status: 'active' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at most/i);
  });

  it('writes one audit entry per asset', async () => {
    const asset = await createAsset('audited');
    await bulk([asset._id], { status: 'retired' });

    const res = await request(app).get(`/api/audit?document_id=${asset._id}`).set(auth());
    expect(res.status).toBe(200);
    const bulkEntries = res.body.data.filter((e: any) => e.diff && 'bulk_edit' in e.diff);
    expect(bulkEntries).toHaveLength(1);
    expect(bulkEntries[0].diff.bulk_edit).toEqual({ status: 'retired' });
  });
});
