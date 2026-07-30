/**
 * zone.controller.ts — CRUD for zones (the named group of rooms on a floor —
 * see Zone.entity.ts).
 *
 * A zone has no geometry: the map derives its shape from the work areas that
 * belong to it. So there is nothing here about coordinates or dimensions.
 *
 * `name` must be unique within a floor, matching the same rule work areas and
 * floor numbers already follow.
 *
 * `WorkArea.zone_id` is a soft join with no FK (a real one would give `floors`
 * two cascade paths to `work_areas`, which SQL Server rejects), so deletion
 * has to clear it explicitly — unlike work-area deletion, which blocks when
 * assets still reference it. Ungrouping rooms is harmless and reversible, so
 * deleting a zone just detaches them rather than refusing.
 */
import { Request, Response, NextFunction } from 'express';
import { AppDataSource } from '../config/database';
import { Zone } from '../entities/Zone.entity';
import { WorkArea } from '../entities/WorkArea.entity';

const repo = () => AppDataSource.getRepository(Zone);

export const getAllZones = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { floor_id } = req.query as { floor_id?: string };
    const where = floor_id ? { floor_id } : {};
    const zones = await repo().find({ where, order: { name: 'ASC' } });

    // Room count per zone — the management list needs it, and computing it
    // here avoids the client fetching every work area just to count.
    const counts = await AppDataSource.getRepository(WorkArea)
      .createQueryBuilder('w')
      .select('w.zone_id', 'zone_id')
      .addSelect('COUNT(*)', 'count')
      .where('w.zone_id IS NOT NULL')
      .groupBy('w.zone_id')
      .getRawMany<{ zone_id: string; count: number }>();
    const countByZone = new Map(counts.map((c) => [c.zone_id, Number(c.count)]));

    res.json({
      success: true,
      data: zones.map((z) => ({ ...z.toApiResponse(), workarea_count: countByZone.get(z.id) ?? 0 })),
    });
  } catch (error) { next(error); }
};

export const getZoneById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const zone = await repo().findOne({ where: { id: req.params.id } });
    if (!zone) { res.status(404).json({ success: false, error: 'Zone not found' }); return; }
    res.json({ success: true, data: zone.toApiResponse() });
  } catch (error) { next(error); }
};

export const createZone = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const body = req.body as { floor_id: string; name: string; color?: string | null; description?: string | null };
    if (!body.floor_id || !body.name?.trim()) {
      res.status(400).json({ success: false, error: 'floor_id and name are required' });
      return;
    }

    const existing = await findByFoldedName(body.floor_id, body.name);
    if (existing) {
      res.status(400).json({ success: false, error: `A zone named "${existing.name}" already exists on this floor` });
      return;
    }

    const zone = repo().create({
      floor_id: body.floor_id,
      name: body.name.trim(),
      color: body.color ?? null,
      description: body.description ?? null,
    });
    await repo().save(zone);
    res.status(201).json({ success: true, data: zone.toApiResponse() });
  } catch (error) { next(error); }
};

export const updateZone = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const zone = await repo().findOne({ where: { id: req.params.id } });
    if (!zone) { res.status(404).json({ success: false, error: 'Zone not found' }); return; }
    const body = req.body as Partial<{ name: string; color: string | null; description: string | null }>;

    if (body.name !== undefined && body.name.trim() !== zone.name) {
      const clash = await findByFoldedName(zone.floor_id, body.name);
      if (clash && clash.id !== zone.id) {
        res.status(400).json({ success: false, error: `A zone named "${clash.name}" already exists on this floor` });
        return;
      }
      zone.name = body.name.trim();
    }
    if (body.color !== undefined) zone.color = body.color ?? null;
    if (body.description !== undefined) zone.description = body.description ?? null;
    await repo().save(zone);
    res.json({ success: true, data: zone.toApiResponse() });
  } catch (error) { next(error); }
};

export const deleteZone = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const zone = await repo().findOne({ where: { id: req.params.id } });
    if (!zone) { res.status(404).json({ success: false, error: 'Zone not found' }); return; }

    // Soft join: detach the rooms rather than leaving dangling zone_ids.
    // They stay on the floor, just ungrouped.
    const detached = await AppDataSource.getRepository(WorkArea)
      .update({ zone_id: zone.id }, { zone_id: null });

    await repo().remove(zone);
    res.json({
      success: true,
      message: `Zone deleted. ${detached.affected ?? 0} work area(s) are now ungrouped.`,
    });
  } catch (error) { next(error); }
};

/**
 * Case/whitespace-insensitive name lookup within a floor. Zone names are the
 * join key the physical survey matches `helyszín` against, so "HR" and " hr "
 * must be the same zone rather than two rows that colour differently and split
 * the import.
 */
async function findByFoldedName(floorId: string, name: string): Promise<Zone | null> {
  const target = name.trim().toLowerCase();
  const candidates = await repo().find({ where: { floor_id: floorId } });
  return candidates.find((z) => z.name.trim().toLowerCase() === target) ?? null;
}
