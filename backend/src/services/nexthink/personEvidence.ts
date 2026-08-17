/**
 * personEvidence.ts — the third opinion on "whose machine is this".
 *
 * ITSM holds one assigned person per asset, typed by whoever raised the request. The survey holds
 * whoever was standing there during the walk-around. This holds what the logon records say. None
 * of the three is authoritative and this one least of all — but it is the only one that is not
 * somebody's memory, and where it agrees with neither of the others that is worth knowing.
 *
 * What it must never do is pick a winner on a shared machine. On the real export one desktop had
 * six different people on it with the top two separated by a single logon; 17 devices are like
 * that. A tool that named one of them would be inventing a fact, and the person whose name it
 * printed would be the one asked to explain it. So the shared machines come out as their own
 * category, listed, undecided.
 */
import { In } from 'typeorm';
import { AppDataSource } from '../../config/database';
import { Asset } from '../../entities/Asset.entity';
import { NexthinkLoginSnapshot, NexthinkAccountKind } from '../../entities/NexthinkLoginSnapshot.entity';

/**
 * Below this, the top account is not evidence of anything.
 *
 * A single logon is what a support visit looks like. Admin accounts are already excluded by
 * `account_kind`, but a colleague signing in with their own account to fix something is not, and
 * that is exactly the row that would otherwise reassign a machine to the person who repaired it.
 */
const MIN_LOGINS = 3;

/**
 * If the runner-up has at least this share of the top account's logons, the machine is shared and
 * no claim is made. 0.7 rather than a fixed gap: on a machine with 4 and 3 logons the difference
 * is noise, on one with 40 and 28 it is still noise, and a fixed gap gets one of those wrong.
 */
const SHARED_RATIO = 0.7;

/**
 * Fold a name for comparison: accents off, case down, spacing normalised.
 *
 * Both sources write "Surname, Firstname", so no reordering is needed — but neither is dependable
 * about accents or case. The real export contains "Palotas, Monika" and "vasarhelyi, Zsuzsanna"
 * against ITSM's "Palotás, Mónika". Comparing raw strings would report those as disagreements,
 * and a report whose findings are mostly spelling is a report nobody reads twice.
 */
export function foldName(name: string | null | undefined): string {
  if (!name) return '';
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ', ')
    .trim();
}

export function sameName(a: string | null | undefined, b: string | null | undefined): boolean {
  const fa = foldName(a);
  const fb = foldName(b);
  return fa !== '' && fa === fb;
}

/** What the logon record claims about one device, and how strongly. */
export interface TopUser {
  full_name: string;
  user_name: string;
  logins: number;
  /** The runner-up, kept so the reader can see how close the call was. */
  runner_up: { full_name: string | null; logins: number } | null;
}

export type PersonComparison =
  /** Both sources name the same person. Nothing to do. */
  | 'agree'
  /** The map has nobody and Nexthink has a clear one — a gap this can fill. */
  | 'map_has_nobody'
  /** Both name somebody, and they differ. Needs a human; this is the #87 feed. */
  | 'disagree'
  /** Top two too close, or too many people. Listed, never decided. */
  | 'shared'
  /**
   * Top account below MIN_LOGINS, or no named-person logons at all. The second case is most of
   * the shop floor: those machines only ever see a generic or autologon account, so this report
   * structurally cannot say anything about them. Counted rather than omitted — a denominator
   * that quietly excludes the population you care about is worse than a large honest one.
   */
  | 'too_little_evidence';

export interface PersonFinding {
  device_name: string;
  comparison: PersonComparison;
  /** Null when the device has no named logons at all. */
  nexthink: TopUser | null;
  asset_display_name: string;
  asset_person: string | null;
  asset_id: string;
}

/**
 * Decide what one device's logon rows say, as a pure function of the rows and the map's value.
 *
 * Separated from the querying so the thresholds can be tested against the shapes that actually
 * occur — a 4-versus-3 machine, a 26-versus-21 machine, a single-logon support visit — rather
 * than reasoned about.
 */
export function comparePerson(
  allRows: Array<{
    full_name: string | null;
    user_name: string;
    logins: number;
    account_kind: NexthinkAccountKind;
  }>,
  assetPerson: string | null,
): { comparison: PersonComparison; top: TopUser | null } {
  /**
   * Takes EVERY logon row for the device, not a pre-filtered list, and applies the one rule here.
   *
   * The first version took only `account_kind === 'person'` rows and then filtered again on
   * `full_name` — two places deciding "is this a person", and the caller's filter was the load
   * bearing one. An admin account that happens to carry an AD display name (`mmhbabaAdmin` with
   * "Baba, Bela" on it) would have passed the inner test, so any caller that stopped pre-filtering
   * would have started reassigning machines to whoever administered them, silently.
   */
  const named = allRows
    .filter((r) => r.account_kind === 'person' && r.full_name && r.full_name.trim() !== '')
    .sort((a, b) => b.logins - a.logins);
  if (named.length === 0) return { comparison: 'too_little_evidence', top: null };

  const first = named[0];
  const second = named[1] ?? null;
  const top: TopUser = {
    full_name: first.full_name!,
    user_name: first.user_name,
    logins: first.logins,
    runner_up: second ? { full_name: second.full_name, logins: second.logins } : null,
  };

  if (first.logins < MIN_LOGINS) return { comparison: 'too_little_evidence', top };
  if (second && second.logins >= first.logins * SHARED_RATIO) {
    return { comparison: 'shared', top };
  }
  if (!assetPerson || assetPerson.trim() === '') return { comparison: 'map_has_nobody', top };
  return { comparison: sameName(first.full_name, assetPerson) ? 'agree' : 'disagree', top };
}

/**
 * Compare every device in the logon snapshot against the map.
 *
 * Devices the map has never heard of are skipped rather than reported: they are the subject of
 * `nexthink-unknown-devices.ts`, and repeating them here would mean two lists that have to be
 * reconciled by whoever reads them.
 */
export async function findPersonFindings(): Promise<PersonFinding[]> {
  // Every row, not just the person ones: a device whose only logons are generic belongs in the
  // "too little evidence" count rather than vanishing from the denominator. `comparePerson` owns
  // the filtering, so there is exactly one definition of what counts as a person.
  const logins = await AppDataSource.getRepository(NexthinkLoginSnapshot).find();
  if (logins.length === 0) return [];

  const byDevice = new Map<string, NexthinkLoginSnapshot[]>();
  for (const l of logins) {
    const list = byDevice.get(l.device_name) ?? [];
    list.push(l);
    byDevice.set(l.device_name, list);
  }

  const names = [...byDevice.keys()];
  const assetRepo = AppDataSource.getRepository(Asset);
  // Same two-step resolution as everywhere else, and the same 500-row chunking: the older
  // devices carry the HWA as their display name and have no hardware_asset_id.
  const assetByName = new Map<string, Asset>();
  for (let i = 0; i < names.length; i += 500) {
    const chunk = names.slice(i, i + 500);
    const rows = await assetRepo.find({
      where: [{ hardware_asset_id: In(chunk) }, { display_name: In(chunk) }],
    });
    for (const a of rows) {
      if (a.hardware_asset_id) assetByName.set(a.hardware_asset_id, a);
      if (!assetByName.has(a.display_name)) assetByName.set(a.display_name, a);
    }
  }

  const findings: PersonFinding[] = [];
  for (const [device, rows] of byDevice) {
    const asset = assetByName.get(device);
    if (!asset) continue;
    const { comparison, top } = comparePerson(rows, asset.person_full_name);
    findings.push({
      device_name: device,
      comparison,
      nexthink: top,
      asset_display_name: asset.display_name,
      asset_person: asset.person_full_name,
      asset_id: asset.id,
    });
  }
  return findings;
}
