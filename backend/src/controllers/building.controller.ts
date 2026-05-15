/**
 * building.controller.ts — CRUD for buildings.
 *
 * `deleteBuilding` performs a guarded cascading delete:
 *  1. Checks for assets assigned to the building — blocks deletion if any exist.
 *  2. Manually cascades: workstations → sections → work areas → floors (in that order)
 *     because TypeORM's cascade on the relations does not cover all levels automatically
 *     in the delete path.
 *  3. Then removes the building itself.
 *
 * All other operations are straightforward TypeORM repository calls.
 */
import { Request, Response, NextFunction } from 'express';
import { AppDataSource } from '../config/database';
import { Building } from '../entities/Building.entity';
import { Floor } from '../entities/Floor.entity';
import { WorkArea } from '../entities/WorkArea.entity';
import { Section } from '../entities/Section.entity';
import { Workstation } from '../entities/Workstation.entity';
import { Asset } from '../entities/Asset.entity';

const repo = () => AppDataSource.getRepository(Building);

export const getAllBuildings = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const buildings = await repo().find({ order: { name: 'ASC' } });
    res.json({ success: true, data: buildings.map((b) => b.toApiResponse()) });
  } catch (error) { next(error); }
};

export const getBuildingById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const building = await repo().findOne({ where: { id: req.params.id } });
    if (!building) { res.status(404).json({ success: false, error: 'Building not found' }); return; }
    res.json({ success: true, data: building.toApiResponse() });
  } catch (error) { next(error); }
};

export const createBuilding = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const body = req.body as { name: string; address?: string; metadata?: Record<string, unknown> };
    const building = repo().create({ name: body.name, address: body.address ?? null, metadata: body.metadata ?? null });
    await repo().save(building);
    res.status(201).json({ success: true, data: building.toApiResponse() });
  } catch (error) { next(error); }
};

export const updateBuilding = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const building = await repo().findOne({ where: { id: req.params.id } });
    if (!building) { res.status(404).json({ success: false, error: 'Building not found' }); return; }
    const body = req.body as Partial<{ name: string; address: string; metadata: Record<string, unknown> }>;
    if (body.name !== undefined) building.name = body.name;
    if (body.address !== undefined) building.address = body.address ?? null;
    if (body.metadata !== undefined) building.metadata = body.metadata ?? null;
    await repo().save(building);
    res.json({ success: true, data: building.toApiResponse() });
  } catch (error) { next(error); }
};

export const deleteBuilding = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const building = await repo().findOne({ where: { id: req.params.id } });
    if (!building) { res.status(404).json({ success: false, error: 'Building not found' }); return; }

    // Check for assets before deleting
    const assetCount = await AppDataSource.getRepository(Asset).count({ where: { building_id: req.params.id } });
    if (assetCount > 0) {
      res.status(400).json({ success: false, error: `Cannot delete building with ${assetCount} asset(s). Please reassign or remove them first.` });
      return;
    }

    // Cascade: floor → workarea → section → workstation handled by SQL CASCADE
    // But assets have SET NULL policy, so check above is needed
    const floorIds = (await AppDataSource.getRepository(Floor).find({ where: { building_id: req.params.id }, select: ['id'] })).map((f) => f.id);
    if (floorIds.length > 0) {
      const waIds = (await AppDataSource.getRepository(WorkArea).find({ where: floorIds.map((id) => ({ floor_id: id })), select: ['id'] })).map((w) => w.id);
      if (waIds.length > 0) {
        const secIds = (await AppDataSource.getRepository(Section).find({ where: waIds.map((id) => ({ workarea_id: id })), select: ['id'] })).map((s) => s.id);
        if (secIds.length > 0) {
          await AppDataSource.getRepository(Workstation).delete(secIds.map((id) => ({ section_id: id })));
          await AppDataSource.getRepository(Section).delete(waIds.map((id) => ({ workarea_id: id })));
        }
        await AppDataSource.getRepository(WorkArea).delete(floorIds.map((id) => ({ floor_id: id })));
      }
      await AppDataSource.getRepository(Floor).delete({ building_id: req.params.id });
    }

    await repo().remove(building);
    res.json({ success: true, message: 'Building deleted successfully' });
  } catch (error) { next(error); }
};
