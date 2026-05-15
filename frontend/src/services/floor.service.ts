/**
 * floor.service.ts — API calls for the Floor entity.
 *
 * `getFloors(buildingId?)`: When a `buildingId` is provided, returns only floors
 * for that building. Used by both the building details page and the `useHierarchy`
 * hook which needs floors for floor-filter dropdowns.
 *
 * `svg_background` in the Floor interface holds the full base64-encoded floor
 * plan image (or SVG text). It is large and should not be fetched in list views
 * — use `getFloor(id)` only when the floor map actually needs to render.
 */
import api from './api';

export interface Floor {
  _id: string;
  building_id: string;
  floor_number: number;
  name: string;
  map_file?: string;
  svg_background?: string;
  metadata?: {
    area?: number;
    ceiling_height?: number;
    [key: string]: any;
  };
  created_at?: string;
  updated_at?: string;
}

export const floorService = {
  // Get all floors
  getFloors: async (buildingId?: string): Promise<Floor[]> => {
    const url = buildingId ? `/floors?building_id=${buildingId}` : '/floors';
    const response = await api.get(url);
    return response.data.data;
  },

  // Get floor by ID
  getFloor: async (id: string): Promise<Floor> => {
    const response = await api.get(`/floors/${id}`);
    return response.data.data;
  },

  // Create floor
  createFloor: async (data: Partial<Floor>): Promise<Floor> => {
    const response = await api.post('/floors', data);
    return response.data.data;
  },

  // Update floor
  updateFloor: async (id: string, data: Partial<Floor>): Promise<Floor> => {
    const response = await api.patch(`/floors/${id}`, data);
    return response.data.data;
  },

  // Delete floor
  deleteFloor: async (id: string): Promise<void> => {
    await api.delete(`/floors/${id}`);
  },
};