/**
 * zone.service.ts — Zones: the named group of rooms on a floor.
 *
 * Hierarchy: Building > Floor > **Zone** > WorkArea. A zone is the bigger area
 * people name out loud ("the HR wing"); the work areas inside it are the
 * individual rooms ("Reception", "HR office").
 *
 * A zone has no coordinates or size on purpose — the map derives its shape
 * from the rooms belonging to it (see utils/workareaColors.ts and FloorMap's
 * zone halos), so an L-shaped zone renders as an L instead of a bounding box
 * that would swallow a neighbouring zone's room.
 */
import api from './api';

export interface Zone {
  _id: string;
  floor_id: string;
  name: string;
  /** Palette hex; null means the map picks one automatically for this floor. */
  color: string | null;
  description: string | null;
  /** Only present on the list endpoint. */
  workarea_count?: number;
  created_at?: string;
  updated_at?: string;
}

export const zoneService = {
  getZones: async (floorId?: string): Promise<Zone[]> => {
    const url = floorId ? `/zones?floor_id=${floorId}` : '/zones';
    const res = await api.get(url);
    return res.data.data;
  },

  getZone: async (id: string): Promise<Zone> => {
    const res = await api.get(`/zones/${id}`);
    return res.data.data;
  },

  createZone: async (data: { floor_id: string; name: string; color?: string | null; description?: string | null }): Promise<Zone> => {
    const res = await api.post('/zones', data);
    return res.data.data;
  },

  updateZone: async (id: string, data: Partial<Pick<Zone, 'name' | 'color' | 'description'>>): Promise<Zone> => {
    const res = await api.patch(`/zones/${id}`, data);
    return res.data.data;
  },

  /** Deleting a zone leaves its work areas on the floor, just ungrouped. */
  deleteZone: async (id: string): Promise<void> => {
    await api.delete(`/zones/${id}`);
  },
};
