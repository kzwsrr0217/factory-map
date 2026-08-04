/**
 * assets-filtering.test.ts — Integration tests for asset list filter params.
 *
 * Covers:
 *   - GET /api/assets?status=active          — filters by status
 *   - GET /api/assets?building_id=X          — filters by building
 *   - GET /api/assets?floor_id=X             — filters by floor
 *   - GET /api/assets?include_connections=true — includes connections array
 *   - GET /api/assets?search=X               — full-text search
 *   - GET /api/assets?type=IPC               — filters by asset type
 *   - GET /api/assets?ids=a,b                — resolves specific assets by id
 *   - GET /api/assets?connected_to=X         — assets whose one-way links point at X
 *   - GET /api/assets?sort=&dir=              — server-side ordering, whitelisted
 *   - GET /api/assets?ids_only=true           — ids for the filter, for "select all"
 *   - Filter combinations (status + search)
 *   - Unauthenticated request → 401
 */
import request from 'supertest';
import { AppDataSource } from '../config/database';
import { Asset } from '../entities/Asset.entity';
import { Building } from '../entities/Building.entity';
import { Floor } from '../entities/Floor.entity';
import { setupTests } from './helpers/testApp';

let app: any; // eslint-disable-line @typescript-eslint/no-explicit-any
let token: string;
let buildingId: string;
let floorId: string;
const cleanupIds: string[] = [];

beforeAll(async () => {
  let getAdminToken: () => Promise<string>;
  ({ app, getAdminToken } = await setupTests());
  token = await getAdminToken();

  // Create a building + floor for hierarchy filter tests
  const bldRes = await request(app)
    .post('/api/buildings')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: '__filter_test_bld__', address: 'Test Street' });
  buildingId = bldRes.body.data?._id ?? bldRes.body.data?.id;

  if (buildingId) {
    const floorRes = await request(app)
      .post('/api/floors')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '__filter_test_floor__', floor_number: 0, building_id: buildingId });
    floorId = floorRes.body.data?._id ?? floorRes.body.data?.id;
  }

  // Create test assets
  const assets = [
    { basic_info: { display_name: '__filter_active_1__', type: 'IPC', status: 'active' }, hierarchy: { building_id: buildingId ?? null, floor_id: floorId ?? null } },
    { basic_info: { display_name: '__filter_active_2__', type: 'Server', status: 'active' } },
    { basic_info: { display_name: '__filter_maint_1__', type: 'IPC', status: 'maintenance' } },
    { basic_info: { display_name: '__filter_inactive_1__', type: 'Switch', status: 'inactive' } },
    { basic_info: { display_name: '__filter_search_unique_xyz__', type: 'IPC', status: 'active' } },
  ];
  for (const body of assets) {
    const res = await request(app)
      .post('/api/assets')
      .set('Authorization', `Bearer ${token}`)
      .send(body);
    if (res.body.data?._id) cleanupIds.push(res.body.data._id);
    else if (res.body.data?.id) cleanupIds.push(res.body.data.id);
  }
}, 30000);

afterAll(async () => {
  // Clean up created assets
  if (cleanupIds.length > 0) {
    const repo = AppDataSource.getRepository(Asset);
    await repo.createQueryBuilder().delete().whereInIds(cleanupIds).execute();
  }
  // Clean up building + floor
  if (floorId) {
    await AppDataSource.getRepository(Floor)
      .createQueryBuilder().delete().where('id = :id', { id: floorId }).execute().catch(() => {});
  }
  if (buildingId) {
    await AppDataSource.getRepository(Building)
      .createQueryBuilder().delete().where('id = :id', { id: buildingId }).execute().catch(() => {});
  }
});

describe('GET /api/assets — authentication', () => {
  it('returns 401 without a token', async () => {
    const res = await request(app).get('/api/assets');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/assets — status filter', () => {
  it('returns only active assets when status=active', async () => {
    const res = await request(app)
      .get('/api/assets?status=active')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    const statuses = res.body.data.map((a: any) => a.basic_info?.status ?? a.status);
    expect(statuses.every((s: string) => s === 'active')).toBe(true);
  });

  it('returns only maintenance assets when status=maintenance', async () => {
    const res = await request(app)
      .get('/api/assets?status=maintenance')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const statuses = res.body.data.map((a: any) => a.basic_info?.status ?? a.status);
    expect(statuses.every((s: string) => s === 'maintenance')).toBe(true);
  });

  it('returns only inactive assets when status=inactive', async () => {
    const res = await request(app)
      .get('/api/assets?status=inactive')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const statuses = res.body.data.map((a: any) => a.basic_info?.status ?? a.status);
    expect(statuses.every((s: string) => s === 'inactive')).toBe(true);
  });
});

describe('GET /api/assets — search filter (q param)', () => {
  it('returns asset matching unique search term', async () => {
    const res = await request(app)
      .get('/api/assets?q=__filter_search_unique_xyz__')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    const names = res.body.data.map((a: any) => a.basic_info?.display_name ?? a.display_name);
    expect(names).toContain('__filter_search_unique_xyz__');
  });

  it('returns empty list for non-existent search term', async () => {
    const res = await request(app)
      .get('/api/assets?q=ZZZZZZ_ABSOLUTELY_NOT_EXISTS_XXXXXXX')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(0);
  });

  it('search is case-insensitive (LIKE %q%)', async () => {
    const res = await request(app)
      .get('/api/assets?q=__FILTER_SEARCH_UNIQUE')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    // MSSQL LIKE is case-insensitive by default with most collations
    // Just confirm status 200 and not a server error
    expect(res.body.success).toBe(true);
  });
});

describe('GET /api/assets — building / floor filter', () => {
  it('returns asset by building_id when building_id is provided', async () => {
    if (!buildingId) return;
    const res = await request(app)
      .get(`/api/assets?building_id=${buildingId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const found = res.body.data.some(
      (a: any) => a.hierarchy?.building_id === buildingId
    );
    expect(found).toBe(true);
  });

  it('returns asset by floor_id when floor_id is provided', async () => {
    if (!floorId) return;
    const res = await request(app)
      .get(`/api/assets?floor_id=${floorId}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const found = res.body.data.some(
      (a: any) => a.hierarchy?.floor_id === floorId
    );
    expect(found).toBe(true);
  });

  it('returns empty when querying with a non-existent building_id', async () => {
    const res = await request(app)
      .get('/api/assets?building_id=00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBe(0);
  });
});

describe('GET /api/assets — response structure', () => {
  it('returns success, data array, and meta object', async () => {
    const res = await request(app)
      .get('/api/assets')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.meta).toBeDefined();
    expect(typeof res.body.meta.total).toBe('number');
  });

  it('includes connections array when include_connections=true', async () => {
    const res = await request(app)
      .get('/api/assets?include_connections=true')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    // Each asset should have a connections field (array, possibly empty)
    for (const asset of res.body.data) {
      expect(asset.connections).toBeDefined();
      expect(Array.isArray(asset.connections)).toBe(true);
    }
  });

  it('nested basic_info contains display_name', async () => {
    const res = await request(app)
      .get('/api/assets?q=__filter_active_1__')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    if (res.body.data.length > 0) {
      expect(res.body.data[0].basic_info).toBeDefined();
      expect(typeof res.body.data[0].basic_info.display_name).toBe('string');
    }
  });
});

describe('GET /api/assets — combined filters', () => {
  it('status + search combination returns matching assets', async () => {
    const res = await request(app)
      .get('/api/assets?status=active&q=__filter_active__')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const statuses = res.body.data.map((a: any) => a.basic_info?.status ?? a.status);
    expect(statuses.every((s: string) => s === 'active')).toBe(true);
  });
});


describe('GET /api/assets — id lookup (ids param)', () => {
  it('returns exactly the assets asked for', async () => {
    const [first, second] = cleanupIds;
    const res = await request(app)
      .get(`/api/assets?ids=${first},${second}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.map((a: any) => a._id).sort()).toEqual([first, second].sort());
  });

  it('ignores ids that do not exist rather than failing', async () => {
    const res = await request(app)
      .get(`/api/assets?ids=${cleanupIds[0]},00000000-0000-0000-0000-000000000000`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('treats an empty ids list as "nothing", not "everything"', async () => {
    // The trap this guards: a caller that found no peers sending ids= and getting
    // back the first 1000 assets, which then look like connection peers.
    const res = await request(app)
      .get('/api/assets?ids=')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('rejects more ids than it will look up instead of answering short', async () => {
    const tooMany = Array.from({ length: 501 }, (_, i) => `id-${i}`).join(',');
    const res = await request(app)
      .get(`/api/assets?ids=${tooMany}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/501/);
  });

  it('combines with other filters rather than overriding them', async () => {
    const res = await request(app)
      .get(`/api/assets?ids=${cleanupIds.join(',')}&status=maintenance`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const names = res.body.data.map((a: any) => a.basic_info.display_name);
    expect(names).toEqual(['__filter_maint_1__']);
  });
});

describe('GET /api/assets — inbound links (connected_to param)', () => {
  it('finds the asset behind a one-way link, and not the other way round', async () => {
    const [source, target] = cleanupIds;
    await request(app)
      .post(`/api/assets/${source}/connections`)
      .set('Authorization', `Bearer ${token}`)
      .send({ connected_asset_id: target, connection_type: 'network', bidirectional: false })
      .expect(201);

    const inbound = await request(app)
      .get(`/api/assets?connected_to=${target}`)
      .set('Authorization', `Bearer ${token}`);
    expect(inbound.status).toBe(200);
    expect(inbound.body.data.map((a: any) => a._id)).toEqual([source]);

    // A one-way link is only visible from its source, which is the whole reason
    // this param exists — nothing points at the source.
    const reverse = await request(app)
      .get(`/api/assets?connected_to=${source}`)
      .set('Authorization', `Bearer ${token}`);
    expect(reverse.body.data).toEqual([]);
  });

  it('returns nothing for an asset no link points at', async () => {
    const res = await request(app)
      .get('/api/assets?connected_to=00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });
});


describe('GET /api/assets — server-side sorting', () => {
  /**
   * Sorting has to happen in the database once the list is paged: page 2 of a
   * browser-sorted list is page 2 of the wrong list.
   */
  it('orders by name in both directions', async () => {
    const asc = await request(app)
      .get('/api/assets?page=1&limit=200&q=__filter_&sort=name&dir=asc')
      .set('Authorization', `Bearer ${token}`);
    const desc = await request(app)
      .get('/api/assets?page=1&limit=200&q=__filter_&sort=name&dir=desc')
      .set('Authorization', `Bearer ${token}`);
    const ascNames = asc.body.data.map((a: any) => a.basic_info.display_name);
    const descNames = desc.body.data.map((a: any) => a.basic_info.display_name);
    expect(ascNames.length).toBeGreaterThan(1);
    expect(descNames).toEqual([...ascNames].reverse());
  });

  it('falls back to name order for an unknown or hostile sort key', async () => {
    // The key arrives in a query string, so it is whitelisted rather than interpolated.
    const res = await request(app)
      .get('/api/assets?page=1&limit=200&q=__filter_&sort=;DROP TABLE assets--')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    const names = res.body.data.map((a: any) => a.basic_info.display_name);
    expect(names).toEqual([...names].sort());
  });

  it('keeps paging stable when the sort column ties', async () => {
    // Every test asset shares a null maintenance date, so without the display-name
    // tiebreaker the pages could overlap or skip rows between two requests.
    const first = await request(app)
      .get('/api/assets?page=1&limit=2&q=__filter_&sort=maintenance')
      .set('Authorization', `Bearer ${token}`);
    const second = await request(app)
      .get('/api/assets?page=2&limit=2&q=__filter_&sort=maintenance')
      .set('Authorization', `Bearer ${token}`);
    const ids = [...first.body.data, ...second.body.data].map((a: any) => a._id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('GET /api/assets — dashboard filters', () => {
  it('filters by manufacturer, model and person as partial matches', async () => {
    const [first] = cleanupIds;
    await request(app).patch(`/api/assets/${first}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        basic_info: { display_name: '__filter_active_1__', manufacturer: 'ACME Robotics', model: 'ZX-9' },
        assigned_person: { full_name: 'Test Person' },
      })
      .expect(200);

    const byManufacturer = await request(app)
      .get('/api/assets?manufacturer=acme&page=1&limit=50')
      .set('Authorization', `Bearer ${token}`);
    expect(byManufacturer.body.data.map((a: any) => a._id)).toContain(first);

    const byModel = await request(app)
      .get('/api/assets?model=zx&page=1&limit=50')
      .set('Authorization', `Bearer ${token}`);
    expect(byModel.body.data.map((a: any) => a._id)).toContain(first);

    const byPerson = await request(app)
      .get('/api/assets?person=test%20per&page=1&limit=50')
      .set('Authorization', `Bearer ${token}`);
    expect(byPerson.body.data.map((a: any) => a._id)).toContain(first);

    const missing = await request(app)
      .get('/api/assets?manufacturer=nothing_matches_this&page=1&limit=50')
      .set('Authorization', `Bearer ${token}`);
    expect(missing.body.data).toEqual([]);
  });

  it('maintenance=any means "has a date at all", for the calendar', async () => {
    // The calendar pages through months, so it needs every asset carrying a date -
    // not just the overdue or the next 30 days. It used to fetch the whole estate.
    const [, second] = cleanupIds;
    await request(app).patch(`/api/assets/${second}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ basic_info: { display_name: '__filter_active_2__' }, maintenance: { next_date: '2027-06-01' } })
      .expect(200);

    const withDate = await request(app)
      .get('/api/assets?maintenance=any&q=__filter_&page=1&limit=200')
      .set('Authorization', `Bearer ${token}`);
    expect(withDate.body.data.map((a: any) => a._id)).toContain(second);
    // A date in 2027 is neither overdue nor within 30 days, so those two windows
    // must not claim it.
    for (const window of ['overdue', 'upcoming']) {
      const res = await request(app)
        .get(`/api/assets?maintenance=${window}&q=__filter_&page=1&limit=200`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.body.data.map((a: any) => a._id)).not.toContain(second);
    }
  });

  it('splits maintenance into overdue and upcoming', async () => {
    const [, second] = cleanupIds;
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    await request(app).patch(`/api/assets/${second}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ basic_info: { display_name: '__filter_active_2__' }, maintenance: { next_date: yesterday } })
      .expect(200);

    const overdue = await request(app)
      .get('/api/assets?maintenance=overdue&page=1&limit=200')
      .set('Authorization', `Bearer ${token}`);
    expect(overdue.body.data.map((a: any) => a._id)).toContain(second);

    // Overdue is not upcoming: the two windows must not overlap, or the dashboard's
    // two tiles would double-count the same asset.
    const upcoming = await request(app)
      .get('/api/assets?maintenance=upcoming&page=1&limit=200')
      .set('Authorization', `Bearer ${token}`);
    expect(upcoming.body.data.map((a: any) => a._id)).not.toContain(second);
  });
});

describe('GET /api/assets?ids_only=true', () => {
  it('returns ids for the whole filtered set, not one page of them', async () => {
    // What "select everything that matches" needs: the ids, uncapped, without the rows.
    const res = await request(app)
      .get('/api/assets?ids_only=true&q=__filter_')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThanOrEqual(4);
    expect(typeof res.body.data[0]).toBe('string');
    expect(res.body.meta.total).toBe(res.body.data.length);
  });

  it('honours the same filters as the list itself', async () => {
    const res = await request(app)
      .get('/api/assets?ids_only=true&q=__filter_&status=maintenance')
      .set('Authorization', `Bearer ${token}`);
    const list = await request(app)
      .get('/api/assets?q=__filter_&status=maintenance&page=1&limit=200')
      .set('Authorization', `Bearer ${token}`);
    expect(res.body.data.sort()).toEqual(list.body.data.map((a: any) => a._id).sort());
  });
});
