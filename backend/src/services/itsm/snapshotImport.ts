/**
 * snapshotImport.ts — Loading an ITSM export, as a plan you can look at first.
 *
 * The mapping and the joins were previously inside `scripts/import-itsm-snapshot.ts`,
 * which read three files off the VM's disk and printed to a console. That made the whole
 * reconciliation round require a terminal on the server, which is how a monthly job
 * becomes a quarterly one. The logic lives here so the same code can answer an upload
 * from the browser, and the script keeps its file-reading and printing.
 *
 * ── Why the preview matters more than usual ─────────────────────────────────────
 * This import REPLACES the table: an ITSM export is a snapshot, not a set of edits, and
 * anything absent from it is absent from ITSM. That is the correct semantic and also a
 * destructive one, so the plan says what the replacement would change — what is new, what
 * has disappeared, what changed on the fields anyone acts on. "Disappeared" is not a
 * curiosity: those are the records that become `verify-disposal` tasks.
 *
 * ── What it never does ──────────────────────────────────────────────────────────
 * Reads nothing from ITSM (the export is handed to it) and writes nothing anywhere unless
 * `apply` is set. Never touches `assets` — linking a snapshot row to an asset is a
 * separate, human decision (see inventoryMatch.ts).
 */
import { AppDataSource } from '../../config/database';
import { ItsmHardwareSnapshot } from '../../entities/ItsmHardwareSnapshot.entity';
import { chunkForEntity } from '../../utils/mssqlBatch';

export type SnapshotRow = Record<string, unknown>;

const str = (v: unknown): string | null => (v == null || v === '' ? null : String(v));

export interface CatalogItemRef {
  id: string;
  displayName: string;
  type: string | null;
}

/**
 * Display names are joined on, so they are compared with the same tolerance the ITSM
 * exports need: case and whitespace differ between the Hardware Asset payload and the
 * Catalog Items CSV for the same item.
 */
export function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** The ITSM grid's "Export to CSV" quotes every field and separates with `","`. */
function parseCsvLine(line: string): string[] {
  let s = line;
  if (s.startsWith('"')) s = s.slice(1);
  if (s.endsWith('"')) s = s.slice(0, -1);
  return s.split('","');
}

/**
 * The Hardware Assets view, exported straight from the ITSM portal's own "Export to CSV".
 *
 * Worth accepting because of who can produce it: the OData export needs PowerShell on a
 * domain-joined machine, while this is two clicks in the portal by whoever is already
 * looking at the list. Same records — 1074 in the export this was written against.
 *
 * The columns are mapped onto the names `mapRow` already understands, so the whole tested
 * import path is reused rather than duplicated. A row has no GUID here; `mapRow` falls back
 * to the HWA id, which is unique anyway and is what every other table joins on.
 *
 * The export quotes every data field but not the header, and it does not escape a quote
 * inside a value (`IPC 19" Rack`). Splitting quoted fields on `","` survives both, which is
 * why `parseCsvLine` is reused here rather than replaced with something stricter that would
 * reject the file outright.
 */
const PORTAL_COLUMNS: Record<string, string> = {
  '#id': 'HardwareAssetID',
  'display name': 'DisplayName',
  status: 'Status',
  'serial number': 'SerialNumber',
  'mac address': 'MACAddress',
  'company asset tag': 'AssetTag',
  'catalog item': 'CatalogItem',
  person: 'AssignedPersonName',
  location: 'Location',
  'last modified': 'ItsmModifiedAt',
};

export interface PortalCsvResult {
  rows: Array<Record<string, string>>;
  /** Rows whose field count does not match the header — reported, never guessed at. */
  malformed: number;
  /** Header columns this parser has no use for. Named so a changed export is noticed. */
  ignored: string[];
}

export function parsePortalHardwareCsv(text: string): PortalCsvResult {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) return { rows: [], malformed: 0, ignored: [] };

  // The header is not quoted in this export, so it is split plainly.
  const header = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, '').toLowerCase());
  const mapped = header.map((h) => PORTAL_COLUMNS[h]);
  const ignored = header.filter((_, i) => !mapped[i]);
  if (!mapped.includes('HardwareAssetID')) {
    throw new Error('That CSV has no "#ID" column — is it the Hardware Assets export?');
  }

  const rows: Array<Record<string, string>> = [];
  let malformed = 0;
  for (const line of lines.slice(1)) {
    const fields = parseCsvLine(line);
    if (fields.length !== header.length) { malformed++; continue; }
    const row: Record<string, string> = {};
    mapped.forEach((name, i) => { if (name) row[name] = fields[i].trim(); });
    if (!row.HardwareAssetID) { malformed++; continue; }
    rows.push(row);
  }
  return { rows, malformed, ignored };
}

export interface CsvParseResult<T> {
  map: Map<string, T>;
  /** Rows with an unexpected field count — reported rather than guessed at. */
  malformed: number;
}

/**
 * Catalog items by normalised display name.
 * Expected columns: #ID, Display Name, Status, Type, Time Added, Last Modified.
 */
export function parseCatalogItems(text: string): CsvParseResult<CatalogItemRef> {
  const map = new Map<string, CatalogItemRef>();
  let malformed = 0;
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  for (const line of lines.slice(1)) {
    const fields = parseCsvLine(line);
    if (fields.length !== 6) { malformed++; continue; }
    const [id, displayName, , type] = fields;
    if (!id || !displayName) continue;
    map.set(normalizeName(displayName), { id, displayName, type: type || null });
  }
  return { map, malformed };
}

/**
 * Person login ids by normalised display name.
 * Expected columns: #ID, Display Name, Status, Principal Name, Logon Name, AD Account,
 * Cost Center, Location, Organization, Is Real Person, Time Added, Last Modified.
 *
 * Joined on the display name because the Hardware Asset payload's PersonId is an internal
 * GUID with no counterpart in this CSV — only the login-style #ID appears in both worlds.
 * If two rows share a display name the first wins; the export's own order decides.
 */
export function parsePersons(text: string): CsvParseResult<string> {
  const map = new Map<string, string>();
  let malformed = 0;
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  for (const line of lines.slice(1)) {
    const fields = parseCsvLine(line);
    if (fields.length !== 12) { malformed++; continue; }
    const [id, displayName] = fields;
    if (!id || !displayName) continue;
    const key = normalizeName(displayName);
    if (!map.has(key)) map.set(key, id);
  }
  return { map, malformed };
}

/**
 * Controlled Catalog Item "Type" values (confirmed against the real MMH export,
 * 2026-07-27) -> the app's asset_type buckets. Anything not listed falls back to 'other';
 * there is no app bucket for accessories, docks, tablets, headsets and the like.
 */
const ITSM_TYPE_TO_ASSET_TYPE: Record<string, string> = {
  Notebook: 'laptop',
  Printer: 'printer',
  Workstation: 'workstation',
  Monitor: 'monitor',
  Server: 'server',
  Smartphone: 'phone',
  Telephone: 'phone',
  Scanner: 'scanner',
  Camera: 'camera',
  'Network Device': 'network',
  // Added after measuring the real catalogue against this table rather than reading it:
  // these are the Type values it actually uses, and without them a re-import would have
  // dropped the type of 569 records to 'other' — 237 desktops, 197 phones, 69 IPCs. The
  // table it was written against evidently used different words.
  Desktop: 'workstation',
  'Generic PC': 'workstation',
  Phone: 'phone',
  IPC: 'ipc',
  'Generic IPC': 'ipc',
  Dockingstation: 'dock',
  // No app bucket for these, and inventing one would be worse than 'other': Tablet,
  // USB Stick, Accessory, Microscope, Security Device.
};

/** Switch, router or access point, told apart by what the name says. */
function classifyNetworkDevice(displayName: string): string {
  const n = displayName.toLowerCase();
  if (/(^|[^a-z])(sw|switch)([^a-z]|$)/.test(n)) return 'switch';
  if (/(^|[^a-z])(ap|wlan|wifi|access.?point)([^a-z]|$)/.test(n)) return 'access_point';
  if (/(^|[^a-z])(rt|router|fw|firewall)([^a-z]|$)/.test(n)) return 'router';
  return 'network';
}

/**
 * What the catalogue NAME says the product is, where it says it unambiguously.
 *
 * The `Type` dropdown on a catalogue item is set by hand and has been set wrongly: the item
 * `DELL CAD Docking Station USB-C (WD19DCS)` carries Type = Monitor in Alemba, which put
 * five docking stations into the monitor count — and the monitor count is what a screen
 * redistribution is planned from. `Aruba Switches` has no usable Type at all, so thirteen
 * switches sat in 'other'.
 *
 * The name is the more reliable of the two here, so it wins. Kept to words that name a
 * product outright: `docking station` requires the noun, not the adjective, and a name that
 * also says "monitor" is left to the Type — a docking monitor is a monitor.
 *
 * Nothing here writes to ITSM. The mistake stays in Alemba; the app just stops repeating it.
 */
const NAME_CATEGORIES: Array<{ word: RegExp; type: string; definitive: boolean }> = [
  { word: /dock(ing)?\s*station/i, type: 'dock', definitive: true },
  { word: /\bswitch(es)?\b/i, type: 'switch', definitive: true },
  { word: /\b(firewall|fortigate)\b/i, type: 'router', definitive: true },
  // The rest are here only so a name that mentions two categories can be spotted and left
  // alone. `Switch / Server 19" Rack` is a rack; reading "Switch" out of it turned 23 of
  // them into switches on the first dry run of this rule, which is what it is for.
  { word: /\bmonitor\b/i, type: 'monitor', definitive: false },
  { word: /\bserver\b/i, type: 'server', definitive: false },
  { word: /\b(notebook|laptop)\b/i, type: 'laptop', definitive: false },
  { word: /\bworkstation\b/i, type: 'workstation', definitive: false },
  { word: /\brack\b/i, type: 'rack', definitive: false },
];

export function classifyFromCatalogName(catalogDisplayName: string | null): string | null {
  const name = (catalogDisplayName ?? '').trim();
  if (!name) return null;
  const named = NAME_CATEGORIES.filter((c) => c.word.test(name));
  const distinct = new Set(named.map((c) => c.type));
  // Two categories in one name means the name is describing something else — a rack that
  // holds them, a bundle — and the Type field is the better guide.
  if (distinct.size !== 1) return null;
  return named[0].definitive ? named[0].type : null;
}

export function classifyAssetType(itsmType: string | null, catalogDisplayName: string | null): string {
  const mapped = itsmType ? ITSM_TYPE_TO_ASSET_TYPE[itsmType] : undefined;
  if (mapped === 'network' && catalogDisplayName) return classifyNetworkDevice(catalogDisplayName);
  return classifyFromCatalogName(catalogDisplayName) ?? mapped ?? 'other';
}

/** The first word of a catalogue name is the make, in this catalogue's conventions. */
export function deriveManufacturer(catalogDisplayName: string | null): string | null {
  if (!catalogDisplayName) return null;
  const first = catalogDisplayName.trim().split(/\s+/)[0];
  return first || null;
}

export function mapRow(
  r: SnapshotRow,
  now: Date,
  catalogItems: Map<string, CatalogItemRef>,
  persons: Map<string, string>,
): Partial<ItsmHardwareSnapshot> | null {
  const itsm_id = str(r.HardwareAssetID) ?? str(r.itsm_id);
  const itsm_guid = str(r.Guid) ?? str(r.itsm_guid) ?? itsm_id;
  if (!itsm_id || !itsm_guid) return null;

  const catalog_itsm_id = str(r.CatalogItemId) ?? str(r.catalog_itsm_id);
  const catalog_item_name = str(r.CatalogItem) ?? str(r.catalog_item_name);
  // Joined by display name, not by catalog_itsm_id: that id is an internal GUID with no
  // counterpart in the CSV. It is still stored as-is; it is just not the join key.
  const catalogRef = catalog_item_name ? catalogItems.get(normalizeName(catalog_item_name)) : undefined;
  const catalogDisplayName = catalog_item_name ?? catalogRef?.displayName ?? null;
  const catalogType = catalogRef?.type ?? null;

  const assigned_person_name = str(r.AssignedPersonName) ?? str(r.assigned_person_name);

  return {
    itsm_guid,
    itsm_id,
    display_name: str(r.DisplayName) ?? str(r.display_name),
    serial_number: str(r.SerialNumber) ?? str(r.serial_number),
    asset_tag: str(r.AssetTag) ?? str(r.asset_tag),
    mac_address: str(r.MACAddress) ?? str(r.mac_address),
    status: str(r.Status) ?? str(r.status),
    location_name: str(r.Location) ?? str(r.location_name),
    catalog_item_name,
    catalog_itsm_id,
    asset_type: classifyAssetType(catalogType, catalogDisplayName),
    manufacturer: deriveManufacturer(catalogDisplayName),
    assigned_person_name,
    person_itsm_id: str(r.PersonId) ?? str(r.person_itsm_id),
    person_id: assigned_person_name ? persons.get(normalizeName(assigned_person_name)) ?? null : null,
    itsm_modified_at: str(r.ModifiedDate) ?? str(r.itsm_modified_at),
    imported_at: now,
  };
}

/** Fields worth telling someone changed. Timestamps and ids are not; these are. */
const COMPARED_FIELDS: Array<keyof ItsmHardwareSnapshot> = [
  'display_name', 'serial_number', 'asset_tag', 'mac_address', 'status',
  'location_name', 'catalog_item_name', 'assigned_person_name',
];

export interface SnapshotChange {
  itsm_id: string;
  display_name: string | null;
  /** `field: "was" -> "now"`, only for fields that actually differ. */
  changes: string[];
}

export interface SnapshotImportPlan {
  /** Rows in the uploaded hardware export. */
  parsed: number;
  /** Rows without a HardwareAssetID or Guid — nothing can be done with them. */
  skipped: number;
  /** In the export, not in the table today. */
  added: Array<{ itsm_id: string; display_name: string | null }>;
  /**
   * In the table today, absent from the export. These become `verify-disposal` tasks:
   * ITSM no longer has them, so either the device is gone or the record was retired.
   */
  removed: Array<{ itsm_id: string; display_name: string | null }>;
  changed: SnapshotChange[];
  unchanged: number;
  /** How well the two optional CSVs did their job. */
  enrichment: {
    catalog_items: number;
    catalog_malformed: number;
    persons: number;
    persons_malformed: number;
    /** Excludes the 'other' fallback, which says nothing about whether the join worked. */
    classified: number;
    /**
     * Rows whose already-known type was kept because this run could not derive one — a
     * stale Catalog Items CSV, usually. Reported rather than silent: it is the difference
     * between "nothing changed" and "a hundred classifications were nearly lost".
     */
    type_kept: number;
    manufacturer: number;
    person_id_resolved: number;
    with_person_name: number;
  };
  applied: boolean;
}

export interface SnapshotImportInput {
  /** The Hardware Asset export, already parsed from JSON. */
  hardware: SnapshotRow[];
  /** Catalog Items CSV text. Without it, asset_type and manufacturer stay unenriched. */
  catalogItemsCsv?: string | null;
  /** Persons CSV text. Without it, person_id stays null. */
  personsCsv?: string | null;
  apply: boolean;
}

/**
 * Works out what loading this export would change, and — with `apply` — loads it.
 *
 * The write replaces the table inside one transaction: a half-applied snapshot would be a
 * mixture of two points in time, which is worse than either.
 */
export async function planSnapshotImport(input: SnapshotImportInput): Promise<SnapshotImportPlan> {
  const catalog = input.catalogItemsCsv ? parseCatalogItems(input.catalogItemsCsv) : { map: new Map<string, CatalogItemRef>(), malformed: 0 };
  const persons = input.personsCsv ? parsePersons(input.personsCsv) : { map: new Map<string, string>(), malformed: 0 };

  const now = new Date();
  const mapped = input.hardware
    .map((r) => mapRow(r, now, catalog.map, persons.map))
    .filter((r): r is Partial<ItsmHardwareSnapshot> => r !== null);

  const repo = AppDataSource.getRepository(ItsmHardwareSnapshot);
  const existing = await repo.find();
  const existingById = new Map(existing.map((r) => [r.itsm_id.toUpperCase(), r]));
  const incomingIds = new Set(mapped.map((r) => r.itsm_id!.toUpperCase()));

  const added: SnapshotImportPlan['added'] = [];
  const changed: SnapshotChange[] = [];
  let unchanged = 0;
  let typeKept = 0;

  for (const row of mapped) {
    const before = existingById.get(row.itsm_id!.toUpperCase());
    if (!before) {
      added.push({ itsm_id: row.itsm_id!, display_name: row.display_name ?? null });
      continue;
    }
    /**
     * A type already worked out is not thrown away because this run could not work it out.
     *
     * `asset_type` is derived, not exported: it comes from the Catalog Items CSV, which is a
     * separate hand-made export and goes stale on its own schedule. So a device whose
     * catalogue item is missing from today's CSV would come back as 'other' — and since the
     * import is a full replace, that is a silent loss of a hundred records' classification
     * on an import that reports "1021 unchanged". Measured, not imagined: it happened on the
     * first dry run of the current export.
     *
     * Only ever keeps; a run that DOES derive a type overwrites the old one as normal.
     */
    if ((row.asset_type ?? 'other') === 'other' && before.asset_type && before.asset_type !== 'other') {
      row.asset_type = before.asset_type;
      typeKept++;
    }
    const diffs: string[] = [];
    for (const field of COMPARED_FIELDS) {
      const was = (before[field] ?? null) as string | null;
      const now_ = (row[field] ?? null) as string | null;
      if ((was ?? '') !== (now_ ?? '')) diffs.push(`${field}: ${was ?? '—'} → ${now_ ?? '—'}`);
    }
    if (diffs.length > 0) changed.push({ itsm_id: row.itsm_id!, display_name: row.display_name ?? null, changes: diffs });
    else unchanged++;
  }

  const removed = existing
    .filter((r) => !incomingIds.has(r.itsm_id.toUpperCase()))
    .map((r) => ({ itsm_id: r.itsm_id, display_name: r.display_name }));

  const plan: SnapshotImportPlan = {
    parsed: input.hardware.length,
    skipped: input.hardware.length - mapped.length,
    added,
    removed,
    changed,
    unchanged,
    enrichment: {
      catalog_items: catalog.map.size,
      catalog_malformed: catalog.malformed,
      persons: persons.map.size,
      persons_malformed: persons.malformed,
      classified: mapped.filter((r) => r.asset_type && r.asset_type !== 'other').length,
      type_kept: typeKept,
      manufacturer: mapped.filter((r) => r.manufacturer).length,
      person_id_resolved: mapped.filter((r) => r.person_id).length,
      with_person_name: mapped.filter((r) => r.assigned_person_name).length,
    },
    applied: false,
  };

  if (!input.apply || mapped.length === 0) return plan;

  await AppDataSource.transaction(async (manager) => {
    await manager.clear(ItsmHardwareSnapshot);
    const txRepo = manager.getRepository(ItsmHardwareSnapshot);
    // MSSQL caps a statement at 2100 parameters — see utils/mssqlBatch.ts. Derived from
    // entity metadata so adding a column cannot silently overflow it.
    const chunk = chunkForEntity(ItsmHardwareSnapshot);
    for (let i = 0; i < mapped.length; i += chunk) {
      await txRepo.insert(mapped.slice(i, i + chunk) as ItsmHardwareSnapshot[]);
    }
  });

  return { ...plan, applied: true };
}
