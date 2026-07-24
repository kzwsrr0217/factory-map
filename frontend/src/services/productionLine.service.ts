/**
 * productionLine.service.ts — read-only API calls for the ProductionLine
 * organizational reference table (see
 * backend/src/entities/ProductionLine.entity.ts). Hand-seeded for now — no
 * live IFS/Databricks connection exists yet.
 */
import api from './api';

export interface ProductionLine {
  code: string;
  description: string | null;
}

export const productionLineService = {
  getProductionLines: async (): Promise<ProductionLine[]> => {
    const response = await api.get('/production-lines');
    return response.data.data;
  },
};
