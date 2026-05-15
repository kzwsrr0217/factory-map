/**
 * floor.controller.ts — CRUD for floors.
 *
 * Key behaviours:
 *  - `createFloor`: Validates that the floor_number is unique within the building
 *    before saving.
 *  - `updateFloor`: Re-validates uniqueness if the floor_number is being changed.
 *  - `deleteFloor`: Blocks deletion if assets are assigned to the floor.
 *    Cascades: work areas → sections → workstations before removing the floor.
 *
 * The floor plan image (`svg_background`) is not handled here — it is uploaded
 * separately via the floor plan upload endpoint and stored as base64 in the entity.
 */
import { Request, Response, NextFunction } from 'express';
import { AppDataSource } from '../config/database';
import { Floor } from '../entities/Floor.entity';
import { WorkArea } from '../entities/WorkArea.entity';
import { Section } from '../entities/Section.entity';
import { Workstation } from '../entities/Workstation.entity';
import { Asset } from '../entities/Asset.entity';

const repo = () => AppDataSource.getRepository(Floor);

export const getAllFloors = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { building_id } = req.query as { building_id?: string };
    const where = building_id ? { building_id } : {};
    const floors = await repo().find({ where, order: { floor_number: 'ASC' } });
    res.json({ success: true, data: floors.map((f) => f.toApiResponse()) });
  } catch (error) { next(error); }
};

export const getFloorById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const floor = await repo().findOne({ where: { id: req.params.id } });
    if (!floor) { res.status(404).json({ success: false, error: 'Floor not found' }); return; }
    res.json({ success: true, data: floor.toApiResponse() });
  } catch (error) { next(error); }
};

export const createFloor = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const body = req.body as { building_id: string; floor_number: number; name: string; map_file?: string; svg_background?: string; metadata?: Record<string, unknown> };
    const existing = await repo().findOne({ where: { building_id: body.building_id, floor_number: body.floor_number } });
    if (existing) {
      res.status(400).json({ success: false, error: `Floor number ${body.floor_number} already exists in this building` });
      return;
    }
    const floor = repo().create({
      building_id: body.building_id,
      floor_number: body.floor_number,
      name: body.name,
      map_file: body.map_file ?? null,
      svg_background: body.svg_background ?? null,
      metadata: body.metadata ?? null,
    });
    await repo().save(floor);
    res.status(201).json({ success: true, data: floor.toApiResponse() });
  } catch (error) { next(error); }
};

export const updateFloor = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const floor = await repo().findOne({ where: { id: req.params.id } });
    if (!floor) { res.status(404).json({ success: false, error: 'Floor not found' }); return; }
    const body = req.body as Partial<{ floor_number: number; name: string; map_file: string; svg_background: string; metadata: Record<string, unknown> }>;

    if (body.floor_number !== undefined && body.floor_number !== floor.floor_number) {
      const dup = await repo().findOne({ where: { building_id: floor.building_id, floor_number: body.floor_number } });
      if (dup) { res.status(400).json({ success: false, error: `Floor number ${body.floor_number} already exists` }); return; }
      floor.floor_number = body.floor_number;
    }
    if (body.name !== undefined) floor.name = body.name;
    if (body.map_file !== undefined) floor.map_file = body.map_file ?? null;
    if (body.svg_background !== undefined) floor.svg_background = body.svg_background ?? null;
    if (body.metadata !== undefined) floor.metadata = body.metadata ?? null;

    await repo().save(floor);
    res.json({ success: true, data: floor.toApiResponse() });
  } catch (error) { next(error); }
};

export const deleteFloor = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const floor = await repo().findOne({ where: { id: req.params.id } });
    if (!floor) { res.status(404).json({ success: false, error: 'Floor not found' }); return; }

    const assetCount = await AppDataSource.getRepository(Asset).count({ where: { floor_id: req.params.id } });
    if (assetCount > 0) {
      res.status(400).json({ success: false, error: `Cannot delete floor with ${assetCount} asset(s)` });
      return;
    }

    const waIds = (await AppDataSource.getRepository(WorkArea).find({ where: { floor_id: req.params.id }, select: ['id'] })).map((w) => w.id);
    if (waIds.length > 0) {
      const secIds = (await AppDataSource.getRepository(Section).find({ where: waIds.map((id) => ({ workarea_id: id })), select: ['id'] })).map((s) => s.id);
      if (secIds.length > 0) {
        await AppDataSource.getRepository(Workstation).delete(secIds.map((id) => ({ section_id: id })));
        await AppDataSource.getRepository(Section).delete(waIds.map((id) => ({ workarea_id: id })));
      }
      await AppDataSource.getRepository(WorkArea).delete({ floor_id: req.params.id });
    }

    await repo().remove(floor);
    res.json({ success: true, message: 'Floor deleted successfully' });
  } catch (error) { next(error); }
};
