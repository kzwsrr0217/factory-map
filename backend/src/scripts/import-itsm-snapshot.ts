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
import { planSnapshotImport, parsePortalHardwareCsv } from '../services/itsm/snapshotImport';

type Row = Record<string, unknown>;

const HARDWARE_FILE = 'itsm-mmh-hardware.json';
/**
 * The other shape the export comes in.
 *
 * The OData call the JSON comes from needs a domain-joined machine and a working View API
 * path; the ITSM web portal's own "Export to CSV" on the Hardware Assets grid needs neither,
 * and is what has actually been used since. Same columns, different names — see
 * parsePortalHardwareCsv, which the browser upload already goes through.
 */
const HARDWARE_CSV_FILE = 'hardware-assets.csv';
const CATALOG_ITEMS_FILE = 'hardware-catalog-items.csv';
const PERSONS_FILE = 'persons.csv';

/**
 * Reads a bare `[...]` array or a `{ items: [...] }` / `{ Items: [...] }` wrapper
 * (matching the shape Alemba's GetViewData itself returns, which the PS export script may
 * pass through as-is). Strips a leading UTF-8 BOM — PowerShell's `Out-File -Encoding utf8`
 * writes one and JSON.parse rejects it.
 */
function readRows(dir: string, file: string): Row[] {
  const full = path.join(dir, file);
  if (!fs.existsSync(full)) return [];
  const text = fs.readFileSync(full, 'utf8').replace(/^﻿/, '');
  const parsed = JSON.parse(text);
  if (Array.isArray(parsed)) return parsed as Row[];
  const rows = (parsed.items ?? parsed.Items ?? []) as Row[];
  return Array.isArray(rows) ? rows : [];
}

function readTextIfPresent(dir: string, file: string): string | null {
  const full = path.join(dir, file);
  if (!fs.existsSync(full)) return null;
  return fs.readFileSync(full, 'utf8');
}

/**
 * Reads the three files and hands them to the service, which owns the mapping, the joins
 * and the write. This script is the file-reading and the printing; the same service answers
 * an upload from the browser, so there is one definition of what importing means.
 */
async function importSnapshot(dir: string, apply: boolean): Promise<void> {
  // The JSON if it is there, otherwise the portal CSV. Read in that order because the JSON
  // is the richer export; a directory holding both is a directory where somebody ran the
  // OData script, and that answer should win.
  let hardware = readRows(dir, HARDWARE_FILE);
  let csvNote = '';
  if (hardware.length === 0) {
    const csv = readTextIfPresent(dir, HARDWARE_CSV_FILE);
    if (csv) {
      const parsed = parsePortalHardwareCsv(csv);
      hardware = parsed.rows as Row[];
      csvNote = `  ✔ ${HARDWARE_CSV_FILE}: ${parsed.rows.length} row(s) read`
        + `${parsed.malformed > 0 ? `, ${parsed.malformed} skipped (wrong field count, or no HardwareAssetID)` : ''}`
        + `${parsed.ignored.length > 0 ? `\n    columns not used: ${parsed.ignored.join(', ')}` : ''}`;
    }
  }
  if (hardware.length === 0) {
    console.log(`  – neither ${HARDWARE_FILE} nor ${HARDWARE_CSV_FILE} is present or non-empty in ${dir}, nothing to import`);
    return;
  }
  if (csvNote) console.log(csvNote);
  const catalogItemsCsv = readTextIfPresent(dir, CATALOG_ITEMS_FILE);
  const personsCsv = readTextIfPresent(dir, PERSONS_FILE);
  if (!catalogItemsCsv) console.log(`  – ${CATALOG_ITEMS_FILE}: not present, skipping asset_type/manufacturer enrichment`);
  if (!personsCsv) console.log(`  – ${PERSONS_FILE}: not present, skipping person_id enrichment`);

  const plan = await planSnapshotImport({ hardware, catalogItemsCsv, personsCsv, apply });
  const e = plan.enrichment;

  if (catalogItemsCsv) {
    console.log(`  ✔ ${CATALOG_ITEMS_FILE}: ${e.catalog_items} catalog items loaded${e.catalog_malformed > 0 ? ` (${e.catalog_malformed} malformed row(s) skipped)` : ''}`);
  }
  if (personsCsv) {
    console.log(`  ✔ ${PERSONS_FILE}: ${e.persons} persons loaded${e.persons_malformed > 0 ? ` (${e.persons_malformed} malformed row(s) skipped)` : ''}`);
  }

  const loaded = plan.parsed - plan.skipped;
  console.log(`  ${apply ? '✔' : '·'} itsm_hardware_snapshot: ${loaded} rows ${apply ? 'replaced' : 'would be replaced'}${plan.skipped > 0 ? ` (${plan.skipped} skipped — missing HardwareAssetID/Guid)` : ''}`);
  // Counts genuinely-classified rows, NOT just non-null ones — classifyAssetType() always
  // returns a bucket (falling back to 'other'), so a set asset_type says nothing about
  // whether the Catalog Items join resolved anything. Reporting that as "resolved" made a
  // run with no CSV at all still claim 100%.
  console.log(`    asset_type classified (excl. 'other' fallback): ${e.classified}/${loaded}, manufacturer derived: ${e.manufacturer}/${loaded}`);
  if (e.type_kept > 0) {
    console.log(`    ${e.type_kept} row(s) kept the type they already had — this run could not derive one (stale ${CATALOG_ITEMS_FILE}?)`);
  }
  console.log(`    person_id resolved: ${e.person_id_resolved}/${e.with_person_name} assigned-person rows`);
  // What the replacement actually did to the table, which the old version never said.
  console.log(`    against the previous snapshot: ${plan.added.length} new, ${plan.removed.length} gone, ${plan.changed.length} changed, ${plan.unchanged} unchanged`);
  if (plan.removed.length > 0) {
    console.log(`    the ${plan.removed.length} gone from ITSM become verify-disposal tasks — run tasks:generate`);
  }
}

function resolveDir(): string {
  const arg = process.argv.slice(2).find((a) => !a.startsWith('--'));
  if (!arg) {
    console.error('✖ Usage: import-itsm-snapshot.ts <export-directory> [--dry-run]');
    process.exit(1);
  }
  return path.resolve(arg);
}

async function main(): Promise<void> {
  // This is a full replace of the table, so it can say what it would do first — the same
  // discipline as every other importer here.
  const apply = !process.argv.includes('--dry-run');
  const dir = resolveDir();
  console.log(`📥 ${apply ? 'Importing' : 'Dry run —'} ITSM MMH hardware snapshot from: ${dir}`);
  if (!fs.existsSync(dir)) {
    console.error(`✖ Directory not found: ${dir}`);
    process.exit(1);
  }

  await AppDataSource.initialize();
  console.log('✅ Connected to SQL Server\n');
  try {
    await importSnapshot(dir, apply);
    console.log(apply
      ? '\n✅ Import complete — app-owned asset data was not touched.'
      : '\n· Nothing written. Re-run without --dry-run to apply.');
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error('✖ Import failed:', err);
  process.exit(1);
});
