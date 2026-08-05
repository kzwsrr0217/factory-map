/**
 * normalisation-status.test.ts — "Is what I am looking at current?"
 *
 * The run page's only non-obvious claim is `tasks.stale`: the task list was derived before
 * the newest export or survey, so what it says describes a situation that has already
 * changed. A list reading "nothing outstanding" because it ran before the survey landed is
 * worse than no list, and nothing else in the app could notice that.
 *
 * The tests are written as relations rather than absolute counts on purpose — the endpoint
 * reports on the whole database, and asserting "1057 records" would only pin down the state
 * of whichever suite ran first.
 *
 * The second thing pinned here is why `derived_at` is not read off the task rows: a run that
 * changes nothing leaves no mark on them, and a clean estate has no rows at all — so
 * "derived, found nothing" and "never derived" would be indistinguishable. That was a real
 * bug: pressing Re-derive left the page still insisting the list was stale.
 */
import request from 'supertest';
import { AppDataSource } from '../config/database';
import { AuditLog } from '../entities/AuditLog.entity';
import { NormalisationTask } from '../entities/NormalisationTask.entity';
import { generateTasks, TASK_GENERATION_ENTITY } from '../services/itsm/taskGenerator';
import { setupTests } from './helpers/testApp';

let app: any; // eslint-disable-line @typescript-eslint/no-explicit-any
let token: string;

const PREFIX = `ns_${Date.now()}`;
const auth = () => ({ Authorization: `Bearer ${token}` });
const createdAssetIds: string[] = [];
let buildingId: string;
let floorId: string;

const status = async () => {
  const res = await request(app).get('/api/inventory/status').set(auth());
  expect(res.status).toBe(200);
  return res.body.data;
};

beforeAll(async () => {
  let getAdminToken: () => Promise<string>;
  ({ app, getAdminToken } = await setupTests());
  token = await getAdminToken();

  const b = await request(app).post('/api/buildings').set(auth()).send({ name: PREFIX });
  buildingId = b.body.data._id;
  const f = await request(app).post('/api/floors').set(auth())
    .send({ building_id: buildingId, floor_number: 5, name: `${PREFIX} Fifth` });
  floorId = f.body.data._id;
}, 40000);

afterAll(async () => {
  for (const id of createdAssetIds) await request(app).delete(`/api/assets/${id}`).set(auth());
  await AppDataSource.getRepository(AuditLog).delete({ entity_type: TASK_GENERATION_ENTITY });
  await AppDataSource.getRepository(AuditLog).delete({ entity_type: 'inventory_survey' });
});

describe('GET /api/inventory/status', () => {
  it('requires authentication', async () => {
    expect((await request(app).get('/api/inventory/status')).status).toBe(401);
  });

  it('reports the round as counts and times', async () => {
    const s = await status();
    expect(typeof s.itsm_export.records).toBe('number');
    expect(s.app.total).toBeGreaterThanOrEqual(s.app.linked);
    // Placed is a subset of the estate; a number above it would mean superseded rows are
    // being counted on one side and not the other.
    expect(s.app.total).toBeGreaterThanOrEqual(s.app.placed);
  });

  it('a re-derive that changes nothing still counts as a run', async () => {
    await AppDataSource.getRepository(AuditLog).delete({ entity_type: TASK_GENERATION_ENTITY });
    expect((await status()).tasks.derived_at).toBeNull();

    await generateTasks({ apply: true, by: PREFIX });
    const first = await status();
    expect(first.tasks.derived_at).not.toBeNull();

    // The second run finds the same thing, so nothing is written to the task rows — and the
    // page must still be able to say when the list was last checked.
    await generateTasks({ apply: true, by: PREFIX });
    const second = await status();
    expect(second.tasks.derived_at).not.toBeNull();
    expect(new Date(second.tasks.derived_at).getTime())
      .toBeGreaterThanOrEqual(new Date(first.tasks.derived_at).getTime());
  });

  it('goes stale when a survey lands after the last re-derive, and clean again after another', async () => {
    await generateTasks({ apply: true, by: PREFIX });
    expect((await status()).tasks.stale).toBe(false);

    const room = await request(app).post('/api/workareas').set(auth()).send({
      floor_id: floorId,
      name: `${PREFIX} Room`,
      coordinates: { x: 5, y: 5 },
      dimensions: { width: 100, height: 100 },
    });
    expect(room.status).toBe(201);

    const applied = await request(app).post('/api/inventory/survey/import').set(auth()).send({
      rows: [{
        id: `${PREFIX}-1`,
        azonosito_mod: 'EGYEB',
        eszkoz_tipus: 'Monitor',
        sorozatszam: `${PREFIX}-SER`,
        epulet: PREFIX,
        emelet: '5',
        work_area: `${PREFIX} Room`,
        megjegyzes: `${PREFIX} monitor`,
      }],
      apply: true,
    });
    expect(applied.status).toBe(200);

    const afterSurvey = await status();
    // The data moved and the list did not: the numbers on the page are now describing the
    // situation before the survey.
    expect(afterSurvey.tasks.stale).toBe(true);
    expect(afterSurvey.survey.applied_at).not.toBeNull();
    expect(afterSurvey.survey.assets_created).toBe(1);

    await generateTasks({ apply: true, by: PREFIX });
    expect((await status()).tasks.stale).toBe(false);

    const created = await request(app).get(`/api/assets?q=${PREFIX}-SER`).set(auth());
    for (const a of created.body.data ?? []) createdAssetIds.push(a._id);
  });

  it('never calls the round consistent before the list has been derived', async () => {
    await AppDataSource.getRepository(AuditLog).delete({ entity_type: TASK_GENERATION_ENTITY });
    await AppDataSource.getRepository(NormalisationTask).clear();
    const s = await status();
    // Zero open tasks, but nothing has ever checked. Reading that as "consistent" is the
    // most expensive mistake this page could make.
    expect(s.tasks.open).toBe(0);
    expect(s.tasks.consistent).toBe(false);
  });
});
