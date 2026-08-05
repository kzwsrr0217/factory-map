/**
 * snapshot-import.test.ts — Loading an ITSM export from an upload.
 *
 * This import REPLACES the snapshot table, because an ITSM export is a point in time and
 * whatever is absent from it is absent from ITSM. That is the right semantic and a
 * destructive one, so the properties worth pinning down are the ones that stop it doing
 * damage quietly:
 *
 *   - a preview writes nothing;
 *   - an empty export is refused rather than applied, since "the file failed to parse"
 *     and "ITSM has nothing" look identical once the table is cleared;
 *   - the plan names what would disappear, which is both the guard against a partial
 *     export and the source of the verify-disposal tasks.
 */
import request from 'supertest';
import { AppDataSource } from '../config/database';
import { ItsmHardwareSnapshot } from '../entities/ItsmHardwareSnapshot.entity';
import { setupTests } from './helpers/testApp';

let app: any; // eslint-disable-line @typescript-eslint/no-explicit-any
let token: string;

const PREFIX = `si_${Date.now()}`;

beforeAll(async () => {
  let getAdminToken: () => Promise<string>;
  ({ app, getAdminToken } = await setupTests());
  token = await getAdminToken();
}, 30000);

/**
 * The table is replaced by every apply, so each test starts from a known state and the
 * suite leaves it empty. Other suites seed what they need themselves.
 */
async function seedSnapshot(rows: Array<Partial<ItsmHardwareSnapshot>>): Promise<void> {
  const repo = AppDataSource.getRepository(ItsmHardwareSnapshot);
  await repo.clear();
  if (rows.length > 0) await repo.insert(rows as ItsmHardwareSnapshot[]);
}

afterAll(async () => {
  await AppDataSource.getRepository(ItsmHardwareSnapshot).clear();
});

const auth = () => ({ Authorization: `Bearer ${token}` });

/** A row in the export's own field names, which is what the mapper reads. */
function exportRow(id: string, over: Record<string, unknown> = {}) {
  return { HardwareAssetID: id, Guid: `${id}-guid`, DisplayName: id, Status: 'Deployed', ...over };
}

describe('POST /api/itsm/snapshot/import', () => {
  it('requires authentication', async () => {
    const res = await request(app).post('/api/itsm/snapshot/import').send({ hardware: [] });
    expect(res.status).toBe(401);
  });

  it('refuses an empty export instead of clearing the table', async () => {
    await seedSnapshot([{ itsm_guid: 'g', itsm_id: `${PREFIX}_KEEP`, display_name: 'keep me' }]);

    const res = await request(app).post('/api/itsm/snapshot/import').set(auth())
      .send({ hardware: [], apply: true });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/empty/i);

    // The point of the refusal: what was there is still there.
    expect(await AppDataSource.getRepository(ItsmHardwareSnapshot).count()).toBe(1);
  });

  it('rejects a body that is not a row array', async () => {
    const res = await request(app).post('/api/itsm/snapshot/import').set(auth())
      .send({ hardware: 'not an array' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/array/);
  });

  it('previews without writing anything', async () => {
    await seedSnapshot([
      { itsm_guid: 'g1', itsm_id: `${PREFIX}_A`, display_name: 'A', status: 'Deployed' },
      { itsm_guid: 'g2', itsm_id: `${PREFIX}_B`, display_name: 'B', status: 'Deployed' },
    ]);

    const res = await request(app).post('/api/itsm/snapshot/import').set(auth()).send({
      hardware: [
        exportRow(`${PREFIX}_A`, { Status: 'Retired' }),
        exportRow(`${PREFIX}_C`),
      ],
      apply: false,
    });

    expect(res.status).toBe(200);
    const plan = res.body.data;
    expect(plan.applied).toBe(false);
    expect(plan.added.map((a: any) => a.itsm_id)).toEqual([`${PREFIX}_C`]);
    expect(plan.removed.map((r: any) => r.itsm_id)).toEqual([`${PREFIX}_B`]);
    expect(plan.changed).toHaveLength(1);
    // Field-level, so a person can see whether the change is the one they expected.
    expect(plan.changed[0].changes.join(' ')).toMatch(/status: Deployed → Retired/);

    const stored = await AppDataSource.getRepository(ItsmHardwareSnapshot).find();
    expect(stored.map((r) => r.itsm_id).sort()).toEqual([`${PREFIX}_A`, `${PREFIX}_B`].sort());
  });

  it('replaces the table on apply', async () => {
    await seedSnapshot([{ itsm_guid: 'g1', itsm_id: `${PREFIX}_OLD`, display_name: 'old' }]);

    const res = await request(app).post('/api/itsm/snapshot/import').set(auth())
      .send({ hardware: [exportRow(`${PREFIX}_NEW`)], apply: true });

    expect(res.body.data.applied).toBe(true);
    const stored = await AppDataSource.getRepository(ItsmHardwareSnapshot).find();
    // Replaced, not merged: an export is the whole truth about ITSM at that moment.
    expect(stored.map((r) => r.itsm_id)).toEqual([`${PREFIX}_NEW`]);
  });

  it('counts rows it cannot use rather than dropping them silently', async () => {
    await seedSnapshot([]);
    const res = await request(app).post('/api/itsm/snapshot/import').set(auth()).send({
      hardware: [exportRow(`${PREFIX}_OK`), { DisplayName: 'no id at all' }],
      apply: false,
    });
    expect(res.body.data.parsed).toBe(2);
    expect(res.body.data.skipped).toBe(1);
  });

  it('enriches from the two CSVs, and says how far it got without them', async () => {
    await seedSnapshot([]);
    const catalogCsv = [
      '"#ID","Display Name","Status","Type","Time Added","Last Modified"',
      '"CI-1","Dell Latitude 5490","Active","Notebook","x","y"',
    ].join('\n');
    const personsCsv = [
      '"#ID","Display Name","Status","Principal Name","Logon Name","AD Account","Cost Center","Location","Organization","Is Real Person","Time Added","Last Modified"',
      '"mmhbela","Kovács, Béla","Active","a","b","c","d","e","f","Yes","x","y"',
    ].join('\n');

    const withCsvs = await request(app).post('/api/itsm/snapshot/import').set(auth()).send({
      hardware: [exportRow(`${PREFIX}_ENR`, { CatalogItem: 'Dell Latitude 5490', AssignedPersonName: 'Kovács, Béla' })],
      catalogItemsCsv: catalogCsv,
      personsCsv,
      apply: false,
    });
    expect(withCsvs.body.data.enrichment.classified).toBe(1);
    expect(withCsvs.body.data.enrichment.manufacturer).toBe(1);
    expect(withCsvs.body.data.enrichment.person_id_resolved).toBe(1);

    // Without them the load still works; it just knows less. Saying so is the point —
    // a run with no CSV once reported full classification.
    const without = await request(app).post('/api/itsm/snapshot/import').set(auth()).send({
      hardware: [exportRow(`${PREFIX}_ENR`, { CatalogItem: 'Dell Latitude 5490', AssignedPersonName: 'Kovács, Béla' })],
      apply: false,
    });
    expect(without.body.data.enrichment.classified).toBe(0);
    expect(without.body.data.enrichment.person_id_resolved).toBe(0);
    expect(without.body.data.enrichment.with_person_name).toBe(1);
  });

  it('accepts the export unchanged from a previous load without reporting churn', async () => {
    // Re-uploading the same file is something people will do; it must look like nothing.
    await seedSnapshot([]);
    const hardware = [exportRow(`${PREFIX}_SAME1`), exportRow(`${PREFIX}_SAME2`)];
    await request(app).post('/api/itsm/snapshot/import').set(auth()).send({ hardware, apply: true });

    const again = await request(app).post('/api/itsm/snapshot/import').set(auth())
      .send({ hardware, apply: false });
    expect(again.body.data.added).toEqual([]);
    expect(again.body.data.removed).toEqual([]);
    expect(again.body.data.changed).toEqual([]);
    expect(again.body.data.unchanged).toBe(2);
  });
});
