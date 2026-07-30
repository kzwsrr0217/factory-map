/**
 * import-itsm-snapshot.ts — Idempotent, full-replace importer for the MMH-scoped
 * ITSM (Alemba/Operaio) hardware snapshot.
 *
 * The backend has no working path to call the real ITSM View API from inside
 * its Podman container (see ItsmHardwareSnapshot.entity.ts — the only proven
 * access pattern today is Windows Integrated/Kerberos SSO from a domain-joined
 * machine). So instead of a live HTTP adapter, this script reads the JSON that
 * `ops/itsm/Export-ItsmMmhSnapshot.ps1` produces — one
 * `$filter=contains(HardwareAssetIsAssignedToLocation/DisplayName/Value,'MMH')`
 * OData call, run outside the container — and replaces the contents of
 * `itsm_hardware_snapshot` with it.
 *
 * Also joins against an optional `hardware-catalog-items.csv` (exported by
 * hand from the ITSM web UI's "Hardware Catalog Items" grid — Asset Management
 * > Hardware Asset Management > Hardware Catalog Items > Export to CSV) to
 * resolve two fields that aren't queryable any other way in this ITSM
 * instance:
 *   - `asset_type`: the Catalog Item's own "Type" column (Desktop, Notebook,
 *     Server, IPC, ...), mapped to the app's asset-type buckets. "Network
 *     Device" is ambiguous (covers switches and access points alike) so it's
 *     disambiguated by keyword against the catalog item's display name.
 *   - `manufacturer`: NOT an exposed field anywhere in this ITSM instance
 *     (confirmed: not on the Hardware Asset, not on the Catalog Items grid/
 *     CSV, only visible on each Catalog Item's own individual record form,
 *     which isn't bulk-queryable without an Alemba admin widening that view's
 *     projection). Derived instead from the first word of the catalog item's
 *     display name ("DELL Optiplex..." -> "DELL") — an approximation, not an
 *     authoritative field.
 * Model and OS type/version are not populated at all: Model isn't in the
 * Catalog Items CSV either, and OS isn't tracked as a queryable
 * field/relationship anywhere in this ITSM instance (its Software Assets
 * list is applications only, no OS entry).
 *
 * Also joins against an optional `persons.csv` (ITSM web UI: Asset
 * Management > Master Data > Persons, filtered to MMH > Export to CSV) to
 * resolve `person_id` — the real ITSM login-style ID (e.g. "mmhgeza"), which
 * like Manufacturer isn't exposed on the Hardware Asset's nav expansion
 * (only the Person's GUID + display name are). Same display-name join
 * rationale as Catalog Items.
 *
 * Unlike import-master-data.ts (which merges/upserts a soft-join reference
 * table), this is a **full replace**: the table always reflects "MMH hardware
 * assets as of the last export run". A device that moves off-MMH or is
 * retired in ITSM should disappear on the next import rather than linger.
 *
 * Run inside the backend container, pointing at the directory holding the
 * exported JSON file (default name `itsm-mmh-hardware.json`) and, optionally,
 * `hardware-catalog-items.csv`:
 *   docker exec factory-map-backend npx ts-node src/scripts/import-itsm-snapshot.ts /path/to/export/dir
 */
import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { AppDataSource } from '../config/database';
import { ItsmHardwareSnapshot } from '../entities/ItsmHardwareSnapshot.entity';
import { chunkForEntity } from '../utils/mssqlBatch';

type Row = Record<string, unknown>;

const str = (v: unknown): string | null => (v == null || v === '' ? null : String(v));

const HARDWARE_FILE = 'itsm-mmh-hardware.json';
const CATALOG_ITEMS_FILE = 'hardware-catalog-items.csv';
const PERSONS_FILE = 'persons.csv';

// Reads a bare `[...]` array or a `{ items: [...] }` / `{ Items: [...] }` wrapper
// (matching the shape Alemba's GetViewData itself returns, which the PS export
// script may pass through as-is). Strips a leading UTF-8 BOM (PowerShell's
// `Out-File -Encoding utf8` writes one, which JSON.parse rejects).
function readRows(dir: string, file: string): Row[] {
  const full = path.join(dir, file);
  if (!fs.existsSync(full)) return [];
  const text = fs.readFileSync(full, 'utf8').replace(/^﻿/, '');
  const parsed = JSON.parse(text);
  if (Array.isArray(parsed)) return parsed as Row[];
  const rows = (parsed.items ?? parsed.Items ?? []) as Row[];
  return Array.isArray(rows) ? rows : [];
}

// ── Hardware Catalog Items reference (CSV, exported by hand — see header) ──

interface CatalogItemRef {
  id: string;
  displayName: string;
  type: string | null;
}

// Normalises a catalog item display name for joining — the Hardware Asset
// payload's CatalogItemId is an internal GUID with no counterpart in this
// CSV (which keys by the human-readable HCI#### id instead), so the join
// has to go through the display name. Verified against the real export: 8
// of 618 names collide, but every colliding pair shares the same Type, so a
// name-keyed lookup is safe for classification purposes even though it
// isn't a true 1:1 identity join.
function normalizeName(name: string): string {
  return name.trim().toLowerCase();
}

// This export's fields never contain a literal comma, but many display names
// contain an unescaped inch-mark quote (e.g. `Monitor 24"`, `19" Rack`) that
// breaks a naive quote-toggling CSV parser — confirmed against the real
// export, ~20 of 618 rows (mostly Monitors) would otherwise be lost.
// Splitting on the literal `","` delimiter instead handles this correctly,
// as long as no field contains that exact 3-char sequence (true here).
function parseCsvLine(line: string): string[] {
  let s = line;
  if (s.startsWith('"')) s = s.slice(1);
  if (s.endsWith('"')) s = s.slice(0, -1);
  return s.split('","');
}

// Expected columns: #ID, Display Name, Status, Type, Time Added, Last Modified
// (exactly what the ITSM grid's "Export to CSV" produces). A row with a
// different field count is logged and skipped rather than guessed at.
function readCatalogItems(dir: string): Map<string, CatalogItemRef> {
  const map = new Map<string, CatalogItemRef>();
  const full = path.join(dir, CATALOG_ITEMS_FILE);
  if (!fs.existsSync(full)) {
    console.log(`  – ${CATALOG_ITEMS_FILE}: not present, skipping asset_type/manufacturer enrichment`);
    return map;
  }
  const text = fs.readFileSync(full, 'utf8').replace(/^﻿/, '');
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  let skipped = 0;
  for (const line of lines.slice(1)) {
    const fields = parseCsvLine(line);
    if (fields.length !== 6) { skipped++; continue; }
    const [id, displayName, , type] = fields;
    if (!id || !displayName) continue;
    map.set(normalizeName(displayName), { id, displayName, type: type || null });
  }
  console.log(`  ✔ ${CATALOG_ITEMS_FILE}: ${map.size} catalog items loaded${skipped > 0 ? ` (${skipped} malformed row(s) skipped)` : ''}`);
  return map;
}

// Expected columns: #ID, Display Name, Status, Principal Name, Logon Name,
// AD Account, Cost Center, Location, Organization, Is Real Person, Time
// Added, Last Modified (ITSM web UI: Asset Management > Master Data >
// Persons > Export to CSV). Same display-name join rationale as Catalog
// Items — the Hardware Asset payload's PersonId is an internal GUID with no
// counterpart here, only the login-style #ID (e.g. "mmhgeza") does.
function readPersons(dir: string): Map<string, string> {
  const map = new Map<string, string>();
  const full = path.join(dir, PERSONS_FILE);
  if (!fs.existsSync(full)) {
    console.log(`  – ${PERSONS_FILE}: not present, skipping person_id enrichment`);
    return map;
  }
  const text = fs.readFileSync(full, 'utf8').replace(/^﻿/, '');
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  let skipped = 0;
  for (const line of lines.slice(1)) {
    const fields = parseCsvLine(line);
    if (fields.length !== 12) { skipped++; continue; }
    const [id, displayName] = fields;
    if (!id || !displayName) continue;
    // Same collision caveat as Catalog Items — if two rows ever share a
    // display name, first one wins (whichever the export lists first).
    const key = normalizeName(displayName);
    if (!map.has(key)) map.set(key, id);
  }
  console.log(`  ✔ ${PERSONS_FILE}: ${map.size} persons loaded${skipped > 0 ? ` (${skipped} malformed row(s) skipped)` : ''}`);
  return map;
}

// Controlled Catalog Item "Type" values (confirmed against the real MMH
// export, 2026-07-27) -> the app's asset_type buckets (see
// frontend/src/utils/assetTypes.ts ASSET_TYPE_MAP). Anything not listed here
// (Accessory, Dockingstation, Tablet, Headset, Mouse, Microscope, Keyboard,
// USB Stick, Security Device, Projector, Arbeitsbekleidung & Zubehör, blank)
// falls back to 'other' — there's no app bucket for them today.
const ITSM_TYPE_TO_ASSET_TYPE: Record<string, string> = {
  Notebook: 'laptop',
  Printer: 'printer',
  Monitor: 'monitor',
  Phone: 'phone',
  Desktop: 'workstation',
  'Generic PC': 'workstation',
  'Generic IPC': 'ipc',
  IPC: 'ipc',
  'IPC Zubehör': 'ipc',
  Server: 'server',
  Scanner: 'scanner',
  Webcam: 'camera',
  'Datacenter Infrastructure': 'server',
};

// "Network Device" is too broad on its own (covers switches, APs, RFID
// readers, firewalls, ...) — disambiguate by keyword against the catalog
// item's own display name.
function classifyNetworkDevice(displayName: string): string {
  const n = displayName.toLowerCase();
  if (n.includes('switch')) return 'switch';
  if (n.includes('router') || n.includes('firewall') || n.includes('netscaler')) return 'router';
  if (n.includes('wlan') || n.includes('access point')) return 'access_point';
  return 'other';
}

// Always returns a bucket — never null/blank — so a resolved catalog item
// with an untracked or missing ITSM Type still lands on 'other' rather than
// showing as "Unknown" in the UI (the app's own fallback for an empty field).
function classifyAssetType(itsmType: string | null, catalogDisplayName: string | null): string {
  if (itsmType === 'Network Device') return classifyNetworkDevice(catalogDisplayName ?? '');
  if (itsmType && ITSM_TYPE_TO_ASSET_TYPE[itsmType]) return ITSM_TYPE_TO_ASSET_TYPE[itsmType];
  return 'other';
}

// Approximation only — see the file header. Takes the first whitespace-
// delimited token of the catalog item's display name.
function deriveManufacturer(catalogDisplayName: string | null): string | null {
  if (!catalogDisplayName) return null;
  const first = catalogDisplayName.trim().split(/\s+/)[0];
  return first || null;
}

function mapRow(
  r: Row,
  now: Date,
  catalogItems: Map<string, CatalogItemRef>,
  persons: Map<string, string>,
): Partial<ItsmHardwareSnapshot> | null {
  const itsm_id = str(r.HardwareAssetID) ?? str(r.itsm_id);
  const itsm_guid = str(r.Guid) ?? str(r.itsm_guid) ?? itsm_id;
  if (!itsm_id || !itsm_guid) return null;

  const catalog_itsm_id = str(r.CatalogItemId) ?? str(r.catalog_itsm_id);
  const catalog_item_name = str(r.CatalogItem) ?? str(r.catalog_item_name);
  // Joined by display name, not catalog_itsm_id — the Hardware Asset payload's
  // CatalogItemId is an internal GUID with no counterpart in the CSV (see
  // normalizeName). catalog_itsm_id is still stored on the row/asset
  // as-is; it's just not the join key here.
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

async function importSnapshot(dir: string): Promise<void> {
  const raw = readRows(dir, HARDWARE_FILE);
  if (raw.length === 0) {
    console.log(`  – ${HARDWARE_FILE}: not present or empty in ${dir}, nothing to import`);
    return;
  }
  const catalogItems = readCatalogItems(dir);
  const persons = readPersons(dir);

  const now = new Date();
  const rows = raw.map((r) => mapRow(r, now, catalogItems, persons)).filter((r): r is Partial<ItsmHardwareSnapshot> => r !== null);
  const skipped = raw.length - rows.length;

  await AppDataSource.transaction(async (manager) => {
    await manager.clear(ItsmHardwareSnapshot);
    const repo = manager.getRepository(ItsmHardwareSnapshot);
    // MSSQL caps a statement at 2100 parameters — see utils/mssqlBatch.ts.
    // Derived from entity metadata so adding a column can't silently overflow.
    const chunk = chunkForEntity(ItsmHardwareSnapshot);
    for (let i = 0; i < rows.length; i += chunk) {
      await repo.insert(rows.slice(i, i + chunk) as ItsmHardwareSnapshot[]);
    }
  });

  // Counts genuinely-classified rows, NOT just non-null ones —
  // classifyAssetType() always returns a bucket (falling back to 'other'), so
  // `r.asset_type` being set says nothing about whether the Catalog Items CSV
  // join actually resolved anything. Reporting that as "resolved" made a run
  // with no CSV at all still claim 100%.
  const withType = rows.filter((r) => r.asset_type && r.asset_type !== 'other').length;
  const withManufacturer = rows.filter((r) => r.manufacturer).length;
  const withPersonName = rows.filter((r) => r.assigned_person_name).length;
  const withPersonId = rows.filter((r) => r.person_id).length;
  console.log(`  ✔ itsm_hardware_snapshot: ${rows.length} rows replaced${skipped > 0 ? ` (${skipped} skipped — missing HardwareAssetID/Guid)` : ''}`);
  console.log(`    asset_type classified (excl. 'other' fallback): ${withType}/${rows.length}, manufacturer derived: ${withManufacturer}/${rows.length}`);
  console.log(`    person_id resolved: ${withPersonId}/${withPersonName} assigned-person rows`);
}

function resolveDir(): string {
  const arg = process.argv[2];
  if (!arg) {
    console.error('✖ Usage: import-itsm-snapshot.ts <export-directory>');
    process.exit(1);
  }
  return path.resolve(arg);
}

async function main(): Promise<void> {
  const dir = resolveDir();
  console.log(`📥 Importing ITSM MMH hardware snapshot from: ${dir}`);
  if (!fs.existsSync(dir)) {
    console.error(`✖ Directory not found: ${dir}`);
    process.exit(1);
  }

  await AppDataSource.initialize();
  console.log('✅ Connected to SQL Server\n');
  try {
    await importSnapshot(dir);
    console.log('\n✅ Import complete — app-owned asset data was not touched.');
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error('✖ Import failed:', err);
  process.exit(1);
});
