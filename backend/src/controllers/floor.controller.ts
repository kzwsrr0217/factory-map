/**
 * floor.controller.ts — CRUD for floors.
 *
 * Key behaviours:
 *  - `createFloor`: Validates that the floor_number is unique within the building
 *    before saving.
 *  - `updateFloor`: Re-validates uniqueness if the floor_number is being changed.
 *  - `deleteFloor`: Blocks deletion if assets, wall ports, OR network rooms
 *    are assigned to the floor (all three are soft joins via floor_id, no
 *    FK — orphaned rows would otherwise survive pointing at a deleted floor,
 *    the network room case still carrying real rack/patch-panel wiring info
 *    cascaded underneath it).
 *    Cascades: work areas → sections → workstations before removing the floor.
 *
 * The floor plan image (`svg_background`) is not handled here — it is uploaded
 * separately via the floor plan upload endpoint and stored as base64 in the entity.
 *
 * `getFloorSvg` serves the newer file-reference floor plans (`svg_ref`, see
 * FLOORPLANS_DIR below) — a prototype path alongside the base64 approach,
 * not a replacement of it yet.
 */
import { Request, Response, NextFunction } from 'express';
import * as fs from 'fs';
import * as path from 'path';
import { AppDataSource } from '../config/database';
import { Floor } from '../entities/Floor.entity';
import { WorkArea } from '../entities/WorkArea.entity';
import { Section } from '../entities/Section.entity';
import { Workstation } from '../entities/Workstation.entity';
import { Asset } from '../entities/Asset.entity';
import { WallPort } from '../entities/WallPort.entity';
import { NetworkRoom } from '../entities/NetworkRoom.entity';
import { Building } from '../entities/Building.entity';

const repo = () => AppDataSource.getRepository(Floor);

// File-reference floor plans (Floor.svg_ref) — see Floor.entity.ts and
// docs/DATA_MODEL_MIGRATION.md. Files live under this directory, checked
// into the repo (not uploaded at runtime), mirroring shopfloor_visualizer's
// "the plan is its own file, not a DB blob" convention.
const FLOORPLANS_DIR = path.resolve(__dirname, '../floorplans');

export const getAllFloors = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { building_id } = req.query as { building_id?: string };
    const where = building_id ? { building_id } : {};
    const floors = await repo().find({ where, order: { floor_number: 'ASC' } });
    res.json({ success: true, data: floors.map((f) => f.toApiResponse()) });
  } catch (error) { next(error); }
};

/**
 * GET /floors/progress — how far the survey has got, floor by floor.
 *
 * The estate-wide numbers on the dashboard say nothing about where the work stands:
 * recording a factory takes weeks, several people walk different floors, and the
 * question every morning is which floor is done and which was left half-finished.
 *
 * Everything is counted in the database with four group-bys rather than by shipping
 * rows to the browser — this has to stay cheap enough to open all the time, and the
 * socket counts alone would be thousands of rows once the network survey runs.
 *
 * Definitions, all deliberate:
 *  - `assets` counts what belongs ON the plan: rack-mounted devices are excluded,
 *    since they are drawn in the rack diagram instead, and superseded rows are
 *    excluded everywhere (they are replacement history, see getAssetStats).
 *  - a socket is `patched` once it reaches a panel, `live` only once a switch port
 *    is recorded too — the two are separate states because a patched socket with no
 *    switch has no network, which is the mistake the whole workflow guards against.
 *  - `occupied` is about devices, not cabling: a socket can be occupied and dead.
 */
export const getFloorProgress = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const floors = await repo().find({ order: { floor_number: 'ASC' } });
    const buildings = await AppDataSource.getRepository(Building).find();
    const buildingName = new Map(buildings.map((b) => [b.id, b.name]));

    type Row = { floor_id: string | null; total: number; placed: number };
    const assetRows = await AppDataSource.getRepository(Asset)
      .createQueryBuilder('a')
      .select('a.floor_id', 'floor_id')
      .addSelect('COUNT(*)', 'total')
      .addSelect('SUM(CASE WHEN a.is_placed = 1 THEN 1 ELSE 0 END)', 'placed')
      .where('a.successor_id IS NULL')
      .andWhere('a.rack_id IS NULL')
      .groupBy('a.floor_id')
      .getRawMany<Row>();
    const assetsByFloor = new Map(assetRows.map((r) => [r.floor_id ?? '', r]));

    const areaRows = await AppDataSource.getRepository(WorkArea)
      .createQueryBuilder('w')
      .select('w.floor_id', 'floor_id')
      .addSelect('COUNT(*)', 'count')
      .groupBy('w.floor_id')
      .getRawMany<{ floor_id: string; count: number }>();
    const areasByFloor = new Map(areaRows.map((r) => [r.floor_id, Number(r.count)]));

    const socketRows = await AppDataSource.getRepository(WallPort)
      .createQueryBuilder('w')
      .select('w.floor_id', 'floor_id')
      .addSelect('COUNT(*)', 'total')
      .addSelect('SUM(CASE WHEN w.patch_panel_id IS NOT NULL THEN 1 ELSE 0 END)', 'patched')
      .addSelect('SUM(CASE WHEN w.patch_panel_id IS NOT NULL AND w.switch_port IS NOT NULL THEN 1 ELSE 0 END)', 'live')
      .groupBy('w.floor_id')
      .getRawMany<{ floor_id: string; total: number; patched: number; live: number }>();
    const socketsByFloor = new Map(socketRows.map((r) => [r.floor_id, r]));

    // Separate query: MSSQL won't aggregate over a subquery, and joining the assets
    // in above would multiply the socket rows (so the patched/live sums would lie).
    // COUNT(DISTINCT w.id) rather than COUNT(*) for the same reason.
    const occupiedRows = await AppDataSource.getRepository(WallPort)
      .createQueryBuilder('w')
      .select('w.floor_id', 'floor_id')
      .addSelect('COUNT(DISTINCT w.id)', 'occupied')
      .innerJoin(Asset, 'x', 'x.wall_port_id = w.id AND x.successor_id IS NULL')
      .groupBy('w.floor_id')
      .getRawMany<{ floor_id: string; occupied: number }>();
    const occupiedByFloor = new Map(occupiedRows.map((r) => [r.floor_id, Number(r.occupied)]));

    const data = floors.map((f) => {
      const a = assetsByFloor.get(f.id);
      const s = socketsByFloor.get(f.id);
      return {
        floor_id: f.id,
        floor_name: f.name,
        floor_number: f.floor_number,
        building_id: f.building_id,
        building_name: buildingName.get(f.building_id) ?? null,
        has_floor_plan: !!(f.svg_background || f.svg_ref || f.map_file),
        work_areas: areasByFloor.get(f.id) ?? 0,
        assets: { total: Number(a?.total ?? 0), placed: Number(a?.placed ?? 0) },
        sockets: {
          total: Number(s?.total ?? 0),
          patched: Number(s?.patched ?? 0),
          live: Number(s?.live ?? 0),
          occupied: occupiedByFloor.get(f.id) ?? 0,
        },
      };
    });

    // Devices assigned to no floor at all: the survey backlog, and the reason a
    // per-floor table alone would look finished while most of the estate is missing.
    const noFloor = assetsByFloor.get('');
    res.json({
      success: true,
      data,
      meta: {
        unassigned_assets: Number(noFloor?.total ?? 0),
        generated_at: new Date().toISOString(),
      },
    });
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
    const body = req.body as { building_id: string; floor_number: number; name: string; map_file?: string; svg_background?: string; svg_ref?: string; scale_meters_per_unit?: number; metadata?: Record<string, unknown> };
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
      svg_ref: body.svg_ref ?? null,
      scale_meters_per_unit: body.scale_meters_per_unit ?? null,
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
    const body = req.body as Partial<{ floor_number: number; name: string; map_file: string; svg_background: string; svg_ref: string; scale_meters_per_unit: number; metadata: Record<string, unknown> }>;

    if (body.floor_number !== undefined && body.floor_number !== floor.floor_number) {
      const dup = await repo().findOne({ where: { building_id: floor.building_id, floor_number: body.floor_number } });
      if (dup) { res.status(400).json({ success: false, error: `Floor number ${body.floor_number} already exists` }); return; }
      floor.floor_number = body.floor_number;
    }
    if (body.name !== undefined) floor.name = body.name;
    if (body.map_file !== undefined) floor.map_file = body.map_file ?? null;
    if (body.svg_background !== undefined) floor.svg_background = body.svg_background ?? null;
    if (body.svg_ref !== undefined) floor.svg_ref = body.svg_ref ?? null;
    if (body.scale_meters_per_unit !== undefined) floor.scale_meters_per_unit = body.scale_meters_per_unit ?? null;
    if (body.metadata !== undefined) floor.metadata = body.metadata ?? null;

    await repo().save(floor);
    res.json({ success: true, data: floor.toApiResponse() });
  } catch (error) { next(error); }
};

// ── GET /floors/:id/svg ────────────────────────────────────────────────────
// Serves the floor plan file referenced by Floor.svg_ref (see
// Floor.entity.ts / docs/DATA_MODEL_MIGRATION.md). svg_ref is a plain
// filename, never a path — rejects anything that would resolve outside
// FLOORPLANS_DIR (path traversal via '..', absolute paths, etc.).
export const getFloorSvg = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const floor = await repo().findOne({ where: { id: req.params.id } });
    if (!floor) { res.status(404).json({ success: false, error: 'Floor not found' }); return; }
    if (!floor.svg_ref) { res.status(404).json({ success: false, error: 'This floor has no svg_ref' }); return; }

    const resolved = path.resolve(FLOORPLANS_DIR, floor.svg_ref);
    const rel = path.relative(FLOORPLANS_DIR, resolved);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      res.status(400).json({ success: false, error: 'Invalid svg_ref' });
      return;
    }
    if (!fs.existsSync(resolved)) {
      res.status(404).json({ success: false, error: 'Floor plan file not found on disk' });
      return;
    }

    res.type('image/svg+xml');
    const stream = fs.createReadStream(resolved);
    stream.on('error', (err) => { if (!res.headersSent) next(err); else res.destroy(); });
    stream.pipe(res);
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

    const wallPortCount = await AppDataSource.getRepository(WallPort).count({ where: { floor_id: req.params.id } });
    if (wallPortCount > 0) {
      res.status(400).json({ success: false, error: `Cannot delete floor with ${wallPortCount} wall port(s). Please remove them first.` });
      return;
    }

    const roomCount = await AppDataSource.getRepository(NetworkRoom).count({ where: { floor_id: req.params.id } });
    if (roomCount > 0) {
      res.status(400).json({ success: false, error: `Cannot delete floor with ${roomCount} network room(s). Please reassign or remove them first.` });
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
