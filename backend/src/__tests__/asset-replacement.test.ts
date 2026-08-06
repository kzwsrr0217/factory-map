/**
 * asset-replacement.test.ts — One device taking another's place.
 *
 * A swap hands the replacement the old machine's room, its place on the map and everything
 * connected to it, and leaves the old record behind as history. The case pinned hardest here
 * is running the same swap twice, because that is not harmless and it is not obvious why: the
 * first run empties the old asset's room, so a second would copy that emptiness onto the
 * replacement and quietly take it off the floor plan. It happened while recording two real
 * swaps, and the log still said the screens had moved.
 */
import request from 'supertest';
import { AppDataSource } from '../config/database';
import { Asset } from '../entities/Asset.entity';
import { AssetConnection } from '../entities/AssetConnection.entity';
import { replaceAssetWith, ReplacementError } from '../services/asset/replacement';
import { setupTests } from './helpers/testApp';

let app: any; // eslint-disable-line @typescript-eslint/no-explicit-any
let token: string;

const PREFIX = `rep${Date.now()}`;
const auth = () => ({ Authorization: `Bearer ${token}` });
const createdAssetIds: string[] = [];
let buildingId: string;
let floorId: string;
let workareaId: string;

async function makeAsset(name: string, placed = false): Promise<string> {
  const res = await request(app).post('/api/assets').set(auth()).send({
    basic_info: { display_name: `${PREFIX}-${name}`, type: 'workstation', status: 'active' },
    ...(placed
      ? {
        hierarchy: { building_id: buildingId, floor_id: floorId, workarea_id: workareaId },
        location: { coordinates: { x: 120, y: 240 } },
      }
      : {}),
  });
  expect(res.status).toBe(201);
  const id = res.body.data._id ?? res.body.data.id;
  createdAssetIds.push(id);
  return id;
}

beforeAll(async () => {
  let getAdminToken: () => Promise<string>;
  ({ app, getAdminToken } = await setupTests());
  token = await getAdminToken();

  const b = await request(app).post('/api/buildings').set(auth()).send({ name: PREFIX });
  buildingId = b.body.data._id;
  const f = await request(app).post('/api/floors').set(auth())
    .send({ building_id: buildingId, floor_number: 7, name: `${PREFIX} Seventh` });
  floorId = f.body.data._id;
  const w = await request(app).post('/api/workareas').set(auth())
    .send({ floor_id: floorId, name: `${PREFIX} Room` });
  workareaId = w.body.data._id;
}, 40000);

afterAll(async () => {
  for (const id of createdAssetIds) await request(app).delete(`/api/assets/${id}`).set(auth());
  await request(app).delete(`/api/workareas/${workareaId}`).set(auth());
  await request(app).delete(`/api/floors/${floorId}`).set(auth());
  await request(app).delete(`/api/buildings/${buildingId}`).set(auth());
});

describe('replaceAssetWith', () => {
  it('hands the room, the place and the screens to the replacement', async () => {
    const oldId = await makeAsset('old-a', true);
    const newId = await makeAsset('new-a');
    const monitorId = await makeAsset('screen-a');

    // The screen points at its machine: an outbound parent-child names the PARENT.
    const connRepo = AppDataSource.getRepository(AssetConnection);
    await connRepo.save(connRepo.create({
      asset_id: monitorId, connected_asset_id: oldId,
      connection_type: 'parent-child', bidirectional: false,
    }));

    const result = await replaceAssetWith(oldId, newId, { id: 'test', username: 'test' });
    expect(result.already_recorded).toBe(false);
    expect(result.connections_moved).toBe(1);
    expect(result.inherited_placement).toBe(true);

    const repo = AppDataSource.getRepository(Asset);
    const oldAsset = (await repo.findOne({ where: { id: oldId } }))!;
    const newAsset = (await repo.findOne({ where: { id: newId } }))!;

    expect(newAsset.workarea_id).toBe(workareaId);
    expect(newAsset.is_placed).toBe(true);
    expect(newAsset.predecessor_id).toBe(oldId);
    // The old record stays, as history, out of its slot.
    expect(oldAsset.successor_id).toBe(newId);
    expect(oldAsset.is_placed).toBe(false);
    expect(oldAsset.workarea_id).toBeNull();

    const moved = await connRepo.findOne({ where: { asset_id: monitorId } });
    expect(moved?.connected_asset_id).toBe(newId);
  });

  it('does not unplace the replacement when the same swap is recorded twice', async () => {
    const oldId = await makeAsset('old-b', true);
    const newId = await makeAsset('new-b');

    await replaceAssetWith(oldId, newId, { id: 'test', username: 'test' });
    const second = await replaceAssetWith(oldId, newId, { id: 'test', username: 'test' });

    expect(second.already_recorded).toBe(true);
    const newAsset = (await AppDataSource.getRepository(Asset).findOne({ where: { id: newId } }))!;
    expect(newAsset.workarea_id).toBe(workareaId);
    expect(newAsset.is_placed).toBe(true);
  });

  it('refuses the cases that cannot mean anything', async () => {
    const id = await makeAsset('old-c');
    await expect(replaceAssetWith(id, id)).rejects.toThrow(ReplacementError);
    await expect(replaceAssetWith(id, '')).rejects.toThrow(/required/i);
    await expect(replaceAssetWith(id, '00000000-0000-0000-0000-000000000000'))
      .rejects.toThrow(/replacement asset not found/i);
  });
});

describe('POST /api/assets/:id/replace', () => {
  it('still answers with both records, and maps the refusals to statuses', async () => {
    const oldId = await makeAsset('old-d', true);
    const newId = await makeAsset('new-d');

    const ok = await request(app).post(`/api/assets/${oldId}/replace`).set(auth())
      .send({ replacement_id: newId });
    expect(ok.status).toBe(200);
    expect(ok.body.data.old._id).toBe(oldId);
    expect(ok.body.data.new._id).toBe(newId);

    const missingId = await request(app).post(`/api/assets/${oldId}/replace`).set(auth()).send({});
    expect(missingId.status).toBe(400);

    const itself = await request(app).post(`/api/assets/${oldId}/replace`).set(auth())
      .send({ replacement_id: oldId });
    expect(itself.status).toBe(422);

    const absent = await request(app).post(`/api/assets/${oldId}/replace`).set(auth())
      .send({ replacement_id: '00000000-0000-0000-0000-000000000000' });
    expect(absent.status).toBe(404);
  });
});
