/**
 * surveyTasks.ts — the disagreements the survey import declined to act on, as work.
 *
 * `survey_observation.suppressed_fields` records every place the walkers brought a value, the asset
 * already held a different one, and the never-overwrite rule kept the old one. That rule is right
 * for an automated import and wrong as a final answer: the person who stood in the room is usually
 * the better witness, and until now nobody was told a question existed.
 *
 * ── Self-closing, without needing another survey round ──────────────────────────
 * Compared against the asset's CURRENT value, not just replayed from the table. So when somebody
 * resolves the disagreement — by editing the asset, or by accepting an ITSM value that happens to
 * match what the survey saw — the task stops being derived and closes itself. Replaying the stored
 * conflict instead would keep the task open until the next survey import, which is months away and
 * would train everyone to ignore the list.
 *
 * ── What is deliberately NOT raised ─────────────────────────────────────────────
 * Nothing from `resolution = 'unmatched'`. On the real survey that is 489 of 735 rows, and 478 of
 * them are one known cause: buildings and floors the survey names that the map has no correction
 * for yet. The import report already groups those by place with row counts, which is how they get
 * fixed — six corrections cover 478 rows. Turning them into 489 individual tasks would bury the
 * list under a backlog that a handful of edits clears, and a list nobody trusts is worse than no
 * list. Same reason the 230 unregistered monitors should be one task and not 230.
 */
import { In } from 'typeorm';
import { AppDataSource } from '../../config/database';
import { Asset } from '../../entities/Asset.entity';
import { SurveyObservation } from '../../entities/SurveyObservation.entity';
import type { RequiredTask } from '../itsm/taskGenerator';

/**
 * Read the asset field a suppressed conflict names.
 *
 * A small explicit map rather than `asset[field]`: the field names come out of a database column
 * and indexing an entity with an arbitrary string would let a future writer read anything on it,
 * including the ITSM link fields. Only these three are ever suppressed — see suppressedConflicts.
 */
const FIELD_READERS: Record<string, (a: Asset) => string | null> = {
  serial_number: (a) => a.serial_number,
  model: (a) => a.model,
  asset_type: (a) => a.asset_type,
};

/** Same folding the survey matcher uses, so a task is never raised over spelling. */
function fold(value: string | null | undefined): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export async function deriveSurveyTasks(): Promise<RequiredTask[]> {
  const observations = await AppDataSource.getRepository(SurveyObservation).find({
    where: { resolution: 'updated' },
  });
  const withConflicts = observations.filter(
    (o) => o.resolved_asset_id && o.suppressed_fields && o.suppressed_fields.length > 0,
  );
  if (withConflicts.length === 0) return [];

  const assetRepo = AppDataSource.getRepository(Asset);
  const assetById = new Map<string, Asset>();
  const ids = [...new Set(withConflicts.map((o) => o.resolved_asset_id!))];
  // 500 at a time: the same parameter ceiling every other bulk read here respects.
  for (let i = 0; i < ids.length; i += 500) {
    for (const a of await assetRepo.find({ where: { id: In(ids.slice(i, i + 500)) } })) {
      assetById.set(a.id, a);
    }
  }

  const required: RequiredTask[] = [];
  for (const o of withConflicts) {
    const asset = assetById.get(o.resolved_asset_id!);
    // The asset was deleted since the import. The observation is kept on purpose (no FK), but
    // there is nothing left to decide about.
    if (!asset) continue;

    const open = o.suppressed_fields!.filter((c) => {
      const read = FIELD_READERS[c.field];
      // An unknown field name cannot be checked, so it cannot be claimed to be resolved either.
      if (!read) return true;
      return fold(read(asset)) !== fold(c.survey_value);
    });
    if (open.length === 0) continue;

    const where = [o.epulet, o.emelet, o.helyszin, o.work_area].filter(Boolean).join(' / ');
    required.push({
      kind: 'resolve-survey-difference',
      subject_key: asset.id,
      asset_id: asset.id,
      itsm_id: asset.hardware_asset_id ?? null,
      summary: `${asset.display_name}: the survey saw ${open.length} field(s) differently — decide which is right`,
      evidence: [
        ...open.map((c) => `${c.field}: the record says "${c.app_value ?? '(empty)'}", the survey read "${c.survey_value ?? '(empty)'}"`),
        where ? `Seen at: ${where}.` : 'The survey row carried no place.',
        o.szemely ? `The survey named ${o.szemely}.` : '',
        'The import kept the record\'s value, because an automated import must not overwrite what may'
          + ' have come from ITSM. That is why this is a question and not a change.',
      ].filter(Boolean).join('\n'),
    });
  }
  return required;
}
