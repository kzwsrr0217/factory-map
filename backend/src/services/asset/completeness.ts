/**
 * completeness.ts — how fully an asset is recorded, and what is left on it.
 *
 * ── The one decision this file exists to get right ──────────────────────────────
 * **The denominator differs per asset.** A monitor carries no Nexthink agent, an IPC on an OS older
 * than Windows 10 cannot either, a rack-mounted server does not belong on a floor plan, and a printer
 * has no personal owner. So every check is either APPLICABLE to an asset or not, and the score is over
 * the applicable ones only.
 *
 * Get that wrong and the feature is worse than nothing. A flat "seven checks, you have four" would
 * mark all 405 monitors permanently incomplete for lacking data they can never have; within a fortnight
 * nobody looks at the number, and the genuinely incomplete records then hide among the false ones. This
 * is the same distinction the evidence panel needed three attempts to hold: "cannot know" is not
 * "missing".
 *
 * ── A checklist, not a percentage ───────────────────────────────────────────────
 * The API returns per-check verdicts with reasons, and a satisfied/applicable count. A single percent
 * hides WHICH thing is missing, which is the only part anyone can act on, and it invites collecting the
 * cheap ticks. The percentage is derivable if a caller wants one; the reverse is not.
 *
 * ── An unsatisfied check is not always the asset's fault ────────────────────────
 * Measured on 2026-08-19: 0 of 1344 live assets have map coordinates and 1 has `is_placed`. So "on the
 * floor plan" is not a defect of any individual asset — it is a project stage nobody has started. The
 * estate summary exists to say that, because a per-asset widget showing the same red on all 1344 would
 * teach everyone to ignore it. Read the summary first; read a single asset's list when you are working
 * on that asset.
 */
import { In } from 'typeorm';
import { AppDataSource } from '../../config/database';
import { Asset } from '../../entities/Asset.entity';
import { AssetConnection } from '../../entities/AssetConnection.entity';
import { ItsmHardwareSnapshot } from '../../entities/ItsmHardwareSnapshot.entity';
import { NexthinkDeviceSnapshot } from '../../entities/NexthinkDeviceSnapshot.entity';
import { SurveyObservation } from '../../entities/SurveyObservation.entity';

export type CheckKey =
  | 'itsm-record'
  | 'itsm-compared'
  | 'nexthink-seen'
  | 'surveyed'
  | 'core-fields'
  | 'on-the-plan'
  | 'network-socket'
  | 'attached-to-a-machine';

export interface CheckResult {
  key: CheckKey;
  label: string;
  /** False when this check cannot apply to this asset. Never counted either way. */
  applicable: boolean;
  satisfied: boolean;
  /**
   * Why it is not applicable, or what is missing. Always populated for anything other than a plain
   * pass — a red tick with no reason is a question, not information.
   */
  detail: string | null;
}

export interface AssetCompleteness {
  asset_id: string;
  display_name: string;
  /**
   * False for a device that has left service. The checks are still returned — somebody looking at a
   * retired machine may want to know what was recorded about it — but nothing should be shown as a
   * defect, and the estate summary leaves it out entirely.
   */
  tracked: boolean;
  checks: CheckResult[];
  /** Of the checks that apply to THIS asset. */
  satisfied: number;
  applicable: number;
}

/**
 * Asset types that can carry a Nexthink agent. Same list the import uses, deliberately — two
 * definitions of "could Nexthink see this" would drift.
 */
const AGENT_TYPES = new Set(['workstation', 'laptop', 'server', 'ipc']);

/** Types that live on a floor plan. A rack-mounted server is located by its rack, not by a dot. */
const PLAN_TYPES = new Set([
  'workstation', 'laptop', 'ipc', 'monitor', 'printer', 'scanner', 'dock', 'phone', 'other',
]);

/** Types that plug into a wall socket, so a socket is part of recording them. */
const SOCKET_TYPES = new Set(['workstation', 'ipc', 'printer', 'server', 'switch']);

/** Types that belong to a machine, so a parent link is part of recording them. */
const CHILD_TYPES = new Set(['monitor', 'dock']);

/**
 * The fields that make a record usable, per family.
 *
 * Not "every column": most of the forty are optional by design, and demanding them all would make the
 * check unreachable. These are the ones without which the asset cannot be identified or found.
 *
 * `model` is deliberately NOT here yet. It is empty on 1334 of 1344 live assets, so requiring it would
 * fail everything — and the value exists in the landing tables (Nexthink reports it, the ITSM catalogue
 * name carries it), so the fix is a backfill, not a thousand manual edits. Same for `os_type`, which is
 * empty everywhere. Both belong in this list the day after that backfill runs, and not before: a check
 * nothing can pass is a check everyone learns to skip.
 */
const CORE_FIELDS: Record<string, Array<keyof Asset>> = {
  agent: ['asset_type', 'serial_number', 'manufacturer', 'person_full_name'],
  peripheral: ['asset_type', 'serial_number', 'manufacturer'],
  network: ['asset_type', 'manufacturer'],
};

function familyOf(assetType: string | null): keyof typeof CORE_FIELDS {
  if (!assetType) return 'peripheral';
  if (AGENT_TYPES.has(assetType)) return 'agent';
  if (['switch', 'router', 'network', 'patch-panel'].includes(assetType)) return 'network';
  return 'peripheral';
}

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

/**
 * Whether an OS string is old enough that no Nexthink agent could run on it.
 *
 * Only says true when the OS is KNOWN and old. An unrecorded OS returns false — the check then stays
 * applicable, and the missing OS shows up as its own gap rather than quietly excusing this one.
 */
function preWindows10(os: string | null): boolean {
  if (!os) return false;
  return /windows\s*(xp|vista|7|8(\.1)?)\b/i.test(os) || /server\s*(2003|2008|2012)/i.test(os);
}

export interface CompletenessInputs {
  /**
   * When the loaded ITSM export was imported.
   *
   * Needed because a verdict recorded BEFORE this export means nothing — it describes a comparison
   * with data that has since been replaced. On this estate 1045 live assets read `missing` from a
   * compare that ran while the snapshot table was empty; reporting that as a real disagreement would
   * accuse a thousand records of a problem the app created, and the only honest answer is "re-run it".
   *
   * Compared against each asset's own `reconcile_last_at`, NOT against the newest reconcile entry in
   * `audit_logs`: that entry is deletable — it is null on this database right now, wiped with the rest
   * of the audit rows — and a staleness rule that quietly stops working is worse than none.
   */
  itsmImportedAt: Date | null;
  itsmIds: Set<string>;
  nexthinkNames: Set<string>;
  surveyedAssetIds: Set<string>;
  /** Asset ids that have at least one outbound parent-child link, i.e. they name a parent. */
  hasParent: Set<string>;
}

/**
 * Everything the checks need, in four queries rather than four per asset.
 *
 * Written for the estate summary — 1344 assets × four lookups each would be five thousand round trips.
 * The single-asset path uses the same function so the two can never answer differently.
 */
export async function loadCompletenessInputs(assets: Asset[]): Promise<CompletenessInputs> {
  const keys = [...new Set(assets.flatMap(
    (a) => [a.hardware_asset_id, a.display_name].filter((x): x is string => Boolean(x)),
  ))];
  const ids = assets.map((a) => a.id);

  const age = await AppDataSource.getRepository(ItsmHardwareSnapshot)
    .createQueryBuilder('i').select('MAX(i.imported_at)', 'max').getRawOne<{ max: Date | null }>();
  const itsmImportedAt = age?.max ?? null;

  const itsmIds = new Set<string>();
  const nexthinkNames = new Set<string>();
  const surveyedAssetIds = new Set<string>();
  const hasParent = new Set<string>();

  // 500 at a time throughout: SQL Server caps a statement at 2100 parameters.
  for (let i = 0; i < keys.length; i += 500) {
    const chunk = keys.slice(i, i + 500);
    for (const r of await AppDataSource.getRepository(ItsmHardwareSnapshot)
      .find({ where: { itsm_id: In(chunk) }, select: { itsm_id: true } })) {
      itsmIds.add(r.itsm_id);
    }
    for (const r of await AppDataSource.getRepository(NexthinkDeviceSnapshot)
      .find({ where: { device_name: In(chunk) }, select: { device_name: true } })) {
      nexthinkNames.add(r.device_name);
    }
  }
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    for (const r of await AppDataSource.getRepository(SurveyObservation)
      .find({ where: { resolved_asset_id: In(chunk) }, select: { resolved_asset_id: true } })) {
      if (r.resolved_asset_id) surveyedAssetIds.add(r.resolved_asset_id);
    }
    for (const r of await AppDataSource.getRepository(AssetConnection)
      .find({ where: { asset_id: In(chunk), connection_type: 'parent-child' }, select: { asset_id: true } })) {
      hasParent.add(r.asset_id);
    }
  }

  return { itsmImportedAt, itsmIds, nexthinkNames, surveyedAssetIds, hasParent };
}

/**
 * Statuses that mean the device is out of service, so nothing about it is expected to be complete.
 *
 * The applicability rule again, applied to status rather than type: a decommissioned machine is not
 * an incomplete record, it is a machine that has left. Demanding a floor-plan position and a live
 * Nexthink agent from 61 retired devices would put 61 permanent reds on the estate summary that no
 * amount of work could ever clear.
 *
 * Matched case-insensitively because two vocabularies are in the column at once: 946 assets read
 * `active` and 22 read `Deployed`, the second straight out of the ITSM export. That mixture is a
 * separate normalisation gap, but this set must not be the thing that trips over it.
 */
const OUT_OF_SERVICE = new Set(['decommissioned', 'disposed', 'retired', 'scrapped']);

export function isOutOfService(asset: Asset): boolean {
  return OUT_OF_SERVICE.has((asset.status ?? '').trim().toLowerCase());
}

/** Pure: given an asset and the loaded sets, what is recorded and what is not. */
export function assessAsset(asset: Asset, inputs: CompletenessInputs): AssetCompleteness {
  const hwa = asset.hardware_asset_id?.trim() ?? null;
  const type = asset.asset_type;
  const seenByNexthink = inputs.nexthinkNames.has(hwa ?? '') || inputs.nexthinkNames.has(asset.display_name);
  const inItsm = Boolean(hwa && inputs.itsmIds.has(hwa));

  const checks: CheckResult[] = [];
  const add = (
    key: CheckKey, label: string, applicable: boolean, satisfied: boolean, detail: string | null,
  ) => checks.push({ key, label, applicable, satisfied, detail });

  // 1. In Alemba at all. Applicable to everything: the policy is that every device, monitors
  //    included, is registered there.
  add('itsm-record', 'Registered in ITSM', true, inItsm,
    inItsm ? null
      : !hwa ? 'No HWA number, so nothing to look up. A missing HWA means it was never registered.'
        : 'Carries an HWA the loaded ITSM export does not contain.');

  // 2. Compared against ITSM. Only meaningful once there is a record to compare with.
  /**
   * A verdict older than the export it claims to describe is not a verdict. Checked before the status
   * is read at all, because the status is the thing that went stale — and a stale `missing` on a
   * device that is plainly in the export would otherwise read as a real problem.
   */
  const verdictStale = Boolean(
    asset.reconcile_last_at && inputs.itsmImportedAt
      && new Date(asset.reconcile_last_at) < new Date(inputs.itsmImportedAt),
  );
  const status = asset.reconcile_last_status;
  const compared = !verdictStale && (status === 'in_sync'
    || (status === 'differences' && (asset.reconcile_diff_count ?? 0) === 0));
  add('itsm-compared', 'Agrees with ITSM', inItsm, inItsm && compared,
    !inItsm ? 'Nothing to compare against until it is in the export.'
      : status === null ? 'Never compared. That is different from "agrees" — run a compare.'
        : verdictStale ? 'The last compare ran before the current export was loaded, so its verdict says nothing. Re-run it.'
          : status === 'missing' ? 'The last compare could not find it in ITSM.'
            : status === 'error' ? 'The last compare failed on this asset.'
              : compared ? null
                : `${asset.reconcile_diff_count ?? 'Some'} field(s) still disagree.`);

  /**
   * 3. Seen by Nexthink. NOT applicable to anything that cannot carry the agent — every monitor, dock
   *    and phone — nor to a machine whose recorded OS predates Windows 10. Those are the two exclusions
   *    that stop this check from being permanently red on half the estate.
   */
  const couldReport = Boolean(type && AGENT_TYPES.has(type)) && !preWindows10(asset.os_version ?? asset.os_type);
  add('nexthink-seen', 'Reports to Nexthink', couldReport, couldReport && seenByNexthink,
    !type ? 'No asset type recorded, so it cannot be judged — fill the type first.'
      : !AGENT_TYPES.has(type) ? `A ${type} carries no Nexthink agent.`
        : preWindows10(asset.os_version ?? asset.os_type) ? 'Its OS is older than Windows 10, which cannot run the agent.'
          : seenByNexthink ? null
            : 'Not in the Nexthink export: switched off long enough to be aged out, or the agent is not installed.');

  // 4. Confirmed on site by a person. Applies to everything — that is what a full inventory is for.
  const surveyed = inputs.surveyedAssetIds.has(asset.id);
  add('surveyed', 'Seen in a physical survey', true, surveyed,
    surveyed ? null : 'No survey row resolved to it. Nobody has confirmed it exists by looking.');

  // 5. The fields without which the record cannot identify or locate the device.
  const family = familyOf(type);
  const missing = CORE_FIELDS[family].filter((f) => isEmpty(asset[f]));
  add('core-fields', 'Key fields filled', true, missing.length === 0,
    missing.length === 0 ? null : `Missing: ${missing.join(', ')}.`);

  /**
   * 6. Drawn on the floor plan. Room and floor are not enough — this asks whether somebody can point
   *    at it on the plan, which is what the map exists for.
   */
  const planApplies = Boolean(type && PLAN_TYPES.has(type));
  add('on-the-plan', 'Placed on the floor plan', planApplies, planApplies && asset.is_placed,
    !planApplies ? `A ${type ?? 'device of unknown type'} is not located by a dot on a plan.`
      : asset.is_placed ? null
        : asset.workarea_id ? 'It has a room but is not drawn on the plan yet.'
          : 'No room, so there is nowhere to draw it — give it a room first.');

  // 7. Socket, and through it the patch panel and switch port. Only for things that plug into a wall.
  const socketApplies = Boolean(type && SOCKET_TYPES.has(type));
  add('network-socket', 'Wired to a known socket', socketApplies, socketApplies && Boolean(asset.wall_port_id),
    !socketApplies ? `A ${type ?? 'device of unknown type'} is not recorded against a wall socket.`
      : asset.wall_port_id ? null
        : 'No socket recorded, so its patch panel and switch port are unknown.');

  // 8. A peripheral that belongs to a machine. A screen with no parent is a screen nobody can trace.
  const childApplies = Boolean(type && CHILD_TYPES.has(type));
  add('attached-to-a-machine', 'Attached to its machine', childApplies,
    childApplies && inputs.hasParent.has(asset.id),
    !childApplies ? 'Not a peripheral, so it has no machine to belong to.'
      : inputs.hasParent.has(asset.id) ? null
        : 'No parent recorded, so nothing says which machine it serves.');

  /**
   * A device out of service is measured against nothing. Applied here rather than by filtering the
   * caller's list, so the single-asset endpoint and the summary cannot disagree about who counts.
   */
  const tracked = !isOutOfService(asset);
  if (!tracked) {
    for (const c of checks) {
      c.applicable = false;
      c.satisfied = false;
      c.detail = `Out of service (${asset.status}), so nothing is expected of the record.`;
    }
  }

  const applicable = checks.filter((c) => c.applicable);
  return {
    asset_id: asset.id,
    display_name: asset.display_name,
    tracked,
    checks,
    satisfied: applicable.filter((c) => c.satisfied).length,
    applicable: applicable.length,
  };
}

export async function getAssetCompleteness(assetId: string): Promise<AssetCompleteness | null> {
  const asset = await AppDataSource.getRepository(Asset).findOne({ where: { id: assetId } });
  if (!asset) return null;
  return assessAsset(asset, await loadCompletenessInputs([asset]));
}

export interface CompletenessSummary {
  /** Live assets only: a replaced device is not part of the estate anyone is recording. */
  total: number;
  /**
   * Per check across the estate. `applicable` is the honest denominator — "0 of 1344" and
   * "0 of 300 it applies to" are very different statements.
   */
  by_check: Array<{
    key: CheckKey;
    label: string;
    applicable: number;
    satisfied: number;
    /**
     * True when the check applies widely and virtually nothing satisfies it: a stage nobody has
     * started, rather than a fault of any individual asset.
     *
     * Deliberately NOT `satisfied === 0`. The floor-plan check stands at 1 of 1197 and the wall-socket
     * check at 1 of 434, so an exact-zero test would stay silent on the two checks this flag exists
     * for — one stray record out of a thousand is not a programme under way.
     */
    unstarted: boolean;
  }>;
  /** How many assets are fully recorded against everything that applies to them. */
  complete: number;
  /** Distribution of "satisfied of applicable", so the shape is visible without listing 1344 rows. */
  distribution: Array<{ satisfied: number; applicable: number; assets: number }>;
}

/**
 * Whether a check is an unstarted programme stage rather than this asset's own gap.
 *
 * Named and exported so the rule has one home and can be tested directly. Inlined, the only way to
 * pin it was to restate the arithmetic in the test, which proves nothing.
 *
 * Two guards, each for a different mistake. The 20 stops a check applying to three devices being
 * announced as a programme stage. The 2% is the mistake actually made: written as `satisfied === 0`
 * this stayed silent on the floor-plan check at 1 of 1197 and the socket check at 1 of 434 — the two
 * it was written for — because one stray record out of a thousand is not a start.
 */
export function isUnstartedStage(satisfied: number, applicable: number): boolean {
  return applicable >= 20 && satisfied / applicable < 0.02;
}

export async function getCompletenessSummary(): Promise<CompletenessSummary> {
  /**
   * Replaced devices and retired ones both drop out. Together they are 133 of 1477 rows here, and
   * counting them would make the estate look worse every time somebody correctly retires a machine —
   * the exact opposite of what the indicator is for.
   */
  const assets = (await AppDataSource.getRepository(Asset).find())
    .filter((a) => !a.successor_id && !isOutOfService(a));
  const inputs = await loadCompletenessInputs(assets);
  const assessed = assets.map((a) => assessAsset(a, inputs));

  const keys = new Map<CheckKey, { label: string; applicable: number; satisfied: number }>();
  for (const a of assessed) {
    for (const c of a.checks) {
      if (!c.applicable) continue;
      const cur = keys.get(c.key) ?? { label: c.label, applicable: 0, satisfied: 0 };
      cur.applicable++;
      if (c.satisfied) cur.satisfied++;
      keys.set(c.key, cur);
    }
  }

  const dist = new Map<string, { satisfied: number; applicable: number; assets: number }>();
  for (const a of assessed) {
    const k = `${a.satisfied}/${a.applicable}`;
    const cur = dist.get(k) ?? { satisfied: a.satisfied, applicable: a.applicable, assets: 0 };
    cur.assets++;
    dist.set(k, cur);
  }

  return {
    total: assets.length,
    by_check: [...keys].map(([key, v]) => ({
      key,
      label: v.label,
      applicable: v.applicable,
      satisfied: v.satisfied,
      unstarted: isUnstartedStage(v.satisfied, v.applicable),
    })).sort((a, b) => (a.satisfied / a.applicable) - (b.satisfied / b.applicable)),
    complete: assessed.filter((a) => a.applicable > 0 && a.satisfied === a.applicable).length,
    distribution: [...dist.values()].sort(
      (a, b) => (a.satisfied / a.applicable) - (b.satisfied / b.applicable),
    ),
  };
}
