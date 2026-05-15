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
 *    asset_connections table. Remove also cleans up the reverse direction.
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
import { Request, Response, NextFunction } from 'express';
import { AppDataSource } from '../config/database';
import { Asset } from '../entities/Asset.entity';
import { AssetSoftware } from '../entities/AssetSoftware.entity';
import { AssetConnection } from '../entities/AssetConnection.entity';
import { io } from '../server';

const repo = () => AppDataSource.getRepository(Asset);
const softwareRepo = () => AppDataSource.getRepository(AssetSoftware);
const connRepo = () => AppDataSource.getRepository(AssetConnection);

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

function isPlacedFromCoords(x: number, y: number): boolean {
  return x !== 0 || y !== 0;
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
  }

  const hier = body.hierarchy as Record<string, unknown> | undefined;
  if (hier) {
    if (hier.building_id !== undefined) asset.building_id = (hier.building_id as string) ?? null;
    if (hier.floor_id !== undefined) asset.floor_id = (hier.floor_id as string) ?? null;
    if (hier.workarea_id !== undefined) asset.workarea_id = (hier.workarea_id as string) ?? null;
    if (hier.section_id !== undefined) asset.section_id = (hier.section_id as string) ?? null;
    if (hier.workstation_id !== undefined) asset.workstation_id = (hier.workstation_id as string) ?? null;
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
  return repo().findOne({ where: { id }, relations: ['software', 'connections'] });
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
    const { page, limit, floor_id, building_id, workarea_id, section_id, status, type, is_placed, q, include_connections } =
      req.query as Record<string, string | undefined>;

    const qb = repo().createQueryBuilder('a');

    if (include_connections === 'true') {
      qb.leftJoinAndSelect('a.connections', 'conn');
    }

    if (floor_id)    qb.andWhere('a.floor_id = :floor_id', { floor_id });
    if (building_id) qb.andWhere('a.building_id = :building_id', { building_id });
    if (workarea_id) qb.andWhere('a.workarea_id = :workarea_id', { workarea_id });
    if (section_id)  qb.andWhere('a.section_id = :section_id', { section_id });
    if (status)      qb.andWhere('a.status = :status', { status });
    if (type)        qb.andWhere('a.asset_type = :type', { type });
    if (is_placed !== undefined) qb.andWhere('a.is_placed = :is_placed', { is_placed: is_placed === 'true' ? 1 : 0 });

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
      const l = Math.min(200, Math.max(1, parseInt(limit, 10)));
      qb.skip((p - 1) * l).take(l);
      const [assets, total] = await qb.getManyAndCount();
      res.json({ success: true, data: assets.map((a) => a.toApiResponse()), total, page: p, limit: l, pages: Math.ceil(total / l) });
    } else {
      const assets = await qb.getMany();
      res.json({ success: true, data: assets.map((a) => a.toApiResponse()) });
    }
  } catch (error) { next(error); }
};

// ── GET /assets/:id ───────────────────────────────────────────────────────────

export const getAssetById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const asset = await loadWithRelations(req.params.id);
    if (!asset) { res.status(404).json({ success: false, error: 'Asset not found' }); return; }
    res.json({ success: true, data: asset.toApiResponse() });
  } catch (error) { next(error); }
};

// ── POST /assets ──────────────────────────────────────────────────────────────

export const createAsset = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const body = req.body as Record<string, unknown>;
    const asset = repo().create({ source_of_truth: 'local', sync_status: 'never', is_managed: false });
    applyBodyToAsset(asset, body);
    await repo().save(asset);
    await saveRelations(asset, body);
    const full = (await loadWithRelations(asset.id))!;
    io.emit('asset:created', full.toApiResponse());
    res.status(201).json({ success: true, data: full.toApiResponse() });
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

    applyBodyToAsset(asset, body);
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
    await repo().remove(asset);
    io.emit('asset:deleted', { _id: req.params.id });
    res.json({ success: true, message: 'Asset deleted successfully' });
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

export const addConnection = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const asset = await loadWithRelations(req.params.id);
    if (!asset) { res.status(404).json({ success: false, error: 'Asset not found' }); return; }
    const connData = req.body as { connected_asset_id: string; connection_type: string; description?: string; label?: string; bidirectional?: boolean; strength?: string; patch_panel?: { panel_name?: string; panel_port?: string; switch_name?: string; switch_port?: string } | null };
    const existing = (asset.connections ?? []).find((c) => c.connected_asset_id === connData.connected_asset_id);
    if (existing) { res.status(400).json({ success: false, error: 'Connection already exists' }); return; }
    const conn = connRepo().create({ asset_id: req.params.id, ...connData });
    await connRepo().save(conn);
    const full = (await loadWithRelations(req.params.id))!;
    res.status(201).json({ success: true, data: full.toApiResponse(), message: 'Connection added successfully' });
  } catch (error) { next(error); }
};

export const updateConnection = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id, connectedAssetId } = req.params;
    const conn = await connRepo().findOne({ where: { asset_id: id, connected_asset_id: connectedAssetId } });
    if (!conn) { res.status(404).json({ success: false, error: 'Connection not found' }); return; }
    const body = req.body as Partial<{ connection_type: string; description: string; label: string; bidirectional: boolean; strength: string; patch_panel: { panel_name?: string; panel_port?: string; switch_name?: string; switch_port?: string } | null }>;
    Object.assign(conn, body);
    await connRepo().save(conn);
    const full = (await loadWithRelations(id))!;
    res.json({ success: true, data: full.toApiResponse(), message: 'Connection updated successfully' });
  } catch (error) { next(error); }
};

export const removeConnection = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id, connectedAssetId } = req.params;
    const conn = await connRepo().findOne({ where: { asset_id: id, connected_asset_id: connectedAssetId } });
    if (!conn) { res.status(404).json({ success: false, error: 'Connection not found' }); return; }
    await connRepo().remove(conn);
    // Remove reverse connection too
    await connRepo().delete({ asset_id: connectedAssetId, connected_asset_id: id });
    const full = (await loadWithRelations(id))!;
    res.json({ success: true, data: full.toApiResponse(), message: 'Connection removed successfully' });
  } catch (error) { next(error); }
};

// ── GET /assets/maintenance-counts ───────────────────────────────────────────

export const getMaintenanceCounts = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const now = new Date();
    const in30 = new Date(now.getTime() + 30 * 86400_000);

    const [overdue, due_soon] = await Promise.all([
      repo().createQueryBuilder('a')
        .where('a.maint_next_date IS NOT NULL')
        .andWhere('a.maint_next_date < :now', { now })
        .getCount(),
      repo().createQueryBuilder('a')
        .where('a.maint_next_date IS NOT NULL')
        .andWhere('a.maint_next_date >= :now', { now })
        .andWhere('a.maint_next_date <= :in30', { in30 })
        .getCount(),
    ]);

    res.json({ success: true, data: { overdue, due_soon } });
  } catch (error) { next(error); }
};
