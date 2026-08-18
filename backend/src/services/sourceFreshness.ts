/**
 * sourceFreshness.ts — how old each source is, and how much of the estate it covers.
 *
 * Meant to sit above the task list, because the list answers "what is left" and says nothing about
 * whether the data behind it is worth acting on. "7 devices quiet for 30+ days" means one thing
 * against yesterday's export and another against one taken three weeks ago, and until the import
 * ledger existed nothing recorded which it was.
 *
 * Deliberately NOT a three-column grid of the sources. That was the first idea and it does not
 * survive the data — the sources do not have opinions on the same fields, their grain differs, and
 * most cells would agree. See services/evidence/assetEvidence.ts for the argument in full. This is
 * three rows of numbers instead: when, how much, how much of it lands.
 *
 * ── Why coverage and not just a date ────────────────────────────────────────────
 * A fresh export that covers a third of the estate is not fresh data about the estate. The date
 * answers "is this stale"; the coverage answers "is this about my devices". Both are needed before
 * anyone trusts a count derived from them, and each is cheap: one COUNT per source.
 */
import { AppDataSource } from '../config/database';
import { Asset } from '../entities/Asset.entity';
import { ImportRun, ImportRunSource } from '../entities/ImportRun.entity';
import { ItsmHardwareSnapshot } from '../entities/ItsmHardwareSnapshot.entity';
import { NexthinkDeviceSnapshot } from '../entities/NexthinkDeviceSnapshot.entity';
import { SurveyObservation } from '../entities/SurveyObservation.entity';
import { lastRun } from './importRun';

export interface SourceStatus {
  source: ImportRunSource;
  label: string;
  /** False when the landing table is empty — nothing has ever been loaded. */
  loaded: boolean;
  /**
   * When the import ran. Null where the table holds data but no run was ever recorded, which is
   * true of anything imported before the ledger existed — an honest "unknown", not zero.
   */
  imported_at: Date | null;
  /** When the export itself was produced, where the source states it. Usually unknown. */
  taken_at: Date | null;
  /** Whole days since the import. Null when the date is unknown. */
  age_days: number | null;
  rows: number;
  counts: ImportRun['counts'];
  /** One line about how much of the estate this source actually speaks for. */
  coverage: string;
  /** The single thing worth doing about this source right now, if anything. */
  attention: string | null;
}

function ageInDays(from: Date | null): number | null {
  if (!from) return null;
  return Math.floor((Date.now() - from.getTime()) / 86_400_000);
}

/**
 * Assets a source could plausibly say something about, and how many it does.
 *
 * Counted by joining on the identifier each source actually uses rather than by assuming they are
 * comparable: ITSM on `hardware_asset_id`, Nexthink on the same (its device name IS the HWA), the
 * survey on its own resolution. Guessing a shared key here is how the earlier HWA-versus-uuid
 * mistake happened.
 */
async function coverageLines(): Promise<Record<ImportRunSource, string>> {
  const assetRepo = AppDataSource.getRepository(Asset);
  const liveAssets = await assetRepo.count({ where: { successor_id: undefined } })
    .catch(() => assetRepo.count());

  const itsmLinked = await AppDataSource.query(
    `SELECT COUNT(*) n FROM assets a WHERE a.successor_id IS NULL AND EXISTS
       (SELECT 1 FROM itsm_hardware_snapshot s WHERE s.itsm_id = a.hardware_asset_id)`,
  );
  const nxSeen = await AppDataSource.query(
    `SELECT COUNT(*) n FROM assets a WHERE a.successor_id IS NULL AND EXISTS
       (SELECT 1 FROM nexthink_device_snapshot d
        WHERE d.device_name = a.hardware_asset_id OR d.device_name = a.display_name)`,
  );
  const surveyed = await AppDataSource.query(
    `SELECT COUNT(DISTINCT o.resolved_asset_id) n FROM survey_observation o
     WHERE o.resolved_asset_id IS NOT NULL`,
  );

  return {
    'itsm-hardware': `${itsmLinked[0].n} of ${liveAssets} assets are in the export`,
    'nexthink-devices': `${nxSeen[0].n} of ${liveAssets} assets have reported — the rest carry no agent, or are off`,
    'nexthink-logins': 'logons only; coverage is the device export above',
    survey: `${surveyed[0].n} of ${liveAssets} assets were resolved from a survey row`,
  };
}

export async function getSourceFreshness(): Promise<SourceStatus[]> {
  const [itsmRows, nxRows, nxLogins, surveyRows] = await Promise.all([
    AppDataSource.getRepository(ItsmHardwareSnapshot).count(),
    AppDataSource.getRepository(NexthinkDeviceSnapshot).count(),
    AppDataSource.query('SELECT COUNT(*) n FROM nexthink_login_snapshot').then((r) => Number(r[0].n)),
    AppDataSource.getRepository(SurveyObservation).count(),
  ]);
  const coverage = await coverageLines();

  const build = async (
    source: ImportRunSource,
    label: string,
    rows: number,
    attention: string | null,
  ): Promise<SourceStatus> => {
    const run = await lastRun(source);
    return {
      source,
      label,
      loaded: rows > 0,
      imported_at: run?.imported_at ?? null,
      taken_at: run?.taken_at ?? null,
      age_days: ageInDays(run?.imported_at ?? null),
      rows,
      counts: run?.counts ?? null,
      coverage: coverage[source],
      attention,
    };
  };

  /**
   * The `attention` line is the one judgement here, and it is kept to facts the source itself
   * states. "Nothing has been loaded" is certain; "this looks stale" is a threshold, so it says the
   * age and lets the reader decide rather than inventing a rule about how often an export is due.
   */
  const nxGone = (await lastRun('nexthink-devices'))?.counts?.gone ?? 0;

  return [
    await build('itsm-hardware', 'ITSM', itsmRows,
      itsmRows === 0 ? 'No ITSM export is loaded — every comparison against it is unavailable.' : null),
    await build('nexthink-devices', 'Nexthink devices', nxRows,
      nxRows === 0
        ? 'No Nexthink export is loaded.'
        : nxGone > 0
          ? `${nxGone} device(s) dropped out since the previous import — worth checking whether they were retired.`
          : null),
    await build('nexthink-logins', 'Nexthink logons', nxLogins, null),
    await build('survey', 'Physical survey', surveyRows,
      surveyRows === 0 ? 'No survey has been imported, so nobody has confirmed anything on site.' : null),
  ];
}
