/**
 * survey-import.test.ts — Handing the app the physical walk-around.
 *
 * The import is the moment three sources meet: what the survey found, what ITSM exported,
 * and what the app already holds. What is worth pinning down is not the arithmetic but the
 * behaviours a refactor would quietly break:
 *
 *   - a preview writes nothing, because the same call is also the validation tool;
 *   - a row whose HWA matches nothing is REPORTED, never guessed at — inventing a device
 *     from a mistyped number is worse than leaving it unresolved;
 *   - an unmatched building does not drag its floor into the report, since a floor name
 *     under an unknown building was never even looked up;
 *   - "Móder, Hajnalka" in the export and "moder hajnalka" in the survey are one person.
 *     Comparing those as strings once put nearly every name in the unmatched list;
 *   - a stored correction changes how the survey is read, and a preview-only correction
 *     changes the preview without being kept.
 */
import request from 'supertest';
import { AppDataSource } from '../config/database';
import { Asset } from '../entities/Asset.entity';
import { ItsmHardwareSnapshot } from '../entities/ItsmHardwareSnapshot.entity';
import { NameCorrection } from '../entities/NameCorrection.entity';
import { WorkArea } from '../entities/WorkArea.entity';
import { Zone } from '../entities/Zone.entity';
import { setupTests } from './helpers/testApp';

let app: any; // eslint-disable-line @typescript-eslint/no-explicit-any
let token: string;
let buildingId: string;
let floorId: string;
let roomId: string;

const PREFIX = `sv_${Date.now()}`;
const auth = () => ({ Authorization: `Bearer ${token}` });
const createdAssetIds: string[] = [];

/** The room the survey rows below point at. */
const ROOM = `${PREFIX} Recepció`;
/** A person as the ITSM export writes them: surname, comma, forename, with diacritics. */
const PERSON_AS_ITSM = 'Móder, Hajnalka';

async function seedAsset(name: string, hwa: string | null, extra: Record<string, unknown> = {}) {
  const res = await request(app).post('/api/assets').set(auth()).send({
    basic_info: { display_name: `${PREFIX}-${name}`, type: 'workstation' },
    ...(hwa ? { itsm: { hardware_asset_id: hwa } } : {}),
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

/** A survey row in the walk-around tool's own field names. */
function row(over: Record<string, unknown> = {}) {
  return {
    id: `${PREFIX}-${Math.random().toString(36).slice(2)}`,
    epulet: PREFIX,
    emelet: '3',
    work_area: ROOM,
    ...over,
  };
}

const importSurvey = (body: Record<string, unknown>) =>
  request(app).post('/api/inventory/survey/import').set(auth()).send(body);

beforeAll(async () => {
  let getAdminToken: () => Promise<string>;
  ({ app, getAdminToken } = await setupTests());
  token = await getAdminToken();

  const b = await request(app).post('/api/buildings').set(auth()).send({ name: PREFIX });
  buildingId = b.body.data._id;
  const f = await request(app).post('/api/floors').set(auth())
    .send({ building_id: buildingId, floor_number: 3, name: `${PREFIX} Third` });
  floorId = f.body.data._id;
  const w = await request(app).post('/api/workareas').set(auth()).send({
    floor_id: floorId,
    name: ROOM,
    coordinates: { x: 10, y: 10 },
    dimensions: { width: 200, height: 150 },
  });
  roomId = w.body.data._id;

  // One ITSM snapshot row, purely so the person index has a name in it. The import reads
  // person names from the snapshot, which is where they come from in real use.
  await AppDataSource.getRepository(ItsmHardwareSnapshot).insert([{
    itsm_guid: `${PREFIX}-guid`,
    itsm_id: `${PREFIX}-HWA`,
    display_name: `${PREFIX}-snapshot`,
    assigned_person_name: PERSON_AS_ITSM,
    person_itsm_id: 'p-1',
    person_id: 'mmhmoder',
  } as ItsmHardwareSnapshot]);
}, 40000);

afterAll(async () => {
  for (const id of createdAssetIds) {
    await request(app).delete(`/api/assets/${id}`).set(auth());
  }
  await AppDataSource.getRepository(NameCorrection).clear();
  await AppDataSource.getRepository(ItsmHardwareSnapshot).delete({ itsm_id: `${PREFIX}-HWA` });
});

describe('POST /api/inventory/survey/import', () => {
  it('requires authentication', async () => {
    const res = await request(app).post('/api/inventory/survey/import').send({ rows: [row()] });
    expect(res.status).toBe(401);
  });

  it('rejects a body that is not a row array, and an empty survey', async () => {
    expect((await importSurvey({ rows: 'nope' })).status).toBe(400);
    // A run over nothing reports "0 unmatched", which reads like a clean survey.
    const empty = await importSurvey({ rows: [] });
    expect(empty.status).toBe(400);
    expect(empty.body.error).toMatch(/no entries/i);
  });

  it('previews without writing anything', async () => {
    const asset = await seedAsset('preview', `${PREFIX}-P1`);
    const res = await importSurvey({
      rows: [row({ azonosito_mod: 'HWA', hwa: `${PREFIX}-P1` })],
      apply: false,
    });

    expect(res.status).toBe(200);
    expect(res.body.data.applied).toBe(false);
    expect(res.body.data.to_update).toBe(1);

    const after = await getAsset(asset._id);
    expect(after.hierarchy?.floor_id ?? null).toBeNull();
  });

  it('places the matched asset and creates the ones ITSM has never heard of', async () => {
    const asset = await seedAsset('apply', `${PREFIX}-A1`);
    const res = await importSurvey({
      rows: [
        row({ azonosito_mod: 'HWA', hwa: `${PREFIX}-A1`, terulet: 'Client Operation' }),
        row({
          azonosito_mod: 'EGYEB',
          eszkoz_tipus: 'Monitor',
          sorozatszam: `${PREFIX}-SER-1`,
          megjegyzes: `${PREFIX} monitor`,
        }),
      ],
      apply: true,
    });

    expect(res.body.data.applied).toBe(true);
    expect(res.body.data.to_update).toBe(1);
    expect(res.body.data.to_create).toBe(1);

    const placed = await getAsset(asset._id);
    expect(placed.hierarchy.floor_id).toBe(floorId);
    expect(placed.hierarchy.workarea_id).toBe(roomId);

    const created = await AppDataSource.getRepository(Asset)
      .findOne({ where: { serial_number: `${PREFIX}-SER-1` } });
    expect(created).not.toBeNull();
    // Local-only on purpose: nobody has registered it in Alemba yet, and the app never
    // writes to ITSM.
    expect(created!.source_of_truth).toBe('local');
    expect(created!.asset_type).toBe('monitor');
    expect(created!.workarea_id).toBe(roomId);
    createdAssetIds.push(created!.id);
  });

  it('re-importing a refined survey does not create the same device twice', async () => {
    const res = await importSurvey({
      rows: [row({
        azonosito_mod: 'EGYEB',
        eszkoz_tipus: 'Monitor',
        sorozatszam: `${PREFIX}-SER-1`,
        megjegyzes: `${PREFIX} monitor`,
      })],
      apply: true,
    });
    // Matched on serial, so it is an update — the survey will be re-exported more than once.
    expect(res.body.data.to_create).toBe(0);
    expect(res.body.data.to_update).toBe(1);
    const all = await AppDataSource.getRepository(Asset)
      .find({ where: { serial_number: `${PREFIX}-SER-1` } });
    expect(all).toHaveLength(1);
  });

  it('reports an HWA with no asset instead of inventing one', async () => {
    const before = await AppDataSource.getRepository(Asset).count();
    const res = await importSurvey({
      rows: [row({ azonosito_mod: 'HWA', hwa: `${PREFIX}-GHOST`, megjegyzes: 'read off a label' })],
      apply: true,
    });
    expect(res.body.data.unmatched_hwa).toEqual([
      { hwa: `${PREFIX}-GHOST`, note: 'read off a label' },
    ]);
    expect(res.body.data.to_create).toBe(0);
    expect(await AppDataSource.getRepository(Asset).count()).toBe(before);
  });

  it('blames the side that actually failed, not both', async () => {
    const res = await importSurvey({
      rows: [
        row({ epulet: 'Nowhere House', azonosito_mod: 'HWA', hwa: `${PREFIX}-X` }),
        row({ emelet: 'the attic', azonosito_mod: 'HWA', hwa: `${PREFIX}-Y` }),
      ],
      apply: false,
    });

    const byBuilding = new Map<string, any>(
      res.body.data.unmatched_place.map((u: any) => [u.building, u]),
    );
    const unknownBuilding = byBuilding.get('Nowhere House');
    expect(unknownBuilding.building_matched).toBe(false);
    // The floor was never looked up, so proposing a rename for it would send someone
    // renaming a floor that is perfectly fine.
    expect(unknownBuilding.floor_suggestion).toBeNull();

    const unknownFloor = byBuilding.get(PREFIX);
    expect(unknownFloor.building_matched).toBe(true);
    expect(unknownFloor.building_suggestion).toBeNull();
  });

  it('reads "moder hajnalka" and "Móder, Hajnalka" as one person', async () => {
    // Comparing these as strings made the same person a mismatch on two counts at once —
    // the comma and the word order — and filled the unmatched list with names that were
    // never wrong. Found on the real export, not by reasoning about it.
    const res = await importSurvey({
      rows: [row({ azonosito_mod: 'HWA', hwa: `${PREFIX}-A1`, szemely: 'moder hajnalka' })],
      apply: false,
    });
    expect(res.body.data.unmatched_persons).toEqual([]);
  });

  it('names an unknown person once, with a count, and keeps them as free text', async () => {
    const res = await importSurvey({
      rows: [
        row({ azonosito_mod: 'HWA', hwa: `${PREFIX}-A1`, szemely: 'Nobody Atall' }),
        row({ azonosito_mod: 'HWA', hwa: `${PREFIX}-P1`, szemely: 'Nobody Atall' }),
      ],
      apply: true,
    });
    expect(res.body.data.unmatched_persons).toEqual([
      { name: 'Nobody Atall', rows: 2, suggestion: null },
    ]);
    // Free text beats nothing: it is the best information anyone has about who uses it.
    const placed = await AppDataSource.getRepository(Asset)
      .findOne({ where: { hardware_asset_id: `${PREFIX}-A1` } });
    expect(placed!.person_full_name).toBe('Nobody Atall');
    expect(placed!.person_id).toBeNull();
  });

  it('reports a room the map lacks, and still places the device on its floor', async () => {
    const res = await importSurvey({
      rows: [row({ work_area: 'Nonexistent Room', azonosito_mod: 'HWA', hwa: `${PREFIX}-P1` })],
      apply: false,
    });
    expect(res.body.data.missing_work_areas).toHaveLength(1);
    expect(res.body.data.missing_work_areas[0].raw_room_name).toBe('Nonexistent Room');
    expect(res.body.data.no_room).toBe(1);
    // Still an update: a floor is worth having even without the room.
    expect(res.body.data.to_update).toBe(1);
  });

  it('creates the rooms the survey names only when applying', async () => {
    const roomName = `${PREFIX} Tárgyaló`;
    const dry = await importSurvey({
      rows: [row({ work_area: roomName, helyszin: `${PREFIX} HR`, azonosito_mod: 'HWA', hwa: `${PREFIX}-P1` })],
      create_missing_workareas: true,
      apply: false,
    });
    expect(dry.body.data.created_areas).toBeNull();
    expect(await AppDataSource.getRepository(WorkArea).count({ where: { name: roomName } })).toBe(0);

    const wet = await importSurvey({
      rows: [row({ work_area: roomName, helyszin: `${PREFIX} HR`, azonosito_mod: 'HWA', hwa: `${PREFIX}-P1` })],
      create_missing_workareas: true,
      apply: true,
    });
    expect(wet.body.data.created_areas).toMatchObject({ work_areas: 1, zones: 1 });
    // Re-planned after creating them, so this run's assets land in the new room rather
    // than needing a second pass.
    expect(wet.body.data.missing_work_areas).toEqual([]);
    const room = await AppDataSource.getRepository(WorkArea).findOne({ where: { name: roomName } });
    expect(room).not.toBeNull();
    expect(room!.zone_id).not.toBeNull();
    const placed = await AppDataSource.getRepository(Asset)
      .findOne({ where: { hardware_asset_id: `${PREFIX}-P1` } });
    expect(placed!.workarea_id).toBe(room!.id);

    await AppDataSource.getRepository(WorkArea).delete({ id: room!.id });
    await AppDataSource.getRepository(Zone).delete({ name: `${PREFIX} HR` });
  });
});

describe('/api/inventory/corrections', () => {
  afterEach(async () => {
    await AppDataSource.getRepository(NameCorrection).clear();
  });

  const put = (body: Record<string, unknown>) =>
    request(app).put('/api/inventory/corrections').set(auth()).send(body);

  it('refuses a scope it does not know, a missing side, and a pair that already matches', async () => {
    expect((await put({ scope: 'colour', from_value: 'a', to_value: 'b' })).status).toBe(400);
    expect((await put({ scope: 'persons', from_value: 'a' })).status).toBe(400);
    // Storing this would suggest a fix that does nothing, which is worse than no row.
    const noop = await put({ scope: 'work_area', from_value: 'hr iroda', to_value: 'HR  Iroda' });
    expect(noop.status).toBe(400);
    expect(noop.body.error).toMatch(/already match/i);
  });

  it('replaces rather than adds when the same name is corrected twice', async () => {
    const first = await put({ scope: 'work_area', from_value: 'Recepcio', to_value: 'wrong' });
    expect(first.status).toBe(201);
    const second = await put({ scope: 'work_area', from_value: 'RECEPCIO', to_value: ROOM });
    expect(second.status).toBe(200);
    // Two rules for one name would make the import depend on row order.
    expect(second.body.data._id).toBe(first.body.data._id);
    const list = await request(app).get('/api/inventory/corrections').set(auth());
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].to_value).toBe(ROOM);
  });

  it('a stored correction changes how the survey reads', async () => {
    const rows = [row({ work_area: 'Rcpcio', azonosito_mod: 'HWA', hwa: `${PREFIX}-P1` })];
    const before = await importSurvey({ rows, apply: false });
    expect(before.body.data.missing_work_areas).toHaveLength(1);

    await put({ scope: 'work_area', from_value: 'Rcpcio', to_value: ROOM });

    const after = await importSurvey({ rows, apply: false });
    expect(after.body.data.missing_work_areas).toEqual([]);
    expect(after.body.data.no_room).toBe(0);
  });

  it('a correction sent with the preview affects the preview only', async () => {
    const rows = [row({ work_area: 'Rcpcio', azonosito_mod: 'HWA', hwa: `${PREFIX}-P1` })];
    const res = await importSurvey({
      rows,
      corrections: { work_area: { Rcpcio: ROOM } },
      apply: false,
    });
    expect(res.body.data.missing_work_areas).toEqual([]);
    // This is how someone sees the effect of a fix before deciding to keep it.
    expect(await AppDataSource.getRepository(NameCorrection).count()).toBe(0);
  });

  it('refuses an id that is not one', async () => {
    // The MSSQL driver throws on a malformed GUID, which would surface as a 500 for what
    // is plainly a bad request.
    const res = await request(app).delete('/api/inventory/corrections/not-an-id').set(auth());
    expect(res.status).toBe(400);
  });
});
