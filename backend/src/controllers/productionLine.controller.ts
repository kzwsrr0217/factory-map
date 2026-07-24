/**
 * productionLine.controller.ts — Read-only listing for the ProductionLine
 * organizational reference table (see entities/ProductionLine.entity.ts).
 * Hand-seeded for now — no live IFS/Databricks connection exists yet.
 */
import { Request, Response, NextFunction } from 'express';
import { AppDataSource } from '../config/database';
import { ProductionLine } from '../entities/ProductionLine.entity';

const repo = () => AppDataSource.getRepository(ProductionLine);

export const getAllProductionLines = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const lines = await repo().find({ order: { code: 'ASC' } });
    res.json({ success: true, data: lines.map((l) => l.toApiResponse()) });
  } catch (error) { next(error); }
};
