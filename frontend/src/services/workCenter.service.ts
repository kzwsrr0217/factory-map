/**
 * workCenter.service.ts — read-only API calls for the WorkCenter
 * organizational reference table (see backend/src/entities/WorkCenter.entity.ts).
 * Hand-seeded for now — no live IFS/Databricks connection exists yet.
 */
import api from './api';

export interface WorkCenter {
  code: string;
  description: string | null;
  production_line_code: string | null;
}

export const workCenterService = {
  getWorkCenters: async (): Promise<WorkCenter[]> => {
    const response = await api.get('/work-centers');
    return response.data.data;
  },
};
