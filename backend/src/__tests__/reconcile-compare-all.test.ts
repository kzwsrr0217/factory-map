/**
 * reconcile-compare-all.test.ts — Comparing everything at once, and knowing when it is old.
 *
 * The per-asset check was the only way to compare, so nobody did it a thousand times and the
 * drift overview quietly described whatever had last been checked by hand. On the real
 * database that meant every linked asset read `missing` — a verdict from a run made before the
 * export it claims to be about had even been loaded.
 *
 * What is pinned here is therefore not "the numbers are right" but the two things that made
 * the old answer misleading: it refuses to run with no export loaded (marking everything
 * missing is exactly the wrong answer), and the round's status reports the comparison as stale
 * when it predates the newest data.
 */
import request from 'supertest';
import { AppDataSource } from '../config/database';
import { Asset } from '../entities/Asset.entity';
import { AuditLog } from '../entities/AuditLog.entity';
import { ItsmHardwareSnapshot } from '../entities/ItsmHardwareSnapshot.entity';
import {
  RECONCILE_RUN_ENTITY,
  lastReconcileRunAt,
  reconcileAllFromSnapshot,
} from '../services/itsm/ReconcileService';
import { setupTests } from './helpers/testApp';

let app: any; // eslint-disable-line @typescript-eslint/no-explicit-any
let token: string;

const PREFIX = `cmp${Date.now()}`;
const auth = () => ({ Authorization: `Bearer ${token}` });
const createdAssetIds: string[] = [];
const snapshotIds: string[] = [];

/** One export row, as the importer would have left it. */
async function snapshotRow(over: Partial<ItsmHardwareSnapshot> & { itsm_id: string }): Promise<void> {
  const repo = AppDataSource.getRepository(ItsmHardwareSnapshot);
  await repo.save(repo.create({
    itsm_guid: over.itsm_id,
    display_name: over.itsm_id,
    imported_at: new Date(),
    ...over,
  }));
  snapshotIds.push(over.itsm_id);
}

/** The create endpoint takes the nested shape the API response uses. */
async function asset(
  { name, hwa, serial, status = 'active' }:
  { name: string; hwa: string; serial?: string; status?: string },
): Promise<string> {
  const res = await request(app).post('/api/assets').set(auth()).send({
    basic_info: {
      display_name: name, type: 'workstation', status,
      ...(serial ? { serial_number: serial } : {}),
    },
    itsm: { hardware_asset_id: hwa },
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
}, 40000);

afterAll(async () => {
  for (const id of createdAssetIds) await request(app).delete(`/api/assets/${id}`).set(auth());
  for (const id of snapshotIds) await AppDataSource.getRepository(ItsmHardwareSnapshot).delete({ itsm_id: id });
  await AppDataSource.getRepository(AuditLog).delete({ entity_type: RECONCILE_RUN_ENTITY });
});

describe('reconcileAllFromSnapshot', () => {
  it('refuses to run when no export is loaded', async () => {
    const repo = AppDataSource.getRepository(ItsmHardwareSnapshot);
    const held = await repo.find();
    await repo.clear();
    try {
      await expect(reconcileAllFromSnapshot()).rejects.toThrow(/no itsm export is loaded/i);
    } finally {
      if (held.length > 0) await repo.save(held);
    }
  });

  it('separates in sync, different and not-in-the-export, and records the run', async () => {
    await snapshotRow({ itsm_id: `${PREFIX}-SAME`, serial_number: 'SER-SAME', status: 'Deployed' });
    await snapshotRow({ itsm_id: `${PREFIX}-DIFF`, serial_number: 'SER-EXPORT', status: 'Deployed' });

    const sameId = await asset({ name: `${PREFIX}-SAME`, hwa: `${PREFIX}-SAME`, serial: 'SER-SAME' });
    const diffId = await asset({ name: `${PREFIX}-DIFF`, hwa: `${PREFIX}-DIFF`, serial: 'SER-LOCAL' });
    const goneId = await asset({ name: `${PREFIX}-GONE`, hwa: `${PREFIX}-NOT-IN-EXPORT` });

    const result = await reconcileAllFromSnapshot({ by: 'test' });
    expect(result.checked).toBeGreaterThanOrEqual(3);
    expect(result.export_records).toBeGreaterThanOrEqual(2);
    expect(result.export_loaded_at).not.toBeNull();

    const repo = AppDataSource.getRepository(Asset);
    const verdict = async (id: string) => (await repo.findOne({ where: { id } }))!;
    expect((await verdict(sameId)).reconcile_last_status).toBe('in_sync');
    expect((await verdict(diffId)).reconcile_last_status).toBe('differences');
    expect((await verdict(diffId)).reconcile_diff_count).toBeGreaterThan(0);
    expect((await verdict(goneId)).reconcile_last_status).toBe('missing');
    // Every checked asset gets a timestamp — the point of the whole exercise.
    expect((await verdict(sameId)).reconcile_last_at).not.toBeNull();

    // "Nobody has ever compared" must be tellable from "compared, found nothing", which the
    // asset rows alone cannot answer.
    expect(await lastReconcileRunAt()).not.toBeNull();
  });

  it('reports the comparison as stale when the export was loaded after it', async () => {
    await snapshotRow({ itsm_id: `${PREFIX}-LATER`, serial_number: 'SER-LATER' });
    await asset({ name: `${PREFIX}-LATER`, hwa: `${PREFIX}-LATER`, serial: 'SER-LATER' });

    await reconcileAllFromSnapshot({ by: 'test' });
    const before = (await request(app).get('/api/inventory/status').set(auth())).body.data;
    expect(before.comparison.compared_at).not.toBeNull();
    expect(before.comparison.stale).toBe(false);

    // A newer export arrives. Nothing about the stored verdicts changes — which is exactly
    // why they have to be reported as describing the past.
    await AppDataSource.getRepository(ItsmHardwareSnapshot).update(
      { itsm_id: `${PREFIX}-LATER` },
      { imported_at: new Date(Date.now() + 60_000) },
    );
    const after = (await request(app).get('/api/inventory/status').set(auth())).body.data;
    expect(after.comparison.stale).toBe(true);
  });
});

describe('POST /api/itsm/reconcile/all', () => {
  it('requires authentication', async () => {
    expect((await request(app).post('/api/itsm/reconcile/all')).status).toBe(401);
  });

  it('is not read as an asset id by the per-asset check route', async () => {
    await snapshotRow({ itsm_id: `${PREFIX}-ROUTE`, serial_number: 'SER-ROUTE' });
    const res = await request(app).post('/api/itsm/reconcile/all').set(auth());
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('checked');
    expect(res.body.data).toHaveProperty('export_records');
  });
});
