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
/**
 * A real-shaped HWA number, unique to this run. It cannot carry the suite's usual text
 * prefix: the point of the case below is that `HWA1234567` and `1234567` are one device, and
 * that only holds for an identifier that looks like an HWA number.
 */
const HWA_DIGITS = PREFIX.replace(/\D/g, '').slice(-7);

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
      // `kind` tells "a number we do not have" from "a name we have never seen"; this one
      // is neither a bare number nor an HWA number, so it reads as a name.
      { hwa: `${PREFIX}-GHOST`, note: 'read off a label', kind: 'name' },
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

  it('does not reach into another floor for a room of the same name', async () => {
    // The place hierarchy is folded into an index once per run rather than scanned per row
    // (it was quadratic: a 3000-row survey spent five seconds planning). An index keyed
    // wrongly would silently place devices in the identically-named room one floor up,
    // which nothing else would notice.
    const other = await request(app).post('/api/floors').set(auth())
      .send({ building_id: buildingId, floor_number: 4, name: `${PREFIX} Fourth` });
    const twin = await request(app).post('/api/workareas').set(auth()).send({
      floor_id: other.body.data._id,
      name: ROOM, // the same room name, a different floor
      coordinates: { x: 1, y: 1 },
      dimensions: { width: 50, height: 50 },
    });

    const res = await importSurvey({
      rows: [row({ azonosito_mod: 'HWA', hwa: `${PREFIX}-P1`, emelet: '3' })],
      apply: true,
    });
    expect(res.body.data.to_update).toBe(1);

    const placed = await AppDataSource.getRepository(Asset)
      .findOne({ where: { hardware_asset_id: `${PREFIX}-P1` } });
    expect(placed!.floor_id).toBe(floorId);
    expect(placed!.workarea_id).toBe(roomId);
    expect(placed!.workarea_id).not.toBe(twin.body.data._id);

    await AppDataSource.getRepository(WorkArea).delete({ id: twin.body.data._id });
    await request(app).delete(`/api/floors/${other.body.data._id}`).set(auth());
  });

  it('uses the zone to choose between two rooms of one name on the same floor', async () => {
    const zoneA = await request(app).post('/api/zones').set(auth())
      .send({ floor_id: floorId, name: `${PREFIX} Zone A` });
    const zoneB = await request(app).post('/api/zones').set(auth())
      .send({ floor_id: floorId, name: `${PREFIX} Zone B` });
    const shared = `${PREFIX} Iroda`;
    // Saved through the repository, not the API: `POST /workareas` refuses a second room of
    // the same name on a floor. The importer's own `--create-missing-workareas` can still
    // produce the pair (it reports the collision rather than refusing), and so can data that
    // predates that guard — which is exactly what the zone tiebreak is for.
    const waRepo = AppDataSource.getRepository(WorkArea);
    const inA = await waRepo.save(waRepo.create({
      floor_id: floorId, name: shared, zone_id: zoneA.body.data._id,
      coord_x: 300, coord_y: 10, dim_width: 50, dim_height: 50,
    }));
    const inB = await waRepo.save(waRepo.create({
      floor_id: floorId, name: shared, zone_id: zoneB.body.data._id,
      coord_x: 400, coord_y: 10, dim_width: 50, dim_height: 50,
    }));

    const res = await importSurvey({
      rows: [row({
        azonosito_mod: 'HWA', hwa: `${PREFIX}-P1`,
        work_area: shared, helyszin: `${PREFIX} Zone B`,
      })],
      apply: true,
    });
    expect(res.body.data.missing_work_areas).toEqual([]);

    const placed = await AppDataSource.getRepository(Asset)
      .findOne({ where: { hardware_asset_id: `${PREFIX}-P1` } });
    // The zone is a tiebreak, and this is the case it exists for.
    expect(placed!.workarea_id).toBe(inB.id);
    expect(placed!.workarea_id).not.toBe(inA.id);

    await waRepo.delete({ id: inA.id });
    await waRepo.delete({ id: inB.id });
    await AppDataSource.getRepository(Zone).delete({ id: zoneA.body.data._id });
    await AppDataSource.getRepository(Zone).delete({ id: zoneB.body.data._id });
  });

  it('a whole site in one go: every row lands, and none is created twice', async () => {
    // The real survey is the size of a site, not of a test. Measured on synthetic runs:
    // 1200 rows plan in ~0.4 s and apply in ~1.4 s, 3000 in ~0.8 s and ~3.4 s — linear,
    // which is the property this case exists to keep. There is no wall-clock assertion
    // below: a timing threshold in a suite this size would fail for reasons that have
    // nothing to do with the import.
    const N = 400;
    const assetRepo = AppDataSource.getRepository(Asset);
    const bulk = Array.from({ length: N }, (_, i) => assetRepo.create({
      display_name: `${PREFIX}-bulk-${i}`,
      asset_type: 'workstation',
      hardware_asset_id: `${PREFIX}-BULK-${i}`,
      source_of_truth: 'itsm',
    }));
    await assetRepo.save(bulk, { chunk: 40 });

    const rows = Array.from({ length: N }, (_, i) => row({
      azonosito_mod: 'HWA',
      hwa: `${PREFIX}-BULK-${i}`,
      szemely: i % 3 === 0 ? 'moder hajnalka' : `Someone ${i}`,
      megjegyzes: `note ${i}`,
    }));

    const res = await importSurvey({ rows, apply: true });
    expect(res.body.data.to_update).toBe(N);
    expect(res.body.data.to_create).toBe(0);
    expect(res.body.data.unmatched_hwa).toEqual([]);

    const landed = await assetRepo.createQueryBuilder('a')
      .where('a.display_name LIKE :p', { p: `${PREFIX}-bulk-%` })
      .andWhere('a.workarea_id = :w', { w: roomId })
      .getCount();
    expect(landed).toBe(N);

    // Removed in one statement: 400 deletes through the API took longer than the hook
    // budget, and this case is about scale, so it has to clean up at scale too.
    await assetRepo.createQueryBuilder().delete().from(Asset)
      .where('display_name LIKE :p', { p: `${PREFIX}-bulk-%` }).execute();
  }, 60000);

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

/**
 * How the survey writes the identifier it found on the device.
 *
 * All of these come from the real exports, and every one of them was going to be read
 * wrongly: 122 devices the app already holds would have been reported as unknown, and one
 * CSV-only export would have created 65 duplicates. The numbers in the comments are what
 * the 735-device survey actually contains.
 */
describe('POST /api/inventory/survey/import — the identifier column', () => {
  it('finds the device when the HWA prefix was left off', async () => {
    // 95 rows of the real survey carry the number alone, because that is what somebody
    // reads off a label. 92 of them are devices the app already has.
    const asset = await seedAsset('prefix', `HWA${HWA_DIGITS}`);
    const res = await importSurvey({
      rows: [row({ azonosito_mod: 'HWA', hwa: HWA_DIGITS })],
      apply: false,
    });
    expect(res.body.data.to_update).toBe(1);
    expect(res.body.data.unmatched_hwa).toEqual([]);
    expect(res.body.data.matched_by.hwa_prefixed).toBe(1);
    expect(res.body.data.matched_by.hwa).toBe(0);
    expect(asset._id).toBeTruthy();
  });

  it('finds an older device by the name on its asset tag, however it is spelled', async () => {
    // HWA is the current convention; older devices carry MMHIPC…, MMH PRINTER …, MMH LABEL …
    // and those live in `asset_tag`. The same name appears with underscores, with spaces and
    // run together in different rows of the same survey.
    const tag = `${PREFIX}_PRINTER_1039`;
    const res0 = await request(app).post('/api/assets').set(auth()).send({
      basic_info: { display_name: `${PREFIX}-old-printer`, type: 'printer', asset_tag: tag },
    });
    expect(res0.status).toBe(201);
    createdAssetIds.push(res0.body.data._id);

    for (const spelling of [tag, tag.replace(/_/g, ' '), tag.replace(/_/g, '')]) {
      const res = await importSurvey({
        rows: [row({ azonosito_mod: 'HWA', hwa: spelling })],
        apply: false,
      });
      expect(res.body.data.unmatched_hwa).toEqual([]);
      expect(res.body.data.matched_by.device_name).toBe(1);
      expect(res.body.data.to_update).toBe(1);
    }
  });

  it('reads a row as an HWA row when the export has no mode column at all', async () => {
    // A CSV export of the survey has no `azonosito_mod`. Falling through to the "not in
    // ITSM" branch would create a second asset for a device that is already there — 65 of
    // them on the one CSV-only export in hand.
    const asset = await seedAsset('nomode', `${PREFIX}-HWA55555`);
    const res = await importSurvey({
      rows: [row({ hwa: `${PREFIX}-HWA55555`, sorozatszam: 'SER-NOMODE' })],
      apply: false,
    });
    expect(res.body.data.to_update).toBe(1);
    expect(res.body.data.to_create).toBe(0);
    expect(res.body.data.hwa_rows).toBe(1);
    expect(asset._id).toBeTruthy();
  });

  it('still reads an explicit EGYEB as one, identifier or not', async () => {
    // Somebody said it is not in ITSM. That beats the inference.
    const res = await importSurvey({
      rows: [row({ azonosito_mod: 'EGYEB', hwa: 'HWA00001', sorozatszam: `${PREFIX}-EGYEB-SER` })],
      apply: false,
    });
    expect(res.body.data.other_rows).toBe(1);
    expect(res.body.data.to_create).toBe(1);
  });

  it('reports an unresolved identifier even when the building is unknown', async () => {
    // The two problems are independent, and doing the place first meant one hid the other:
    // 612 of 735 real rows have no building yet, so a run reported six identifier problems
    // out of the 33 that were there — and only after every building had been fixed.
    const res = await importSurvey({
      rows: [row({ epulet: 'Nowhere', azonosito_mod: 'HWA', hwa: 'HWA98765' })],
      apply: false,
    });
    expect(res.body.data.unmatched_place).toHaveLength(1);
    expect(res.body.data.unmatched_hwa).toEqual([
      { hwa: 'HWA98765', note: '', kind: 'number' },
    ]);
  });

  it('separates a number it does not have from a name it has never seen', async () => {
    const res = await importSurvey({
      rows: [
        row({ azonosito_mod: 'HWA', hwa: 'HWA98765' }),
        row({ azonosito_mod: 'HWA', hwa: 'MMHIPC7402' }),
      ],
      apply: false,
    });
    const kinds = res.body.data.unmatched_hwa.map((u: any) => u.kind).sort();
    // Different problems, different next step: check the number, or go and identify the box.
    expect(kinds).toEqual(['name', 'number']);
  });
});

describe('POST /api/inventory/survey/import — serials that are not serials', () => {
  it('treats "..." and "N/A 2" as no serial, counts them, and does not merge devices', async () => {
    const res = await importSurvey({
      rows: [
        row({ azonosito_mod: 'EGYEB', eszkoz_tipus: 'Monitor', sorozatszam: '...', megjegyzes: `${PREFIX} junkserial one` }),
        row({ azonosito_mod: 'EGYEB', eszkoz_tipus: 'Monitor', sorozatszam: '...', megjegyzes: `${PREFIX} junkserial two` }),
        row({ azonosito_mod: 'EGYEB', eszkoz_tipus: 'Monitor', sorozatszam: 'N/A 2', megjegyzes: `${PREFIX} junkserial three` }),
      ],
      apply: true,
    });
    expect(res.body.data.placeholder_serials).toBe(3);
    // The devices behind them have no number at all: not found, or not reachable. Said up
    // front, because they come back as "read a number off it" and somebody has to expect that.
    expect(res.body.data.create_without_serial).toBe(3);
    // Three unknown devices, not one device and not three rows sharing a serial.
    expect(res.body.data.to_create).toBe(3);
    const created = await AppDataSource.getRepository(Asset).createQueryBuilder('a')
      .where('a.display_name LIKE :p', { p: `${PREFIX} junkserial %` }).getMany();
    expect(created).toHaveLength(3);
    for (const a of created) {
      expect(a.serial_number).toBeNull();
      createdAssetIds.push(a.id);
    }
  });
});

describe('POST /api/inventory/survey/import — the same device twice', () => {
  it('reports it once with a count, including a pair written two different ways', async () => {
    await seedAsset('dup', `${PREFIX}-HWA24680`);
    const res = await importSurvey({
      rows: [
        row({ azonosito_mod: 'HWA', hwa: `${PREFIX}-HWA24680` }),
        row({ azonosito_mod: 'HWA', hwa: `${PREFIX}-HWA24680` }),
        // "HWA20767" and "20767" are one device recorded twice — the real survey has such a
        // pair, and comparing the raw strings misses it.
        row({ azonosito_mod: 'HWA', hwa: 'HWA20767' }),
        row({ azonosito_mod: 'HWA', hwa: '20767' }),
      ],
      apply: false,
    });
    const dups = res.body.data.duplicates;
    expect(dups).toHaveLength(2);
    expect(dups.every((d: any) => d.rows === 2 && d.kind === 'identifier')).toBe(true);
  });
});
