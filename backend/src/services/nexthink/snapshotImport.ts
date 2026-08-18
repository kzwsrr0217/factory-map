/**
 * snapshotImport.ts (nexthink) — parses the two Nexthink Investigations CSV exports,
 * classifies the logon accounts, and replaces the two landing tables with what they hold.
 *
 * Lives in a service rather than in the CLI script for the same reason the ITSM one does: the
 * same definition of "importing" should answer a browser upload later without being written
 * twice. The script is file reading and printing; everything that decides anything is here.
 *
 * The dry run is the point, not a courtesy. Both tables are full-replaced, and the one number
 * nobody can currently state — how much of the Nexthink estate the factory map actually knows
 * about — only exists once the two are compared. `planNexthinkImport` computes that whether or
 * not it is about to write, so the answer is available before anything is committed.
 */
import { In } from 'typeorm';
import { AppDataSource } from '../../config/database';
import { Asset } from '../../entities/Asset.entity';
import { NexthinkDeviceSnapshot } from '../../entities/NexthinkDeviceSnapshot.entity';
import {
  NexthinkLoginSnapshot,
  NexthinkAccountKind,
} from '../../entities/NexthinkLoginSnapshot.entity';
import { recordImportRun, keyDeltaAgainstLastRun } from '../importRun';

/**
 * Asset types Nexthink could plausibly report on: it needs an agent, so it sees computers and
 * nothing else. Without this list, "assets Nexthink has never seen" would include every
 * monitor, phone, dock and switch in the map and read as a catastrophe instead of a fact about
 * how the tool works. Named here rather than inlined into the report so it is arguable.
 */
export const NEXTHINK_VISIBLE_ASSET_TYPES = ['workstation', 'laptop', 'server', 'ipc'] as const;

/**
 * SQL Server allows at most 2100 parameters per statement, and TypeORM does not split a
 * multi-row `insert()` for you — it builds one statement with a placeholder per column per row.
 * So the chunk size is a budget: rows × columns must stay under the cap.
 *
 * The device row writes 10 columns, the login row 6. At 334 devices a single un-chunked insert
 * would have asked for ~4000 parameters and failed at runtime on the real export — which is
 * why these are constants with the arithmetic written down rather than a number that looked
 * big enough. Halved again for headroom, since adding one column should not break the import.
 */
const DEVICE_INSERT_CHUNK = 100;
const LOGIN_INSERT_CHUNK = 150;
/** Also the read limit: the same 2100-parameter cap applies to `id IN (...)`. */
const LOOKUP_CHUNK = 500;

function* chunked<T>(rows: T[], size: number): Generator<T[]> {
  for (let i = 0; i < rows.length; i += size) yield rows.slice(i, i + size);
}

export interface NexthinkDeviceRow {
  device_name: string;
  entity: string | null;
  first_seen: Date | null;
  last_seen: Date | null;
  hardware_type: string | null;
  manufacturer: string | null;
  model: string | null;
  bios_serial: string | null;
  os_name: string | null;
}

export interface NexthinkLoginRow {
  device_name: string;
  user_name: string;
  full_name: string | null;
  logins: number;
  account_kind: NexthinkAccountKind;
}

/**
 * Splits one line of the Nexthink export.
 *
 * This export quotes every field, header included (unlike the ITSM portal's, which leaves the
 * header bare — see parsePortalHardwareCsv). It does not escape embedded quotes, so a stricter
 * parser would have nothing extra to do; splitting on `","` after trimming the outer pair is
 * exactly as correct here and does not reject the file.
 */
function splitLine(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('"')) s = s.slice(1);
  if (s.endsWith('"')) s = s.slice(0, -1);
  return s.split('","');
}

/** Rows keyed by header name, with a count of lines whose field count did not match. */
function parseCsv(text: string): { rows: Array<Record<string, string>>; malformed: number } {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) return { rows: [], malformed: 0 };
  const header = splitLine(lines[0]);
  const rows: Array<Record<string, string>> = [];
  let malformed = 0;
  for (const line of lines.slice(1)) {
    const values = splitLine(line);
    if (values.length !== header.length) {
      malformed++;
      continue;
    }
    const row: Record<string, string> = {};
    header.forEach((h, i) => {
      row[h] = values[i];
    });
    rows.push(row);
  }
  return { rows, malformed };
}

/**
 * `2026-08-14 12:16:03` as the export writes it.
 *
 * Parsed explicitly rather than handed to `new Date(...)`: that string is not ISO-8601, and
 * what a JS engine makes of a non-ISO date is implementation-defined — the same file could
 * import differently on the VM than on a laptop. An unparseable value returns null and is
 * counted, because a date silently becoming 1970 would make the device look like the oldest
 * thing in the estate and put it straight into the "nobody has seen this in months" report.
 */
export function parseNexthinkDate(raw: string | undefined): Date | null {
  if (!raw) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(raw.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * What kind of account a logon row belongs to — the one definition, checked against the real
 * export rather than reasoned about.
 *
 * Order matters and is deliberate. `win11local@HWA32005` would also match the machine test if
 * that ran first; `mmhbabaAdmin@` has to be caught before the fallback. Verified on the real
 * 671-row export: no account carrying a genuine AD display name is classified as anything but
 * a person, which is the failure that would matter — a real user filtered out as a service
 * account would make the tool claim the survey is wrong about who sits somewhere.
 *
 * `person_unnamed` is not a polite word for "junk": those follow the same MMH+initials shape
 * as the named accounts and are near-certainly people whose AD display name Nexthink did not
 * resolve. 73 of 671. Reported separately so they can be looked at, never counted as evidence.
 */
export function classifyAccount(
  deviceName: string,
  userName: string,
  fullName: string | null,
): NexthinkAccountKind {
  const u = userName.trim();
  if (/^win11local@/i.test(u)) return 'local';
  if (u.toLowerCase().startsWith(`${deviceName.trim().toLowerCase()}@`)) return 'machine';
  if (/admin@/i.test(u)) return 'admin';
  if (/^(MMHGEN\d|MMH_SHOP_FLOOR|IPC@|MMH\d)/i.test(u)) return 'generic';
  return fullName && fullName.trim() !== '' ? 'person' : 'person_unnamed';
}

export interface NexthinkParseResult<T> {
  rows: T[];
  malformed: number;
  /** Rows dropped for having no device name at all — nothing could ever join to them. */
  skipped: number;
}

export function parseNexthinkDevicesCsv(text: string): NexthinkParseResult<NexthinkDeviceRow> & {
  /** Rows whose last_seen could not be parsed — stored as null, never guessed. */
  unparseable_dates: number;
} {
  const { rows, malformed } = parseCsv(text);
  const out: NexthinkDeviceRow[] = [];
  let skipped = 0;
  let unparseableDates = 0;
  for (const r of rows) {
    const name = (r['device.name'] ?? '').trim();
    if (!name) {
      skipped++;
      continue;
    }
    const rawLastSeen = r['device.last_seen'];
    const lastSeen = parseNexthinkDate(rawLastSeen);
    if (rawLastSeen && !lastSeen) unparseableDates++;
    out.push({
      device_name: name,
      entity: r['device.entity']?.trim() || null,
      first_seen: parseNexthinkDate(r['device.first_seen']),
      last_seen: lastSeen,
      hardware_type: r['device.hardware.type']?.trim() || null,
      manufacturer: r['device.hardware.manufacturer']?.trim() || null,
      model: r['device.hardware.model']?.trim() || null,
      bios_serial: r['device.hardware.bios_serial_number']?.trim() || null,
      os_name: r['device.operating_system.name']?.trim() || null,
    });
  }
  return { rows: out, malformed, skipped, unparseable_dates: unparseableDates };
}

export function parseNexthinkLoginsCsv(text: string): NexthinkParseResult<NexthinkLoginRow> {
  const { rows, malformed } = parseCsv(text);
  const out: NexthinkLoginRow[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  for (const r of rows) {
    const device = (r['device.name'] ?? '').trim();
    const user = (r['user.name'] ?? '').trim();
    if (!device || !user) {
      skipped++;
      continue;
    }
    // The pair is the primary key. It is unique in the export (the source query aggregates by
    // it), but a re-export with a differently-shaped query could repeat it, and a duplicate
    // would fail the insert mid-batch rather than being reported. Dropped and counted instead.
    const key = `${device.toLowerCase()}|${user.toLowerCase()}`;
    if (seen.has(key)) {
      skipped++;
      continue;
    }
    seen.add(key);
    const fullName = r['user.ad.full_name']?.trim() || null;
    out.push({
      device_name: device,
      user_name: user,
      full_name: fullName,
      logins: Number.parseInt(r['logins'] ?? '0', 10) || 0,
      account_kind: classifyAccount(device, user, fullName),
    });
  }
  return { rows: out, malformed, skipped };
}

export interface NexthinkImportPlan {
  applied: boolean;
  devices: {
    parsed: number;
    malformed: number;
    skipped: number;
    unparseable_dates: number;
    /** Count per Nexthink entity, so an import missing the Industry ones is visible. */
    by_entity: Record<string, { total: number; windows_11: number }>;
    /** Devices whose last_seen is older than this many days, per the export's own clock. */
    quiet_30d: number;
  };
  logins: {
    parsed: number;
    malformed: number;
    skipped: number;
    by_account_kind: Record<string, number>;
    /** Devices with at least one logon row of any kind. */
    devices_with_logins: number;
    /**
     * Devices where the top two *person* accounts are within one login of each other — the
     * shared machines where "whose is this" has no single answer and must not be decided.
     */
    near_ties: number;
  };
  join: {
    /** Nexthink device_names resolved to an asset via hardware_asset_id (or display_name). */
    matched: number;
    /** Nexthink sees it, the map has never heard of it — candidates for creation. */
    unknown_to_map: string[];
    /**
     * Assets of a type Nexthink could see, absent from this export. Because Nexthink ages
     * inactive devices out entirely, absence is the "nobody has seen this" signal — but it
     * also catches anything simply outside the exported entities, so it is a question, not
     * a verdict.
     */
    never_seen_by_nexthink: number;
    /** Total assets of a Nexthink-visible type, for reading the two numbers above against. */
    visible_type_assets: number;
  };
  /**
   * Device names the PREVIOUS import had and this one does not.
   *
   * The only lifecycle signal this source produces that a single snapshot cannot: Nexthink ages
   * long-inactive devices out of the export entirely, so a retired machine disappears rather than
   * going stale. Null when there is no earlier recorded run to compare against — which is not the
   * same as "nothing disappeared", and the report has to say so.
   *
   * It is a question, not a verdict: a device also drops out if it was moved to an entity outside
   * the export's filter, or if someone scoped the query differently by hand.
   */
  gone_since_last_import: { device_names: string[]; previous_run_at: Date } | null;
}

/** What a device source yields, whether it was a CSV file or the NQL API. */
export type NexthinkDeviceInput = NexthinkParseResult<NexthinkDeviceRow> & {
  unparseable_dates: number;
};

/**
 * Replaces both tables with the parsed rows, and measures the join either way.
 *
 * Takes parsed rows rather than CSV text, so the hand-taken export and the NQL API meet here and
 * nowhere later. It used to take the two CSV strings, which meant the API path would have had to
 * either fake a CSV or duplicate every count below — and two code paths computing "how many
 * devices are on Windows 11" is how the two answers start to differ.
 *
 * The two deletes and both inserts run in one transaction: a half-replaced pair of tables
 * would have a device list from one export and logons from another, and every report across
 * the two would be quietly wrong rather than obviously broken.
 */
export async function planNexthinkImport(input: {
  devices: NexthinkDeviceInput | null;
  logins: NexthinkParseResult<NexthinkLoginRow> | null;
  apply: boolean;
  /** Cut-off for the "quiet" count, in days. Defaults to 30. */
  quietDays?: number;
  /** Recorded in the import ledger. `system` for a scheduled run. */
  by?: string;
}): Promise<NexthinkImportPlan> {
  const quietDays = input.quietDays ?? 30;

  const devicesParsed = input.devices
    ?? { rows: [], malformed: 0, skipped: 0, unparseable_dates: 0 };
  const loginsParsed = input.logins ?? { rows: [], malformed: 0, skipped: 0 };

  const byEntity: Record<string, { total: number; windows_11: number }> = {};
  for (const d of devicesParsed.rows) {
    const key = d.entity ?? '(none)';
    byEntity[key] = byEntity[key] ?? { total: 0, windows_11: 0 };
    byEntity[key].total++;
    if (d.os_name && /windows 11/i.test(d.os_name)) byEntity[key].windows_11++;
  }

  const quietBefore = new Date(Date.now() - quietDays * 24 * 60 * 60 * 1000);
  const quiet = devicesParsed.rows.filter((d) => d.last_seen && d.last_seen < quietBefore).length;

  const byKind: Record<string, number> = {};
  for (const l of loginsParsed.rows) {
    byKind[l.account_kind] = (byKind[l.account_kind] ?? 0) + 1;
  }

  // Near-ties among named people only: an admin account outnumbering a user says nothing about
  // whose desk it is.
  const personsByDevice = new Map<string, number[]>();
  for (const l of loginsParsed.rows) {
    if (l.account_kind !== 'person') continue;
    const list = personsByDevice.get(l.device_name) ?? [];
    list.push(l.logins);
    personsByDevice.set(l.device_name, list);
  }
  let nearTies = 0;
  for (const counts of personsByDevice.values()) {
    if (counts.length < 2) continue;
    const [first, second] = counts.sort((a, b) => b - a);
    if (first - second <= 1) nearTies++;
  }

  /**
   * The join is on `hardware_asset_id`, NOT on `id`.
   *
   * `Asset.id` is a generated uuid; the HWA number lives in `hardware_asset_id` (with a
   * filtered index on it). Binding "HWA16653" against the uuid primary key does not merely
   * fail to match — SQL Server rejects the parameter outright with "Invalid GUID", which is
   * how this was found. `record-replacement.ts` resolves an HWA the same way, falling back to
   * `display_name` because not every asset has `hardware_asset_id` populated; the same
   * fallback is applied here so both agree on what "the asset for this HWA" means.
   *
   * Matching is case-insensitive by virtue of the database collation, and the Nexthink export
   * is consistently upper-case anyway.
   */
  const assetRepo = AppDataSource.getRepository(Asset);
  const deviceNames = devicesParsed.rows.map((d) => d.device_name);
  const matchedNames = new Set<string>();
  for (const chunk of chunked(deviceNames, LOOKUP_CHUNK)) {
    const byHwa = await assetRepo.find({
      where: { hardware_asset_id: In(chunk) },
      select: { hardware_asset_id: true },
    });
    for (const a of byHwa) if (a.hardware_asset_id) matchedNames.add(a.hardware_asset_id);
    const stillMissing = chunk.filter((n) => !matchedNames.has(n));
    if (stillMissing.length > 0) {
      const byName = await assetRepo.find({
        where: { display_name: In(stillMissing) },
        select: { display_name: true },
      });
      for (const a of byName) matchedNames.add(a.display_name);
    }
  }
  const unknownToMap = deviceNames.filter((n) => !matchedNames.has(n));

  const visibleTypeAssets = await assetRepo.find({
    where: { asset_type: In([...NEXTHINK_VISIBLE_ASSET_TYPES]) },
    select: { id: true, hardware_asset_id: true, display_name: true },
  });
  const exported = new Set(deviceNames);
  const neverSeen = visibleTypeAssets.filter(
    (a) => !exported.has(a.hardware_asset_id ?? '') && !exported.has(a.display_name),
  ).length;

  /**
   * Computed BEFORE anything is recorded, so "the previous run" is unambiguous. Done on a dry run
   * too: what disappeared is exactly the kind of thing worth seeing before deciding to overwrite
   * the table with a snapshot that no longer contains it.
   */
  const deviceNamesForLedger = devicesParsed.rows.map((d) => d.device_name);
  const delta = devicesParsed.rows.length > 0
    ? await keyDeltaAgainstLastRun('nexthink-devices', deviceNamesForLedger)
    : null;

  if (input.apply && (devicesParsed.rows.length > 0 || loginsParsed.rows.length > 0)) {
    const importedAt = new Date();
    await AppDataSource.transaction(async (manager) => {
      if (devicesParsed.rows.length > 0) {
        await manager.getRepository(NexthinkDeviceSnapshot).clear();
        for (const chunk of chunked(devicesParsed.rows, DEVICE_INSERT_CHUNK)) {
          await manager
            .getRepository(NexthinkDeviceSnapshot)
            .insert(chunk.map((d) => ({ ...d, imported_at: importedAt })));
        }
      }
      if (loginsParsed.rows.length > 0) {
        await manager.getRepository(NexthinkLoginSnapshot).clear();
        for (const chunk of chunked(loginsParsed.rows, LOGIN_INSERT_CHUNK)) {
          await manager
            .getRepository(NexthinkLoginSnapshot)
            .insert(chunk.map((l) => ({ ...l, imported_at: importedAt })));
        }
      }
    });

    /**
     * After the transaction, deliberately outside it: the ledger describes an import that has
     * already happened, and failing to write it must not roll back the data it describes.
     * `recordImportRun` swallows its own errors for the same reason.
     */
    if (devicesParsed.rows.length > 0) {
      await recordImportRun({
        source: 'nexthink-devices',
        rowCount: devicesParsed.rows.length,
        // The export's own newest sighting is the closest thing to "when this data was true".
        takenAt: devicesParsed.rows.reduce<Date | null>(
          (max, d) => (d.last_seen && (!max || d.last_seen > max) ? d.last_seen : max), null,
        ),
        counts: delta ? { created: delta.appeared.length, gone: delta.disappeared.length } : null,
        presentKeys: deviceNamesForLedger,
        detail: { entities: Object.keys(byEntity) },
        by: input.by,
      });
    }
    if (loginsParsed.rows.length > 0) {
      // No present_keys: absence of a logon row means nobody signed in, which is ordinary for a
      // shop-floor machine and says nothing about whether the device exists.
      await recordImportRun({
        source: 'nexthink-logins',
        rowCount: loginsParsed.rows.length,
        detail: { devices_with_logins: new Set(loginsParsed.rows.map((l) => l.device_name)).size },
        by: input.by,
      });
    }
  }

  return {
    applied: input.apply,
    devices: {
      parsed: devicesParsed.rows.length,
      malformed: devicesParsed.malformed,
      skipped: devicesParsed.skipped,
      unparseable_dates: devicesParsed.unparseable_dates,
      by_entity: byEntity,
      quiet_30d: quiet,
    },
    logins: {
      parsed: loginsParsed.rows.length,
      malformed: loginsParsed.malformed,
      skipped: loginsParsed.skipped,
      by_account_kind: byKind,
      devices_with_logins: new Set(loginsParsed.rows.map((l) => l.device_name)).size,
      near_ties: nearTies,
    },
    join: {
      matched: matchedNames.size,
      unknown_to_map: unknownToMap,
      never_seen_by_nexthink: neverSeen,
      visible_type_assets: visibleTypeAssets.length,
    },
    gone_since_last_import: delta && delta.previous_run_at
      ? { device_names: delta.disappeared, previous_run_at: delta.previous_run_at }
      : null,
  };
}
