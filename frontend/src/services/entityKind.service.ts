/**
 * entityKind.service.ts — read-only API calls for the EntityKind reference
 * table (see backend/src/entities/EntityKind.entity.ts). Config data — no
 * create/update/delete from the frontend in this phase.
 */
import api from './api';

export interface EntityKind {
  value: string;
  label: string;
  geometry_type: 'point' | 'polyline' | 'polygon';
  default_color: string | null;
  rotatable: boolean;
  exempt_from_orphan: boolean;
  footprint: Array<[number, number]> | null;
}

export const entityKindService = {
  getEntityKinds: async (): Promise<EntityKind[]> => {
    const response = await api.get('/entity-kinds');
    return response.data.data;
  },
};
