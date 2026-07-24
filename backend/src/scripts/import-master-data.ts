/**
 * import-master-data.ts — Idempotent, layout-safe importer for the read-only
 * IFS/CMDB reference data, from the *exact* JSON shapes shopfloor_visualizer
 * already produces.
 *
 * This is the "factorymap can eat the same data Matthias's app eats" path.
 * It reads the same files his ingest scripts write —
 *   masterData.json        (machines — ingest-mmag-machines.py)
 *   OTAssetData.json       (IT/OT devices — ingest-mmag-ot-assets.py)
 *   production_lines.json   (IFS get_workcenters.py)
 *   workcenters.json        (IFS get_workcenters.py)
 *   entity_kinds.json       (his data/entity_kinds.json, optional)
 * — and upserts them into master_assets / production_lines / work_centers /
 * entity_kinds. It NEVER touches app-owned layout (Asset positions, floors,
 * work areas, connections): assets join master data by master_ifs_id (a soft
 * join, see MasterAsset.entity.ts), so a re-import that drops a row just makes
 * that asset unmatched (surfaced on the Orphaned Assets page), never deleted.
 *
 * Field-agnostic by design (mirrors his ingest scripts' "genau die Spalten,
 * die QUERY liefert" comment): each mapper copies only the keys the source
 * row actually has, so a widened export just fills more optional columns
 * without any code change here. The two master-data shapes (machines vs OT
 * assets) are merged by `ifs_id` — a machine row and an OT-asset row for the
 * same id contribute their own half of the columns to one merged row.
 *
 * Run inside the backend container, pointing at a directory of exported JSON:
 *   docker exec factory-map-backend npx ts-node src/scripts/import-master-data.ts /path/to/data
 *   (defaults to shopfloor_visualizer's mvp-2d-demo/data if no arg and that
 *    path is reachable; otherwise pass the directory explicitly)
 *
 * Swapping in a live Databricks/IFS pull later means replacing the file reads
 * below with a query — nothing downstream (entities, controllers, the
 * Orphaned Assets page, the reconcile flow) has to change.
 */
import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { AppDataSource } from '../config/database';
import { MasterAsset } from '../entities/MasterAsset.entity';
import { ProductionLine } from '../entities/ProductionLine.entity';
import { WorkCenter } from '../entities/WorkCenter.entity';
import { EntityKind } from '../entities/EntityKind.entity';

type Row = Record<string, unknown>;

// Reads a `{ count, assets: [...] }` or a bare `[...]` / `{ entityKinds: [...] }`
// JSON file, returning the row array (or [] if the file is absent — every
// input is optional so a partial export still imports what it has).
function readRows(dir: string, file: string, arrayKey = 'assets'): Row[] {
  const full = path.join(dir, file);
  if (!fs.existsSync(full)) {
    console.log(`  – ${file}: not present, skipping`);
    return [];
  }
  const parsed = JSON.parse(fs.readFileSync(full, 'utf8'));
  if (Array.isArray(parsed)) return parsed as Row[];
  const rows = (parsed[arrayKey] ?? parsed.assets ?? parsed.entityKinds ?? []) as Row[];
  return Array.isArray(rows) ? rows : [];
}

// MSSQL caps a statement at 2100 parameters; a chunked upsert of N rows with
// C columns sends N*C. Size each chunk to stay well under that limit.
const chunkFor = (columnCount: number): number => Math.max(1, Math.floor(1900 / columnCount));

const str = (v: unknown): string | null => (v == null || v === '' ? null : String(v));
const num = (v: unknown): number | null => (v == null || v === '' ? null : Number(v));
const bool = (v: unknown): boolean | null => (v == null ? null : Boolean(v));
const date = (v: unknown): Date | null => {
  if (v == null || v === '') return null;
  const d = new Date(String(v));
  return isNaN(d.getTime()) ? null : d;
};

// Assigns only the keys present in `src` onto `target`, so a narrower export
// never overwrites an already-populated column with null (idempotent merge).
function assignPresent<T extends object>(target: T, src: Partial<T>): void {
  for (const [k, v] of Object.entries(src)) {
    if (v !== undefined) (target as Row)[k] = v;
  }
}

async function importMasterAssets(dir: string): Promise<void> {
  const machines = readRows(dir, 'masterData.json');
  const otAssets = readRows(dir, 'OTAssetData.json');
  if (machines.length === 0 && otAssets.length === 0) return;

  const repo = AppDataSource.getRepository(MasterAsset);
  const now = new Date();
  // Merge both shapes by ifs_id (machines use ifs_machine_id as the id).
  const merged = new Map<string, Partial<MasterAsset>>();

  for (const m of machines) {
    const ifs_id = str(m.ifs_machine_id) ?? str(m.ifs_id);
    if (!ifs_id) continue;
    const row: Partial<MasterAsset> = merged.get(ifs_id) ?? { ifs_id };
    assignPresent(row, {
      ifs_site: str(m.ifs_site) ?? undefined,
      ifs_machine_id: str(m.ifs_machine_id) ?? undefined,
      ifs_machine_part_no: str(m.ifs_machine_part_no) ?? undefined,
      ifs_machine_part_description: str(m.ifs_machine_part_description) ?? undefined,
      ifs_production_line_id: str(m.ifs_production_line_id) ?? undefined,
      ifs_workcenter_id: str(m.ifs_workcenter_id) ?? undefined,
      ifs_workcenter_description: str(m.ifs_workcenter_description) ?? undefined,
      ifs_cost_center: str(m.ifs_cost_center) ?? undefined,
    });
    merged.set(ifs_id, row);
  }

  for (const o of otAssets) {
    const ifs_id = str(o.ifs_id);
    if (!ifs_id) continue;
    const row: Partial<MasterAsset> = merged.get(ifs_id) ?? { ifs_id };
    assignPresent(row, {
      ifs_site: str(o.ifs_site) ?? undefined,
      // OT assets carry parent_id (= the machine's ifs_id) — this is how an
      // IPC/IT device hangs under its physical machine, matching
      // shopfloor_visualizer's parent_id join. Store it as ifs_machine_id.
      ifs_machine_id: str(o.parent_id) ?? str(o.ifs_machine_id) ?? undefined,
      ifs_part_no: str(o.ifs_part_no) ?? undefined,
      ifs_part_description: str(o.ifs_part_description) ?? undefined,
      ifs_serial_state: str(o.ifs_serial_state) ?? undefined,
      ifs_operational_condition: str(o.ifs_operational_condition) ?? undefined,
      ifs_operational_status: str(o.ifs_operational_status) ?? undefined,
      ifs_server_path: str(o.ifs_server_path) ?? undefined,
      cmdb_id: str(o.cmdb_id) ?? undefined,
      cmdb_status: str(o.cmdb_status) ?? undefined,
      cmdb_catalog_item: str(o.cmdb_catalog_item) ?? undefined,
      cmdb_manufacturer: str(o.cmdb_manufacturer) ?? undefined,
      cmdb_model: str(o.cmdb_model) ?? undefined,
      cmdb_serial_number: str(o.cmdb_serial_number) ?? undefined,
      cmdb_mac_address: str(o.cmdb_mac_address) ?? undefined,
      cmdb_os: str(o.cmdb_os) ?? undefined,
      cmdb_os_version: str(o.cmdb_os_version) ?? undefined,
      cmdb_received_date: date(o.cmdb_received_date) ?? undefined,
    });
    merged.set(ifs_id, row);
  }

  const rows = Array.from(merged.values()).map((r) => ({ ...r, imported_at: now }));
  // upsert by primary key (ifs_id) in chunks — MSSQL caps parameters per stmt.
  const chunk = chunkFor(24); // master_assets has ~24 columns
  for (let i = 0; i < rows.length; i += chunk) {
    await repo.upsert(rows.slice(i, i + chunk) as MasterAsset[], ['ifs_id']);
  }
  console.log(`  ✔ master_assets: ${rows.length} rows (${machines.length} machines + ${otAssets.length} OT assets merged)`);
}

async function importProductionLines(dir: string): Promise<void> {
  const src = readRows(dir, 'production_lines.json', 'value');
  if (src.length === 0) return;
  const repo = AppDataSource.getRepository(ProductionLine);
  const rows = src
    .filter((r) => !!(str(r.ProductionLine) ?? str(r.code)))
    .map((r): Partial<ProductionLine> => ({
      code: (str(r.ProductionLine) ?? str(r.code))!,
      description: str(r.Description) ?? str(r.description),
      contract: str(r.Contract) ?? str(r.contract),
    }));
  const chunk = chunkFor(3);
  for (let i = 0; i < rows.length; i += chunk) {
    await repo.upsert(rows.slice(i, i + chunk) as ProductionLine[], ['code']);
  }
  console.log(`  ✔ production_lines: ${rows.length} rows`);
}

async function importWorkCenters(dir: string): Promise<void> {
  const src = readRows(dir, 'workcenters.json', 'value');
  if (src.length === 0) return;
  const repo = AppDataSource.getRepository(WorkCenter);
  const rows = src
    .filter((r) => !!(str(r.WorkCenterNo) ?? str(r.code)))
    .map((r): Partial<WorkCenter> => ({
      code: (str(r.WorkCenterNo) ?? str(r.code))!,
      description: str(r.Description) ?? str(r.description),
      production_line_code: str(r.ProductionLine) ?? str(r.production_line_code),
      contract: str(r.Contract) ?? str(r.contract),
      objstate: str(r.Objstate) ?? str(r.objstate),
      department_no: str(r.DepartmentNo) ?? str(r.department_no),
      cost_center_id: str(r.CostCenterId) ?? str(r.cost_center_id),
    }));
  const chunk = chunkFor(7);
  for (let i = 0; i < rows.length; i += chunk) {
    await repo.upsert(rows.slice(i, i + chunk) as WorkCenter[], ['code']);
  }
  console.log(`  ✔ work_centers: ${rows.length} rows`);
}

async function importEntityKinds(dir: string): Promise<void> {
  const src = readRows(dir, 'entity_kinds.json', 'entityKinds');
  if (src.length === 0) return;
  const repo = AppDataSource.getRepository(EntityKind);
  const rows = src
    .filter((r) => !!str(r.value))
    .map((r): Partial<EntityKind> => ({
      value: str(r.value)!,
      label: str(r.label) ?? str(r.value)!,
      geometry_type: (str(r.geometryType) ?? 'point') as EntityKind['geometry_type'],
      default_color: str(r.defaultColor),
      rotatable: bool(r.rotatable) ?? false,
      exempt_from_orphan: bool(r.exemptFromOrphan) ?? false,
      footprint: (r.footprint as Array<[number, number]>) ?? null,
      model: str(r.model),
      model_scale: num(r.modelScale),
      preserve_model_colors: bool(r.preserveModelColors),
    }));
  const chunk = chunkFor(10);
  for (let i = 0; i < rows.length; i += chunk) {
    await repo.upsert(rows.slice(i, i + chunk) as EntityKind[], ['value']);
  }
  console.log(`  ✔ entity_kinds: ${rows.length} rows`);
}

function resolveDir(): string {
  const arg = process.argv[2];
  if (arg) return path.resolve(arg);
  // Best-effort default to shopfloor_visualizer's data dir if reachable from
  // a typical sibling checkout — otherwise the user must pass the path.
  const guess = path.resolve(__dirname, '../../../../shopfloor_visualizer/mvp-2d-demo/data');
  return guess;
}

async function main(): Promise<void> {
  const dir = resolveDir();
  console.log(`📥 Importing IFS/CMDB master data from: ${dir}`);
  if (!fs.existsSync(dir)) {
    console.error(`✖ Directory not found: ${dir}\n  Pass the export directory as an argument.`);
    process.exit(1);
  }

  await AppDataSource.initialize();
  console.log('✅ Connected to SQL Server\n');
  try {
    await importProductionLines(dir);
    await importWorkCenters(dir);
    await importEntityKinds(dir);
    await importMasterAssets(dir);
    console.log('\n✅ Import complete — app-owned layout was not touched.');
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error('✖ Import failed:', err);
  process.exit(1);
});
