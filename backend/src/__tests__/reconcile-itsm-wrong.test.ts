/**
 * reconcile-itsm-wrong.test.ts — the third decision, end to end through the endpoint.
 *
 * Accepting an ITSM value and ignoring a difference were the only two things the reconcile page
 * could say. Neither fits the case that dominates after a physical survey: the record is stale and
 * the room is right. This covers the route, the controller and the service together, because the
 * value of the decision is that it is reachable from the page — a service function nothing calls
 * would be no better than the spreadsheet it replaces.
 *
 * Asserted against the stored asset rather than a reconcile check, deliberately: the check goes
 * through the ITSM adapter, and what matters here is that the decision was recorded and that it
 * displaces the opposite one.
 */
import request from 'supertest';
import { AppDataSource } from '../config/database';
import { Asset } from '../entities/Asset.entity';
import { setupTests } from './helpers/testApp';

let app: any; // eslint-disable-line @typescript-eslint/no-explicit-any
let token: string;

const PREFIX = `iw${Date.now()}`;
const auth = () => ({ Authorization: `Bearer ${token}` });
const createdAssetIds: string[] = [];

async function makeAsset(serial: string): Promise<string> {
  const res = await request(app).post('/api/assets').set(auth()).send({
    basic_info: { display_name: `${PREFIX}_asset`, type: 'workstation', status: 'active', serial_number: serial },
    itsm: { hardware_asset_id: `${PREFIX}_HWA` },
  });
  expect(res.status).toBe(201);
  const id = res.body.data._id ?? res.body.data.id;
  createdAssetIds.push(id);
  return id;
}

async function stored(id: string): Promise<Asset | null> {
  return AppDataSource.getRepository(Asset).findOne({ where: { id } });
}

beforeAll(async () => {
  let getAdminToken: () => Promise<string>;
  ({ app, getAdminToken } = await setupTests());
  token = await getAdminToken();
}, 40000);

afterAll(async () => {
  for (const id of createdAssetIds) await request(app).delete(`/api/assets/${id}`).set(auth());
});

describe('PATCH /api/itsm/reconcile/:id/itsm-wrong', () => {
  it('records the app value as the one that should be in ITSM', async () => {
    const id = await makeAsset('REAL-SERIAL');
    const res = await request(app)
      .patch(`/api/itsm/reconcile/${id}/itsm-wrong`)
      .set(auth())
      .send({ field: 'serial_number', itsm_value: 'STALE-SERIAL', note: 'read off the label' });
    expect(res.status).toBe(200);

    const asset = await stored(id);
    expect(asset?.reconcile_itsm_wrong).toHaveLength(1);
    const entry = asset!.reconcile_itsm_wrong![0];
    expect(entry.field).toBe('serial_number');
    // Snapshotted from the asset, not echoed from the request: what the task will be judged
    // against has to be what the app actually held at the moment of the decision.
    expect(entry.app_value).toBe('REAL-SERIAL');
    expect(entry.itsm_value).toBe('STALE-SERIAL');
    expect(entry.note).toBe('read off the label');
  });

  it('does not clear the difference count, because the difference is still there', async () => {
    // The one behaviour that separates this from an ignore. Alemba has not changed yet.
    const id = await makeAsset('REAL-2');
    await AppDataSource.getRepository(Asset).update(id, {
      reconcile_last_status: 'differences',
      reconcile_diff_count: 1,
    });
    await request(app).patch(`/api/itsm/reconcile/${id}/itsm-wrong`).set(auth())
      .send({ field: 'serial_number', itsm_value: 'STALE-2' });

    const asset = await stored(id);
    expect(asset?.reconcile_diff_count).toBe(1);
    expect(asset?.reconcile_last_status).toBe('differences');
  });

  it('supersedes an ignore on the same field', async () => {
    // Opposite decisions about one difference. Leaving both would mean it is simultaneously
    // parked and escalated.
    const id = await makeAsset('REAL-3');
    await request(app).patch(`/api/itsm/reconcile/${id}/ignore`).set(auth())
      .send({ field: 'serial_number', itsm_value: 'STALE-3' });
    expect((await stored(id))?.reconcile_ignored).toHaveLength(1);

    await request(app).patch(`/api/itsm/reconcile/${id}/itsm-wrong`).set(auth())
      .send({ field: 'serial_number', itsm_value: 'STALE-3' });

    const asset = await stored(id);
    expect(asset?.reconcile_ignored).toBeNull();
    expect(asset?.reconcile_itsm_wrong).toHaveLength(1);
  });

  it('replaces rather than duplicates when the same field is marked twice', async () => {
    const id = await makeAsset('REAL-4');
    for (const v of ['STALE-A', 'STALE-B']) {
      await request(app).patch(`/api/itsm/reconcile/${id}/itsm-wrong`).set(auth())
        .send({ field: 'serial_number', itsm_value: v });
    }
    const asset = await stored(id);
    expect(asset?.reconcile_itsm_wrong).toHaveLength(1);
    expect(asset!.reconcile_itsm_wrong![0].itsm_value).toBe('STALE-B');
  });

  it('rejects a field that is not comparable', async () => {
    const id = await makeAsset('REAL-5');
    const res = await request(app).patch(`/api/itsm/reconcile/${id}/itsm-wrong`).set(auth())
      .send({ field: 'not_a_reconcile_field', itsm_value: 'x' });
    expect(res.status).toBe(400);
  });

  it('requires a field', async () => {
    const id = await makeAsset('REAL-6');
    const res = await request(app).patch(`/api/itsm/reconcile/${id}/itsm-wrong`).set(auth()).send({});
    expect(res.status).toBe(400);
  });

  it('withdraws the mark, leaving nothing behind', async () => {
    const id = await makeAsset('REAL-7');
    await request(app).patch(`/api/itsm/reconcile/${id}/itsm-wrong`).set(auth())
      .send({ field: 'serial_number', itsm_value: 'STALE-7' });

    const res = await request(app)
      .patch(`/api/itsm/reconcile/${id}/itsm-wrong/serial_number/withdraw`).set(auth());
    expect(res.status).toBe(200);
    // Null, not an empty array: "never decided" and "decided nothing" stay distinguishable.
    expect((await stored(id))?.reconcile_itsm_wrong).toBeNull();
  });
});
