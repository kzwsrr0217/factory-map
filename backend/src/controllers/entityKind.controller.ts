/**
 * entityKind.controller.ts — Read-only listing for the EntityKind reference
 * table (see entities/EntityKind.entity.ts). Config data, not master data or
 * an editable resource — no create/update/delete in this phase.
 */
import { Request, Response, NextFunction } from 'express';
import { AppDataSource } from '../config/database';
import { EntityKind } from '../entities/EntityKind.entity';

const repo = () => AppDataSource.getRepository(EntityKind);

export const getAllEntityKinds = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const kinds = await repo().find({ order: { value: 'ASC' } });
    res.json({ success: true, data: kinds.map((k) => k.toApiResponse()) });
  } catch (error) { next(error); }
};
