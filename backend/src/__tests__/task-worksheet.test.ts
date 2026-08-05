/**
 * task-worksheet.test.ts — The task list as something you can carry.
 *
 * The worksheet's whole reason to exist is that the task rows do not say where the device
 * is, and "put a label on it" is unactionable without a room to walk into. So what is worth
 * pinning down is the join and the order:
 *
 *   - the device and its place come back on the row;
 *   - the rows are in walking order, and the ones with no room sort LAST rather than first —
 *     a sheet that opens with the devices nobody can find is a sheet that gets put down;
 *   - a task about an ITSM record with no local asset still appears, because "confirm or
 *     retire this" is real work even though there is nothing to walk to;
 *   - it is unpaged, and says so when the cap bites. A worksheet that quietly stops is how a
 *     floor gets skipped and the round stays open for reasons nobody can see.
 */
import request from 'supertest';
import { AppDataSource } from '../config/database';
import { NormalisationTask } from '../entities/NormalisationTask.entity';
import { setupTests } from './helpers/testApp';

let app: any; // eslint-disable-line @typescript-eslint/no-explicit-any
let token: string;
let buildingId: string;
let floorId: string;
let roomId: string;
let zoneId: string;

const PREFIX = `ws_${Date.now()}`;
const auth = () => ({ Authorization: `Bearer ${token}` });
const createdAssetIds: string[] = [];

const taskRepo = () => AppDataSource.getRepository(NormalisationTask);

async function makeAsset(name: string, placed: boolean, extra: Record<string, unknown> = {}) {
  const res = await request(app).post('/api/assets').set(auth()).send({
    basic_info: { display_name: `${PREFIX}-${name}`, type: 'workstation', serial_number: `${PREFIX}-${name}-SER` },
    ...(placed ? { hierarchy: { building_id: buildingId, floor_id: floorId, workarea_id: roomId } } : {}),
    ...extra,
  });
  expect(res.status).toBe(201);
  const id = res.body.data._id ?? res.body.data.id;
  createdAssetIds.push(id);
  return id as string;
}

/** A task row, inserted directly — the generator's own derivation is tested elsewhere. */
async function makeTask(over: Partial<NormalisationTask>) {
  const repo = taskRepo();
  return repo.save(repo.create({
    kind: 'label-device',
    subject_key: `${PREFIX}-${Math.random().toString(36).slice(2)}`,
    asset_id: null,
    itsm_id: null,
    summary: `${PREFIX} do the thing`,
    evidence: 'because',
    evidence_hash: 'h',
    state: 'open',
    ...over,
  } as NormalisationTask));
}

const worksheet = (query = '') =>
  request(app).get(`/api/tasks/worksheet${query}`).set(auth());

beforeAll(async () => {
  let getAdminToken: () => Promise<string>;
  ({ app, getAdminToken } = await setupTests());
  token = await getAdminToken();

  const b = await request(app).post('/api/buildings').set(auth()).send({ name: PREFIX });
  buildingId = b.body.data._id;
  const f = await request(app).post('/api/floors').set(auth())
    .send({ building_id: buildingId, floor_number: 7, name: `${PREFIX} Seventh` });
  floorId = f.body.data._id;
  const z = await request(app).post('/api/zones').set(auth())
    .send({ floor_id: floorId, name: `${PREFIX} Zone` });
  zoneId = z.body.data._id;
  const w = await request(app).post('/api/workareas').set(auth()).send({
    floor_id: floorId,
    name: `${PREFIX} Room`,
    zone_id: zoneId,
    coordinates: { x: 10, y: 10 },
    dimensions: { width: 100, height: 100 },
  });
  roomId = w.body.data._id;
}, 40000);

afterEach(async () => {
  await taskRepo().createQueryBuilder().delete()
    .where('summary LIKE :p', { p: `${PREFIX}%` }).execute();
});

afterAll(async () => {
  for (const id of createdAssetIds) await request(app).delete(`/api/assets/${id}`).set(auth());
});

describe('GET /api/tasks/worksheet', () => {
  it('requires authentication', async () => {
    expect((await request(app).get('/api/tasks/worksheet')).status).toBe(401);
  });

  it('refuses a state it does not know rather than quietly listing the open ones', async () => {
    const res = await worksheet('?state=nonsense');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/state/);
  });

  it('carries the device and the room the task is about', async () => {
    const assetId = await makeAsset('placed', true);
    await makeTask({ asset_id: assetId, summary: `${PREFIX} label the placed one` });

    const res = await worksheet();
    expect(res.status).toBe(200);
    const row = res.body.data.find((r: any) => r.summary.includes('label the placed one'));
    expect(row).toMatchObject({
      device: `${PREFIX}-placed`,
      building: PREFIX,
      floor: `${PREFIX} Seventh`,
      zone: `${PREFIX} Zone`,
      room: `${PREFIX} Room`,
      serial_number: `${PREFIX}-placed-SER`,
      machine_verifiable: false, // label-device: only a person can close it
    });
  });

  it('puts the ones with no room last, and counts them', async () => {
    const placed = await makeAsset('inroom', true);
    const homeless = await makeAsset('noroom', false);
    await makeTask({ asset_id: homeless, summary: `${PREFIX} zzz find this one` });
    await makeTask({ asset_id: placed, summary: `${PREFIX} aaa label this one` });

    const res = await worksheet();
    const mine = res.body.data.filter((r: any) => r.summary.startsWith(PREFIX));
    // Alphabetically "aaa" precedes "zzz" anyway; what is asserted is the PLACE order —
    // the roomless row goes last even though nothing else would put it there.
    expect(mine[mine.length - 1].room).toBeNull();
    expect(mine[0].room).toBe(`${PREFIX} Room`);
    expect(res.body.meta.without_place).toBeGreaterThanOrEqual(1);
  });

  it('keeps a task about an ITSM record that has no local asset', async () => {
    await makeTask({
      kind: 'verify-disposal',
      itsm_id: 'HWA99999',
      asset_id: null,
      summary: `${PREFIX} confirm or retire HWA99999`,
    });

    const res = await worksheet();
    const row = res.body.data.find((r: any) => r.itsm_id === 'HWA99999');
    // Nothing to walk to, and still work: it must not be filtered out by the join.
    expect(row).toBeTruthy();
    expect(row.device).toBeNull();
    expect(row.room).toBeNull();
    expect(row.machine_verifiable).toBe(true);
  });

  it('filters by kind, so a label round is not mixed with the typing', async () => {
    const assetId = await makeAsset('bykind', true);
    await makeTask({ asset_id: assetId, kind: 'label-device', summary: `${PREFIX} label it` });
    await makeTask({ asset_id: assetId, kind: 'register-in-itsm', summary: `${PREFIX} register it` });

    const labels = await worksheet('?kind=label-device');
    const mine = labels.body.data.filter((r: any) => r.summary.startsWith(PREFIX));
    expect(mine).toHaveLength(1);
    expect(mine[0].kind).toBe('label-device');
  });

  it('reports the age in days, which is the number that says what is being ignored', async () => {
    const assetId = await makeAsset('old', true);
    const task = await makeTask({ asset_id: assetId, summary: `${PREFIX} an old one` });
    // first_seen_at is a create-date column, so it is moved by hand here.
    await taskRepo().createQueryBuilder().update(NormalisationTask)
      .set({ first_seen_at: new Date(Date.now() - 10 * 86400000) })
      .whereInIds([task.id]).execute();

    const res = await worksheet();
    const row = res.body.data.find((r: any) => r.summary.includes('an old one'));
    expect(row.age_days).toBe(10);
  });

  it('says it is unpaged by returning everything and reporting the total', async () => {
    const assetId = await makeAsset('many', true);
    for (let i = 0; i < 30; i++) {
      await makeTask({ asset_id: assetId, summary: `${PREFIX} task ${i}` });
    }
    const res = await worksheet();
    const mine = res.body.data.filter((r: any) => r.summary.startsWith(PREFIX));
    // The paged list would have stopped at 50 by default; the sheet must not stop at all.
    expect(mine).toHaveLength(30);
    expect(res.body.meta.truncated).toBe(false);
    expect(res.body.meta.total).toBeGreaterThanOrEqual(30);
  }, 30000);
});
