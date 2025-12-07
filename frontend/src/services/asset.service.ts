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
  };
  assigned_person?: {
    person_id: string;
    full_name: string;
  };
  location: {
    coordinates: { x: number; y: number };
    description?: string;
  };
}

export const assetService = {
  // Get all assets (would need pagination in real app)
  getAssets: async (): Promise<Asset[]> => {
    const response = await api.get('/assets');
    return response.data.data;
  },

  // Get asset by ID
  getAsset: async (id: string): Promise<Asset> => {
    const response = await api.get(`/assets/${id}`);
    return response.data.data;
  },
};