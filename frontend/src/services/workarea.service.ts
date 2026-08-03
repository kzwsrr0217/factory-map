/**
 * workarea.service.ts — API calls for the WorkArea entity.
 *
 * A work area is one room on a floor map — the leaf of
 * Building > Floor > Zone > WorkArea. Its `coordinates` (position) and
 * `dimensions` (width/height) are updated when the user drags or resizes it on
 * the floor plan canvas; the zone it belongs to is `zone_id`.
 */
import api from './api';

export interface WorkArea {
  _id: string;
  floor_id: string;
  name: string;
  coordinates?: {
    x: number;
    y: number;
  };
  dimensions?: {
    width: number;
    height: number;
  };
  // Soft join to ProductionLine.code (organizational hierarchy, IFS-aligned) —
  // see backend/src/entities/WorkArea.entity.ts. Null/absent if unassigned.
  production_line_code?: string | null;
  metadata?: {
    supervisor?: string;
    capacity?: number;
    [key: string]: any;
  };
  /**
   * The zone (bigger named area) this room belongs to — see zone.service.ts.
   * Null when the room isn't grouped yet.
   */
  zone_id?: string | null;
  /**
   * Denormalised copy of the zone, attached by the API so the map can draw the
   * zone halo and label without a second request. Colour lives on the ZONE, not
   * here, so every room in one zone matches by construction.
   */
  zone?: { _id: string; name: string; color: string | null } | null;
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

  /**
   * Arranges this work area's unplaced assets on a grid inside its rectangle.
   * The survey gives assets a room but no coordinates, and the exact spot inside
   * a room carries no information — so this is the answer, not a shortcut.
   * Anything needing an exact spot can still be dragged afterwards.
   */
  autoPlaceAssets: async (id: string): Promise<{
    placed: Array<{ _id: string; display_name: string; x: number; y: number }>;
    skipped: Array<{ _id: string; display_name: string; reason: string }>;
    crowded: boolean;
    message?: string;
  }> => {
    const response = await api.post(`/workareas/${id}/auto-place`);
    return { ...response.data.data, message: response.data.message };
  },

  // Delete work area
  deleteWorkArea: async (id: string): Promise<void> => {
    await api.delete(`/workareas/${id}`);
  },
};