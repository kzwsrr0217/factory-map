/**
 * workarea.service.ts — API calls for the WorkArea entity.
 *
 * Work areas are rectangular zones on a floor map. Their `coordinates` (position)
 * and `dimensions` (width/height) are updated when the user drags or resizes
 * them on the floor plan canvas. The `type` field describes the zone's function
 * (e.g., "assembly", "server room", "office").
 */
import api from './api';

export interface WorkArea {
  _id: string;
  floor_id: string;
  name: string;
  type?: string;
  coordinates?: {
    x: number;
    y: number;
  };
  dimensions?: {
    width: number;
    height: number;
  };
  metadata?: {
    supervisor?: string;
    capacity?: number;
    [key: string]: any;
  };
  created_at?: string;
  updated_at?: string;
}

export const workareaService = {
  // Get all work areas
  getWorkAreas: async (floorId?: string): Promise<WorkArea[]> => {
    const url = floorId ? `/workareas?floor_id=${floorId}` : '/workareas';
    const response = await api.get(url);
    return response.data.data;
  },

  // Get work area by ID
  getWorkArea: async (id: string): Promise<WorkArea> => {
    const response = await api.get(`/workareas/${id}`);
    return response.data.data;
  },

  // Create work area
  createWorkArea: async (data: Partial<WorkArea>): Promise<WorkArea> => {
    const response = await api.post('/workareas', data);
    return response.data.data;
  },

  // Update work area
  updateWorkArea: async (id: string, data: Partial<WorkArea>): Promise<WorkArea> => {
    const response = await api.patch(`/workareas/${id}`, data);
    return response.data.data;
  },

  // Delete work area
  deleteWorkArea: async (id: string): Promise<void> => {
    await api.delete(`/workareas/${id}`);
  },
};