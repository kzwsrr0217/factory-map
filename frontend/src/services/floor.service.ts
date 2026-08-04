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
  // File-reference convention adopted from shopfloor_visualizer (PRD 5.3a) —
  // resolved via getFloorSvg() below (GET /floors/:id/svg) and parsed by
  // utils/svgFloorPlan.ts; see docs/DATA_MODEL_MIGRATION.md phase 4.
  svg_ref?: string | null;
  scale_meters_per_unit?: number | null;
  metadata?: {
    area?: number;
    ceiling_height?: number;
    [key: string]: any;
  };
  created_at?: string;
  updated_at?: string;
}

/** One floor's survey state — see GET /floors/progress in floor.controller.ts. */
export interface FloorProgress {
  floor_id: string;
  floor_name: string;
  floor_number: number;
  building_id: string;
  building_name: string | null;
  has_floor_plan: boolean;
  work_areas: number;
  assets: { total: number; placed: number };
  /** `patched` reaches a panel; `live` also has a switch port; `occupied` is devices. */
  sockets: { total: number; patched: number; live: number; occupied: number };
}

export interface FloorProgressResponse {
  floors: FloorProgress[];
  /** Devices on no floor at all — the backlog a per-floor table would hide. */
  unassigned_assets: number;
  generated_at: string;
}

export const floorService = {
  /**
   * How far the survey has got, counted in the database. Cheap enough to open
   * whenever — the socket counts alone would be thousands of rows to ship.
   */
  getProgress: async (): Promise<FloorProgressResponse> => {
    const response = await api.get('/floors/progress');
    return {
      floors: response.data.data as FloorProgress[],
      unassigned_assets: response.data.meta?.unassigned_assets ?? 0,
      generated_at: response.data.meta?.generated_at ?? '',
    };
  },

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

  // Fetch the raw SVG file referenced by Floor.svg_ref (GET /floors/:id/svg)
  // — see backend/src/controllers/floor.controller.ts getFloorSvg. Prototype
  // path alongside the base64 svg_background field; see
  // docs/DATA_MODEL_MIGRATION.md phase 4.
  getFloorSvg: async (id: string): Promise<string> => {
    const response = await api.get(`/floors/${id}/svg`, { responseType: 'text' });
    return response.data;
  },
};