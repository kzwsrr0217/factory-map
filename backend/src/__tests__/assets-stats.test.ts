/**
 * assets-stats.test.ts — Integration tests for GET /api/assets/stats.
 *
 * Why the endpoint exists: the Dashboard derived every tile, chart and dropdown
 * from one unpaginated `GET /assets`, which caps at 1000 rows. With 1057 assets
 * in the database that meant "1000 Total Assets" on screen — and the distortion
 * reached every number, not just the total (941 active shown as 894, and so on).
 * Nothing read the `truncated` flag the endpoint was already returning.
 *
 * So the assertion that matters most here is that these counts are NOT capped:
 * they are compared against the repository's own count rather than against the
 * list endpoint, because the list endpoint is exactly what they must not inherit
 * their limits from.
 *
 * NOTE: these assertions are about GLOBAL totals, so they require the serial test
 * runner the project already uses (`jest --runInBand`, see package.json). Run the
 * suites in parallel and another suite inserting an asset mid-test shifts the
 * count by one. Scoping the endpoint to a filter would have made the tests
 * parallel-safe, but a dashboard total that can be filtered is not the thing being
 * tested.
 */
import request from 'supertest';
import { IsNull } from 'typeorm';
import { AppDataSource } from '../config/database';
import { Building } from '../entities/Building.entity';
import { Floor } from '../entities/Floor.entity';
import { Asset } from '../entities/Asset.entity';
import { setupTests } from './helpers/testApp';

let app: any; // eslint-disable-line @typescript-eslint/no-explicit-any
let adminToken: string;
let buildingId: string;
let floorId: string;

const PREFIX = `stats_${Date.now()}`;
const auth = () => ({ Authorization: `Bearer ${adminToken}` });
const createdAssetIds: string[] = [];

async function createAsset(name: string, body: Record<string, unknown> = {}) {
  // basic_info is merged rather than spread over: a caller passing only a status
  // must not drop display_name, which the API requires.
  const { basic_info: extraBasic, ...rest } = body;
  const res = await request(app).post('/api/assets').set(auth()).send({
    ...rest,
    basic_info: { display_name: `${PREFIX}-${name}`, ...(extraBasic as object ?? {}) },
  });
  expect(res.status).toBe(201);
  const id = res.body.data._id ?? res.body.data.id;
  createdAssetIds.push(id);
  return res.body.data;
}

async function stats() {
  const res = await request(app).get('/api/assets/stats').set(auth());
  expect(res.status).toBe(200);
  return res.body.data;
}

/** ISO date `days` from now, for the maintenance buckets. */
function inDays(days: number): string {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
}

beforeAll(async () => {
  let getAdminToken: () => Promise<string>;
  ({ app, getAdminToken } = await setupTests());
  adminToken = await getAdminToken();

  const b = await request(app).post('/api/buildings').set(auth()).send({ name: PREFIX });
  buildingId = b.body.data._id;
  const f = await request(app).post('/api/floors').set(auth())
    .send({ building_id: buildingId, floor_number: 1, name: 'Stats Floor' });
  floorId = f.body.data._id;
}, 30000);

afterAll(async () => {
  if (createdAssetIds.length > 0) {
    await AppDataSource.getRepository(Asset)
      .createQueryBuilder().delete().whereInIds(createdAssetIds).execute();
  }
  await AppDataSource.getRepository(Floor).delete({ id: floorId });
  await AppDataSource.getRepository(Building).delete({ id: buildingId });
});

describe('GET /api/assets/stats', () => {
  it('counts the whole table, not just the first page of the list endpoint', async () => {
    // The point of the endpoint. Compared against the repository rather than
    // against GET /assets, whose 1000-row cap is what this must not inherit.
    const dbTotal = await AppDataSource.getRepository(Asset).count({ where: { successor_id: IsNull() } });
    expect((await stats()).total).toBe(dbTotal);
  });

  it('moves with the data', async () => {
    const before = (await stats()).total;
    await createAsset('counted');
    expect((await stats()).total).toBe(before + 1);
  });

  it('excludes assets superseded by a replacement', async () => {
    // Those are the historical half of a replacement; counting them would
    // inflate every total against what the lists show.
    const before = (await stats()).total;
    const oldAsset = await createAsset('superseded');
    const newAsset = await createAsset('successor');
    expect((await stats()).total).toBe(before + 2);

    await request(app).patch(`/api/assets/${oldAsset._id}`).set(auth()).send({
      basic_info: { display_name: oldAsset.basic_info.display_name },
      successor_id: newAsset._id,
    });

    expect((await stats()).total).toBe(before + 1);
  });

  it('groups by status, and labels a missing status rather than dropping it', async () => {
    const before = (await stats()).by_status;
    await createAsset('inactive-one', { basic_info: { status: 'inactive' } });

    const after = (await stats()).by_status;
    expect(after.inactive).toBe((before.inactive ?? 0) + 1);
    // A null status is its own bucket: an asset with no status is a real state
    // worth seeing, not a row to leave out of the chart.
    expect(Object.keys(after)).toContain('unknown');
  });

  it('groups by type with its own label for the untyped ones', async () => {
    const before = (await stats()).by_type;
    await createAsset('typed', { basic_info: { type: 'printer' } });
    await createAsset('untyped-one');

    const after = (await stats()).by_type;
    expect(after.printer).toBe((before.printer ?? 0) + 1);
    expect(after.untyped).toBe((before.untyped ?? 0) + 1);
  });

  it('counts assets with no floor under their own key', async () => {
    const before = (await stats()).by_floor;
    await createAsset('on-a-floor', {
      hierarchy: { building_id: buildingId, floor_id: floorId },
    });

    const after = (await stats()).by_floor;
    expect(after[floorId]).toBe((before[floorId] ?? 0) + 1);
    expect(Object.keys(after)).toContain('unassigned');
  });

  it('counts unplaced assets, ignoring rack-mounted ones', async () => {
    // A rack-mounted asset has no floor-plan position and never will; counting it
    // as "unplaced" would put it on a to-do list it can never leave.
    const before = (await stats()).unplaced;
    await createAsset('tray-bound');
    expect((await stats()).unplaced).toBe(before + 1);

    const room = await request(app).post('/api/network/rooms').set(auth())
      .send({ name: `${PREFIX}-IDF`, type: 'idf', building_id: buildingId, floor_id: floorId });
    const rack = await request(app).post('/api/network/racks').set(auth())
      .send({ name: `${PREFIX}-RACK`, network_room_id: room.body.data._id, u_count: 42 });
    await createAsset('rack-mounted', {
      hierarchy: { building_id: buildingId, floor_id: floorId, rack_id: rack.body.data._id, u_position: 3 },
    });

    expect((await stats()).unplaced).toBe(before + 1);
    await request(app).delete(`/api/network/rooms/${room.body.data._id}`).set(auth());
  });

  it('splits maintenance into overdue and due-in-30-days', async () => {
    const before = await stats();
    await createAsset('overdue', { maintenance: { next_date: inDays(-5) } });
    await createAsset('due-soon', { maintenance: { next_date: inDays(10) } });
    await createAsset('due-later', { maintenance: { next_date: inDays(90) } });

    const after = await stats();
    expect(after.maintenance_overdue).toBe(before.maintenance_overdue + 1);
    expect(after.maintenance_due_soon).toBe(before.maintenance_due_soon + 1);
    // The one 90 days out belongs to neither bucket.
  });

  it('requires authentication', async () => {
    const res = await request(app).get('/api/assets/stats');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/assets/persons', () => {
  it('includes people known only by name, not just those with an ITSM id', async () => {
    // The frontend used to derive this list from a full asset download and required
    // both a name and an id, which dropped everyone the inventory survey
    // contributes — informal names kept as free text on purpose. Those are the
    // people most likely to be typed into the field the list feeds.
    const withId = `${PREFIX} Named Person`;
    const nameOnly = `${PREFIX} Nameonly Person`;
    await createAsset('has-id', { assigned_person: { full_name: withId, person_id: `${PREFIX}-id` } });
    await createAsset('name-only', { assigned_person: { full_name: nameOnly } });

    const res = await request(app).get('/api/assets/persons').set(auth());
    expect(res.status).toBe(200);
    const byName = new Map(res.body.data.map((p: any) => [p.full_name, p.person_id]));

    expect(byName.get(withId)).toBe(`${PREFIX}-id`);
    expect(byName.has(nameOnly)).toBe(true);
    expect(byName.get(nameOnly)).toBeNull();
  });

  it('lists each person once even when some of their assets carry no id', async () => {
    // Grouped by name rather than DISTINCT over (name, id), which would list such
    // a person twice and give the autocomplete duplicate entries.
    const shared = `${PREFIX} Mixed Person`;
    await createAsset('mixed-a', { assigned_person: { full_name: shared, person_id: `${PREFIX}-mixed` } });
    await createAsset('mixed-b', { assigned_person: { full_name: shared } });

    const res = await request(app).get('/api/assets/persons').set(auth());
    const hits = res.body.data.filter((p: any) => p.full_name === shared);
    expect(hits).toHaveLength(1);
    expect(hits[0].person_id).toBe(`${PREFIX}-mixed`);
  });

  it('requires authentication', async () => {
    expect((await request(app).get('/api/assets/persons')).status).toBe(401);
  });
});
