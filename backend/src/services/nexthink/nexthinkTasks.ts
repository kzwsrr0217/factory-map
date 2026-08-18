/**
 * nexthinkTasks.ts — turns what the machines report into things to do.
 *
 * Until now the Nexthink findings were console output from three scripts. That is fine for
 * looking, useless for working: there was no way to say "I have dealt with this", no way to
 * dismiss one and have it come back if the facts changed, and no single place that answered
 * "what is left". The task table already provides all of that, so this only has to derive rows.
 *
 * ── What Nexthink is allowed to conclude ────────────────────────────────────────
 * A machine cannot report to Nexthink without existing and being switched on. That is the whole
 * of its authority, and it is narrow but absolute — no survey, no export and no memory can
 * contradict it. Everything else here is a question, phrased as one.
 *
 * The most useful consequence is negative: it CLOSES a question the other sources can only open.
 * `verify-disposal` exists because ITSM lists hardware the survey never found, and someone has to
 * go and see whether it still exists. When the device reported this week, the answer is yes, and
 * sending a person to look for it is waste. So those become `create-in-map` instead — see
 * `suppressVerifyDisposalFor`.
 *
 * ── What it must not conclude ───────────────────────────────────────────────────
 * Nothing about who owns a shared machine (18 devices have their top two users within a whisker),
 * nothing about Windows 11 eligibility (the NQL fields do not exist), and nothing about a device
 * being GONE — Nexthink ages inactive devices out of the export entirely, so absence has two
 * indistinguishable causes: retired, or outside the exported entities. A task that said "this is
 * decommissioned" on that basis would be wrong roughly as often as it was right.
 */
import { In } from 'typeorm';
import { AppDataSource } from '../../config/database';
import { Asset } from '../../entities/Asset.entity';
import { ItsmHardwareSnapshot } from '../../entities/ItsmHardwareSnapshot.entity';
import { NexthinkDeviceSnapshot } from '../../entities/NexthinkDeviceSnapshot.entity';
import type { RequiredTask } from '../itsm/taskGenerator';
import { findPersonFindings } from './personEvidence';

/**
 * Seen within this many days of the export's newest sighting counts as "in service".
 *
 * Measured against the export's own clock rather than today's date, so a report run against a
 * three-week-old export does not quietly promote every device to "gone".
 */
const ACTIVE_DAYS = 7;

/** One date, memoised per call chain: the newest sighting in the snapshot. */
async function freshestSighting(): Promise<Date | null> {
  const row = await AppDataSource.getRepository(NexthinkDeviceSnapshot)
    .createQueryBuilder('d').select('MAX(d.last_seen)', 'max')
    .getRawOne<{ max: Date | null }>();
  return row?.max ?? null;
}

function daysBetween(later: Date, earlier: Date): number {
  return Math.round((later.getTime() - earlier.getTime()) / 86_400_000);
}

/** Resolve Nexthink device names to assets, by HWA then by display name, in chunks. */
async function assetsByDeviceName(names: string[]): Promise<Map<string, Asset>> {
  const out = new Map<string, Asset>();
  const repo = AppDataSource.getRepository(Asset);
  for (let i = 0; i < names.length; i += 500) {
    const chunk = names.slice(i, i + 500);
    const rows = await repo.find({
      where: [{ hardware_asset_id: In(chunk) }, { display_name: In(chunk) }],
    });
    for (const a of rows) {
      if (a.hardware_asset_id) out.set(a.hardware_asset_id, a);
      if (!out.has(a.display_name)) out.set(a.display_name, a);
    }
  }
  return out;
}

/**
 * ITSM ids for which `verify-disposal` must NOT be raised, because Nexthink has seen the device.
 * Exported so the ITSM generator can consult it without duplicating the reasoning.
 *
 * PRESENCE in the snapshot is the test, deliberately — not recency. Nexthink ages long-inactive
 * devices out of the export entirely, so a device that is in the table reported inside the
 * retention window and therefore exists. "Does it exist" and "is it still in service" are
 * different questions, and only the second needs ACTIVE_DAYS.
 *
 * The first version used the 7-day test here and it was wrong in a way the data showed
 * immediately: HWA38257, last seen 8 days before the export's newest sighting, got a
 * `verify-disposal` telling someone to go and find it AND a `create-in-map` saying it is running.
 * Three devices had both. A threshold in one place and not the other is how that happens.
 *
 * Returns the ITSM id (= the HWA = the Nexthink device name), which is the same `subject_key`
 * the disposal task uses, so the caller only has to test membership.
 */
export async function suppressVerifyDisposalFor(): Promise<Set<string>> {
  const devices = await AppDataSource.getRepository(NexthinkDeviceSnapshot)
    .find({ select: { device_name: true } });
  return new Set(devices.map((d) => d.device_name));
}

/**
 * Everything the Nexthink snapshot says needs doing. Reads only; writes nothing.
 *
 * Returns an empty list when the snapshot is empty rather than throwing: a deployment that has
 * never imported a Nexthink export should generate the ITSM and survey tasks normally, not fail.
 */
export async function deriveNexthinkTasks(): Promise<RequiredTask[]> {
  const deviceRepo = AppDataSource.getRepository(NexthinkDeviceSnapshot);
  const devices = await deviceRepo.find();
  if (devices.length === 0) return [];

  const freshest = await freshestSighting();
  const names = devices.map((d) => d.device_name);
  const assetByName = await assetsByDeviceName(names);
  const itsmRows = await AppDataSource.getRepository(ItsmHardwareSnapshot).find();
  const itsmById = new Map(itsmRows.map((r) => [r.itsm_id, r]));

  const required: RequiredTask[] = [];

  for (const d of devices) {
    const asset = assetByName.get(d.device_name);
    const itsm = itsmById.get(d.device_name);
    const seen = d.last_seen ? d.last_seen.toISOString().slice(0, 10) : 'unknown';
    const what = [d.entity ?? 'no entity', d.model ?? 'unknown model', d.os_name ?? 'unknown OS']
      .join(' · ');

    if (!asset) {
      if (itsm) {
        // The interesting case: ITSM has it, Nexthink proves it is running, the map lacks it.
        required.push({
          kind: 'create-in-map',
          subject_key: d.device_name,
          asset_id: null,
          itsm_id: d.device_name,
          summary: `${d.device_name}: in ITSM and reporting to Nexthink, but not in the map — add it`,
          evidence: [
            `Nexthink last saw it ${seen} (${what}).`,
            `ITSM: ${itsm.catalog_item_name ?? 'no catalogue item'} · ${itsm.status ?? 'no status'}`
              + `${itsm.assigned_person_name ? ` · ${itsm.assigned_person_name}` : ''}`
              + `${itsm.location_name ? ` · ${itsm.location_name}` : ''}.`,
            'No survey visit is needed to confirm it exists: it was switched on and on the network.',
          ].join('\n'),
        });
      } else {
        /**
         * On the network and in no asset register at all. The strongest finding this source
         * produces, and the only one where Nexthink is the sole witness — which is why the
         * evidence names the export date: if it turns out to be in Alemba after all, the export
         * was simply older than the device, and that is checkable rather than arguable.
         */
        required.push({
          kind: 'register-in-itsm',
          subject_key: d.device_name,
          asset_id: null,
          itsm_id: d.device_name,
          summary: `${d.device_name}: on the network, in no asset register — register it in ITSM`,
          evidence: [
            `Nexthink last saw it ${seen} (${what}).`,
            `Serial (BIOS): ${d.bios_serial || 'not reported'}.`,
            'Neither the loaded ITSM export nor the map contains it. If the export predates the'
              + ' device this is not a finding — check the export date before raising it in Alemba.',
          ].join('\n'),
        });
      }
      continue;
    }

    /**
     * A machine the map records as replaced, still switched on.
     *
     * `successor_id` is what "was replaced" means, so this needs no list of claimed swaps — it is
     * derived from what the app already recorded. Whether the right outcome is a reinstall or a
     * shelf depends on Windows 11 eligibility, which is not in this data; the task says so.
     */
    if (asset.successor_id && d.last_seen && freshest
        && daysBetween(freshest, d.last_seen) <= ACTIVE_DAYS) {
      required.push({
        kind: 'dispose-replaced-machine',
        subject_key: asset.id,
        asset_id: asset.id,
        itsm_id: d.device_name,
        summary: `${asset.display_name}: recorded as replaced, but still reporting (last seen ${seen})`,
        evidence: [
          `Still in service as of the export: ${what}.`,
          'Either it was reinstalled and put back to work — in which case nothing is wrong and this'
            + ' can be closed — or the swap has not physically happened yet, or it is running'
            + ' unnoticed on the network.',
          'If it is not Windows 11 capable it should be shut down and set aside for decommission.'
            + ' That eligibility is NOT in this data; it comes from the Nexthink "Windows 11 -'
            + ' Readiness and migration" dashboard.',
        ].join('\n'),
      });
    }
  }

  /**
   * Who uses it. Only the clear disagreements: `findPersonFindings` has already set aside the
   * shared machines and the ones with too few logons to mean anything, and those must not become
   * tasks — a task nobody can act on is worse than no task.
   */
  for (const f of await findPersonFindings()) {
    if (f.comparison !== 'disagree' || !f.nexthink) continue;
    required.push({
      kind: 'confirm-primary-user',
      subject_key: f.asset_id,
      asset_id: f.asset_id,
      itsm_id: f.device_name,
      summary: `${f.asset_display_name}: the map says ${f.asset_person}, the logons say ${f.nexthink.full_name}`,
      evidence: [
        `${f.nexthink.full_name} signed in ${f.nexthink.logins} time(s)`
          + `${f.nexthink.runner_up ? `, next is ${f.nexthink.runner_up.full_name ?? '(no AD name)'} with ${f.nexthink.runner_up.logins}` : ' and nobody else did'}.`,
        'A person who changed desks looks exactly like this, so neither side is assumed wrong.',
        'Resolve it by correcting the map, or by marking the ITSM value as wrong so Alemba gets fixed.',
      ].join('\n'),
    });
  }

  return required;
}
