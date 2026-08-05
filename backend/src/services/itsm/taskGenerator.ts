/**
 * taskGenerator.ts — Turns the state of the three sources into a list of things to do.
 *
 * The inventory ends with the physical survey, the ITSM export and the app disagreeing
 * in a handful of specific ways. Each disagreement has one action that resolves it, and
 * the point of this generator is that "everything is consistent" becomes checkable: it
 * is true exactly when this returns no open tasks.
 *
 * ── Derived every time ──────────────────────────────────────────────────────────
 * The task list is recomputed from the data, never maintained by hand. A re-run
 * upserts on (kind, subject) — see the unique index in the migration — so running it
 * twice cannot double the list, and a task whose cause has gone is closed rather than
 * left to be noticed.
 *
 * ── What may close a task ───────────────────────────────────────────────────────
 * `MACHINE_VERIFIABLE` lists the kinds whose completion leaves a trace in the data:
 * an asset gains an HWA link, a serial appears in a later ITSM export, a field
 * difference is resolved. The generator closes those itself.
 *
 * Everything else is a human attestation — putting a label on a device leaves no trace
 * anywhere — and the generator must not pretend to know. Those stay open until a person
 * closes them, even if every derived condition around them has changed.
 *
 * ── What it never does ──────────────────────────────────────────────────────────
 * It never writes to ITSM (the app is read-only against Alemba by policy), never links
 * an asset to a record, and never edits an asset. It only records what a person or a
 * later export has to do or prove. The one exception to "only tasks" is closing them,
 * which is bookkeeping about its own rows.
 */
import { createHash, randomUUID } from 'crypto';
import { AppDataSource } from '../../config/database';
import { Asset } from '../../entities/Asset.entity';
import { AuditLog } from '../../entities/AuditLog.entity';
import { ItsmHardwareSnapshot } from '../../entities/ItsmHardwareSnapshot.entity';
import {
  NormalisationTask,
  NormalisationTaskKind,
} from '../../entities/NormalisationTask.entity';
import { chunkForEntity, chunked, MSSQL_PARAM_BUDGET } from '../../utils/mssqlBatch';
import { findUnlinkedMmhAssets } from './ReconcileService';
import {
  buildSnapshotIndex,
  matchRecord,
  describeCandidate,
  SnapshotCandidateRow,
} from './inventoryMatch';

/**
 * Kinds the generator may close on its own, because finishing them changes the data:
 * an asset gains an HWA link, a serial turns up in a later export, a difference is
 * resolved, a record disappears from ITSM.
 *
 * Only `label-device` is missing from this list, and that is the whole point of the
 * distinction: a label on a device leaves no trace in any data source, so nothing but a
 * person can say it was applied.
 *
 * `verify-disposal` was in the human-only group at first, on the reasoning that
 * "confirm it exists or retire it" is a judgement. That was wrong, and a test caught it:
 * both of its resolutions ARE visible — either someone links a local asset to the
 * record, or the record stops coming in the export. Judgement is needed to DO it, not
 * to prove it was done.
 */
export const MACHINE_VERIFIABLE: ReadonlySet<NormalisationTaskKind> = new Set([
  'link-to-itsm',
  'decide-match',
  'register-in-itsm',
  'identify-device',
  'check-hwa',
  'resolve-field-differences',
  'verify-disposal',
]);

/** A task the current data says is necessary, before it meets what is stored. */
export interface RequiredTask {
  kind: NormalisationTaskKind;
  subject_key: string;
  asset_id: string | null;
  itsm_id: string | null;
  summary: string;
  evidence: string;
}

export interface GenerateResult {
  created: RequiredTask[];
  /** Still necessary; evidence refreshed. */
  unchanged: number;
  /** Evidence changed, so a dismissal (if any) no longer covers it. */
  reopened: RequiredTask[];
  /** No longer necessary and machine-verifiable, so closed. */
  closed: NormalisationTask[];
  /** No longer derivable but only a person can say it is done. */
  awaitingHuman: NormalisationTask[];
}

/** The audit `entity_type` that marks one generator run. */
export const TASK_GENERATION_ENTITY = 'task_generation';

function hash(evidence: string): string {
  return createHash('sha256').update(evidence).digest('hex').slice(0, 64);
}

function toCandidateRow(row: ItsmHardwareSnapshot): SnapshotCandidateRow {
  return {
    itsm_id: row.itsm_id,
    display_name: row.display_name,
    serial_number: row.serial_number,
    mac_address: row.mac_address,
    asset_tag: row.asset_tag,
    model: row.model,
    catalog_name: row.catalog_item_name,
    manufacturer: row.manufacturer,
    asset_type: row.asset_type,
    person_name: row.assigned_person_name,
  };
}

/**
 * What the data says needs doing, right now. Pure: no reads of the task table, no
 * writes at all — so it can be printed as a report before anyone decides to persist it.
 */
export async function deriveRequiredTasks(): Promise<RequiredTask[]> {
  const snapshotRows = await AppDataSource.getRepository(ItsmHardwareSnapshot).find();
  const index = buildSnapshotIndex(snapshotRows.map(toCandidateRow));
  const assets = (await AppDataSource.getRepository(Asset).find()).filter((a) => !a.successor_id);

  const required: RequiredTask[] = [];
  const add = (t: RequiredTask) => required.push(t);

  for (const asset of assets) {
    const hwa = asset.hardware_asset_id?.trim();

    if (hwa) {
      if (!index.byItsmId.has(hwa.toUpperCase())) {
        add({
          kind: 'check-hwa',
          subject_key: asset.id,
          asset_id: asset.id,
          itsm_id: hwa,
          summary: `${asset.display_name}: carries HWA ${hwa}, which the ITSM export does not contain`,
          evidence: 'Either the number was misread off the label, or the ITSM record was deleted. Check the label against Alemba before changing anything.',
        });
      }
      // Field-level disagreement with ITSM. The reconcile page is where these are
      // resolved per field; the task exists so they count towards "nothing is left".
      if (asset.reconcile_last_status === 'differences' && (asset.reconcile_diff_count ?? 0) > 0) {
        add({
          kind: 'resolve-field-differences',
          subject_key: asset.id,
          asset_id: asset.id,
          itsm_id: hwa,
          summary: `${asset.display_name}: ${asset.reconcile_diff_count} field(s) disagree with ITSM`,
          evidence: 'Resolve each on the ITSM Reconcile page: accept the ITSM value, ignore it with a reason, or fix it in Alemba.',
        });
      }
      continue;
    }

    // No HWA: the case the matcher exists for.
    const result = matchRecord({
      serial_number: asset.serial_number,
      mac_address: asset.mac_address,
      asset_tag: asset.asset_tag,
      display_name: asset.display_name,
      model: asset.model,
      catalog_name: asset.catalog_display_name,
      manufacturer: asset.manufacturer,
      asset_type: asset.asset_type,
      person_name: asset.person_full_name,
    }, index);

    const evidence = [result.reason, ...result.candidates.map(describeCandidate)].join('\n');

    switch (result.verdict) {
      case 'confident': {
        const match = result.candidates[0];
        add({
          kind: 'link-to-itsm',
          subject_key: asset.id,
          asset_id: asset.id,
          itsm_id: match.row.itsm_id,
          summary: `${asset.display_name}: link to ${match.row.itsm_id} — ITSM already knows this device`,
          evidence,
        });
        // A device matched by serial rather than read off a sticker has no sticker.
        // Nothing in any data source will ever show this as done, so it is human-only.
        add({
          kind: 'label-device',
          subject_key: asset.id,
          asset_id: asset.id,
          itsm_id: match.row.itsm_id,
          summary: `${asset.display_name}: put an HWA label on it (${match.row.itsm_id})`,
          evidence: 'It was matched by serial, not read from a label, so the label is missing. Needs a person to confirm — labelling leaves no trace in any data source.',
        });
        break;
      }
      case 'ambiguous':
        add({
          kind: 'decide-match',
          subject_key: asset.id,
          asset_id: asset.id,
          itsm_id: null,
          summary: `${asset.display_name}: decide which ITSM record this is (${result.candidates.length} candidate(s))`,
          evidence,
        });
        break;
      case 'weak-only':
        add({
          kind: 'decide-match',
          subject_key: asset.id,
          asset_id: asset.id,
          itsm_id: null,
          summary: `${asset.display_name}: weak evidence only — check whether it is in ITSM at all`,
          evidence,
        });
        break;
      case 'no-evidence': {
        // The two situations split here because the action differs. With a key that
        // nothing in ITSM carries, registering it is safe. With nothing to match on,
        // registering it might duplicate hardware ITSM already holds.
        const hasKey = /genuinely absent/.test(result.reason);
        if (hasKey) {
          add({
            kind: 'register-in-itsm',
            subject_key: asset.id,
            asset_id: asset.id,
            itsm_id: null,
            summary: `${asset.display_name}: register in ITSM, then re-export`,
            evidence: `${result.reason}\nAfter it is in Alemba, re-run the snapshot import: this task closes itself when the export carries the serial.`,
          });
        } else {
          add({
            kind: 'identify-device',
            subject_key: asset.id,
            asset_id: asset.id,
            itsm_id: null,
            summary: `${asset.display_name}: read a serial (or MAC) off the device`,
            evidence: `${result.reason}\nUntil then it cannot be told apart from hardware ITSM already has.`,
          });
        }
        break;
      }
    }
  }

  // The other direction: ITSM has hardware the survey never found.
  for (const row of await findUnlinkedMmhAssets()) {
    add({
      kind: 'verify-disposal',
      subject_key: row.itsm_id,
      asset_id: null,
      itsm_id: row.itsm_id,
      summary: `${row.display_name}: in ITSM, not found by the survey — confirm it exists or retire it in ITSM`,
      evidence: [
        `Status in ITSM: ${row.status ?? 'unknown'}${row.location_name ? `, location ${row.location_name}` : ''}.`,
        row.serial_match
          ? `Its serial matches the local asset ${row.serial_match.display_name}, so it may simply be unlinked rather than gone.`
          : 'No local asset carries its serial.',
      ].join('\n'),
    });
  }

  return required;
}

/**
 * Brings the stored list in line with what the data now requires.
 *
 * `apply: false` computes everything and writes nothing, which is how this is meant to
 * be looked at first — the same discipline as every other script here.
 */
/**
 * Records the run itself, so "derived and found nothing" can be told apart from "never
 * derived". Both look like an empty task table, and the difference is the whole claim the
 * inventory rests on.
 *
 * The task rows cannot answer this: a run that changes nothing leaves no trace in them, and
 * a clean estate has no rows at all. Written to the audit log rather than a table of its
 * own because a generation IS an event with an actor, and the log already shows those.
 */
async function recordRun(by: string, result: GenerateResult): Promise<void> {
  const repo = AppDataSource.getRepository(AuditLog);
  await repo.save(repo.create({
    user_id: by,
    username: by,
    action: 'generate',
    entity_type: TASK_GENERATION_ENTITY,
    // Not an entity id: the run is what this row is about, and it needs an identity to be
    // referred to at all.
    document_id: randomUUID(),
    diff: {
      created: result.created.length,
      reopened: result.reopened.length,
      closed: result.closed.length,
      unchanged: result.unchanged,
      awaiting_human: result.awaitingHuman.length,
    },
  })).catch(() => { /* the run happened; failing to log it must not undo it */ });
}

export async function generateTasks(
  { apply, by = 'system' }: { apply: boolean; by?: string },
): Promise<GenerateResult> {
  const repo = AppDataSource.getRepository(NormalisationTask);
  const required = await deriveRequiredTasks();
  const existing = await repo.find();

  const key = (kind: string, subject: string) => `${kind}::${subject}`;
  const existingByKey = new Map(existing.map((t) => [key(t.kind, t.subject_key), t]));
  const requiredByKey = new Map(required.map((t) => [key(t.kind, t.subject_key), t]));

  const result: GenerateResult = {
    created: [], unchanged: 0, reopened: [], closed: [], awaitingHuman: [],
  };
  const toSave: NormalisationTask[] = [];

  for (const [k, task] of requiredByKey) {
    const evidenceHash = hash(task.evidence);
    const stored = existingByKey.get(k);
    if (!stored) {
      result.created.push(task);
      if (apply) {
        toSave.push(repo.create({
          kind: task.kind,
          subject_key: task.subject_key,
          asset_id: task.asset_id,
          itsm_id: task.itsm_id,
          summary: task.summary,
          evidence: task.evidence,
          evidence_hash: evidenceHash,
          state: 'open',
        }));
      }
      continue;
    }

    // A dismissal covers the situation it was made about. If the evidence has changed,
    // the decision was about something else and the task comes back.
    if (stored.state === 'dismissed' && stored.evidence_hash !== evidenceHash) {
      result.reopened.push(task);
      if (apply) {
        stored.state = 'open';
        stored.closed_by = null;
        stored.closed_at = null;
        stored.summary = task.summary;
        stored.evidence = task.evidence;
        stored.evidence_hash = evidenceHash;
        toSave.push(stored);
      }
      continue;
    }

    // Still necessary. A closed one that is derivable again reopens: whatever made it
    // done has been undone.
    if (stored.state === 'done') {
      result.reopened.push(task);
      if (apply) {
        stored.state = 'open';
        stored.closed_by = null;
        stored.closed_at = null;
        stored.summary = task.summary;
        stored.evidence = task.evidence;
        stored.evidence_hash = evidenceHash;
        toSave.push(stored);
      }
      continue;
    }

    result.unchanged++;
    if (apply && (stored.summary !== task.summary || stored.evidence_hash !== evidenceHash)) {
      stored.summary = task.summary;
      stored.evidence = task.evidence;
      stored.evidence_hash = evidenceHash;
      toSave.push(stored);
    }
  }

  for (const stored of existing) {
    if (requiredByKey.has(key(stored.kind, stored.subject_key))) continue;
    if (stored.state !== 'open') continue;
    if (MACHINE_VERIFIABLE.has(stored.kind)) {
      result.closed.push(stored);
      if (apply) {
        stored.state = 'done';
        stored.closed_by = 'system';
        stored.closed_at = new Date();
        toSave.push(stored);
      }
    } else {
      // The cause is gone from the data, but only a person can say a label was applied.
      result.awaitingHuman.push(stored);
    }
  }

  // Chunked for MSSQL's 2100-parameter cap: a task row spends a parameter per column, so an
  // unchunked save fails somewhere above 150 rows. That is not a hypothetical size — the
  // FIRST generation over a real estate derives far more than that, and it surfaced as a
  // driver error the moment the test database held a few hundred assets.
  if (apply && toSave.length > 0) {
    await repo.save(toSave, { chunk: chunkForEntity(NormalisationTask) });
  }

  if (apply) {
    // `last_seen_at` means "the last run that still found this necessary" (see the entity),
    // and an unchanged task is not saved above — so without this the column stopped moving
    // exactly for the tasks nothing had happened to, and "how long has this been
    // outstanding, and is the answer current?" became unanswerable.
    const stillRequired = [...requiredByKey.keys()]
      .map((k) => existingByKey.get(k)?.id)
      .filter((id): boolean => !!id) as string[];
    // One parameter per id here, so the budget IS the row count — see utils/mssqlBatch.ts.
    for (const chunk of chunked(stillRequired, MSSQL_PARAM_BUDGET)) {
      await repo.createQueryBuilder()
        .update(NormalisationTask)
        .set({ last_seen_at: new Date() })
        .whereInIds(chunk)
        .execute();
    }
    await recordRun(by, result);
  }
  return result;
}

/**
 * When the generator last ran, whatever it found. Null only when it has never run.
 */
export async function lastGenerationAt(): Promise<Date | null> {
  const row = await AppDataSource.getRepository(AuditLog).findOne({
    where: { entity_type: TASK_GENERATION_ENTITY },
    order: { timestamp: 'DESC' },
  });
  return row?.timestamp ?? null;
}
