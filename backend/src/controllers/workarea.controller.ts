/**
 * workarea.controller.ts — CRUD for work areas.
 *
 * Work areas have optional position (`coordinates`) and size (`dimensions`)
 * properties that control where they are rendered on the floor map. If not
 * provided on creation, they default to (0, 0) with 150×100 dimensions.
 *
 * Deletion cascades automatically via the Section and Workstation TypeORM
 * relations (cascade: true on WorkArea.sections), so no manual cascade
 * logic is needed here.
 */
import { Request, Response, NextFunction } from 'express';
import { AppDataSource } from '../config/database';
import { WorkArea } from '../entities/WorkArea.entity';

const repo = () => AppDataSource.getRepository(WorkArea);

export const getAllWorkAreas = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { floor_id } = req.query as { floor_id?: string };
    const where = floor_id ? { floor_id } : {};
    const areas = await repo().find({ where, order: { name: 'ASC' } });
    res.json({ success: true, data: areas.map((a) => a.toApiResponse()) });
  } catch (error) { next(error); }
};

export const getWorkAreaById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const area = await repo().findOne({ where: { id: req.params.id } });
    if (!area) { res.status(404).json({ success: false, error: 'Work area not found' }); return; }
    res.json({ success: true, data: area.toApiResponse() });
  } catch (error) { next(error); }
};

export const createWorkArea = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const body = req.body as {
      floor_id: string; name: string; type?: string;
      coordinates?: { x: number; y: number };
      dimensions?: { width: number; height: number };
      metadata?: Record<string, unknown>;
    };
    const area = repo().create({
      floor_id: body.floor_id,
      name: body.name,
      type: body.type ?? null,
      coord_x: body.coordinates?.x ?? 0,
      coord_y: body.coordinates?.y ?? 0,
      dim_width: body.dimensions?.width ?? 150,
      dim_height: body.dimensions?.height ?? 100,
      metadata: body.metadata ?? null,
    });
    await repo().save(area);
    res.status(201).json({ success: true, data: area.toApiResponse() });
  } catch (error) { next(error); }
};

export const updateWorkArea = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const area = await repo().findOne({ where: { id: req.params.id } });
    if (!area) { res.status(404).json({ success: false, error: 'Work area not found' }); return; }
    const body = req.body as Partial<{
      name: string; type: string;
      coordinates: { x: number; y: number };
      dimensions: { width: number; height: number };
      metadata: Record<string, unknown>;
    }>;
    if (body.name !== undefined) area.name = body.name;
    if (body.type !== undefined) area.type = body.type ?? null;
    if (body.coordinates !== undefined) { area.coord_x = body.coordinates.x; area.coord_y = body.coordinates.y; }
    if (body.dimensions !== undefined) { area.dim_width = body.dimensions.width; area.dim_height = body.dimensions.height; }
    if (body.metadata !== undefined) area.metadata = body.metadata ?? null;
    await repo().save(area);
    res.json({ success: true, data: area.toApiResponse() });
  } catch (error) { next(error); }
};

export const deleteWorkArea = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const area = await repo().findOne({ where: { id: req.params.id } });
    if (!area) { res.status(404).json({ success: false, error: 'Work area not found' }); return; }
    await repo().remove(area);
    res.json({ success: true, message: 'Work area deleted successfully' });
  } catch (error) { next(error); }
};
