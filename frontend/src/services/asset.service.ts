import api from './api';

export interface Asset {
  _id: string;
  hierarchy: {
    building_id: string;
    floor_id: string;
    workarea_id: string;
    section_id: string;
    workstation_id: string;
  };
  itsm: {
    hardware_id: string | null;
    is_managed: boolean;
    last_synced: string | null;
    sync_status: 'success' | 'failed' | 'never';
  };
  basic_info: {
    display_name: string;
    asset_tag?: string;
    serial_number?: string;
    model?: string;
    manufacturer?: string;
    status?: string;
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
  network?: {  // ← HOZZÁADVA
    ip_address?: string;
    hostname?: string;
    vlan?: string;
    switch_port?: string;
  };
  assigned_person?: {
    person_id: string;
    full_name: string;
  };
  software?: Array<{  // ← HOZZÁADVA
    software_id: string | null;
    display_name: string;
    vendor?: string;
    version?: string;
    source: 'itsm' | 'manual';
  }>;
  location: {
    coordinates: { x: number; y: number };
    rotation?: number;  // ← HOZZÁADVA
    icon_type?: string;  // ← HOZZÁADVA
    description?: string;
  };
  custom_fields?: {  // ← HOZZÁADVA
    physical_condition?: 'Good' | 'Fair' | 'Poor';
    environment?: string;
    notes?: string;
    tags?: string[];
  };
  created_at?: string;
  updated_at?: string;
}

export const assetService = {
  // Get all assets
  getAssets: async (): Promise<Asset[]> => {
    const response = await api.get('/assets');
    return response.data.data;
  },

  // Get asset by ID
  getAsset: async (id: string): Promise<Asset> => {
    const response = await api.get(`/assets/${id}`);
    return response.data.data;
  },

  // Create asset  ← ÚJ
  createAsset: async (data: Partial<Asset>): Promise<Asset> => {
    const response = await api.post('/assets', data);
    return response.data.data;
  },

  // Update asset  ← ÚJ
  updateAsset: async (id: string, data: Partial<Asset>): Promise<Asset> => {
    const response = await api.patch(`/assets/${id}`, data);
    return response.data.data;
  },

  // Delete asset
  deleteAsset: async (id: string): Promise<void> => {
    await api.delete(`/assets/${id}`);
  },
};