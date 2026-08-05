/**
 * normalisation-tasks.test.ts — The task list over HTTP.
 *
 * The endpoint set is small; what is worth pinning down is the two rules it enforces
 * rather than leaving to the UI, because they are what keeps the list honest:
 *
 *   - dismissing needs a reason, or the decision cannot be reviewed later and is
 *     indistinguishable from having forgotten;
 *   - ticking a machine-verifiable task says so in the response, because the next
 *     generation will reopen it if the cause is still in the data, and someone believing
 *     otherwise would stop chasing the cause.
 *
 * Rows are created directly rather than through the generator: these tests are about the
 * HTTP surface, and the derivation has its own suite (task-generator.test.ts).
 */
import request from 'supertest';
import { AppDataSource } from '../config/database';
import { NormalisationTask } from '../entities/NormalisationTask.entity';
import { setupTests } from './helpers/testApp';

let app: any; // eslint-disable-line @typescript-eslint/no-explicit-any
let token: string;

const PREFIX = `nt_${Date.now()}`;
const createdIds: string[] = [];

beforeAll(async () => {
  let getAdminToken: () => Promise<string>;
  ({ app, getAdminToken } = await setupTests());
  token = await getAdminToken();
}, 30000);

afterEach(async () => {
  if (createdIds.length === 0) return;
  await AppDataSource.getRepository(NormalisationTask)
    .createQueryBuilder().delete().whereInIds(createdIds).execute();
  createdIds.length = 0;
});

const auth = () => ({ Authorization: `Bearer ${token}` });

async function makeTask(over: Partial<NormalisationTask>): Promise<NormalisationTask> {
  const task = await AppDataSource.getRepository(NormalisationTask).save({
    kind: 'register-in-itsm',
    subject_key: `${PREFIX}_${Math.random().toString(36).slice(2, 10)}`,
    asset_id: null,
    itsm_id: null,
    summary: `${PREFIX} something to do`,
    evidence: 'because',
    evidence_hash: 'h',
    state: 'open',
    ...over,
  } as NormalisationTask);
  createdIds.push(task.id);
  return task;
}

describe('GET /api/tasks', () => {
  it('requires authentication', async () => {
    const res = await request(app).get('/api/tasks');
    expect(res.status).toBe(401);
  });

  it('lists open tasks by default and leaves the closed ones out', async () => {
    const open = await makeTask({ summary: `${PREFIX} open one` });
    await makeTask({ summary: `${PREFIX} done one`, state: 'done' });

    const res = await request(app).get(`/api/tasks?q=${PREFIX}`).set(auth());
    expect(res.status).toBe(200);
    const ids = res.body.data.map((t: any) => t._id);
    expect(ids).toContain(open.id);
    expect(res.body.data.every((t: any) => t.state === 'open')).toBe(true);
  });

  it('says which tasks the data can close', async () => {
    // So the UI can offer the right action without restating the rule.
    await makeTask({ kind: 'label-device', summary: `${PREFIX} label it` });
    await makeTask({ kind: 'link-to-itsm', summary: `${PREFIX} link it` });

    const res = await request(app).get(`/api/tasks?q=${PREFIX}`).set(auth());
    const byKind = new Map(res.body.data.map((t: any) => [t.kind, t.machine_verifiable]));
    expect(byKind.get('link-to-itsm')).toBe(true);
    // A label appears in no export, so only a person can attest to it.
    expect(byKind.get('label-device')).toBe(false);
  });

  it('filters by kind and by nobody-has-taken-it', async () => {
    const mine = await makeTask({ kind: 'check-hwa', summary: `${PREFIX} unassigned` });
    await makeTask({ kind: 'check-hwa', summary: `${PREFIX} taken`, assigned_to: 'someone' });

    const byKind = await request(app).get(`/api/tasks?q=${PREFIX}&kind=check-hwa`).set(auth());
    expect(byKind.body.data).toHaveLength(2);

    const unassigned = await request(app)
      .get(`/api/tasks?q=${PREFIX}&kind=check-hwa&assigned_to=__unassigned__`).set(auth());
    expect(unassigned.body.data.map((t: any) => t._id)).toEqual([mine.id]);
  });
});

describe('GET /api/tasks/summary', () => {
  it('counts by kind and state, and says whether anything is outstanding', async () => {
    await makeTask({ kind: 'identify-device', summary: `${PREFIX} a` });
    await makeTask({ kind: 'identify-device', summary: `${PREFIX} b`, state: 'dismissed', note: 'scrapped' });

    const res = await request(app).get('/api/tasks/summary').set(auth());
    expect(res.status).toBe(200);
    expect(res.body.data.by_kind['identify-device'].open).toBeGreaterThanOrEqual(1);
    expect(res.body.data.by_kind['identify-device'].dismissed).toBeGreaterThanOrEqual(1);
    // With an open task in the table this must be false — it is the definition of done
    // for the whole exercise, so it must never be optimistic.
    expect(res.body.data.consistent).toBe(false);
    expect(res.body.data.open_unassigned).toBeGreaterThanOrEqual(1);
  });
});

describe('PATCH /api/tasks/:id', () => {
  it('takes a task and records a note', async () => {
    const task = await makeTask({ summary: `${PREFIX} assignable` });
    const res = await request(app).patch(`/api/tasks/${task.id}`).set(auth())
      .send({ assigned_to: 'bela', note: 'doing it Friday' });
    expect(res.status).toBe(200);
    expect(res.body.data.assigned_to).toBe('bela');
    expect(res.body.data.note).toBe('doing it Friday');
    expect(res.body.data.state).toBe('open');
  });

  it('refuses to dismiss without a reason', async () => {
    const task = await makeTask({ summary: `${PREFIX} no reason` });
    const res = await request(app).patch(`/api/tasks/${task.id}`).set(auth())
      .send({ state: 'dismissed' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/requires a note/);

    const unchanged = await AppDataSource.getRepository(NormalisationTask)
      .findOne({ where: { id: task.id } });
    expect(unchanged!.state).toBe('open');
  });

  it('dismisses with a reason, and records who did it', async () => {
    const task = await makeTask({ summary: `${PREFIX} with reason` });
    const res = await request(app).patch(`/api/tasks/${task.id}`).set(auth())
      .send({ state: 'dismissed', note: 'device is being scrapped next week' });
    expect(res.status).toBe(200);
    expect(res.body.data.state).toBe('dismissed');
    expect(res.body.data.closed_by).toBe('admin');
    expect(res.body.data.closed_at).toBeTruthy();
  });

  it('warns that a tick on a data-checked task will not stick', async () => {
    const task = await makeTask({ kind: 'link-to-itsm', summary: `${PREFIX} link` });
    const res = await request(app).patch(`/api/tasks/${task.id}`).set(auth())
      .send({ state: 'done' });
    expect(res.status).toBe(200);
    expect(res.body.meta.note).toMatch(/reopen/);
  });

  it('takes a person at their word on a label, with no such warning', async () => {
    const task = await makeTask({ kind: 'label-device', summary: `${PREFIX} label` });
    const res = await request(app).patch(`/api/tasks/${task.id}`).set(auth())
      .send({ state: 'done' });
    expect(res.status).toBe(200);
    expect(res.body.data.state).toBe('done');
    expect(res.body.data.closed_by).toBe('admin');
    expect(res.body.meta).toBeUndefined();
  });

  it('clears the closure when a task is reopened by hand', async () => {
    const task = await makeTask({
      kind: 'label-device', summary: `${PREFIX} reopen`, state: 'done',
      closed_by: 'someone', closed_at: new Date(),
    });
    const res = await request(app).patch(`/api/tasks/${task.id}`).set(auth())
      .send({ state: 'open' });
    expect(res.body.data.state).toBe('open');
    expect(res.body.data.closed_by).toBeNull();
    expect(res.body.data.closed_at).toBeNull();
  });

  it('rejects a state it does not know', async () => {
    const task = await makeTask({ summary: `${PREFIX} bad state` });
    const res = await request(app).patch(`/api/tasks/${task.id}`).set(auth())
      .send({ state: 'maybe' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Unknown state/);
  });

  it('404s for a task that does not exist', async () => {
    const res = await request(app)
      .patch('/api/tasks/00000000-0000-0000-0000-000000000000').set(auth())
      .send({ assigned_to: 'x' });
    expect(res.status).toBe(404);
  });
});

describe('POST /api/tasks/generate', () => {
  it('re-derives and reports what changed', async () => {
    const res = await request(app).post('/api/tasks/generate').set(auth()).send({});
    expect(res.status).toBe(200);
    for (const key of ['created', 'reopened', 'unchanged', 'closed', 'awaiting_human']) {
      expect(typeof res.body.data[key]).toBe('number');
    }
  });
});
