/**
 * workstation.service.ts — API calls for the Workstation entity.
 *
 * Workstations are individual physical positions within sections
 * (a desk, a CNC machine station, an operator panel). They can be rendered
 * on the floor map at a specific position and rotation. Assets are linked
 * to workstations via `asset.workstation_id`.
 */
import api from './api';

export interface Workstation {
  _id: string;
  section_id: string;
  name: string;
  type?: string;
  status?: string;
  rotation?: number;
  coordinates?: {
    x: number;
    y: number;
  };
  created_at?: string;
  updated_at?: string;
}

export const workstationService = {
  // Get all workstations
  getWorkstations: async (sectionId?: string): Promise<Workstation[]> => {
    const url = sectionId ? `/workstations?section_id=${sectionId}` : '/workstations';
    const response = await api.get(url);
    return response.data.data;
  },

  // Get workstation by ID
  getWorkstation: async (id: string): Promise<Workstation> => {
    const response = await api.get(`/workstations/${id}`);
    return response.data.data;
  },

  // Create workstation
  createWorkstation: async (data: Partial<Workstation>): Promise<Workstation> => {
    const response = await api.post('/workstations', data);
    return response.data.data;
  },

  // Update workstation
  updateWorkstation: async (id: string, data: Partial<Workstation>): Promise<Workstation> => {
    const response = await api.patch(`/workstations/${id}`, data);
    return response.data.data;
  },

  // Delete workstation
  deleteWorkstation: async (id: string): Promise<void> => {
    await api.delete(`/workstations/${id}`);
  },
};