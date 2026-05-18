/**
 * building.controller.ts — CRUD for buildings.
 *
 * `deleteBuilding` performs a guarded cascading delete:
 *  1. Checks for assets assigned to the building — blocks deletion if any exist.
 *  2. Runs the hierarchy cascade (workstations → sections → workareas → floors)
 *     inside a single transaction so a partial failure leaves no orphaned rows.
 *  3. Then removes the building itself.
 *
 * All handlers use asyncHandler so uncaught promise rejections flow to Express
 * error middleware without explicit try/catch boilerplate.
 */
import { AppDataSource } from '../config/database';
import { asyncHandler } from '../utils/asyncHandler';
import { Building } from '../entities/Building.entity';
import { Floor } from '../entities/Floor.entity';
import { WorkArea } from '../entities/WorkArea.entity';
import { Section } from '../entities/Section.entity';
import { Workstation } from '../entities/Workstation.entity';
import { Asset } from '../entities/Asset.entity';

const repo = () => AppDataSource.getRepository(Building);

export const getAllBuildings = asyncHandler(async (_req, res) => {
  const buildings = await repo().find({ order: { name: 'ASC' } });
  res.json({ success: true, data: buildings.map((b) => b.toApiResponse()) });
});

export const getBuildingById = asyncHandler(async (req, res) => {
  const building = await repo().findOne({ where: { id: req.params.id } });
  if (!building) { res.status(404).json({ success: false, error: 'Building not found' }); return; }
  res.json({ success: true, data: building.toApiResponse() });
});

export const createBuilding = asyncHandler(async (req, res) => {
  const body = req.body as { name: string; address?: string; metadata?: Record<string, unknown> };
  const building = repo().create({ name: body.name, address: body.address ?? null, metadata: body.metadata ?? null });
  await repo().save(building);
  res.status(201).json({ success: true, data: building.toApiResponse() });
});

export const updateBuilding = asyncHandler(async (req, res) => {
  const building = await repo().findOne({ where: { id: req.params.id } });
  if (!building) { res.status(404).json({ success: false, error: 'Building not found' }); return; }
  const body = req.body as Partial<{ name: string; address: string; metadata: Record<string, unknown> }>;
  if (body.name !== undefined) building.name = body.name;
  if (body.address !== undefined) building.address = body.address ?? null;
  if (body.metadata !== undefined) building.metadata = body.metadata ?? null;
  await repo().save(building);
  res.json({ success: true, data: building.toApiResponse() });
});

export const deleteBuilding = asyncHandler(async (req, res) => {
  const building = await repo().findOne({ where: { id: req.params.id } });
  if (!building) { res.status(404).json({ success: false, error: 'Building not found' }); return; }

  const assetCount = await AppDataSource.getRepository(Asset).count({ where: { building_id: req.params.id } });
  if (assetCount > 0) {
    res.status(400).json({ success: false, error: `Cannot delete building with ${assetCount} asset(s). Please reassign or remove them first.` });
    return;
  }

  await AppDataSource.transaction(async (tx) => {
    const floorIds = (await tx.getRepository(Floor).find({ where: { building_id: req.params.id }, select: ['id'] })).map((f) => f.id);
    if (floorIds.length > 0) {
      const waIds = (await tx.getRepository(WorkArea).find({ where: floorIds.map((id) => ({ floor_id: id })), select: ['id'] })).map((w) => w.id);
      if (waIds.length > 0) {
        const secIds = (await tx.getRepository(Section).find({ where: waIds.map((id) => ({ workarea_id: id })), select: ['id'] })).map((s) => s.id);
        if (secIds.length > 0) {
          await tx.getRepository(Workstation).delete(secIds.map((id) => ({ section_id: id })));
          await tx.getRepository(Section).delete(waIds.map((id) => ({ workarea_id: id })));
        }
        await tx.getRepository(WorkArea).delete(floorIds.map((id) => ({ floor_id: id })));
      }
      await tx.getRepository(Floor).delete({ building_id: req.params.id });
    }
    await tx.getRepository(Building).remove(building);
  });
  res.json({ success: true, message: 'Building deleted successfully' });
});
