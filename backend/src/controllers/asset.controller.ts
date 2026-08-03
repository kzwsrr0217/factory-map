/**
 * asset.controller.ts — CRUD and connection management for assets.
 *
 * Key functions:
 *  - `getAssetLookups`: Returns distinct non-null values for autocomplete fields
 *    (manufacturer, model, OS, VLAN, etc.) in a single request.
 *  - `getAllAssets`: Supports filtering by hierarchy, status, type, placement, and
 *    free-text search. Optional pagination via `page` + `limit` query params.
 *    Pass `include_connections=true` to left-join AssetConnection rows (used by
 *    the network graph and topology report; omitted by default for performance).
 *  - `createAsset` / `updateAsset` / `deleteAsset`: Standard CRUD. Each broadcasts
 *    the change to all connected clients via Socket.io.
 *  - `bulkCreateAssets`: Accepts up to 500 assets in one request. Returns HTTP 207
 *    (Multi-Status) with per-item success/error results.
 *  - `updateAsset`: Includes cycle detection for predecessor/successor lifecycle links
 *    and automatic location history recording when coordinates change.
 *  - `addConnection` / `updateConnection` / `removeConnection`: Manage the
 *    asset_connections table. A pair of assets can have several distinct
 *    connections between them (identity is each row's own id, not the
 *    asset pair); bidirectional connections are mirrored as two rows
 *    sharing a `pair_id`, kept in sync on update/remove.
 *  - `replaceAsset`: Swaps a broken/retired asset for a replacement,
 *    transferring position, hierarchy, wall-port assignment, and every
 *    connection to the replacement.
 *  - `syncAssetFromITSM`: Mock ITSM sync that updates status and software (for dev/demo).
 *
 * Internal helpers:
 *  - `applyBodyToAsset()`: Maps the nested API request body to flat entity columns.
 *    This is the single place where the API field names are translated to DB columns.
 *    Auto-generates a UUID + created_at timestamp for any work_item that lacks one.
 *  - `saveRelations()`: Replaces the software list (delete + insert pattern).
 *  - `loadWithRelations()`: Loads an asset including its software and connections.
 *  - `wouldCreateCycle()`: Traverses the predecessor/successor chain to detect loops.
 */
import { randomUUID } from 'crypto';
import { In } from 'typeorm';
import { Request, Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth.middleware';
import { AuditLog } from '../entities/AuditLog.entity';
import { AppDataSource } from '../config/database';
import { Asset } from '../entities/Asset.entity';
import { MasterAsset } from '../entities/MasterAsset.entity';
import { AssetSoftware } from '../entities/AssetSoftware.entity';
import { AssetConnection } from '../entities/AssetConnection.entity';
import { EntityKind } from '../entities/EntityKind.entity';
import { WallPort } from '../entities/WallPort.entity';
import { WorkArea } from '../entities/WorkArea.entity';
import { Floor } from '../entities/Floor.entity';
import { Section } from '../entities/Section.entity';
import { Workstation } from '../entities/Workstation.entity';
import { io } from '../server';
import { chunkForEntity, findByIn } from '../utils/mssqlBatch';

const repo = () => AppDataSource.getRepository(Asset);
const masterAssetRepo = () => AppDataSource.getRepository(MasterAsset);
const softwareRepo = () => AppDataSource.getRepository(AssetSoftware);
const connRepo = () => AppDataSource.getRepository(AssetConnection);
const entityKindRepo = () => AppDataSource.getRepository(EntityKind);
const wallPortRepo = () => AppDataSource.getRepository(WallPort);

// Mirrors shopfloor_visualizer's objectTypeTemplates convention (FR-6b): the
// first time an asset is placed (is_placed flips false → true) with no
// explicit footprint of its own, pre-fill loc_footprint from its
// EntityKind's default footprint. Never overwrites a footprint the asset
// already has (explicitly set, or filled by an earlier placement).
async function fillFootprintFromEntityKind(asset: Asset, wasPlaced: boolean): Promise<void> {
  if (wasPlaced || !asset.is_placed || asset.loc_footprint || !asset.entity_kind) return;
  const kind = await entityKindRepo().findOne({ where: { value: asset.entity_kind } });
  if (kind?.footprint) asset.loc_footprint = kind.footprint;
}

// Two devices can't physically occupy the same U slot in a rack. Checks the
// [u_position, u_position + rack_u_size - 1] range against every other
// asset in the same rack (excluding this one, for updates). Called after
// applyBodyToAsset so rack_id/u_position/rack_u_size reflect the incoming
// request.
// Building/floor/workarea/section/workstation are independent columns on
// Asset (no FK chain), so nothing stops e.g. floor_id pointing at Floor A
// while section_id points at a section whose work area is on Floor B —
// confirmed reachable via the plain API. Walks up from whichever of
// workstation_id/section_id/workarea_id is set (most specific first) to the
// work area's floor_id, and rejects if that disagrees with asset.floor_id.
// Does not require every intermediate field to be filled in — only that
// whichever ARE filled in agree with each other.
async function findHierarchyMismatch(asset: Asset): Promise<string | null> {
  let derivedFloorId: string | null = null;
  if (asset.workstation_id) {
    const ws = await AppDataSource.getRepository(Workstation).findOne({ where: { id: asset.workstation_id } });
    if (!ws) return 'workstation_id does not reference an existing workstation';
    const sec = await AppDataSource.getRepository(Section).findOne({ where: { id: ws.section_id } });
    if (sec) {
      const wa = await AppDataSource.getRepository(WorkArea).findOne({ where: { id: sec.workarea_id } });
      if (wa) derivedFloorId = wa.floor_id;
    }
  } else if (asset.section_id) {
    const sec = await AppDataSource.getRepository(Section).findOne({ where: { id: asset.section_id } });
    if (!sec) return 'section_id does not reference an existing section';
    const wa = await AppDataSource.getRepository(WorkArea).findOne({ where: { id: sec.workarea_id } });
    if (wa) derivedFloorId = wa.floor_id;
  } else if (asset.workarea_id) {
    const wa = await AppDataSource.getRepository(WorkArea).findOne({ where: { id: asset.workarea_id } });
    if (!wa) return 'workarea_id does not reference an existing work area';
    derivedFloorId = wa.floor_id;
  }
  if (derivedFloorId && asset.floor_id && derivedFloorId !== asset.floor_id) {
    return 'floor_id does not match the floor of the assigned work area/section/workstation';
  }
  return null;
}

async function findRackCollision(asset: Asset): Promise<Asset | null> {
  if (!asset.rack_id || asset.u_position == null) return null;
  const start = asset.u_position;
  const end = asset.u_position + (asset.rack_u_size || 1) - 1;
  const others = await repo().find({ where: { rack_id: asset.rack_id } });
  return others.find((other) => {
    if (other.id === asset.id || other.u_position == null) return false;
    const oStart = other.u_position;
    const oEnd = other.u_position + (other.rack_u_size || 1) - 1;
    return start <= oEnd && oStart <= end;
  }) ?? null;
}

// A maintenance "last serviced" date in the future is always a data-entry
// mistake (typo, wrong picker value) — nobody has serviced equipment ahead
// of time. Left unchecked it also silently breaks reporting: AssetReports.tsx
// counts "recently serviced" via `now - last_date < 30 days`, which a future
// date satisfies trivially, making unserviced equipment look serviced.
function findFutureMaintenanceDate(asset: Asset): string | null {
  if (asset.maint_last_date && asset.maint_last_date.getTime() > Date.now()) {
    return 'maintenance.last_date cannot be in the future';
  }
  return null;
}

// Attaches the joined MasterAsset (IFS/CMDB) row, if any, onto an asset's API
// response under `master`. `master: null` with a non-null `master_ifs_id`
// means the join target is missing — the orphan case from PRD 5.3 (the
// master row disappeared on a re-import, or was never seeded/imported).
// No live IFS/Databricks call happens here — this only reads the local
// master_assets table (see MasterAsset.entity.ts).
async function attachMasterData<T extends { master_ifs_id: string | null }>(
  response: T
): Promise<T & { master: ReturnType<MasterAsset['toApiResponse']> | null }> {
  const master = response.master_ifs_id
    ? await masterAssetRepo().findOne({ where: { ifs_id: response.master_ifs_id } })
    : null;
  return { ...response, master: master ? master.toApiResponse() : null };
}

async function attachMasterDataMany<T extends { master_ifs_id: string | null }>(
  responses: T[]
): Promise<Array<T & { master: ReturnType<MasterAsset['toApiResponse']> | null }>> {
  const ifsIds = [...new Set(responses.map((r) => r.master_ifs_id).filter((v): v is string => !!v))];
  if (ifsIds.length === 0) return responses.map((r) => ({ ...r, master: null }));
  const rows = await masterAssetRepo().find({ where: { ifs_id: In(ifsIds) } });
  // Keyed case-insensitively to match MSSQL's default case-insensitive collation,
  // which attachMasterData's findOne({ where: { ifs_id } }) relies on implicitly.
  const byIfsId = new Map(rows.map((m) => [m.ifs_id.toUpperCase(), m.toApiResponse()]));
  return responses.map((r) => ({ ...r, master: r.master_ifs_id ? byIfsId.get(r.master_ifs_id.toUpperCase()) ?? null : null }));
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function wouldCreateCycle(assetId: string, targetId: string, direction: 'predecessor' | 'successor'): Promise<boolean> {
  const field = direction === 'predecessor' ? 'predecessor_id' : 'successor_id';
  let current: string | null = targetId;
  const visited = new Set<string>();
  while (current) {
    if (current === assetId) return true;
    if (visited.has(current)) break;
    visited.add(current);
    const doc = await AppDataSource.getRepository(Asset).findOne({ where: { id: current }, select: [field as keyof Asset] as (keyof Asset)[] });
    current = doc ? (doc[field as keyof Asset] as string | null) : null;
  }
  return false;
}

/**
 * An asset counts as placed on the map once it has a non-zero coordinate.
 *
 * The null coalescing is load-bearing, not defensive noise: `loc_x`/`loc_y` carry
 * a database default of 0, so on a freshly `create()`d entity they are still
 * **undefined** in memory until the row is reloaded. Comparing undefined against
 * 0 is true, which used to mark every asset created through the API with a floor
 * but no coordinates as placed — so it rendered in the map's top-left corner and
 * never appeared in the unplaced tray, the exact state the tray exists to expose.
 */
function isPlacedFromCoords(x: number | null | undefined, y: number | null | undefined): boolean {
  return (x ?? 0) !== 0 || (y ?? 0) !== 0;
}

// Map incoming nested body → entity fields
function applyBodyToAsset(asset: Asset, body: Record<string, unknown>): void {
  const bi = body.basic_info as Record<string, unknown> | undefined;
  if (bi) {
    if (bi.display_name !== undefined) asset.display_name = bi.display_name as string;
    if (bi.asset_tag !== undefined) asset.asset_tag = (bi.asset_tag as string) ?? null;
    if (bi.serial_number !== undefined) asset.serial_number = (bi.serial_number as string) ?? null;
    if (bi.model !== undefined) asset.model = (bi.model as string) ?? null;
    if (bi.manufacturer !== undefined) asset.manufacturer = (bi.manufacturer as string) ?? null;
    if (bi.status !== undefined) asset.status = (bi.status as string) ?? null;
    if (bi.type !== undefined) asset.asset_type = (bi.type as string) ?? null;
    if (bi.os_type !== undefined) asset.os_type = (bi.os_type as string) ?? null;
    if (bi.os_version !== undefined) asset.os_version = (bi.os_version as string) ?? null;
    if (bi.mac_address !== undefined) asset.mac_address = (bi.mac_address as string) ?? null;
  }

  const ts = body.technical_specs as Record<string, unknown> | undefined;
  if (ts) {
    if (ts.cpu !== undefined) asset.cpu = (ts.cpu as string) ?? null;
    if (ts.ram !== undefined) asset.ram = (ts.ram as string) ?? null;
    if (ts.storage !== undefined) asset.storage = (ts.storage as string) ?? null;
    if (ts.gpu !== undefined) asset.gpu = (ts.gpu as string) ?? null;
  }

  const net = body.network as Record<string, unknown> | undefined;
  if (net) {
    if (net.ip_address !== undefined) asset.ip_address = (net.ip_address as string) ?? null;
    if (net.hostname !== undefined) asset.hostname = (net.hostname as string) ?? null;
    if (net.vlan !== undefined) asset.vlan = (net.vlan as string) ?? null;
    if (net.switch_port !== undefined) asset.switch_port = (net.switch_port as string) ?? null;
    if (net.dhcp_static !== undefined) asset.dhcp_static = (net.dhcp_static as string) ?? null;
  }

  const ap = body.assigned_person as Record<string, unknown> | null | undefined;
  if (ap !== undefined) {
    if (ap === null) {
      asset.person_id = null; asset.person_itsm_id = null; asset.person_full_name = null;
    } else {
      if (ap.person_id !== undefined) asset.person_id = (ap.person_id as string) ?? null;
      if (ap.itsm_id !== undefined) asset.person_itsm_id = (ap.itsm_id as string) ?? null;
      if (ap.full_name !== undefined) asset.person_full_name = (ap.full_name as string) ?? null;
    }
  }

  const org = body.organization as Record<string, unknown> | undefined;
  if (org) {
    if (org.itsm_id !== undefined) asset.org_itsm_id = (org.itsm_id as string) ?? null;
    if (org.display_name !== undefined) asset.org_display_name = (org.display_name as string) ?? null;
  }

  const cat = body.catalog_item as Record<string, unknown> | undefined;
  if (cat) {
    if (cat.itsm_id !== undefined) asset.catalog_itsm_id = (cat.itsm_id as string) ?? null;
    if (cat.display_name !== undefined) asset.catalog_display_name = (cat.display_name as string) ?? null;
  }

  const itsm = body.itsm as Record<string, unknown> | undefined;
  if (itsm) {
    if (itsm.itsm_guid !== undefined) asset.itsm_guid = (itsm.itsm_guid as string) ?? null;
    if (itsm.hardware_asset_id !== undefined) asset.hardware_asset_id = (itsm.hardware_asset_id as string) ?? null;
    if (itsm.asset_class !== undefined) asset.asset_class = (itsm.asset_class as string) ?? null;
    if (itsm.source_of_truth !== undefined) asset.source_of_truth = itsm.source_of_truth as string;
    if (itsm.is_managed !== undefined) asset.is_managed = itsm.is_managed as boolean;
    if (itsm.sync_status !== undefined) asset.sync_status = itsm.sync_status as string;
    if (itsm.last_synced !== undefined) asset.last_synced = itsm.last_synced ? new Date(itsm.last_synced as string) : null;
  }

  if (body.master_ifs_id !== undefined) asset.master_ifs_id = (body.master_ifs_id as string) ?? null;
  if (body.entity_kind !== undefined) asset.entity_kind = (body.entity_kind as string) ?? null;

  const loc = body.location as Record<string, unknown> | undefined;
  if (loc) {
    const coords = loc.coordinates as { x?: number; y?: number } | undefined;
    if (coords !== undefined) {
      asset.loc_x = coords.x ?? 0;
      asset.loc_y = coords.y ?? 0;
      asset.is_placed = isPlacedFromCoords(asset.loc_x, asset.loc_y);
    }
    if (loc.rotation !== undefined) asset.loc_rotation = (loc.rotation as number) ?? 0;
    if (loc.icon_type !== undefined) asset.loc_icon_type = (loc.icon_type as string) ?? 'computer';
    if (loc.description !== undefined) asset.loc_description = (loc.description as string) ?? null;
    if (loc.footprint !== undefined) asset.loc_footprint = (loc.footprint as Array<[number, number]>) ?? null;
  }

  const hier = body.hierarchy as Record<string, unknown> | undefined;
  if (hier) {
    // AssetFormModal only exposes building/floor pickers — it has no
    // workarea/section/workstation selector, so it always resubmits those
    // fields unchanged from the asset's PREVIOUS floor. If floor_id is
    // actually changing, those stale ids would silently point at a work
    // area/section/workstation/rack that lives on the old floor entirely
    // (confirmed: they can reference rows that don't exist on the new floor
    // at all). Clear them here unless the caller explicitly set a new value
    // for that specific field in the same request (e.g. a future
    // "assign to this work area" action, or the map drag-to-move handler,
    // which does pass the newly-computed workarea_id).
    const floorChanging = hier.floor_id !== undefined && hier.floor_id !== asset.floor_id;

    if (hier.building_id !== undefined) asset.building_id = (hier.building_id as string) ?? null;
    if (hier.floor_id !== undefined) asset.floor_id = (hier.floor_id as string) ?? null;

    if (hier.workarea_id !== undefined) asset.workarea_id = (hier.workarea_id as string) ?? null;
    else if (floorChanging) asset.workarea_id = null;

    if (hier.section_id !== undefined) asset.section_id = (hier.section_id as string) ?? null;
    else if (floorChanging) asset.section_id = null;

    if (hier.workstation_id !== undefined) asset.workstation_id = (hier.workstation_id as string) ?? null;
    else if (floorChanging) asset.workstation_id = null;

    if (hier.rack_id !== undefined) {
      asset.rack_id = (hier.rack_id as string) ?? null;
      // Clearing rack_id (unmounting) without also clearing/re-setting map
      // coordinates left is_placed stuck at true forever — the asset then
      // has no rack AND no meaningful map position, but never shows up in
      // Unplaced Assets because nothing ever flips the flag back. Recompute
      // from whichever placement signal (rack or coords) is actually true.
      asset.is_placed = asset.rack_id ? true : isPlacedFromCoords(asset.loc_x, asset.loc_y);
    } else if (floorChanging) {
      asset.rack_id = null;
      asset.u_position = null;
      asset.is_placed = isPlacedFromCoords(asset.loc_x, asset.loc_y);
    }
    if (hier.u_position !== undefined) asset.u_position = (hier.u_position as number) ?? null;
    if (hier.rack_u_size !== undefined) asset.rack_u_size = (hier.rack_u_size as number) ?? 1;
  }

  const cf = body.custom_fields as Record<string, unknown> | undefined;
  if (cf) {
    if (cf.physical_condition !== undefined) asset.physical_condition = (cf.physical_condition as string) ?? null;
    if (cf.environment !== undefined) asset.environment = (cf.environment as string) ?? null;
    if (cf.notes !== undefined) asset.notes = (cf.notes as string) ?? null;
    if (cf.tags !== undefined) asset.tags = (cf.tags as string[]) ?? null;
    if (cf.object_id !== undefined) asset.object_id = (cf.object_id as string) ?? null;
    if (cf.serial_object !== undefined) asset.serial_object = (cf.serial_object as string) ?? null;
    if (cf.remote_access_tool !== undefined) asset.remote_access_tool = (cf.remote_access_tool as string) ?? null;
    if (cf.remote_access_version !== undefined) asset.remote_access_version = (cf.remote_access_version as string) ?? null;
    if (cf.backup_tool !== undefined) asset.backup_tool = (cf.backup_tool as string) ?? null;
    if (cf.backup_status !== undefined) asset.backup_status = (cf.backup_status as string) ?? null;
    if (cf.winupdate_date !== undefined) asset.winupdate_date = cf.winupdate_date ? new Date(cf.winupdate_date as string) : null;
    if (cf.fortiedr_active !== undefined) asset.fortiedr_active = (cf.fortiedr_active as boolean) ?? null;
  }

  const maint = body.maintenance as Record<string, unknown> | undefined;
  if (maint) {
    if (maint.last_date !== undefined) asset.maint_last_date = maint.last_date ? new Date(maint.last_date as string) : null;
    if (maint.next_date !== undefined) asset.maint_next_date = maint.next_date ? new Date(maint.next_date as string) : null;
    if (maint.interval_days !== undefined) asset.maint_interval_days = (maint.interval_days as number) ?? null;
    if (maint.notes !== undefined) asset.maint_notes = (maint.notes as string) ?? null;
  }

  const wi = body.work_items;
  if (wi !== undefined) {
    const now = new Date().toISOString();
    asset.work_items = (wi as Array<Record<string, unknown>>).map(item => ({
      ...item,
      id: (item.id as string) || randomUUID(),
      created_at: (item.created_at as string) || now,
    })) as Asset['work_items'];
  }

  if (body.predecessor_id !== undefined) asset.predecessor_id = (body.predecessor_id as string) ?? null;
  if (body.successor_id !== undefined) asset.successor_id = (body.successor_id as string) ?? null;
  if (body.is_placed !== undefined) asset.is_placed = body.is_placed as boolean;
  if (body.wall_port_id !== undefined) {
    asset.wall_port_id = (body.wall_port_id as string) ?? null;
    // Also clear the loaded relation so TypeORM doesn't reconstruct the FK from the object
    if (asset.wall_port_id === null) (asset as any).wall_port = null;
  }
}

async function saveRelations(asset: Asset, body: Record<string, unknown>): Promise<void> {
  const softwareList = body.software as Array<Record<string, unknown>> | undefined;
  if (softwareList !== undefined) {
    await softwareRepo().delete({ asset_id: asset.id });
    if (softwareList.length > 0) {
      const rows = softwareList.map((s) => softwareRepo().create({
        asset_id: asset.id,
        software_id: (s.software_id as string) ?? null,
        display_name: s.display_name as string,
        vendor: (s.vendor as string) ?? null,
        version: (s.version as string) ?? null,
        source: (s.source as string) ?? 'manual',
      }));
      await softwareRepo().save(rows);
    }
  }
}

async function loadWithRelations(id: string): Promise<Asset | null> {
  return repo().findOne({
    where: { id },
    relations: ['software', 'connections', 'wall_port', 'wall_port.patch_panel', 'wall_port.patch_panel.rack', 'wall_port.patch_panel.rack.room'],
  });
}

// ── GET /assets/lookups ───────────────────────────────────────────────────────

const LOOKUP_COLUMNS: Record<string, string> = {
  manufacturer:         'manufacturer',
  model:                'model',
  os_type:              'os_type',
  os_version:           'os_version',
  vlan:                 'vlan',
  environment:          'environment',
  remote_access_tool:   'remote_access_tool',
  remote_access_version:'remote_access_version',
  backup_tool:          'backup_tool',
  catalog_item:         'catalog_display_name',
  organization:         'org_display_name',
  serial_object:        'serial_object',
  asset_type:           'asset_type',
};

export const getAssetLookups = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const results: Record<string, string[]> = {};
    await Promise.all(
      Object.entries(LOOKUP_COLUMNS).map(async ([key, col]) => {
        const rows = await AppDataSource.getRepository(Asset)
          .createQueryBuilder('a')
          .select(`DISTINCT a.${col}`, 'val')
          .where(`a.${col} IS NOT NULL`)
          .andWhere(`a.${col} != ''`)
          .orderBy('val', 'ASC')
          .getRawMany<{ val: string }>();
        results[key] = rows.map(r => r.val).filter(Boolean);
      })
    );
    res.json({ success: true, data: results });
  } catch (error) { next(error); }
};

// ── GET /assets ───────────────────────────────────────────────────────────────

export const getAllAssets = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { page, limit, floor_id, building_id, workarea_id, section_id, status, type, is_placed, q, include_connections, include_master, orphaned } =
      req.query as Record<string, string | undefined>;

    const qb = repo().createQueryBuilder('a');

    if (include_connections === 'true') {
      qb.leftJoinAndSelect('a.connections', 'conn')
        .leftJoinAndSelect('a.wall_port', 'wp')
        .leftJoinAndSelect('wp.patch_panel', 'wp_pp')
        .leftJoinAndSelect('wp_pp.rack', 'wp_rack')
        .leftJoinAndSelect('wp_rack.room', 'wp_room');
    }

    if (floor_id)    qb.andWhere('a.floor_id = :floor_id', { floor_id });
    if (building_id) qb.andWhere('a.building_id = :building_id', { building_id });
    if (workarea_id) qb.andWhere('a.workarea_id = :workarea_id', { workarea_id });
    if (section_id)  qb.andWhere('a.section_id = :section_id', { section_id });
    if (status)      qb.andWhere('a.status = :status', { status });
    if (type)        qb.andWhere('a.asset_type = :type', { type });
    if (is_placed !== undefined) qb.andWhere('a.is_placed = :is_placed', { is_placed: is_placed === 'true' ? 1 : 0 });
    // Orphaned = references a master row (IFS/CMDB) that no longer resolves —
    // see MasterAsset.entity.ts / attachMasterData. Filtered here (rather than
    // fetched-then-filtered client-side) so the dedicated Orphaned Assets page
    // doesn't have to pull every asset in the org to find the few that qualify.
    if (orphaned === 'true') {
      qb.andWhere('a.master_ifs_id IS NOT NULL')
        .andWhere('NOT EXISTS (SELECT 1 FROM master_assets ma WHERE ma.ifs_id = a.master_ifs_id)');
    }

    if (q) {
      const like = `%${q}%`;
      qb.andWhere(
        '(a.display_name LIKE :q OR a.serial_number LIKE :q OR a.asset_tag LIKE :q OR ' +
        'a.manufacturer LIKE :q OR a.model LIKE :q OR a.ip_address LIKE :q OR ' +
        'a.hostname LIKE :q OR a.person_full_name LIKE :q)',
        { q: like }
      );
    }

    qb.orderBy('a.display_name', 'ASC');

    if (page && limit) {
      const p = Math.max(1, parseInt(page, 10));
      const l = Math.min(500, Math.max(1, parseInt(limit, 10)));
      qb.skip((p - 1) * l).take(l);
      const [assets, total] = await qb.getManyAndCount();
      const data = include_master === 'true'
        ? await attachMasterDataMany(assets.map((a) => a.toApiResponse()))
        : assets.map((a) => a.toApiResponse());
      res.json({ success: true, data, meta: { total, page: p, limit: l, totalPages: Math.ceil(total / l) } });
    } else {
      // No explicit pagination — apply a safety cap so large datasets don't cause full-table reads
      const CAP = 1000;
      qb.take(CAP);
      const [assets, total] = await qb.getManyAndCount();
      const data = include_master === 'true'
        ? await attachMasterDataMany(assets.map((a) => a.toApiResponse()))
        : assets.map((a) => a.toApiResponse());
      res.json({ success: true, data, meta: { total, limit: CAP, truncated: total > CAP } });
    }
  } catch (error) { next(error); }
};

// ── GET /assets/:id ───────────────────────────────────────────────────────────

export const getAssetById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const asset = await loadWithRelations(req.params.id);
    if (!asset) { res.status(404).json({ success: false, error: 'Asset not found' }); return; }
    res.json({ success: true, data: await attachMasterData(asset.toApiResponse()) });
  } catch (error) { next(error); }
};

// ── GET /assets/:id/ot-children ─────────────────────────────────────────────
// IT-managed devices (IPCs, etc.) mounted on the physical machine this asset
// represents — the reverse of MasterAsset.ifs_machine_id (see that entity's
// doc comment). Empty when the asset isn't IFS-joined or is itself an IT
// device rather than a machine. No live IFS/Databricks call — reads only
// the local master_assets table.
export const getAssetOtChildren = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const asset = await repo().findOne({ where: { id: req.params.id } });
    if (!asset) { res.status(404).json({ success: false, error: 'Asset not found' }); return; }
    if (!asset.master_ifs_id) { res.json({ success: true, data: [] }); return; }

    const children = await masterAssetRepo()
      .createQueryBuilder('m')
      .where('m.ifs_machine_id = :ifsId', { ifsId: asset.master_ifs_id })
      .andWhere('m.ifs_id != m.ifs_machine_id')
      .getMany();
    res.json({ success: true, data: children.map((c) => c.toApiResponse()) });
  } catch (error) { next(error); }
};

// ── POST /assets ──────────────────────────────────────────────────────────────

export const createAsset = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const body = req.body as Record<string, unknown>;
    const asset = repo().create({ source_of_truth: 'local', sync_status: 'never', is_managed: false });
    applyBodyToAsset(asset, body);
    const hierarchyMismatch = await findHierarchyMismatch(asset);
    if (hierarchyMismatch) {
      res.status(422).json({ success: false, error: hierarchyMismatch });
      return;
    }
    const collision = await findRackCollision(asset);
    if (collision) {
      res.status(409).json({ success: false, error: `Rack U${asset.u_position} is already occupied by "${collision.display_name}"` });
      return;
    }
    const futureMaint = findFutureMaintenanceDate(asset);
    if (futureMaint) {
      res.status(422).json({ success: false, error: futureMaint });
      return;
    }
    await fillFootprintFromEntityKind(asset, false);
    await repo().save(asset);
    await saveRelations(asset, body);
    const full = (await loadWithRelations(asset.id))!;
    io.emit('asset:created', full.toApiResponse());
    res.status(201).json({ success: true, data: full.toApiResponse() });
  } catch (error) { next(error); }
};

// ── PATCH /assets/bulk ────────────────────────────────────────────────────────

/** Hard cap per request. A correction pass touches tens of rows, not thousands. */
const MAX_BULK_UPDATE = 500;

/**
 * Applies the same few changes to many assets at once.
 *
 * Why it exists: after the inventory survey import, corrections come in groups —
 * "these twelve are actually in the other room", "these all belong to her now".
 * Without this, each one is a full form round-trip, and `POST /assets/bulk` is no
 * help because it only ever creates. That made the correction pass the most
 * expensive part of the whole workflow.
 *
 * Deliberately a **narrow whitelist**: the room, the person, the status, and
 * clearing the placement. Identity (name, serial, hardware_asset_id) and
 * everything ITSM-owned are out of reach on purpose — a bulk edit that can
 * overwrite a serial number across fifty rows is a data-loss tool, and those
 * fields are never wrong in groups anyway.
 */
export const bulkUpdateAssets = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const body = req.body as {
      asset_ids?: string[];
      changes?: {
        workarea_id?: string | null;
        person_full_name?: string | null;
        person_id?: string | null;
        status?: string | null;
        clear_placement?: boolean;
      };
    };

    const ids = Array.isArray(body.asset_ids) ? [...new Set(body.asset_ids)] : [];
    const changes = body.changes ?? {};
    if (ids.length === 0) {
      res.status(400).json({ success: false, error: 'asset_ids is required and must not be empty' });
      return;
    }
    if (ids.length > MAX_BULK_UPDATE) {
      res.status(400).json({ success: false, error: `At most ${MAX_BULK_UPDATE} assets per request` });
      return;
    }
    if (Object.keys(changes).length === 0) {
      res.status(400).json({ success: false, error: 'changes is required — nothing to apply' });
      return;
    }

    // A work area determines its floor and building, so those are derived rather
    // than accepted from the caller: passing all three lets them disagree, and
    // an asset whose floor_id contradicts its work area is exactly the state
    // findHierarchyMismatch exists to prevent.
    let targetArea: WorkArea | null = null;
    let targetFloorId: string | null = null;
    let targetBuildingId: string | null = null;
    if (changes.workarea_id !== undefined && changes.workarea_id !== null) {
      targetArea = await AppDataSource.getRepository(WorkArea).findOneBy({ id: changes.workarea_id });
      if (!targetArea) {
        res.status(422).json({ success: false, error: 'workarea_id does not reference an existing work area' });
        return;
      }
      targetFloorId = targetArea.floor_id;
      const floor = await AppDataSource.getRepository(Floor).findOneBy({ id: targetArea.floor_id });
      targetBuildingId = floor?.building_id ?? null;
    }

    const assets = await findByIn(repo(), 'id', ids);
    const found = new Set(assets.map((a) => a.id));
    const skipped: Array<{ _id: string; reason: string }> = ids
      .filter((id) => !found.has(id))
      .map((id) => ({ _id: id, reason: 'No such asset' }));

    const updated: Array<{ _id: string; display_name: string }> = [];
    /** Assets sent back to the unplaced tray because their room changed. */
    const unplaced: string[] = [];

    for (const asset of assets) {
      if (changes.workarea_id !== undefined) {
        const movingRoom = asset.workarea_id !== (changes.workarea_id ?? null);
        asset.workarea_id = changes.workarea_id ?? null;
        if (targetArea) {
          asset.floor_id = targetFloorId;
          asset.building_id = targetBuildingId;
        }
        // Coordinates are relative to the room the asset was in. Keeping them
        // would leave it drawn inside the OLD rectangle while belonging to the
        // new one — visibly in one room, structurally in another. Back to the
        // tray instead, where "Arrange unplaced" can lay it out in the new room.
        if (movingRoom && asset.is_placed) {
          asset.loc_x = 0;
          asset.loc_y = 0;
          asset.is_placed = false;
          unplaced.push(asset.display_name);
        }
        // Retired levels: a section/workstation from the old room would now point
        // at another room entirely.
        asset.section_id = null;
        asset.workstation_id = null;
      }
      if (changes.person_full_name !== undefined) asset.person_full_name = changes.person_full_name ?? null;
      if (changes.person_id !== undefined) asset.person_id = changes.person_id ?? null;
      if (changes.status !== undefined) asset.status = changes.status ?? null;
      if (changes.clear_placement) {
        asset.loc_x = 0;
        asset.loc_y = 0;
        asset.is_placed = false;
      }
      updated.push({ _id: asset.id, display_name: asset.display_name });
    }

    if (assets.length > 0) await repo().save(assets, { chunk: chunkForEntity(Asset) });

    // One entry per asset, matching how single edits are recorded. Written
    // manually because the audit middleware infers the action from req.method
    // and expects one flat asset in the response body.
    const user = (req as AuthRequest).user;
    if (user && updated.length > 0) {
      const logRepo = AppDataSource.getRepository(AuditLog);
      const entries = updated.map((u) => logRepo.create({
        user_id: user.id, username: user.username, action: 'update',
        entity_type: 'asset', document_id: u._id,
        diff: { bulk_edit: changes },
      }));
      await logRepo.save(entries, { chunk: chunkForEntity(AuditLog) })
        .catch(() => { /* audit failure must never fail the request */ });
    }

    for (const asset of assets) io.emit('asset:updated', asset.toApiResponse());

    res.json({
      success: true,
      data: { updated, skipped, unplaced },
      message: `${updated.length} asset(s) updated`
        + (unplaced.length > 0 ? `, ${unplaced.length} returned to the unplaced tray because their work area changed` : '')
        + (skipped.length > 0 ? `, ${skipped.length} skipped` : ''),
    });
  } catch (error) { next(error); }
};

// ── POST /assets/bulk ─────────────────────────────────────────────────────────

export const bulkCreateAssets = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { assets } = req.body as { assets?: unknown[] };
    if (!Array.isArray(assets) || assets.length === 0) {
      res.status(400).json({ success: false, error: 'assets array is required and must not be empty' }); return;
    }
    if (assets.length > 500) {
      res.status(400).json({ success: false, error: 'Maximum 500 assets per bulk import' }); return;
    }

    const results: { index: number; success: boolean; id?: string; error?: string }[] = [];
    await Promise.all(assets.map(async (assetData, index) => {
      try {
        const body = assetData as Record<string, unknown>;
        const asset = repo().create({ source_of_truth: 'local', sync_status: 'never', is_managed: false });
        applyBodyToAsset(asset, body);
        await repo().save(asset);
        await saveRelations(asset, body);
        io.emit('asset:created', asset.toApiResponse());
        results.push({ index, success: true, id: asset.id });
      } catch (err) {
        results.push({ index, success: false, error: err instanceof Error ? err.message : 'Unknown error' });
      }
    }));

    results.sort((a, b) => a.index - b.index);
    res.status(207).json({
      success: true,
      data: { succeeded: results.filter((r) => r.success).length, failed: results.filter((r) => !r.success).length, results },
    });
  } catch (error) { next(error); }
};

// ── PATCH /assets/:id ─────────────────────────────────────────────────────────

export const updateAsset = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const assetId = req.params.id;
    const body = req.body as Record<string, unknown>;
    const asset = await loadWithRelations(assetId);
    if (!asset) { res.status(404).json({ success: false, error: 'Asset not found' }); return; }

    // Cycle detection for lifecycle links
    const incomingPred = body.predecessor_id as string | null | undefined;
    const incomingSucc = body.successor_id as string | null | undefined;

    if (incomingPred !== undefined && incomingPred) {
      if (incomingPred === assetId) { res.status(422).json({ success: false, error: 'An asset cannot be its own predecessor' }); return; }
      if (await wouldCreateCycle(assetId, incomingPred, 'predecessor')) {
        res.status(422).json({ success: false, error: 'Setting this predecessor would create a lifecycle cycle' }); return;
      }
    }
    if (incomingSucc !== undefined && incomingSucc) {
      if (incomingSucc === assetId) { res.status(422).json({ success: false, error: 'An asset cannot be its own successor' }); return; }
      if (await wouldCreateCycle(assetId, incomingSucc, 'successor')) {
        res.status(422).json({ success: false, error: 'Setting this successor would create a lifecycle cycle' }); return;
      }
    }

    // Record location history if coordinates changed
    const locBody = body.location as Record<string, unknown> | undefined;
    const newCoords = locBody?.coordinates as { x?: number; y?: number } | undefined;
    if (newCoords !== undefined) {
      const prevX = asset.loc_x, prevY = asset.loc_y;
      if (prevX !== (newCoords.x ?? 0) || prevY !== (newCoords.y ?? 0)) {
        const history = asset.loc_history ?? [];
        history.push({ moved_at: new Date(), from_coordinates: { x: prevX, y: prevY }, to_coordinates: { x: newCoords.x ?? 0, y: newCoords.y ?? 0 } });
        asset.loc_history = history;
      }
    }

    const wasPlaced = asset.is_placed;
    applyBodyToAsset(asset, body);
    const hierarchyMismatch = await findHierarchyMismatch(asset);
    if (hierarchyMismatch) {
      res.status(422).json({ success: false, error: hierarchyMismatch });
      return;
    }
    const collision = await findRackCollision(asset);
    if (collision) {
      res.status(409).json({ success: false, error: `Rack U${asset.u_position} is already occupied by "${collision.display_name}"` });
      return;
    }
    const futureMaint = findFutureMaintenanceDate(asset);
    if (futureMaint) {
      res.status(422).json({ success: false, error: futureMaint });
      return;
    }
    await fillFootprintFromEntityKind(asset, wasPlaced);

    // When wall_port_id is being explicitly cleared, issue a direct SQL UPDATE
    // to bypass TypeORM identity-map / dirty-checking that can swallow null FKs
    if (body.wall_port_id === null) {
      await AppDataSource.createQueryBuilder()
        .update(Asset)
        .set({ wall_port_id: () => 'NULL' })
        .where('id = :id', { id: assetId })
        .execute();
    }

    await repo().save(asset);
    await saveRelations(asset, body);

    // Enforce bidirectional symmetry (best-effort)
    if (incomingPred) {
      await repo().createQueryBuilder().update().set({ successor_id: assetId }).where('id = :id AND successor_id IS NULL', { id: incomingPred }).execute().catch(() => { /* ignore */ });
    }
    if (incomingSucc) {
      await repo().createQueryBuilder().update().set({ predecessor_id: assetId }).where('id = :id AND predecessor_id IS NULL', { id: incomingSucc }).execute().catch(() => { /* ignore */ });
    }

    const full = (await loadWithRelations(assetId))!;
    io.emit('asset:updated', full.toApiResponse());
    res.json({ success: true, data: full.toApiResponse() });
  } catch (error) { next(error); }
};

// ── DELETE /assets/:id ────────────────────────────────────────────────────────

export const deleteAsset = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const asset = await repo().findOne({ where: { id: req.params.id } });
    if (!asset) { res.status(404).json({ success: false, error: 'Asset not found' }); return; }
    const id = req.params.id;

    // asset_connections.asset_id cascades via FK (this asset's own outgoing
    // rows), but connected_asset_id, Asset.predecessor_id/successor_id, and
    // WallPort.switch_asset_id are plain columns with no FK — clean up the
    // dangling inbound references those would otherwise leave behind.
    await connRepo().delete({ connected_asset_id: id });
    await repo().createQueryBuilder().update().set({ predecessor_id: () => 'NULL' }).where('predecessor_id = :id', { id }).execute();
    await repo().createQueryBuilder().update().set({ successor_id: () => 'NULL' }).where('successor_id = :id', { id }).execute();
    await wallPortRepo().createQueryBuilder().update().set({ switch_asset_id: () => 'NULL', switch_port: () => 'NULL' }).where('switch_asset_id = :id', { id }).execute();

    await repo().remove(asset);
    io.emit('asset:deleted', { _id: id });
    res.json({ success: true, message: 'Asset deleted successfully' });
  } catch (error) { next(error); }
};

// ── POST /assets/:id/replace ──────────────────────────────────────────────
// A broken/retired asset is swapped for a replacement: the replacement
// inherits the old asset's map position, hierarchy, and wall-port
// assignment, every connection (both directions) is re-pointed at the
// replacement, and — if the old asset was itself a switch — every WallPort
// wired into one of its ports (switch_asset_id) follows it too. The old
// asset keeps existing (for audit/history — see predecessor_id/successor_id)
// but is cleared to unplaced, matching it having been physically removed.
export const replaceAsset = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const oldId = req.params.id;
    const { replacement_id: newId } = req.body as { replacement_id: string };
    if (!newId) { res.status(400).json({ success: false, error: 'replacement_id is required' }); return; }
    if (newId === oldId) { res.status(422).json({ success: false, error: 'An asset cannot replace itself' }); return; }

    const oldAsset = await repo().findOne({ where: { id: oldId } });
    const newAsset = await repo().findOne({ where: { id: newId } });
    if (!oldAsset) { res.status(404).json({ success: false, error: 'Asset to replace not found' }); return; }
    if (!newAsset) { res.status(404).json({ success: false, error: 'Replacement asset not found' }); return; }

    // Transfer position, hierarchy, and physical wiring to the replacement.
    newAsset.building_id = oldAsset.building_id;
    newAsset.floor_id = oldAsset.floor_id;
    newAsset.workarea_id = oldAsset.workarea_id;
    newAsset.section_id = oldAsset.section_id;
    newAsset.workstation_id = oldAsset.workstation_id;
    newAsset.rack_id = oldAsset.rack_id;
    newAsset.u_position = oldAsset.u_position;
    newAsset.rack_u_size = oldAsset.rack_u_size;
    newAsset.loc_x = oldAsset.loc_x;
    newAsset.loc_y = oldAsset.loc_y;
    newAsset.loc_rotation = oldAsset.loc_rotation;
    newAsset.loc_footprint = oldAsset.loc_footprint;
    newAsset.is_placed = oldAsset.is_placed;
    newAsset.wall_port_id = oldAsset.wall_port_id;
    newAsset.predecessor_id = oldId;
    await repo().save(newAsset);

    // Clear the old asset out of its physical slot — it's been removed.
    oldAsset.successor_id = newId;
    oldAsset.is_placed = false;
    oldAsset.loc_x = 0;
    oldAsset.loc_y = 0;
    oldAsset.workarea_id = null;
    oldAsset.section_id = null;
    oldAsset.workstation_id = null;
    oldAsset.rack_id = null;
    oldAsset.u_position = null;
    await repo().save(oldAsset);
    // wall_port_id=null bypasses the same TypeORM identity-map quirk worked
    // around in updateAsset — see the comment there.
    await AppDataSource.createQueryBuilder().update(Asset).set({ wall_port_id: () => 'NULL' }).where('id = :id', { id: oldId }).execute();

    // Re-point every connection (either direction) from the old asset to the
    // replacement. A row that would become self-referencing (the old asset
    // was directly connected to its own replacement) is dropped instead.
    await connRepo().createQueryBuilder().update().set({ asset_id: newId })
      .where('asset_id = :oldId AND connected_asset_id != :newId', { oldId, newId }).execute();
    await connRepo().createQueryBuilder().update().set({ connected_asset_id: newId })
      .where('connected_asset_id = :oldId AND asset_id != :newId', { oldId, newId }).execute();
    await connRepo().delete({ asset_id: newId, connected_asset_id: newId });

    // If the old asset was itself a switch, every WallPort wired into one of
    // its ports (switch_asset_id) needs to follow it to the replacement too —
    // otherwise those wall ports keep pointing at the now-retired switch.
    await wallPortRepo().createQueryBuilder().update().set({ switch_asset_id: newId })
      .where('switch_asset_id = :oldId', { oldId }).execute();

    const fullOld = (await loadWithRelations(oldId))!;
    const fullNew = (await loadWithRelations(newId))!;
    io.emit('asset:updated', fullOld.toApiResponse());
    io.emit('asset:updated', fullNew.toApiResponse());

    // Written manually rather than via the auditLog middleware — that
    // middleware infers create/update/delete from req.method alone (this is
    // a POST, so it would be misfiled as "create") and expects a single
    // flat asset in the response body, not this endpoint's { old, new } pair.
    const user = (req as AuthRequest).user;
    if (user) {
      const logRepo = AppDataSource.getRepository(AuditLog);
      await logRepo.save(logRepo.create({
        user_id: user.id, username: user.username, action: 'update',
        entity_type: 'asset', document_id: oldId,
        diff: { replaced_by: newId, note: 'Asset replaced — cleared to unplaced, connections transferred to replacement' },
      })).catch(() => { /* audit failure must never fail the request */ });
      await logRepo.save(logRepo.create({
        user_id: user.id, username: user.username, action: 'update',
        entity_type: 'asset', document_id: newId,
        diff: { replaces: oldId, note: 'Inherited position, hierarchy, wall-port assignment, and connections from replaced asset' },
      })).catch(() => { /* audit failure must never fail the request */ });
    }

    res.json({ success: true, data: { old: fullOld.toApiResponse(), new: fullNew.toApiResponse() }, message: 'Asset replaced successfully' });
  } catch (error) { next(error); }
};

// ── ITSM mock sync ────────────────────────────────────────────────────────────

const MOCK_STATUSES = ['active', 'active', 'active', 'maintenance', 'inactive'] as const;
const MOCK_SOFTWARE: Record<string, { display_name: string; vendor: string; version: string }[]> = {
  workstation: [
    { display_name: 'Windows 11 Pro', vendor: 'Microsoft', version: '23H2' },
    { display_name: 'Chrome', vendor: 'Google', version: '123.0' },
  ],
  server: [
    { display_name: 'Ubuntu Server', vendor: 'Canonical', version: '22.04 LTS' },
    { display_name: 'Docker Engine', vendor: 'Docker Inc', version: '25.0' },
  ],
  laptop: [
    { display_name: 'Windows 11 Pro', vendor: 'Microsoft', version: '23H2' },
    { display_name: 'Office 365', vendor: 'Microsoft', version: '2024' },
  ],
};

export const syncAssetFromITSM = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const asset = await loadWithRelations(req.params.id);
    if (!asset) { res.status(404).json({ success: false, error: 'Asset not found' }); return; }
    if (!asset.is_managed || !asset.hardware_asset_id) {
      res.status(400).json({ success: false, error: 'Asset is not ITSM managed' }); return;
    }

    const assetType = asset.asset_type ?? 'workstation';
    const newStatus = MOCK_STATUSES[Math.floor(Math.random() * MOCK_STATUSES.length)];
    const softwareList = MOCK_SOFTWARE[assetType] ?? MOCK_SOFTWARE.workstation;

    asset.last_synced = new Date();
    asset.sync_status = 'success';
    asset.status = newStatus;
    await repo().save(asset);

    await softwareRepo().delete({ asset_id: asset.id });
    const rows = softwareList.map((s) => softwareRepo().create({ asset_id: asset.id, display_name: s.display_name, vendor: s.vendor, version: s.version, source: 'itsm' }));
    await softwareRepo().save(rows);

    const full = (await loadWithRelations(asset.id))!;
    res.json({ success: true, data: full.toApiResponse(), message: `Synced: status → ${newStatus}, ${softwareList.length} software items updated` });
  } catch (error) { next(error); }
};

// ── Connections ───────────────────────────────────────────────────────────────
// A pair of assets can have multiple distinct connections between them (e.g.
// two physical ethernet cables, or one ethernet + one power link) — identity
// is each row's own `id`, never the (asset_id, connected_asset_id) pair. When
// bidirectional, addConnection creates a second, mirrored row sharing a
// `pair_id` so update/remove can act on both sides together — see
// AssetConnection.entity.ts.

interface ConnectionBody {
  connected_asset_id: string;
  connection_type: string;
  description?: string | null;
  label?: string | null;
  bidirectional?: boolean;
  strength?: string;
  patch_panel?: { panel_name?: string; panel_port?: string; switch_name?: string; switch_port?: string } | null;
  source_port?: string | null;
  target_port?: string | null;
}

export const addConnection = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const asset = await loadWithRelations(req.params.id);
    if (!asset) { res.status(404).json({ success: false, error: 'Asset not found' }); return; }
    const connData = req.body as ConnectionBody;
    if (req.params.id === connData.connected_asset_id) {
      res.status(422).json({ success: false, error: 'An asset cannot connect to itself' }); return;
    }
    // Block only an exact duplicate (same peer, type, and label) — distinct
    // connections to the same peer (a second cable, a different link type)
    // are a legitimate, common case and must be allowed.
    const exactDuplicate = (asset.connections ?? []).find((c) =>
      c.connected_asset_id === connData.connected_asset_id &&
      c.connection_type === connData.connection_type &&
      (c.label ?? null) === (connData.label ?? null)
    );
    if (exactDuplicate) { res.status(400).json({ success: false, error: 'An identical connection already exists' }); return; }

    const bidirectional = connData.bidirectional ?? true;
    const pairId = bidirectional ? randomUUID() : null;
    const conn = connRepo().create({ asset_id: req.params.id, ...connData, bidirectional, pair_id: pairId });
    await connRepo().save(conn);
    if (bidirectional) {
      const mirror = connRepo().create({
        ...connData,
        asset_id: connData.connected_asset_id,
        connected_asset_id: req.params.id,
        bidirectional: true,
        pair_id: pairId,
      });
      await connRepo().save(mirror);
    }
    const full = (await loadWithRelations(req.params.id))!;
    res.status(201).json({ success: true, data: full.toApiResponse(), message: 'Connection added successfully' });
  } catch (error) { next(error); }
};

export const updateConnection = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id, connectionId } = req.params;
    const conn = await connRepo().findOne({ where: { id: connectionId, asset_id: id } });
    if (!conn) { res.status(404).json({ success: false, error: 'Connection not found' }); return; }
    const body = req.body as Partial<{ connection_type: string; description: string; label: string; bidirectional: boolean; strength: string; patch_panel: { panel_name?: string; panel_port?: string; switch_name?: string; switch_port?: string } | null; source_port: string | null; target_port: string | null }>;
    // Apply the same field changes to both rows of a bidirectional pair
    // (direction-specific fields — asset_id/connected_asset_id — are never
    // touched here) so the two sides never drift apart.
    if (conn.pair_id) {
      await connRepo().update({ pair_id: conn.pair_id }, body);
    } else {
      Object.assign(conn, body);
      await connRepo().save(conn);
    }
    const full = (await loadWithRelations(id))!;
    res.json({ success: true, data: full.toApiResponse(), message: 'Connection updated successfully' });
  } catch (error) { next(error); }
};

export const removeConnection = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id, connectionId } = req.params;
    const conn = await connRepo().findOne({ where: { id: connectionId, asset_id: id } });
    if (!conn) { res.status(404).json({ success: false, error: 'Connection not found' }); return; }
    if (conn.pair_id) {
      await connRepo().delete({ pair_id: conn.pair_id });
    } else {
      await connRepo().remove(conn);
    }
    const full = (await loadWithRelations(id))!;
    res.json({ success: true, data: full.toApiResponse(), message: 'Connection removed successfully' });
  } catch (error) { next(error); }
};

// ── GET /assets/maintenance-counts ───────────────────────────────────────────
// An asset that has been replaced (see replaceAsset) keeps its own
// maint_next_date forever — nothing ever clears it once the asset is
// decommissioned. Without the successor_id exclusion below, a replaced
// asset with a stale next_date would count as "overdue" indefinitely,
// permanently inflating the dashboard even after the real, live equipment
// (the replacement) has no maintenance issue at all.

export const getMaintenanceCounts = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const now = new Date();
    const in30 = new Date(now.getTime() + 30 * 86400_000);

    const [overdue, due_soon] = await Promise.all([
      repo().createQueryBuilder('a')
        .where('a.maint_next_date IS NOT NULL')
        .andWhere('a.maint_next_date < :now', { now })
        .andWhere('a.successor_id IS NULL')
        .getCount(),
      repo().createQueryBuilder('a')
        .where('a.maint_next_date IS NOT NULL')
        .andWhere('a.maint_next_date >= :now', { now })
        .andWhere('a.maint_next_date <= :in30', { in30 })
        .andWhere('a.successor_id IS NULL')
        .getCount(),
    ]);

    res.json({ success: true, data: { overdue, due_soon } });
  } catch (error) { next(error); }
};
