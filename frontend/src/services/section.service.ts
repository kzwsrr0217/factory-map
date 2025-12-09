import api from './api';

export interface Section {
  _id: string;
  workarea_id: string;
  name: string;
  shift_schedule?: string;
  capacity?: number;
  coordinates?: {
    x: number;
    y: number;
  };
  created_at?: string;
  updated_at?: string;
}

export const sectionService = {
  // Get all sections
  getSections: async (workareaId?: string): Promise<Section[]> => {
    const url = workareaId ? `/sections?workarea_id=${workareaId}` : '/sections';
    const response = await api.get(url);
    return response.data.data;
  },

  // Get section by ID
  getSection: async (id: string): Promise<Section> => {
    const response = await api.get(`/sections/${id}`);
    return response.data.data;
  },

  // Create section
  createSection: async (data: Partial<Section>): Promise<Section> => {
    const response = await api.post('/sections', data);
    return response.data.data;
  },

  // Update section
  updateSection: async (id: string, data: Partial<Section>): Promise<Section> => {
    const response = await api.patch(`/sections/${id}`, data);
    return response.data.data;
  },

  // Delete section
  deleteSection: async (id: string): Promise<void> => {
    await api.delete(`/sections/${id}`);
  },
};