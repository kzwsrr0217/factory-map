/**
 * swapEvidence.ts — "we swapped this machine" checked against what the machines reported.
 *
 * This CONFIRMS a claimed swap. It does not find swaps, and the distinction is not pedantry:
 * three attempts at detection were written and all three failed badly (best result: 21
 * candidates for 6 known swaps, one of which was right). The reason is structural — a swap
 * looks exactly like a person changing desks, and there are far more of the latter. Given the
 * pair, though, the same evidence is decisive: on the six swaps that were already known, the
 * logon fingerprint agreed six times out of six.
 *
 * Three independent signals, deliberately kept apart in the output rather than folded into one
 * score. A score would hide which of them actually fired, and they are not equally strong:
 *
 *  1. Shared NAMED people. The strong one. If the same human is the heaviest logon on both
 *     machines, they are the same desk. Only `person` rows count — `person_unnamed` looks like
 *     a human but has no AD name to match on, and admin/machine/local accounts are on
 *     everything.
 *  2. Shared GENERIC accounts. Weak, and reported with the number of other devices carrying the
 *     same account so the reader can see how weak. MMH_SHOP_FLOOR_WB2 on two machines means
 *     something; an account that is on forty means nothing. On the shop floor this is often the
 *     only signal there is, because the IPCs never see a named login at all.
 *  3. Timing. `last_seen` on the old machine against `first_seen` on the new one. This is the
 *     one that answers the disposition question — see `oldMachineFate` below.
 *
 * What this deliberately does NOT do is judge Windows 11 eligibility, which is the actual
 * criterion for reinstall-vs-set-aside. The NQL fields for it do not exist (`hardware.tpm_version`
 * and `hardware.secure_boot_enabled` are both rejected); the answer lives in the built-in
 * "Windows 11 - Readiness and migration" dashboard, which is a third export nobody has taken
 * yet. Reporting the old machine's CURRENT OS as if it were its eligibility would be a guess
 * dressed as a fact, so the report says the eligibility is unknown and names where it comes from.
 */
import { In } from 'typeorm';
import { AppDataSource } from '../../config/database';
import { Asset } from '../../entities/Asset.entity';
import { NexthinkDeviceSnapshot } from '../../entities/NexthinkDeviceSnapshot.entity';
import { NexthinkLoginSnapshot } from '../../entities/NexthinkLoginSnapshot.entity';

/**
 * Seen within this many days of the freshest data in the snapshot = still in service.
 *
 * Measured against the export's own newest `last_seen` rather than against today's date, so the
 * verdict does not drift as the export ages: run against a three-week-old export, "today" is
 * three weeks ago and a machine that was live then is still reported as live then.
 */
const ACTIVE_DAYS = 7;

/**
 * A replacement whose `first_seen` is older than this is not new to the estate, so its
 * `first_seen` is NOT the handover date — it is when the machine originally entered service,
 * possibly years and one previous owner ago. Reusing an old machine as a replacement is the
 * normal path here, so this is the common case, not the exception.
 */
const RECYCLED_AFTER_DAYS = 120;

export interface SharedAccount {
  user_name: string;
  full_name: string | null;
  old_logins: number;
  new_logins: number;
  /** How many OTHER devices in the snapshot carry this same account. 0 = it identifies a desk. */
  devices_sharing: number;
}

/**
 * What became of the old machine, read off the logon record rather than assumed.
 *
 * The operating rule is: a Win11-capable machine gets reinstalled and put back into service, and
 * one that is not gets set aside for a later decommission. Which of the two happened is
 * observable — a machine in service reports to Nexthink, a machine on a shelf does not. So this
 * does not need the eligibility data to say what the current state IS; it only cannot say what
 * the state SHOULD be.
 *
 * Deliberately judged on the old machine's own recent activity, NOT on a comparison against the
 * replacement's `first_seen`. The first version did the comparison and reported gaps of 871 and
 * 577 days as "still reporting after the swap", which is nonsense: those replacements were
 * recycled machines whose `first_seen` is years old. The old machine's own last sighting needs no
 * second date to be meaningful.
 */
export type OldMachineFate =
  /** Reporting right up to the end of the export window — in service, wherever it is. */
  | 'still_active'
  /** Present but not seen for a while: powered off or set aside. */
  | 'quiet'
  /** Not in the export at all: quiet for longer than the export window, or outside its entities. */
  | 'gone_from_nexthink'
  /** In the export but with no readable last_seen. */
  | 'undeterminable';

export type SwapVerdict =
  /** At least one named person is on both machines. */
  | 'confirmed'
  /** Both sides have named people and they do not overlap at all. Not "false" — worth a look. */
  | 'contradicted'
  /** Only generic/machine accounts to go on. Normal for the shop floor; decides nothing. */
  | 'weak_evidence'
  /** One or both machines have no usable logon rows. */
  | 'no_evidence';

export interface SwapEvidence {
  old_hwa: string;
  new_hwa: string;
  /** Whether the map already has the swap, via the predecessor/successor link. */
  already_recorded: boolean;
  old_in_map: Asset | null;
  new_in_map: Asset | null;
  old_device: NexthinkDeviceSnapshot | null;
  new_device: NexthinkDeviceSnapshot | null;
  shared_people: SharedAccount[];
  shared_generic: SharedAccount[];
  /** Named people on the old machine only, heaviest first — who the swap moved away from. */
  old_only_people: SharedAccount[];
  new_only_people: SharedAccount[];
  verdict: SwapVerdict;
  fate: OldMachineFate;
  /** How many days before the end of the export window the old machine was last seen. */
  old_quiet_days: number | null;
  /**
   * When the replacement first reported. This is the handover date only for a machine that is
   * new to the estate; for a recycled one it is when it originally entered service, which is why
   * `replacement_is_recycled` sits next to it instead of the number being interpreted alone.
   */
  replacement_first_seen: Date | null;
  replacement_is_recycled: boolean;
}

/**
 * The verdict, as a pure function of the four account groupings.
 *
 * Extracted from `assessSwap` so it can be tested without a database. Not a refactor for its own
 * sake: the sibling decision below shipped wrong this morning and was caught by a human reading
 * the output, which is not a control that scales.
 */
export function decideVerdict(input: {
  sharedPeople: SharedAccount[];
  sharedGeneric: SharedAccount[];
  oldOnlyPeople: SharedAccount[];
  newOnlyPeople: SharedAccount[];
}): SwapVerdict {
  if (input.sharedPeople.length > 0) return 'confirmed';
  // Only a contradiction if BOTH sides have named people to compare. One side having none is
  // ignorance, not disagreement, and calling it a contradiction would put every shop-floor
  // machine on a list of things to go and check.
  if (input.oldOnlyPeople.length > 0 && input.newOnlyPeople.length > 0) return 'contradicted';
  if (input.sharedGeneric.length > 0) return 'weak_evidence';
  return 'no_evidence';
}

/**
 * What became of the old machine, from its own last sighting against the export's newest.
 *
 * Deliberately takes no argument about the replacement. The first version compared the old
 * machine's `last_seen` against the new machine's `first_seen` and reported gaps of 871 and 577
 * days as "still reporting after the swap" — those replacements were recycled machines first seen
 * in 2024 and 2025. The old machine's own activity needs no second date to be meaningful, and
 * removing the parameter is what makes the mistake impossible rather than merely fixed.
 */
export function decideFate(input: {
  oldDevicePresent: boolean;
  oldLastSeen: Date | null;
  freshest: Date | null;
}): { fate: OldMachineFate; quietDays: number | null } {
  if (!input.oldDevicePresent) return { fate: 'gone_from_nexthink', quietDays: null };
  if (!input.oldLastSeen || !input.freshest) return { fate: 'undeterminable', quietDays: null };
  const quietDays = daysBetween(input.freshest, input.oldLastSeen);
  return { fate: quietDays <= ACTIVE_DAYS ? 'still_active' : 'quiet', quietDays };
}

/**
 * Whether the replacement predates this swap, making its `first_seen` a service date rather than
 * a handover date. Reusing an older machine is the normal path here, so this is the common case.
 */
export function isRecycledReplacement(firstSeen: Date | null, freshest: Date | null): boolean {
  if (!firstSeen || !freshest) return false;
  return daysBetween(freshest, firstSeen) > RECYCLED_AFTER_DAYS;
}

/** By HWA, then by display name — the older devices carry the number as their name. */
async function findAsset(hwa: string): Promise<Asset | null> {
  const repo = AppDataSource.getRepository(Asset);
  return (
    (await repo.findOne({ where: { hardware_asset_id: hwa } }))
    ?? (await repo.findOne({ where: { display_name: hwa } }))
  );
}

/**
 * How many devices carry each of these accounts, across the whole snapshot.
 *
 * This is what turns a shared generic account from a claim into a measurement. Done as one
 * grouped query rather than per account: the shop-floor machines share a handful of accounts and
 * asking separately for each was a query per row for no benefit.
 */
async function deviceCountsByAccount(userNames: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (userNames.length === 0) return counts;
  const rows = await AppDataSource.getRepository(NexthinkLoginSnapshot)
    .createQueryBuilder('l')
    .select('LOWER(l.user_name)', 'u')
    .addSelect('COUNT(DISTINCT l.device_name)', 'n')
    .where('LOWER(l.user_name) IN (:...names)', { names: userNames.map((u) => u.toLowerCase()) })
    .groupBy('LOWER(l.user_name)')
    .getRawMany<{ u: string; n: number }>();
  for (const r of rows) counts.set(r.u, Number(r.n));
  return counts;
}

function daysBetween(later: Date, earlier: Date): number {
  return Math.round((later.getTime() - earlier.getTime()) / 86_400_000);
}

/**
 * The newest `last_seen` in the whole snapshot — the export's own "now".
 *
 * MAX over 334 rows on an indexed column, and every pair in a run needs it, so it is memoised
 * for the process rather than passed through every signature.
 */
let freshestCache: Date | null | undefined;
async function snapshotFreshestDate(): Promise<Date | null> {
  if (freshestCache !== undefined) return freshestCache;
  const row = await AppDataSource.getRepository(NexthinkDeviceSnapshot)
    .createQueryBuilder('d')
    .select('MAX(d.last_seen)', 'max')
    .getRawOne<{ max: Date | null }>();
  freshestCache = row?.max ?? null;
  return freshestCache;
}

/**
 * Assess one claimed swap. Reads only — it never records anything, because the recording is
 * `record-replacement.ts`'s job and a report that also writes is a report nobody dares run.
 */
export async function assessSwap(oldHwaRaw: string, newHwaRaw: string): Promise<SwapEvidence> {
  const oldHwa = oldHwaRaw.trim().toUpperCase();
  const newHwa = newHwaRaw.trim().toUpperCase();

  const [oldInMap, newInMap] = await Promise.all([findAsset(oldHwa), findAsset(newHwa)]);
  const deviceRepo = AppDataSource.getRepository(NexthinkDeviceSnapshot);
  const loginRepo = AppDataSource.getRepository(NexthinkLoginSnapshot);

  const devices = await deviceRepo.find({ where: { device_name: In([oldHwa, newHwa]) } });
  const oldDevice = devices.find((d) => d.device_name === oldHwa) ?? null;
  const newDevice = devices.find((d) => d.device_name === newHwa) ?? null;

  const logins = await loginRepo.find({ where: { device_name: In([oldHwa, newHwa]) } });
  const onOld = logins.filter((l) => l.device_name === oldHwa);
  const onNew = logins.filter((l) => l.device_name === newHwa);

  /**
   * Keyed on lowercased user_name: the export is inconsistent about case (`MMHATKO` and
   * `mmhlato` both occur in the same file), so matching on the raw string silently misses
   * the very overlap this is looking for.
   */
  const key = (l: NexthinkLoginSnapshot) => l.user_name.toLowerCase();
  const newByUser = new Map(onNew.map((l) => [key(l), l]));
  const oldByUser = new Map(onOld.map((l) => [key(l), l]));

  const allAccounts = [...new Set([...onOld, ...onNew].map((l) => l.user_name))];
  const deviceCounts = await deviceCountsByAccount(allAccounts);

  const pair = (l: NexthinkLoginSnapshot, other: NexthinkLoginSnapshot | undefined): SharedAccount => ({
    user_name: l.user_name,
    full_name: l.full_name,
    old_logins: (oldByUser.get(key(l)) ?? (l.device_name === oldHwa ? l : undefined))?.logins ?? 0,
    new_logins: (newByUser.get(key(l)) ?? (l.device_name === newHwa ? l : undefined))?.logins ?? 0,
    // The two machines in question are not "other devices sharing it".
    devices_sharing: Math.max(0, (deviceCounts.get(key(l)) ?? 0) - (other ? 2 : 1)),
  });

  const byLogins = (a: SharedAccount, b: SharedAccount) =>
    (b.old_logins + b.new_logins) - (a.old_logins + a.new_logins);

  const sharedPeople = onOld
    .filter((l) => l.account_kind === 'person' && newByUser.has(key(l)))
    .map((l) => pair(l, newByUser.get(key(l))))
    .sort(byLogins);

  const sharedGeneric = onOld
    .filter((l) => l.account_kind === 'generic' && newByUser.has(key(l)))
    .map((l) => pair(l, newByUser.get(key(l))))
    .sort(byLogins);

  const oldOnlyPeople = onOld
    .filter((l) => l.account_kind === 'person' && !newByUser.has(key(l)))
    .map((l) => pair(l, undefined)).sort(byLogins);
  const newOnlyPeople = onNew
    .filter((l) => l.account_kind === 'person' && !oldByUser.has(key(l)))
    .map((l) => pair(l, undefined)).sort(byLogins);

  const verdict = decideVerdict({ sharedPeople, sharedGeneric, oldOnlyPeople, newOnlyPeople });

  // "Now" is the export's own newest sighting, not the clock. See ACTIVE_DAYS.
  const freshest = await snapshotFreshestDate();
  const { fate, quietDays } = decideFate({
    oldDevicePresent: Boolean(oldDevice),
    oldLastSeen: oldDevice?.last_seen ?? null,
    freshest,
  });

  const replacementFirstSeen = newDevice?.first_seen ?? null;
  const replacementIsRecycled = isRecycledReplacement(replacementFirstSeen, freshest);

  const alreadyRecorded = Boolean(
    oldInMap && newInMap
    && (oldInMap.successor_id === newInMap.id || newInMap.predecessor_id === oldInMap.id),
  );

  return {
    old_hwa: oldHwa,
    new_hwa: newHwa,
    already_recorded: alreadyRecorded,
    old_in_map: oldInMap,
    new_in_map: newInMap,
    old_device: oldDevice,
    new_device: newDevice,
    shared_people: sharedPeople,
    shared_generic: sharedGeneric,
    old_only_people: oldOnlyPeople,
    new_only_people: newOnlyPeople,
    verdict,
    fate,
    old_quiet_days: quietDays,
    replacement_first_seen: replacementFirstSeen,
    replacement_is_recycled: replacementIsRecycled,
  };
}
