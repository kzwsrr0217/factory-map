/**
 * task-generator.test.ts — The contract of the derived task list.
 *
 * Three properties matter more than the individual task kinds, because they are what
 * make the list trustworthy enough to answer "is anything left?":
 *
 *   1. Re-running changes nothing. A list that grows when you look at it is worse than
 *      no list.
 *   2. Only tasks whose completion shows up in the data close themselves. Putting a
 *      label on a device leaves no trace anywhere, so the app must not decide it is done.
 *   3. A dismissal covers the situation it was made about, and lapses when the facts
 *      change — the same rule as the per-field ignore on the reconcile page.
 *
 * Assertions are scoped to the rows each test creates, never to global counts: the test
 * database is shared with every other suite.
 */
import { AppDataSource } from '../config/database';
import { Asset } from '../entities/Asset.entity';
import { ItsmHardwareSnapshot } from '../entities/ItsmHardwareSnapshot.entity';
import { NormalisationTask, NormalisationTaskKind } from '../entities/NormalisationTask.entity';
import { generateTasks } from '../services/itsm/taskGenerator';
import { setupTests } from './helpers/testApp';

const PREFIX = `tg_${Date.now()}`;
const createdAssetIds: string[] = [];
const createdSnapshotIds: string[] = [];

beforeAll(async () => {
  await setupTests();
}, 30000);

afterEach(async () => {
  if (createdAssetIds.length > 0) {
    await AppDataSource.getRepository(NormalisationTask)
      .createQueryBuilder().delete().where('subject_key IN (:...ids)', { ids: createdAssetIds }).execute();
    await AppDataSource.getRepository(Asset)
      .createQueryBuilder().delete().whereInIds(createdAssetIds).execute();
    createdAssetIds.length = 0;
  }
  if (createdSnapshotIds.length > 0) {
    await AppDataSource.getRepository(NormalisationTask)
      .createQueryBuilder().delete().where('subject_key IN (:...ids)', { ids: createdSnapshotIds }).execute();
    await AppDataSource.getRepository(ItsmHardwareSnapshot)
      .createQueryBuilder().delete().where('itsm_id IN (:...ids)', { ids: createdSnapshotIds }).execute();
    createdSnapshotIds.length = 0;
  }
});

async function makeAsset(over: Partial<Asset>): Promise<Asset> {
  const asset = await AppDataSource.getRepository(Asset).save({
    display_name: `${PREFIX}_asset`,
    status: 'active',
    ...over,
  } as Asset);
  createdAssetIds.push(asset.id);
  return asset;
}

async function makeSnapshotRow(over: Partial<ItsmHardwareSnapshot>): Promise<ItsmHardwareSnapshot> {
  const itsmId = over.itsm_id ?? `${PREFIX}_HWA`;
  const row = await AppDataSource.getRepository(ItsmHardwareSnapshot).save({
    itsm_guid: `${itsmId}-guid`,
    itsm_id: itsmId,
    display_name: itsmId,
    ...over,
  } as ItsmHardwareSnapshot);
  createdSnapshotIds.push(row.itsm_id);
  return row;
}

/** Tasks the generator holds for one subject. */
async function tasksFor(subjectKey: string): Promise<NormalisationTask[]> {
  return AppDataSource.getRepository(NormalisationTask).find({ where: { subject_key: subjectKey } });
}

function kinds(tasks: NormalisationTask[]): NormalisationTaskKind[] {
  return tasks.map((t) => t.kind).sort() as NormalisationTaskKind[];
}

describe('taskGenerator — a confident match', () => {
  it('asks for the link and, separately, for the label', async () => {
    await makeSnapshotRow({
      itsm_id: `${PREFIX}_HWA_CONF`,
      serial_number: `${PREFIX}SERIAL1`,
      asset_type: 'laptop',
      assigned_person_name: 'Kovács, Béla',
    });
    const asset = await makeAsset({
      display_name: `${PREFIX}_confident`,
      serial_number: `${PREFIX}serial1`,
      asset_type: 'laptop',
      person_full_name: 'kovacs bela',
    });

    await generateTasks({ apply: true });
    // Two separate jobs, done by different people at different times: linking is a few
    // clicks in the app, labelling means walking to the device.
    expect(kinds(await tasksFor(asset.id))).toEqual(['label-device', 'link-to-itsm']);
  });

  it('closes the link itself once the asset is linked, and leaves the label open', async () => {
    const row = await makeSnapshotRow({
      itsm_id: `${PREFIX}_HWA_CLOSE`,
      serial_number: `${PREFIX}SERIAL2`,
      asset_type: 'laptop',
    });
    const asset = await makeAsset({
      display_name: `${PREFIX}_closing`,
      serial_number: `${PREFIX}serial2`,
      asset_type: 'laptop',
    });
    await generateTasks({ apply: true });

    // The person does the linking in the app; that shows up in the data.
    await AppDataSource.getRepository(Asset).update(asset.id, { hardware_asset_id: row.itsm_id });
    await generateTasks({ apply: true });

    const after = await tasksFor(asset.id);
    const link = after.find((t) => t.kind === 'link-to-itsm')!;
    const label = after.find((t) => t.kind === 'label-device')!;
    expect(link.state).toBe('done');
    expect(link.closed_by).toBe('system');
    // The label is not in any export, so nothing but a person can close it.
    expect(label.state).toBe('open');
    expect(label.closed_by).toBeNull();
  });
});

describe('taskGenerator — idempotence', () => {
  it('creates nothing on a second run', async () => {
    await makeSnapshotRow({ itsm_id: `${PREFIX}_HWA_IDEM`, serial_number: `${PREFIX}SERIAL3` });
    const asset = await makeAsset({
      display_name: `${PREFIX}_idem`,
      serial_number: `${PREFIX}unseen_serial`,
    });

    const first = await generateTasks({ apply: true });
    const mine = (rows: { subject_key?: string; asset_id?: string | null }[]) =>
      rows.filter((r) => (r.subject_key ?? r.asset_id) === asset.id);
    expect(mine(first.created)).toHaveLength(1);

    const second = await generateTasks({ apply: true });
    expect(mine(second.created)).toHaveLength(0);
    expect(mine(second.reopened)).toHaveLength(0);
    expect(await tasksFor(asset.id)).toHaveLength(1);
  });
});

describe('taskGenerator — dismissal', () => {
  it('stays dismissed while the facts are the same', async () => {
    const asset = await makeAsset({
      display_name: `${PREFIX}_dismiss`,
      serial_number: `${PREFIX}dismiss_serial`,
    });
    await generateTasks({ apply: true });

    const [task] = await tasksFor(asset.id);
    await AppDataSource.getRepository(NormalisationTask).update(task.id, {
      state: 'dismissed',
      note: 'Being scrapped next week, not worth registering',
    });

    await generateTasks({ apply: true });
    const [after] = await tasksFor(asset.id);
    expect(after.state).toBe('dismissed');
    expect(after.note).toMatch(/scrapped/);
  });

  it('comes back when the evidence changes', async () => {
    const asset = await makeAsset({
      display_name: `${PREFIX}_relapse`,
      serial_number: `${PREFIX}relapse_serial`,
    });
    await generateTasks({ apply: true });
    const [task] = await tasksFor(asset.id);
    await AppDataSource.getRepository(NormalisationTask).update(task.id, {
      state: 'dismissed', note: 'decided later',
    });

    // A candidate now exists that did not before: the decision was made about a
    // different situation, so it should not silently cover this one.
    await makeSnapshotRow({
      itsm_id: `${PREFIX}_HWA_RELAPSE`,
      serial_number: `${PREFIX}relapse_serial`,
      asset_type: 'laptop',
    });
    await generateTasks({ apply: true });

    const after = await tasksFor(asset.id);
    expect(after.some((t) => t.state === 'open')).toBe(true);
  });
});

describe('taskGenerator — the other direction', () => {
  it('asks about ITSM hardware the survey never found', async () => {
    const row = await makeSnapshotRow({
      itsm_id: `${PREFIX}_HWA_GHOST`,
      status: 'Deployed',
      location_name: 'MMH Veszprém',
    });

    await generateTasks({ apply: true });
    const tasks = await tasksFor(row.itsm_id);
    expect(kinds(tasks)).toEqual(['verify-disposal']);
    expect(tasks[0].summary).toMatch(/confirm it exists or retire it/);
    // The evidence has to carry what a person needs in order to judge it.
    expect(tasks[0].evidence).toMatch(/Deployed/);
  });

  it('reopens a task it had closed if the cause returns', async () => {
    const row = await makeSnapshotRow({ itsm_id: `${PREFIX}_HWA_RETURN` });
    await generateTasks({ apply: true });
    expect((await tasksFor(row.itsm_id))[0].state).toBe('open');

    // Someone links a local asset to it, so it is no longer unaccounted for.
    const asset = await makeAsset({
      display_name: `${PREFIX}_return`,
      hardware_asset_id: row.itsm_id,
    });
    await generateTasks({ apply: true });
    expect((await tasksFor(row.itsm_id))[0].state).toBe('done');

    // …and then the link is removed again. The task must come back rather than stay
    // closed on the strength of something that is no longer true.
    await AppDataSource.getRepository(Asset).update(asset.id, { hardware_asset_id: null });
    await generateTasks({ apply: true });
    const reopened = (await tasksFor(row.itsm_id))[0];
    expect(reopened.state).toBe('open');
    expect(reopened.closed_at).toBeNull();
  });
});

describe('taskGenerator — dry run', () => {
  it('writes nothing without apply', async () => {
    const asset = await makeAsset({
      display_name: `${PREFIX}_dry`,
      serial_number: `${PREFIX}dry_serial`,
    });
    const result = await generateTasks({ apply: false });
    expect(result.created.some((t) => t.subject_key === asset.id)).toBe(true);
    expect(await tasksFor(asset.id)).toHaveLength(0);
  });
});

describe('taskGenerator — at the size of a real estate', () => {
  it('writes a few hundred new tasks in one run', async () => {
    // A task row spends one parameter per column, and MSSQL rejects a statement carrying
    // more than 2100 — so an unchunked save fails somewhere above 150 rows. The FIRST
    // generation over a real site derives far more than that, which makes this the one
    // size that matters and the one nothing smaller would catch. It showed up as a driver
    // error only once the shared test database happened to hold a few hundred assets.
    const N = 200;
    const repo = AppDataSource.getRepository(Asset);
    const many = Array.from({ length: N }, (_, i) => repo.create({
      display_name: `${PREFIX}_bulk_${i}`,
      status: 'active',
      // Nothing to match on, so each derives exactly one task and no ITSM lookup can
      // rescue it — the cheapest way to a large, predictable batch.
      serial_number: null,
      mac_address: null,
      asset_tag: null,
      hardware_asset_id: null,
    }));
    const saved = await repo.save(many, { chunk: 40 });
    for (const a of saved) createdAssetIds.push(a.id);

    const result = await generateTasks({ apply: true });
    const mine = result.created.filter((t) => t.subject_key.length > 0
      && saved.some((a) => a.id === t.subject_key));
    expect(mine).toHaveLength(N);

    const stored = await AppDataSource.getRepository(NormalisationTask)
      .createQueryBuilder('t')
      .where('t.subject_key IN (:...ids)', { ids: saved.map((a) => a.id) })
      .getCount();
    expect(stored).toBe(N);
  }, 60000);
});
