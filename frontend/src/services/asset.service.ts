/**
 * asset.service.ts — All API calls related to assets.
 *
 * The `Asset` interface defines the complete frontend view of an asset, mirroring
 * the nested JSON shape returned by `Asset.toApiResponse()` on the backend.
 *
 * `normalizeAsset()` is applied to every API response to ensure required fields
 * (`basic_info`, `itsm`) always have a safe default value, preventing null-reference
 * errors in components that assume these objects are always present.
 *
 * Methods:
 *  - `getAssets()`: all assets (no filter)
 *  - `getAssetsByFloor(floorId)`: assets on a specific floor
 *  - `getAsset(id)`: single asset with software and connections
 *  - `createAsset(data)`: create a new asset
 *  - `updateAsset(id, data)`: partial update (PATCH)
 *  - `deleteAsset(id)`: delete
 *  - `bulkCreateAssets(assets)`: up to 500 assets in one call; returns per-item results
 *  - `syncAsset(id)`: trigger ITSM sync for one asset
 *  - `addConnection / updateConnection / removeConnection`: manage asset links
 *  - `getAssetsWithConnections()`: all assets with connections joined (network graph/topology)
 *  - `getAssetsByBuilding(buildingId)`: assets in one building
 *  - `getAssetsByRack(rackId)`: devices mounted in one rack
 *  - `getAssetsByIds(ids)`: named assets only — for resolving a connection's far end
 *  - `getAssetsConnectedTo(id)`: assets whose one-way links point at this asset
 *  - `notifyWorkItem(assetId, itemId)`: send immediate alert for one work-item task
 *  - `acceptItsmSnapshot(id)`: promote pending ITSM snapshot to live data
 *  - `syncAllFromItsm()`: full ITSM sync
 *  - `getAssetHistory(id)`: recent audit log entries for an asset
 */
import api from './api';

/**
 * Rows per request when sweeping the whole asset list. Matches the server's own
 * per-page maximum (see getAllAssets), so the sweep uses the fewest round trips
 * the API allows.
 */
const ASSET_PAGE_SIZE = 500;
/** Most pages one sweep will fetch — 25k assets. See getAssets. */
const PAGE_CEILING = 50;

/** Counts computed server-side over every asset — see assetService.getStats. */
export interface AssetStats {
  total: number;
  itsm_managed: number;
  unplaced: number;
  maintenance_overdue: number;
  maintenance_due_soon: number;
  itsm_conflicts: number;
  /** Keyed by status; assets with none are counted under "unknown". */
  by_status: Record<string, number>;
  /** Keyed by type; assets with none are counted under "untyped". */
  by_type: Record<string, number>;
  /** Keyed by floor id; assets on no floor are counted under "unassigned". */
  by_floor: Record<string, number>;
}

export type AssetStatus = 'active' | 'inactive' | 'maintenance' | 'retired';

export interface AssetItsmSnapshot {
  display_name?: string;
  serial_number?: string;
  asset_tag?: string;
  mac_address?: string;
  status?: string;
  person_name?: string;
  person_itsm_id?: string;
  organization_name?: string;
  organization_itsm_id?: string;
  catalog_item_name?: string;
  catalog_item_itsm_id?: string;
  synced_at?: string;
}

export interface AssetHistoryEntry {
  _id: string;
  action: string;
  document_id: string;
  collection: string;
  changed_by?: string;
  changes?: Record<string, { old: unknown; new: unknown }>;
  created_at: string;
}

// Joined IFS/CMDB master data (see backend/src/entities/MasterAsset.entity.ts).
// Populated only when the API call resolves the join (GET /assets/:id always;
// GET /assets only with ?include_master=true) — absent (undefined) means "not
// requested", null means "requested but no matching master row" (orphan).
export interface AssetMasterData {
  ifs_id: string;
  ifs_site: string | null;
  ifs_operational_status: string | null;
  ifs_machine_id: string | null;
  ifs_machine_part_no: string | null;
  ifs_machine_part_description: string | null;
  ifs_production_line_id: string | null;
  ifs_workcenter_id: string | null;
  ifs_workcenter_description: string | null;
  ifs_cost_center: string | null;
  // OT-asset-shape extras (present on IT/network devices — see MasterAsset.entity.ts)
  ifs_part_no: string | null;
  ifs_part_description: string | null;
  ifs_serial_state: string | null;
  ifs_operational_condition: string | null;
  ifs_server_path: string | null;
  cmdb_id: string | null;
  cmdb_status: string | null;
  cmdb_mac_address: string | null;
  cmdb_catalog_item: string | null;
  cmdb_os: string | null;
  cmdb_os_version: string | null;
  cmdb_manufacturer: string | null;
  cmdb_model: string | null;
  cmdb_serial_number: string | null;
  cmdb_received_date: string | null;
}

export interface Asset {
  _id: string;
  // Soft join to MasterAsset.ifs_id (IFS/CMDB) — see AssetMasterData above.
  master_ifs_id?: string | null;
  master?: AssetMasterData | null;
  // Soft join to EntityKind.value — see backend/src/entities/EntityKind.entity.ts.
  entity_kind?: string | null;
  predecessor_id?: string | null;
  successor_id?: string | null;
  is_placed?: boolean;
  hierarchy: {
    building_id:  string | null;
    floor_id:     string | null;
    workarea_id:  string | null;
    section_id:   string | null;
    workstation_id: string | null;
    rack_id?:     string | null;
    u_position?:  number | null;
    rack_u_size?: number;
  };
  itsm: {
    itsm_guid?: string | null;
    hardware_asset_id: string | null;
    asset_class?: string | null;
    itsm_modified_at?: string | null;
    source_of_truth?: 'local' | 'itsm';
    is_managed: boolean;
    last_synced: string | null;
    sync_status: 'success' | 'failed' | 'never';
  };
  itsm_snapshot?: AssetItsmSnapshot | null;
  organization?: {
    itsm_id?: string;
    display_name?: string;
  };
  catalog_item?: {
    itsm_id?: string;
    display_name?: string;
  };
  basic_info: {
    display_name: string;
    asset_tag?: string;
    serial_number?: string;
    model?: string;
    manufacturer?: string;
    status?: AssetStatus;
    type?: string;
    os_type?: string;
    os_version?: string;
    mac_address?: string;  // ← HOZZÁADVA
  };
  technical_specs?: {  // ← HOZZÁADVA
    cpu?: string;
    ram?: string;
    storage?: string;
    gpu?: string;
  };
  network?: {
    ip_address?: string;
    hostname?: string;
    vlan?: string;
    switch_port?: string;
    dhcp_static?: 'dhcp' | 'static' | 'unknown' | null;
  };
  assigned_person?: {
    person_id: string;
    itsm_id?: string;
    full_name: string;
  };
  software?: Array<{  // ← HOZZÁADVA
    software_id: string | null;
    display_name: string;
    vendor?: string;
    version?: string;
    source: 'itsm' | 'manual';
  }>;
  work_items?: Array<{
    id: string;
    title: string;
    description: string;
    done: boolean;
    priority: 'low' | 'medium' | 'high';
    due_date: string | null;
    assigned_to: string | null;
    alert_sent: boolean;
    created_at: string;
  }>;
  wall_port_id?: string | null;
  wall_port?: {
    _id: string;
    label: string;
    floor_id: string;
    patch_panel_id: string | null;
    patch_panel_name: string | null;
    patch_port: number | null;
    /** Ids so the UI can link to the rack view where patching happens. */
    rack_id?: string | null;
    rack_name: string | null;
    building_id?: string | null;
    room_name: string | null;
    room_type: string | null;
    switch_asset_id: string | null;
    switch_port: string | null;
    description: string | null;
  } | null;
  connections?: Array<{
    // Each connection's own identity — never derive identity from
    // (asset, connected_asset) since a pair can have several distinct
    // connections (e.g. two physical cables). Bidirectional connections
    // share `pair_id` across their two mirrored rows (see
    // AssetConnection.entity.ts) so update/remove can act on both sides.
    id: string;
    pair_id?: string | null;
    connected_asset_id: string;
    connection_type: 'network' | 'power' | 'usb' | 'serial' | 'parallel' | 'bluetooth' | 'wifi' | 'ethernet' | 'fiber' | 'dependency' | 'parent-child' | 'peer' | 'other';
    description?: string;
    label?: string;
    bidirectional?: boolean;
    strength?: 'weak' | 'normal' | 'strong';
    patch_panel?: {
      panel_name?: string;
      panel_port?: string;
      switch_name?: string;
      switch_port?: string;
    } | null;
    source_port?: string | null;
    target_port?: string | null;
    created_at?: string;
  }>;
  location: {
    coordinates: { x: number; y: number };
    rotation?: number;  // ← HOZZÁADVA
    icon_type?: string;  // ← HOZZÁADVA
    description?: string;
    // Optional footprint polygon (cm, centered on coordinates) — stored but
    // not yet rendered on the map; see docs/DATA_MODEL_MIGRATION.md.
    footprint?: Array<[number, number]> | null;
    history?: Array<{
      moved_at: string;
      from_coordinates: { x: number; y: number };
      to_coordinates: { x: number; y: number };
      moved_by?: string;
      reason?: string;
    }>;
  };
  custom_fields?: {
    physical_condition?: 'Good' | 'Fair' | 'Poor';
    environment?: string;
    notes?: string;
    tags?: string[];
    object_id?: string;
    serial_object?: string;
    remote_access_tool?: string;
    remote_access_version?: string;
    backup_tool?: string;
    backup_status?: 'active' | 'inactive' | 'error' | 'not_configured';
    winupdate_date?: string;
    fortiedr_active?: boolean;
  };
  maintenance?: {
    last_date?: string;
    next_date?: string;
    interval_days?: number;
    notes?: string;
  };
  created_at?: string;
  updated_at?: string;
}

const normalizeAsset = (a: Asset): Asset => ({
  ...a,
  basic_info: a.basic_info ?? { display_name: a._id ?? 'Unknown' },
  itsm: a.itsm ?? { hardware_asset_id: null, is_managed: false, last_synced: null, sync_status: 'never' },
});

/**
 * Every asset matching `params`, fetched page by page — the shared body behind
 * getAssets() and getAssetsWithConnections(). See getAssets for why paging rather
 * than one unpaginated call, and what the ceiling means.
 */
const sweepAllPages = async (params: Record<string, string | number>): Promise<Asset[]> => {
  const all: Asset[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    const response = await api.get('/assets', {
      params: { page, limit: ASSET_PAGE_SIZE, ...params },
    });
    all.push(...(response.data.data as Asset[]).map(normalizeAsset));
    totalPages = response.data.meta?.totalPages ?? 1;
    page++;
  } while (page <= totalPages && page <= PAGE_CEILING);

  assetService.lastFetchWasTruncated = totalPages > PAGE_CEILING;
  return all;
};

/**
 * Ids per `?ids=` request. Well under the server's 500 so the URL stays a sane
 * length; peer lookups are normally a handful of ids and never hit this.
 */
const ID_LOOKUP_CHUNK = 100;

export const assetService = {
  // Get all assets
  /**
   * Every asset, fetched page by page.
   *
   * A single unpaginated call caps at 1000 rows server-side, which silently hid
   * the 57th-to-last asset onward from every list, filter and picker built on
   * this. Paging through instead means the caller gets the whole set and the
   * client-side filtering they already do stays correct.
   *
   * `PAGE_CEILING` is a real limit, not a formality: at some estate size shipping
   * everything to the browser stops being reasonable, and the honest thing is to
   * stop and say so rather than either hang or truncate quietly. When it trips,
   * `lastFetchWasTruncated` goes true and the Dashboard says how many are missing.
   * The proper fix at that point is server-side filtering and sorting for the
   * list, not a bigger ceiling.
   */
  getAssets: async (opts?: { include_master?: boolean }): Promise<Asset[]> =>
    sweepAllPages(opts?.include_master ? { include_master: 'true' } : {}),

  /**
   * Whether the last getAssets() stopped at the ceiling rather than the end of the
   * data. Read by the Dashboard so a partial list is never presented as complete.
   */
  lastFetchWasTruncated: false,

  // Assets whose master_ifs_id points at a MasterAsset row that no longer
  // resolves (see MasterAsset.entity.ts / attachMasterData) — filtered
  // server-side, not fetched-then-filtered, so this stays cheap at scale.
  getOrphanedAssets: async (): Promise<Asset[]> => {
    const response = await api.get('/assets', { params: { orphaned: 'true' } });
    return (response.data.data as Asset[]).map(normalizeAsset);
  },

  /**
   * Every asset including its connections — for views that really do draw the whole
   * topology (NetworkGraph, the reports, NetworkInfrastructure).
   *
   * Paged, like getAssets: this used to be one unpaginated call, which the server
   * caps at 1000 rows, so with 1057 assets the graph was quietly missing nodes and
   * any edge that ended on one of them.
   *
   * If all you need is to *name* the far end of a link, don't use this — fetch those
   * ids with getAssetsByIds instead.
   */
  getAssetsWithConnections: async (): Promise<Asset[]> =>
    sweepAllPages({ include_connections: 'true' }),

  /** Assets in one building. Server-filtered, for the pickers that only need one. */
  getAssetsByBuilding: async (buildingId: string): Promise<Asset[]> => {
    const response = await api.get('/assets', { params: { building_id: buildingId } });
    return (response.data.data as Asset[]).map(normalizeAsset);
  },

  /**
   * Devices mounted in one rack. Server-filtered: the rack view used to fetch every
   * asset with its connections to find the handful in one cabinet.
   */
  getAssetsByRack: async (rackId: string): Promise<Asset[]> => {
    const response = await api.get('/assets', {
      params: { rack_id: rackId, include_connections: 'true' },
    });
    return (response.data.data as Asset[]).map(normalizeAsset);
  },

  /**
   * Specific assets by id, chunked. For resolving connection peers — the asset on
   * another floor, the switch behind a socket — without downloading the estate.
   * Unknown ids are simply absent from the result.
   */
  getAssetsByIds: async (ids: string[]): Promise<Asset[]> => {
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) return [];
    const chunks: string[][] = [];
    for (let i = 0; i < unique.length; i += ID_LOOKUP_CHUNK) {
      chunks.push(unique.slice(i, i + ID_LOOKUP_CHUNK));
    }
    const responses = await Promise.all(
      chunks.map((chunk) => api.get('/assets', { params: { ids: chunk.join(',') } })),
    );
    return responses.flatMap((r) => (r.data.data as Asset[]).map(normalizeAsset));
  },

  /**
   * Assets with a connection pointing AT this one. Only one-way links turn up —
   * bidirectional ones are mirrored onto both assets already, so the asset's own
   * connections list has them.
   */
  getAssetsConnectedTo: async (assetId: string): Promise<Asset[]> => {
    const response = await api.get('/assets', {
      params: { connected_to: assetId, include_connections: 'true' },
    });
    return (response.data.data as Asset[]).map(normalizeAsset);
  },

  // Get assets filtered by floor ID (includes connections for map rendering,
  // and optionally the resolved master-data join so the map can flag
  // orphaned assets — see getOrphanedAssets)
  getAssetsByFloor: async (floorId: string, opts?: { include_master?: boolean }): Promise<Asset[]> => {
    const response = await api.get('/assets', {
      params: { floor_id: floorId, include_connections: 'true', ...(opts?.include_master ? { include_master: 'true' } : {}) },
    });
    return (response.data.data as Asset[]).map(normalizeAsset);
  },

  // IT-managed devices (IPCs, etc.) mounted on the physical machine this
  // asset represents — see backend/src/entities/MasterAsset.entity.ts
  // ifs_machine_id. Empty when the asset isn't IFS-joined or is itself an
  // IT device rather than a machine.
  getOtChildren: async (id: string): Promise<AssetMasterData[]> => {
    const response = await api.get(`/assets/${id}/ot-children`);
    return response.data.data as AssetMasterData[];
  },

  // Get asset by ID
  getAsset: async (id: string): Promise<Asset> => {
    const response = await api.get(`/assets/${id}`);
    return normalizeAsset(response.data.data);
  },

  // Create asset  ← ÚJ
  createAsset: async (data: Partial<Asset>): Promise<Asset> => {
    const response = await api.post('/assets', data);
    return normalizeAsset(response.data.data);
  },

  // Update asset  ← ÚJ
  updateAsset: async (id: string, data: Partial<Asset>): Promise<Asset> => {
    const response = await api.patch(`/assets/${id}`, data);
    return normalizeAsset(response.data.data);
  },

  // Delete asset
  deleteAsset: async (id: string): Promise<void> => {
    await api.delete(`/assets/${id}`);
  },

  // Bulk create assets
  bulkCreateAssets: async (assets: Partial<Asset>[]): Promise<{
    succeeded: number;
    failed: number;
    results: Array<{ index: number; success: boolean; id?: string; error?: string }>;
  }> => {
    const response = await api.post('/assets/bulk', { assets });
    return response.data.data;
  },

  // Sync asset from ITSM
  syncAsset: async (id: string): Promise<Asset> => {
    const response = await api.post(`/assets/${id}/sync`);
    return normalizeAsset(response.data.data);
  },

  // Connection management methods
  addConnection: async (assetId: string, connectionData: {
    connected_asset_id: string;
    connection_type: string;
    description?: string;
    label?: string;
    bidirectional?: boolean;
    strength?: string;
    patch_panel?: { panel_name?: string; panel_port?: string; switch_name?: string; switch_port?: string } | null;
    source_port?: string | null;
    target_port?: string | null;
  }): Promise<Asset> => {
    const response = await api.post(`/assets/${assetId}/connections`, connectionData);
    return response.data.data;
  },

  updateConnection: async (assetId: string, connectionId: string, connectionData: {
    connection_type: string;
    description?: string;
    label?: string;
    bidirectional?: boolean;
    strength?: string;
    patch_panel?: { panel_name?: string; panel_port?: string; switch_name?: string; switch_port?: string } | null;
    source_port?: string | null;
    target_port?: string | null;
  }): Promise<Asset> => {
    const response = await api.patch(`/assets/${assetId}/connections/${connectionId}`, connectionData);
    return response.data.data;
  },

  /**
   * Applies the same few changes to many assets in one request.
   *
   * Deliberately narrow — room, person, status, clearing the placement — because
   * those are the fields that turn out wrong in groups after an inventory import.
   * Identity and ITSM-owned fields are rejected server-side.
   *
   * Assigning a room derives the floor and building from it, and returns any
   * already-placed asset to the unplaced tray, since its coordinates were
   * relative to the room it left.
   */
  /**
   * Headline counts over the WHOLE table.
   *
   * `getAssets()` caps at 1000 rows, so anything derived from its length is wrong
   * the moment the estate is bigger than that — which it already is. Totals,
   * charts and tiles must come from here instead.
   */
  getStats: async (): Promise<AssetStats> => {
    const response = await api.get('/assets/stats');
    return response.data.data;
  },

  /**
   * Distinct people the assets know about, for the person autocomplete.
   *
   * A dedicated endpoint rather than deriving it from a full asset download: that
   * shipped 1.65 MB to collect a few hundred names, and it required an id as well
   * as a name, which excluded everyone the inventory survey contributes — informal
   * names kept as free text with no id, i.e. exactly the people most likely to be
   * typed into this field.
   */
  getPersons: async (): Promise<Array<{ full_name: string; person_id: string | null }>> => {
    const response = await api.get('/assets/persons');
    return response.data.data;
  },

  /**
   * Server-side search. Used instead of filtering the cached list, so an asset
   * beyond the 1000-row cap is still findable — otherwise it exists in the
   * database and nowhere in the UI.
   */
  searchAssets: async (query: string, limit = 50): Promise<Asset[]> => {
    const response = await api.get('/assets', { params: { q: query, page: 1, limit } });
    return (response.data.data as Asset[]).map(normalizeAsset);
  },

  bulkUpdate: async (
    assetIds: string[],
    changes: {
      workarea_id?: string | null;
      person_full_name?: string | null;
      person_id?: string | null;
      status?: string | null;
      clear_placement?: boolean;
    },
  ): Promise<{
    updated: Array<{ _id: string; display_name: string }>;
    skipped: Array<{ _id: string; reason: string }>;
    unplaced: string[];
    message?: string;
  }> => {
    const response = await api.patch('/assets/bulk', { asset_ids: assetIds, changes });
    return { ...response.data.data, message: response.data.message };
  },

  removeConnection: async (assetId: string, connectionId: string): Promise<Asset> => {
    const response = await api.delete(`/assets/${assetId}/connections/${connectionId}`);
    return response.data.data;
  },

  // Swaps a broken/retired asset for a replacement, transferring its map
  // position, hierarchy, wall-port assignment, and connections — see
  // asset.controller.ts replaceAsset.
  replaceAsset: async (assetId: string, replacementId: string): Promise<{ old: Asset; new: Asset }> => {
    const response = await api.post(`/assets/${assetId}/replace`, { replacement_id: replacementId });
    return response.data.data;
  },

  acceptItsmSnapshot: async (assetId: string): Promise<Asset> => {
    const response = await api.patch(`/itsm/assets/${assetId}/accept-snapshot`);
    return normalizeAsset(response.data.data);
  },

  syncAllFromItsm: async (): Promise<{
    total: number;
    created: number;
    updated: number;
    snapshotted: number;
    skipped: number;
    errors: Array<{ itsm_guid: string; error: string }>;
    started_at: string;
    completed_at: string;
  }> => {
    const response = await api.post('/itsm/sync/all');
    return response.data.data;
  },

  getAssetHistory: async (assetId: string, limit = 50): Promise<AssetHistoryEntry[]> => {
    const response = await api.get('/audit', { params: { document_id: assetId, limit } });
    return response.data.data ?? [];
  },

  notifyWorkItem: async (assetId: string, itemId: string): Promise<{ emailSent: boolean; teamsSent: boolean; errors: string[] }> => {
    const response = await api.post(`/assets/${assetId}/work-items/${itemId}/notify`);
    return response.data.data;
  },
};