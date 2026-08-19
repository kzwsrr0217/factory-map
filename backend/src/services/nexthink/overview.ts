/**
 * overview.ts — the state of the Nexthink source, in one call.
 *
 * Exists because the whole Nexthink round was command-line: the import and all five reports were
 * scripts, so the one person with a terminal could run it and nobody else could. The findings that
 * are ACTIONS were always in the app — they become tasks. The findings that are QUESTIONS had
 * nowhere to be read.
 *
 * ── Why the logic moved here rather than being written twice ────────────────────
 * Two of the five reports had their logic inside the script that printed it. Adding a page meant
 * either calling a script from a web request or reimplementing the same query — and two
 * implementations of "which devices does the map not know" is how two answers start to differ. So
 * they live here, the scripts print what these return, and the endpoint serves the same objects.
 *
 * ── Lists, not just counts ──────────────────────────────────────────────────────
 * Every finding carries the devices behind it. A screen that says "17 devices are quiet" and cannot
 * say which ones is a screen that gets looked at once. The counts are derivable from the lists; the
 * reverse is not.
 */
import { In } from 'typeorm';
import { AppDataSource } from '../../config/database';
import { Asset } from '../../entities/Asset.entity';
import { WorkArea } from '../../entities/WorkArea.entity';
import { ItsmHardwareSnapshot } from '../../entities/ItsmHardwareSnapshot.entity';
import { NexthinkDeviceSnapshot } from '../../entities/NexthinkDeviceSnapshot.entity';
import { NexthinkLoginSnapshot } from '../../entities/NexthinkLoginSnapshot.entity';
import { keyDeltaAgainstLastRun, lastRun } from '../importRun';
import { findPersonFindings, PersonFinding } from './personEvidence';
import { NEXTHINK_VISIBLE_ASSET_TYPES } from './snapshotImport';

/** Below this, silence is a long weekend rather than a signal. */
export const QUIET_FROM_DAYS = 14;

function daysBetween(later: Date, earlier: Date): number {
  return Math.floor((later.getTime() - earlier.getTime()) / 86_400_000);
}

/**
 * Resolve device names to assets, by HWA then by display name.
 *
 * The two-step is not optional: the older devices carry the HWA as their display name and were never
 * given the dedicated column, so matching on one field alone reports devices as missing that are
 * sitting in the map under the number.
 */
async function assetsByDeviceName(names: string[]): Promise<Map<string, Asset>> {
  const out = new Map<string, Asset>();
  if (names.length === 0) return out;
  const repo = AppDataSource.getRepository(Asset);
  // 500 at a time: two bound parameters per row would walk into SQL Server's 2100 cap as the
  // estate grows.
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

export interface UnknownDevice {
  device_name: string;
  entity: string | null;
  hardware_type: string | null;
  hardware: string;
  os_name: string | null;
  bios_serial: string | null;
  first_seen: Date | null;
  last_seen: Date | null;
  /** The ITSM record, when the loaded export has one. */
  itsm: { catalog_item_name: string | null; status: string | null; person: string | null; location: string | null } | null;
  /**
   * True when the device started reporting AFTER the loaded ITSM export was taken. Then "ITSM does
   * not know it" is not a finding at all — the export simply predates the device, and telling
   * somebody to create a CI that may already exist is how a duplicate is made.
   */
  newer_than_itsm_export: boolean;
  /** Heaviest named logon, or null when only generic or autologon accounts have been used. */
  top_person: string | null;
  /** Rooms that person's existing equipment sits in — where this one probably belongs. */
  person_rooms: string[];
}

/**
 * Manufacturer and model without saying "Dell Dell Pro Slim".
 *
 * Nexthink's `hardware.model` sometimes carries the maker and sometimes does not, so neither field
 * alone is right and concatenating them blindly stutters.
 */
function describeHardware(manufacturer: string | null, model: string | null): string {
  const make = manufacturer?.trim() ?? '';
  const mod = model?.trim() ?? '';
  if (!mod) return make || 'unknown model';
  if (!make) return mod;
  return mod.toLowerCase().startsWith(make.toLowerCase()) ? mod : `${make} ${mod}`;
}

/** Which rooms this person's existing assets are in, by name. */
async function roomsOf(fullName: string): Promise<string[]> {
  const assets = await AppDataSource.getRepository(Asset).find({
    where: { person_full_name: fullName },
    select: { workarea_id: true },
  });
  const ids = [...new Set(assets.map((a) => a.workarea_id).filter((x): x is string => Boolean(x)))];
  if (ids.length === 0) return [];
  const rooms = await AppDataSource.getRepository(WorkArea).find({
    where: { id: In(ids) },
    select: { name: true },
  });
  return rooms.map((r) => r.name);
}

/**
 * Machines Nexthink can see that the map does not hold.
 *
 * The strongest finding this source produces: a machine cannot report without existing and being
 * switched on, so there is no "maybe it was decommissioned" reading of any row here.
 */
export async function findUnknownDevices(): Promise<UnknownDevice[]> {
  const devices = await AppDataSource.getRepository(NexthinkDeviceSnapshot).find();
  if (devices.length === 0) return [];
  const known = await assetsByDeviceName(devices.map((d) => d.device_name));
  const missing = devices.filter((d) => !known.has(d.device_name));
  if (missing.length === 0) return [];

  const itsmRepo = AppDataSource.getRepository(ItsmHardwareSnapshot);
  const itsmRows = await itsmRepo.find({ where: { itsm_id: In(missing.map((d) => d.device_name)) } });
  const itsmByHwa = new Map(itsmRows.map((r) => [r.itsm_id, r]));
  const age = await itsmRepo.createQueryBuilder('i')
    .select('MAX(i.imported_at)', 'max').getRawOne<{ max: Date | null }>();
  const itsmImportedAt = age?.max ?? null;

  const logins = await AppDataSource.getRepository(NexthinkLoginSnapshot).find({
    where: { device_name: In(missing.map((d) => d.device_name)), account_kind: 'person' },
  });

  const out: UnknownDevice[] = [];
  for (const d of missing) {
    const itsm = itsmByHwa.get(d.device_name) ?? null;
    const people = logins
      .filter((l) => l.device_name === d.device_name && l.full_name)
      .sort((a, b) => b.logins - a.logins);
    const top = people[0]?.full_name ?? null;
    out.push({
      device_name: d.device_name,
      entity: d.entity,
      hardware_type: d.hardware_type,
      hardware: describeHardware(d.manufacturer, d.model),
      os_name: d.os_name,
      bios_serial: d.bios_serial,
      first_seen: d.first_seen,
      last_seen: d.last_seen,
      itsm: itsm
        ? {
          catalog_item_name: itsm.catalog_item_name,
          status: itsm.status,
          person: itsm.assigned_person_name,
          location: itsm.location_name,
        }
        : null,
      newer_than_itsm_export: Boolean(
        !itsm && itsmImportedAt && d.first_seen && d.first_seen > itsmImportedAt,
      ),
      top_person: top,
      person_rooms: top ? await roomsOf(top) : [],
    });
  }
  // The ones ITSM can supply first: those can be acted on today.
  return out.sort((a, b) => Number(Boolean(b.itsm)) - Number(Boolean(a.itsm)));
}

export interface QuietDevice {
  device_name: string;
  days_quiet: number;
  entity: string | null;
  os_name: string | null;
  last_seen: Date | null;
  /** live in the map · already replaced · not in the map */
  map_state: 'live' | 'replaced' | 'absent';
  person: string | null;
  room: string | null;
}

export interface QuietDevices {
  /** The export's own newest sighting — everything is measured back from this, not from today. */
  freshest: Date | null;
  /** Bucket label to device count, coarse to fine. */
  buckets: Array<{ label: string; count: number }>;
  quiet: QuietDevice[];
  /** True when the export falls in July or August, when weeks of silence is usually leave. */
  holiday_season: boolean;
}

/**
 * Machines that have stopped reporting.
 *
 * Measured back from the newest sighting in the export rather than from today: run against a
 * three-week-old export, today's date would add three weeks of imaginary silence to every device.
 *
 * This is the shallow end by construction. Nexthink ages long-inactive devices out of the export
 * entirely, so a machine switched off months ago does not appear here with an old date — it
 * disappears, and only `disappeared_since_last_import` can see that.
 */
export async function findQuietDevices(quietFromDays = QUIET_FROM_DAYS): Promise<QuietDevices> {
  const devices = await AppDataSource.getRepository(NexthinkDeviceSnapshot).find();
  const withDates = devices.filter((d) => d.last_seen);
  const freshest = withDates.reduce<Date | null>(
    (max, d) => (d.last_seen && (!max || d.last_seen > max) ? d.last_seen : max), null,
  );
  if (!freshest) {
    return { freshest: null, buckets: [], quiet: [], holiday_season: false };
  }

  const ranges: Array<[string, number, number]> = [
    ['60+ days', 60, Infinity],
    ['30–59 days', 30, 60],
    ['14–29 days', 14, 30],
    ['7–13 days', 7, 14],
    ['under 7 days', 0, 7],
  ];
  const buckets = ranges.map(([label, lo, hi]) => ({
    label,
    count: withDates.filter((d) => {
      const q = daysBetween(freshest, d.last_seen!);
      return q >= lo && q < hi;
    }).length,
  })).filter((b) => b.count > 0);

  const candidates = withDates
    .map((d) => ({ d, q: daysBetween(freshest, d.last_seen!) }))
    .filter((x) => x.q >= quietFromDays)
    .sort((a, b) => b.q - a.q);

  const byName = await assetsByDeviceName(candidates.map((x) => x.d.device_name));
  const roomIds = [...new Set([...byName.values()].map((a) => a.workarea_id).filter(Boolean))] as string[];
  const rooms = new Map(
    roomIds.length > 0
      ? (await AppDataSource.getRepository(WorkArea).find({ where: { id: In(roomIds) } }))
        .map((w) => [w.id, w.name] as const)
      : [],
  );

  const month = freshest.getUTCMonth();
  return {
    freshest,
    buckets,
    holiday_season: month === 6 || month === 7,
    quiet: candidates.map(({ d, q }) => {
      const a = byName.get(d.device_name);
      return {
        device_name: d.device_name,
        days_quiet: q,
        entity: d.entity,
        os_name: d.os_name,
        last_seen: d.last_seen,
        map_state: !a ? 'absent' : a.successor_id ? 'replaced' : 'live',
        person: a?.person_full_name ?? null,
        room: a?.workarea_id ? rooms.get(a.workarea_id) ?? null : null,
      };
    }),
  };
}

export interface NexthinkOverview
{
  loaded: boolean;
  /** When the snapshot was imported, and when the export itself was taken. */
  imported_at: Date | null;
  taken_at: Date | null;
  device_count: number;
  login_count: number;
  by_entity: Array<{ entity: string; total: number; windows_11: number }>;
  /** Assets of a type Nexthink could see, absent from the export. A question, not a verdict. */
  never_seen: { count: number; of_visible_type: number };
  unknown_to_map: UnknownDevice[];
  quiet: QuietDevices;
  /** Only the clear disagreements; shared machines and thin evidence are excluded upstream. */
  person_mismatches: PersonFinding[];
  /**
   * Device names the previous import had and this one does not — the closest thing to a
   * decommission signal here. Null when there is no earlier run to compare against, which is not
   * the same as nothing having disappeared.
   */
  disappeared_since_last_import: { device_names: string[]; previous_run_at: Date } | null;
}

export async function getNexthinkOverview(): Promise<NexthinkOverview> {
  const deviceRepo = AppDataSource.getRepository(NexthinkDeviceSnapshot);
  const devices = await deviceRepo.find();
  const loginCount = await AppDataSource.getRepository(NexthinkLoginSnapshot).count();
  const run = await lastRun('nexthink-devices');

  if (devices.length === 0) {
    return {
      loaded: false,
      imported_at: null,
      taken_at: null,
      device_count: 0,
      login_count: loginCount,
      by_entity: [],
      never_seen: { count: 0, of_visible_type: 0 },
      unknown_to_map: [],
      quiet: { freshest: null, buckets: [], quiet: [], holiday_season: false },
      person_mismatches: [],
      disappeared_since_last_import: null,
    };
  }

  const byEntityMap = new Map<string, { total: number; windows_11: number }>();
  for (const d of devices) {
    const key = d.entity ?? '(none)';
    const cur = byEntityMap.get(key) ?? { total: 0, windows_11: 0 };
    cur.total++;
    if (d.os_name && /windows 11/i.test(d.os_name)) cur.windows_11++;
    byEntityMap.set(key, cur);
  }

  // The reverse direction: assets of an agent-carrying type that the export does not mention.
  const assetRepo = AppDataSource.getRepository(Asset);
  const visible = await assetRepo.find({
    where: { asset_type: In([...NEXTHINK_VISIBLE_ASSET_TYPES]) },
    select: { hardware_asset_id: true, display_name: true },
  });
  const exported = new Set(devices.map((d) => d.device_name));
  const neverSeen = visible.filter(
    (a) => !exported.has(a.hardware_asset_id ?? '') && !exported.has(a.display_name),
  ).length;

  const delta = await keyDeltaAgainstLastRun('nexthink-devices', devices.map((d) => d.device_name));

  return {
    loaded: true,
    imported_at: run?.imported_at ?? null,
    taken_at: run?.taken_at ?? null,
    device_count: devices.length,
    login_count: loginCount,
    by_entity: [...byEntityMap]
      .map(([entity, v]) => ({ entity, ...v }))
      .sort((a, b) => b.total - a.total),
    never_seen: { count: neverSeen, of_visible_type: visible.length },
    unknown_to_map: await findUnknownDevices(),
    quiet: await findQuietDevices(),
    person_mismatches: (await findPersonFindings()).filter((f) => f.comparison === 'disagree'),
    disappeared_since_last_import: delta.previous_run_at
      ? { device_names: delta.disappeared, previous_run_at: delta.previous_run_at }
      : null,
  };
}
