/**
 * hierarchy.service.ts — API calls for the Building entity.
 *
 * Buildings are the top level of the location hierarchy. Deleting a building
 * will be blocked by the backend if any assets are still assigned to it.
 *
 * Note: floors are in floor.service.ts, work areas in workarea.service.ts,
 * sections in section.service.ts, and workstations in workstation.service.ts.
 */
import api from './api';

export interface Building {
  _id: string;
  name: string;
  address?: string;
  metadata?: {
    total_area?: number;
    construction_year?: number;
    [key: string]: any;
  };
  created_at?: string;
  updated_at?: string;
}

export const hierarchyService = {
  // Get all buildings
  getBuildings: async (): Promise<Building[]> => {
    const response = await api.get('/buildings');
    return response.data.data;
  },

  // Get building by ID
  getBuilding: async (id: string): Promise<Building> => {
    const response = await api.get(`/buildings/${id}`);
    return response.data.data;
  },

  // Create building
  createBuilding: async (data: Partial<Building>): Promise<Building> => {
    const response = await api.post('/buildings', data);
    return response.data.data;
  },

  // Update building
  updateBuilding: async (id: string, data: Partial<Building>): Promise<Building> => {
    const response = await api.patch(`/buildings/${id}`, data);
    return response.data.data;
  },

  // Delete building
  deleteBuilding: async (id: string): Promise<void> => {
    await api.delete(`/buildings/${id}`);
  },
};