/**
 * normalisationStatus.ts — Where a normalisation round has got to.
 *
 * A round is: export from ITSM → walk the site → hand both to the app → work the task list
 * → act in Alemba → export again. Every step of that already exists on its own page, and
 * that was the problem: nothing said which step is next, or that the answer on screen was
 * computed before the newest data arrived.
 *
 * So this reports the round as four facts and their times, and derives the only thing a
 * person cannot see by looking at the pages one at a time: **whether the task list is
 * older than the data it claims to describe.** A list that says "nothing outstanding"
 * because it was derived before the survey landed is worse than no list.
 *
 * Everything here is a count or a timestamp already stored. Nothing is recomputed, so the
 * page can be opened as often as anyone likes — the same reason the reconcile page reads
 * its summary from the local database rather than asking ITSM.
 */
import { AppDataSource } from '../../config/database';
import { Asset } from '../../entities/Asset.entity';
import { AuditLog } from '../../entities/AuditLog.entity';
import { ItsmHardwareSnapshot } from '../../entities/ItsmHardwareSnapshot.entity';
import { NormalisationTask } from '../../entities/NormalisationTask.entity';
import { lastGenerationAt } from '../itsm/taskGenerator';
import { driftSummary, lastReconcileRunAt } from '../itsm/ReconcileService';

/** The audit `entity_type` written once per survey import — see inventory.controller.ts. */
const SURVEY_RUN_ENTITY = 'inventory_survey';

export interface NormalisationStatus {
  itsm_export: {
    records: number;
    /** When the export was last loaded. Null when the snapshot has never been filled. */
    loaded_at: string | null;
  };
  survey: {
    /** Last time a survey was applied — from the audit log, which is where a run is recorded. */
    applied_at: string | null;
    assets_updated: number | null;
    assets_created: number | null;
  };
  app: {
    /** Assets carrying an ITSM link — the ones a reconcile has anything to say about. */
    linked: number;
    /** Local-only: found by the survey, not registered in ITSM. The backlog. */
    local_only: number;
    /** Placed on a floor. Anything else is only findable through a list. */
    placed: number;
    total: number;
  };
  /**
   * The last comparison of every linked asset against the loaded export.
   *
   * Reported for the same reason as the task list's age, and it was the worse of the two:
   * the drift overview showed whatever had last been checked by hand, so after an export
   * and a survey landed it said all 1057 linked assets were `missing` — a verdict from a
   * run made before the export existed. A number that wrong needs to say how old it is.
   */
  comparison: {
    compared_at: string | null;
    never_checked: number;
    in_sync: number;
    differences: number;
    missing: number;
    error: number;
    /** Compared before the newest export or survey, so the verdicts describe the past. */
    stale: boolean;
  };
  tasks: {
    open: number;
    done: number;
    dismissed: number;
    /** Last time the generator ran at all, whatever it found. */
    derived_at: string | null;
    /** Nothing outstanding — the definition of done for the inventory. */
    consistent: boolean;
    /**
     * True when the list was derived BEFORE the newest export or survey. The whole point
     * of reporting this: the numbers above are then describing a situation that has
     * already changed.
     */
    stale: boolean;
  };
}

const iso = (value: Date | string | null | undefined): string | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

export async function getNormalisationStatus(): Promise<NormalisationStatus> {
  const snapshotRepo = AppDataSource.getRepository(ItsmHardwareSnapshot);
  const assetRepo = AppDataSource.getRepository(Asset);
  const taskRepo = AppDataSource.getRepository(NormalisationTask);

  const records = await snapshotRepo.count();
  // MAX rather than "the first row's value": an import stamps every row with the same
  // time, but a partially-applied one would not, and the newest is the honest answer.
  const snapshotTime = await snapshotRepo.createQueryBuilder('s')
    .select('MAX(s.imported_at)', 'at').getRawOne<{ at: Date | null }>();

  const lastSurveyRun = await AppDataSource.getRepository(AuditLog).findOne({
    where: { entity_type: SURVEY_RUN_ENTITY },
    order: { timestamp: 'DESC' },
  });
  const surveyDiff = (lastSurveyRun?.diff ?? null) as
    { assets_updated?: number; assets_created?: number } | null;

  // Superseded assets are excluded from all four, the same way the Dashboard's own numbers
  // do it: a replaced device is not part of the estate anyone is reconciling, and counting
  // it made a pager once claim more rows than the tile above it.
  const live = () => assetRepo.createQueryBuilder('a').where('a.successor_id IS NULL');
  const [linked, localOnly, placed, total] = await Promise.all([
    live().andWhere('a.hardware_asset_id IS NOT NULL').getCount(),
    live().andWhere('a.source_of_truth = :s', { s: 'local' }).getCount(),
    live().andWhere('a.is_placed = 1').getCount(),
    live().getCount(),
  ]);

  const [open, done, dismissed] = await Promise.all([
    taskRepo.count({ where: { state: 'open' } }),
    taskRepo.count({ where: { state: 'done' } }),
    taskRepo.count({ where: { state: 'dismissed' } }),
  ]);
  // From the logged run, not from the task rows: a generation that changed nothing leaves
  // no mark on them, and a clean estate has no rows at all — so "derived, found nothing"
  // and "never derived" would look identical, which is the one confusion this page exists
  // to prevent.
  const derivedAt = iso(await lastGenerationAt());
  const exportAt = iso(snapshotTime?.at ?? null);
  const surveyAt = iso(lastSurveyRun?.timestamp ?? null);
  const newestInput = [exportAt, surveyAt].filter(Boolean).sort().pop() ?? null;

  const drift = await driftSummary();
  const comparedAt = iso(await lastReconcileRunAt());

  return {
    itsm_export: { records, loaded_at: exportAt },
    survey: {
      applied_at: surveyAt,
      assets_updated: surveyDiff?.assets_updated ?? null,
      assets_created: surveyDiff?.assets_created ?? null,
    },
    app: { linked, local_only: localOnly, placed, total },
    comparison: {
      compared_at: comparedAt,
      never_checked: drift.never_checked,
      in_sync: drift.in_sync,
      differences: drift.differences,
      missing: drift.missing,
      error: drift.error,
      // Never compared counts as stale as soon as there is anything to compare: the
      // difference between "nothing disagrees" and "nobody has looked" is the whole point.
      stale: linked > 0 && (comparedAt === null || (!!newestInput && comparedAt < newestInput)),
    },
    tasks: {
      open,
      done,
      dismissed,
      derived_at: derivedAt,
      // Consistent means nothing open. Said plainly rather than inferred from a zero, so
      // "never derived" cannot be mistaken for "nothing to do".
      consistent: derivedAt !== null && open === 0,
      stale: !!newestInput && (derivedAt === null || derivedAt < newestInput),
    },
  };
}
