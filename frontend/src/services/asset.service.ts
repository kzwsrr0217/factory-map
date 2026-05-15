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
 *  - `acceptItsmSnapshot(id)`: promote pending ITSM snapshot to live data
 *  - `syncAllFromItsm()`: full ITSM sync
 *  - `getAssetHistory(id)`: recent audit log entries for an asset
 */
import api from './api';

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

export interface Asset {
  _id: string;
  predecessor_id?: string | null;
  successor_id?: string | null;
  is_placed?: boolean;
  hierarchy: {
    building_id: string | null;
    floor_id: string | null;
    workarea_id: string | null;
    section_id: string | null;
    workstation_id: string | null;
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
    description: string;
    done: boolean;
    priority: 'low' | 'medium' | 'high';
    created_at: string;
  }>;
  connections?: Array<{
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
    created_at?: string;
  }>;
  location: {
    coordinates: { x: number; y: number };
    rotation?: number;  // ← HOZZÁADVA
    icon_type?: string;  // ← HOZZÁADVA
    description?: string;
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

export const assetService = {
  // Get all assets
  getAssets: async (): Promise<Asset[]> => {
    const response = await api.get('/assets');
    return (response.data.data as Asset[]).map(normalizeAsset);
  },

  // Get assets filtered by floor ID
  getAssetsByFloor: async (floorId: string): Promise<Asset[]> => {
    const response = await api.get('/assets', {
      params: { floor_id: floorId },
    });
    return (response.data.data as Asset[]).map(normalizeAsset);
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
  }): Promise<Asset> => {
    const response = await api.post(`/assets/${assetId}/connections`, connectionData);
    return response.data.data;
  },

  updateConnection: async (assetId: string, connectedAssetId: string, connectionData: {
    connection_type: string;
    description?: string;
    label?: string;
    bidirectional?: boolean;
    strength?: string;
    patch_panel?: { panel_name?: string; panel_port?: string; switch_name?: string; switch_port?: string } | null;
  }): Promise<Asset> => {
    const response = await api.patch(`/assets/${assetId}/connections/${connectedAssetId}`, connectionData);
    return response.data.data;
  },

  removeConnection: async (assetId: string, connectedAssetId: string): Promise<Asset> => {
    const response = await api.delete(`/assets/${assetId}/connections/${connectedAssetId}`);
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
};