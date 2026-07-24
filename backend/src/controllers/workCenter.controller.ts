/**
 * workCenter.controller.ts — Read-only listing for the WorkCenter
 * organizational reference table (see entities/WorkCenter.entity.ts).
 * Hand-seeded for now — no live IFS/Databricks connection exists yet.
 */
import { Request, Response, NextFunction } from 'express';
import { AppDataSource } from '../config/database';
import { WorkCenter } from '../entities/WorkCenter.entity';

const repo = () => AppDataSource.getRepository(WorkCenter);

export const getAllWorkCenters = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const centers = await repo().find({ order: { code: 'ASC' } });
    res.json({ success: true, data: centers.map((c) => c.toApiResponse()) });
  } catch (error) { next(error); }
};
