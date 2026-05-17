import api from './api';

export interface NetworkRoom {
  _id: string;
  name: string;
  type: 'idf' | 'mdf';
  building_id: string;
  floor_id: string | null;
  description: string | null;
  redundant_pair_id: string | null;
  racks: NetworkRack[];
  created_at: string;
  updated_at: string;
}

export interface NetworkRack {
  _id: string;
  name: string;
  network_room_id: string;
  u_count: number;
  description: string | null;
  patch_panels: PatchPanel[];
  created_at: string;
  updated_at: string;
}

export interface PatchPanel {
  _id: string;
  name: string;
  rack_id: string;
  u_position: number | null;
  port_count: number;
  cable_type: 'copper' | 'fiber' | 'mixed';
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface WallPort {
  _id: string;
  label: string;
  floor_id: string;
  pos_x: number;
  pos_y: number;
  patch_panel_id: string | null;
  patch_panel_name: string | null;
  patch_port: number | null;
  switch_asset_id: string | null;
  switch_port: string | null;
  rack_name: string | null;
  room_name: string | null;
  room_type: string | null;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export const networkService = {
  // Rooms
  getRooms: async (params?: { building_id?: string; floor_id?: string; type?: string }): Promise<NetworkRoom[]> => {
    const res = await api.get('/network/rooms', { params });
    return res.data.data;
  },
  getRoom: async (id: string): Promise<NetworkRoom> => {
    const res = await api.get(`/network/rooms/${id}`);
    return res.data.data;
  },
  createRoom: async (data: Partial<NetworkRoom>): Promise<NetworkRoom> => {
    const res = await api.post('/network/rooms', data);
    return res.data.data;
  },
  updateRoom: async (id: string, data: Partial<NetworkRoom>): Promise<NetworkRoom> => {
    const res = await api.patch(`/network/rooms/${id}`, data);
    return res.data.data;
  },
  deleteRoom: async (id: string): Promise<void> => {
    await api.delete(`/network/rooms/${id}`);
  },

  // Racks
  getRacks: async (network_room_id?: string): Promise<NetworkRack[]> => {
    const res = await api.get('/network/racks', { params: network_room_id ? { network_room_id } : {} });
    return res.data.data;
  },
  getRack: async (id: string): Promise<NetworkRack> => {
    const res = await api.get(`/network/racks/${id}`);
    return res.data.data;
  },
  createRack: async (data: Partial<NetworkRack>): Promise<NetworkRack> => {
    const res = await api.post('/network/racks', data);
    return res.data.data;
  },
  updateRack: async (id: string, data: Partial<NetworkRack>): Promise<NetworkRack> => {
    const res = await api.patch(`/network/racks/${id}`, data);
    return res.data.data;
  },
  deleteRack: async (id: string): Promise<void> => {
    await api.delete(`/network/racks/${id}`);
  },

  // Patch Panels
  getPatchPanels: async (rack_id?: string): Promise<PatchPanel[]> => {
    const res = await api.get('/network/patch-panels', { params: rack_id ? { rack_id } : {} });
    return res.data.data;
  },
  createPatchPanel: async (data: Partial<PatchPanel>): Promise<PatchPanel> => {
    const res = await api.post('/network/patch-panels', data);
    return res.data.data;
  },
  updatePatchPanel: async (id: string, data: Partial<PatchPanel>): Promise<PatchPanel> => {
    const res = await api.patch(`/network/patch-panels/${id}`, data);
    return res.data.data;
  },
  deletePatchPanel: async (id: string): Promise<void> => {
    await api.delete(`/network/patch-panels/${id}`);
  },

  // Wall Ports
  getWallPorts: async (params?: { floor_id?: string; patch_panel_id?: string }): Promise<WallPort[]> => {
    const res = await api.get('/network/wall-ports', { params });
    return res.data.data;
  },
  createWallPort: async (data: Partial<WallPort>): Promise<WallPort> => {
    const res = await api.post('/network/wall-ports', data);
    return res.data.data;
  },
  updateWallPort: async (id: string, data: Partial<WallPort>): Promise<WallPort> => {
    const res = await api.patch(`/network/wall-ports/${id}`, data);
    return res.data.data;
  },
  deleteWallPort: async (id: string): Promise<void> => {
    await api.delete(`/network/wall-ports/${id}`);
  },
};
