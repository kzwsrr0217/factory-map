/**
 * workarea.controller.ts — CRUD for work areas.
 *
 * Work areas have optional position (`coordinates`) and size (`dimensions`)
 * properties that control where they are rendered on the floor map. If not
 * provided on creation, they default to (0, 0) with 150×100 dimensions.
 *
 * `name` must be unique within a floor (not globally — the same name on a
 * different floor is fine) — see the existence check in createWorkArea /
 * updateWorkArea, matching the floor_number-within-a-building uniqueness
 * check in floor.controller.ts.
 *
 * Deletion cascades automatically via the Section and Workstation TypeORM
 * relations (cascade: true on WorkArea.sections), so no manual cascade
 * logic is needed for those. Assets are a different story: `asset.workarea_id`
 * is a soft join (no FK), so it needs an explicit guard — see deleteWorkArea,
 * matching the same asset-count check building.controller.ts / floor
 * deletion already do.
 */
import { Request, Response, NextFunction } from 'express';
import { In } from 'typeorm';
import { AppDataSource } from '../config/database';
import { WorkArea } from '../entities/WorkArea.entity';
import { Zone } from '../entities/Zone.entity';
import { Asset } from '../entities/Asset.entity';

const repo = () => AppDataSource.getRepository(WorkArea);

/**
 * Attaches each area's zone. `zone_id` is a soft join with no TypeORM relation
 * (see WorkArea.entity.ts — a real FK would give `floors` two cascade paths to
 * `work_areas`), so it's resolved here in one extra query rather than per row.
 */
async function withZones(areas: WorkArea[]): Promise<WorkArea[]> {
  const ids = [...new Set(areas.map((a) => a.zone_id).filter((id): id is string => !!id))];
  if (ids.length === 0) return areas;
  const zones = await AppDataSource.getRepository(Zone).find({ where: { id: In(ids) } });
  const byId = new Map(zones.map((z) => [z.id, z]));
  for (const area of areas) {
    const z = area.zone_id ? byId.get(area.zone_id) : undefined;
    area.zone = z ? { id: z.id, name: z.name, color: z.color } : null;
  }
  return areas;
}

// The map's drag-to-move handler recomputes an asset's workarea_id from its
// new position (see frontend/src/utils/workareaGeometry.ts), but that only
// fires when the ASSET is dragged. Moving or resizing the WORK AREA itself
// left every asset's workarea_id exactly as it was — stale the moment an
// asset that used to be inside the rectangle no longer is (or vice versa).
// Re-derives every asset's membership on this floor from current geometry
// whenever a work area's coordinates/dimensions actually change.
async function recomputeAssetWorkareaMembership(floorId: string): Promise<void> {
  const assetRepo = AppDataSource.getRepository(Asset);
  const [workareas, assets] = await Promise.all([
    repo().find({ where: { floor_id: floorId } }),
    assetRepo.find({ where: { floor_id: floorId } }),
  ]);
  for (const asset of assets) {
    const match = workareas.find((wa) => {
      const wx = wa.coord_x ?? 0, wy = wa.coord_y ?? 0, ww = wa.dim_width ?? 150, wh = wa.dim_height ?? 100;
      return asset.loc_x >= wx && asset.loc_x <= wx + ww && asset.loc_y >= wy && asset.loc_y <= wy + wh;
    });
    const newWorkareaId = match?.id ?? null;
    if (asset.workarea_id !== newWorkareaId) {
      await assetRepo.update({ id: asset.id }, { workarea_id: newWorkareaId });
    }
  }
}

export const getAllWorkAreas = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { floor_id } = req.query as { floor_id?: string };
    const where = floor_id ? { floor_id } : {};
    const areas = await withZones(await repo().find({ where, order: { name: 'ASC' } }));
    res.json({ success: true, data: areas.map((a) => a.toApiResponse()) });
  } catch (error) { next(error); }
};

export const getWorkAreaById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const area = await repo().findOne({ where: { id: req.params.id } });
    if (!area) { res.status(404).json({ success: false, error: 'Work area not found' }); return; }
    await withZones([area]);
    res.json({ success: true, data: area.toApiResponse() });
  } catch (error) { next(error); }
};

export const createWorkArea = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const body = req.body as {
      floor_id: string; name: string; type?: string; zone_id?: string | null;
      coordinates?: { x: number; y: number };
      dimensions?: { width: number; height: number };
      production_line_code?: string;
      metadata?: Record<string, unknown>;
    };

    const existing = await repo().findOne({ where: { floor_id: body.floor_id, name: body.name } });
    if (existing) {
      res.status(400).json({ success: false, error: `A work area named "${body.name}" already exists on this floor` });
      return;
    }

    const area = repo().create({
      floor_id: body.floor_id,
      name: body.name,
      zone_id: body.zone_id ?? null,
      type: body.type ?? null,
      coord_x: body.coordinates?.x ?? 0,
      coord_y: body.coordinates?.y ?? 0,
      dim_width: body.dimensions?.width ?? 150,
      dim_height: body.dimensions?.height ?? 100,
      production_line_code: body.production_line_code ?? null,
      metadata: body.metadata ?? null,
    });
    await repo().save(area);
    await withZones([area]);
    res.status(201).json({ success: true, data: area.toApiResponse() });
  } catch (error) { next(error); }
};

export const updateWorkArea = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const area = await repo().findOne({ where: { id: req.params.id } });
    if (!area) { res.status(404).json({ success: false, error: 'Work area not found' }); return; }
    const body = req.body as Partial<{
      name: string; type: string; zone_id: string | null;
      coordinates: { x: number; y: number };
      dimensions: { width: number; height: number };
      production_line_code: string;
      metadata: Record<string, unknown>;
    }>;
    const geometryChanging = body.coordinates !== undefined || body.dimensions !== undefined;

    if (body.name !== undefined && body.name !== area.name) {
      const existing = await repo().findOne({ where: { floor_id: area.floor_id, name: body.name } });
      if (existing) {
        res.status(400).json({ success: false, error: `A work area named "${body.name}" already exists on this floor` });
        return;
      }
      area.name = body.name;
    }
    if (body.zone_id !== undefined) area.zone_id = body.zone_id ?? null;
    if (body.type !== undefined) area.type = body.type ?? null;
    if (body.coordinates !== undefined) { area.coord_x = body.coordinates.x; area.coord_y = body.coordinates.y; }
    if (body.dimensions !== undefined) { area.dim_width = body.dimensions.width; area.dim_height = body.dimensions.height; }
    if (body.production_line_code !== undefined) area.production_line_code = body.production_line_code ?? null;
    if (body.metadata !== undefined) area.metadata = body.metadata ?? null;
    await repo().save(area);

    if (geometryChanging) await recomputeAssetWorkareaMembership(area.floor_id);

    await withZones([area]);
    res.json({ success: true, data: area.toApiResponse() });
  } catch (error) { next(error); }
};

export const deleteWorkArea = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const area = await repo().findOne({ where: { id: req.params.id } });
    if (!area) { res.status(404).json({ success: false, error: 'Work area not found' }); return; }

    const assetCount = await AppDataSource.getRepository(Asset).count({ where: { workarea_id: req.params.id } });
    if (assetCount > 0) {
      res.status(400).json({ success: false, error: `Cannot delete work area with ${assetCount} asset(s). Please reassign or remove them first.` });
      return;
    }

    await repo().remove(area);
    res.json({ success: true, message: 'Work area deleted successfully' });
  } catch (error) { next(error); }
};
