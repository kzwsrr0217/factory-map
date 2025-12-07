import api from './api';

export interface Building {
  _id: string;
  name: string;
  address?: string;
  metadata?: any;
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
};