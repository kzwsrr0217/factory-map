/**
 * importRun.ts — recording an import, and the one question only a ledger can answer.
 *
 * Kept deliberately small. The temptation with a history table is to grow it into a change-log,
 * and the app already has one of those: the audit log, which records what PEOPLE did. This records
 * what ARRIVED, which is a different thing with a different shape — an import has no actor worth
 * naming and hundreds of rows nobody edited.
 */
import { AppDataSource } from '../config/database';
import { ImportRun, ImportRunSource } from '../entities/ImportRun.entity';

export interface RecordRunInput {
  source: ImportRunSource;
  rowCount: number;
  takenAt?: Date | null;
  counts?: { created?: number; changed?: number; gone?: number; unchanged?: number } | null;
  presentKeys?: string[] | null;
  detail?: Record<string, unknown> | null;
  by?: string;
}

/**
 * Write the ledger row. Never throws into the caller.
 *
 * The import already happened by the time this runs; failing to record it must not undo it or turn
 * a successful load into an error message. Same reasoning as `recordRun` in the task generator.
 */
export async function recordImportRun(input: RecordRunInput): Promise<ImportRun | null> {
  try {
    const repo = AppDataSource.getRepository(ImportRun);
    return await repo.save(repo.create({
      source: input.source,
      taken_at: input.takenAt ?? null,
      imported_at: new Date(),
      row_count: input.rowCount,
      counts: input.counts ?? null,
      present_keys: input.presentKeys ?? null,
      detail: input.detail ?? null,
      imported_by: input.by ?? 'system',
    }));
  } catch {
    return null;
  }
}

/** The most recent run for a source, or null if there has never been one. */
export async function lastRun(source: ImportRunSource): Promise<ImportRun | null> {
  return AppDataSource.getRepository(ImportRun).findOne({
    where: { source },
    order: { imported_at: 'DESC' },
  });
}

export interface KeyDelta {
  /** Keys this run has that the previous one did not. */
  appeared: string[];
  /** Keys the previous run had and this one does not. */
  disappeared: string[];
  /** Null when there is no previous run to compare against — not the same as "nothing changed". */
  previous_run_at: Date | null;
}

/**
 * Compare a set of keys against the previous recorded run for that source.
 *
 * `disappeared` is the whole point. For Nexthink it means "reported before, does not now", which is
 * the closest thing to a decommission signal the estate produces — and it is NOT proof of one:
 * a device also disappears if it was moved out of the exported entities, or if the export was
 * scoped differently by hand. So this returns the list and says nothing about what it means; the
 * caller has to phrase it as a question.
 *
 * Called BEFORE recording the current run, so "previous" is unambiguous.
 */
export async function keyDeltaAgainstLastRun(
  source: ImportRunSource,
  currentKeys: string[],
): Promise<KeyDelta> {
  const previous = await lastRun(source);
  if (!previous || !previous.present_keys) {
    return { appeared: [], disappeared: [], previous_run_at: previous?.imported_at ?? null };
  }
  const before = new Set(previous.present_keys);
  const now = new Set(currentKeys);
  return {
    appeared: currentKeys.filter((k) => !before.has(k)),
    disappeared: previous.present_keys.filter((k) => !now.has(k)),
    previous_run_at: previous.imported_at,
  };
}
