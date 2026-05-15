/**
 * workstation.controller.ts — CRUD for workstations within sections.
 *
 * Workstations represent individual physical positions on the factory floor
 * (a machine station, a desk, an operator panel). Assets are linked to
 * workstations via `asset.workstation_id`. The workstation's `type` and
 * `rotation` are used by the floor map renderer.
 */
import { Request, Response, NextFunction } from 'express';
import { AppDataSource } from '../config/database';
import { Workstation } from '../entities/Workstation.entity';

const repo = () => AppDataSource.getRepository(Workstation);

export const getAllWorkstations = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { section_id } = req.query as { section_id?: string };
    const where = section_id ? { section_id } : {};
    const ws = await repo().find({ where, order: { name: 'ASC' } });
    res.json({ success: true, data: ws.map((w) => w.toApiResponse()) });
  } catch (error) { next(error); }
};

export const getWorkstationById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const ws = await repo().findOne({ where: { id: req.params.id } });
    if (!ws) { res.status(404).json({ success: false, error: 'Workstation not found' }); return; }
    res.json({ success: true, data: ws.toApiResponse() });
  } catch (error) { next(error); }
};

export const createWorkstation = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const body = req.body as { section_id: string; name: string; type: string; coordinates?: { x: number; y: number }; rotation?: number; status?: string };
    const ws = repo().create({
      section_id: body.section_id,
      name: body.name,
      type: body.type,
      coord_x: body.coordinates?.x ?? 0,
      coord_y: body.coordinates?.y ?? 0,
      rotation: body.rotation ?? 0,
      status: body.status ?? 'active',
    });
    await repo().save(ws);
    res.status(201).json({ success: true, data: ws.toApiResponse() });
  } catch (error) { next(error); }
};

export const updateWorkstation = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const ws = await repo().findOne({ where: { id: req.params.id } });
    if (!ws) { res.status(404).json({ success: false, error: 'Workstation not found' }); return; }
    const body = req.body as Partial<{ name: string; type: string; coordinates: { x: number; y: number }; rotation: number; status: string }>;
    if (body.name !== undefined) ws.name = body.name;
    if (body.type !== undefined) ws.type = body.type;
    if (body.coordinates !== undefined) { ws.coord_x = body.coordinates.x; ws.coord_y = body.coordinates.y; }
    if (body.rotation !== undefined) ws.rotation = body.rotation;
    if (body.status !== undefined) ws.status = body.status;
    await repo().save(ws);
    res.json({ success: true, data: ws.toApiResponse() });
  } catch (error) { next(error); }
};

export const deleteWorkstation = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const ws = await repo().findOne({ where: { id: req.params.id } });
    if (!ws) { res.status(404).json({ success: false, error: 'Workstation not found' }); return; }
    await repo().remove(ws);
    res.json({ success: true, message: 'Workstation deleted successfully' });
  } catch (error) { next(error); }
};
