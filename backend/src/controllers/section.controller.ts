/**
 * section.controller.ts — CRUD for sections within work areas.
 *
 * Sections are relatively simple entities — they hold a position, optional
 * capacity, and a shift schedule. Their deletion cascades to workstations via
 * the TypeORM relation (cascade: true on Section.workstations). Assets are a
 * soft join (`asset.section_id`, no FK) so deletion is guarded by an explicit
 * asset-count check instead — see deleteSection.
 */
import { Request, Response, NextFunction } from 'express';
import { AppDataSource } from '../config/database';
import { Section } from '../entities/Section.entity';
import { Asset } from '../entities/Asset.entity';

const repo = () => AppDataSource.getRepository(Section);

export const getAllSections = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { workarea_id } = req.query as { workarea_id?: string };
    const where = workarea_id ? { workarea_id } : {};
    const sections = await repo().find({ where, order: { name: 'ASC' } });
    res.json({ success: true, data: sections.map((s) => s.toApiResponse()) });
  } catch (error) { next(error); }
};

export const getSectionById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const section = await repo().findOne({ where: { id: req.params.id } });
    if (!section) { res.status(404).json({ success: false, error: 'Section not found' }); return; }
    res.json({ success: true, data: section.toApiResponse() });
  } catch (error) { next(error); }
};

export const createSection = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const body = req.body as { workarea_id: string; name: string; coordinates?: { x: number; y: number }; capacity?: number; shift_schedule?: string; workcenter_code?: string };
    const section = repo().create({
      workarea_id: body.workarea_id,
      name: body.name,
      coord_x: body.coordinates?.x ?? 0,
      coord_y: body.coordinates?.y ?? 0,
      capacity: body.capacity ?? null,
      shift_schedule: body.shift_schedule ?? null,
      workcenter_code: body.workcenter_code ?? null,
    });
    await repo().save(section);
    res.status(201).json({ success: true, data: section.toApiResponse() });
  } catch (error) { next(error); }
};

export const updateSection = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const section = await repo().findOne({ where: { id: req.params.id } });
    if (!section) { res.status(404).json({ success: false, error: 'Section not found' }); return; }
    const body = req.body as Partial<{ name: string; coordinates: { x: number; y: number }; capacity: number; shift_schedule: string; workcenter_code: string }>;
    if (body.name !== undefined) section.name = body.name;
    if (body.coordinates !== undefined) { section.coord_x = body.coordinates.x; section.coord_y = body.coordinates.y; }
    if (body.capacity !== undefined) section.capacity = body.capacity ?? null;
    if (body.shift_schedule !== undefined) section.shift_schedule = body.shift_schedule ?? null;
    if (body.workcenter_code !== undefined) section.workcenter_code = body.workcenter_code ?? null;
    await repo().save(section);
    res.json({ success: true, data: section.toApiResponse() });
  } catch (error) { next(error); }
};

export const deleteSection = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const section = await repo().findOne({ where: { id: req.params.id } });
    if (!section) { res.status(404).json({ success: false, error: 'Section not found' }); return; }

    const assetCount = await AppDataSource.getRepository(Asset).count({ where: { section_id: req.params.id } });
    if (assetCount > 0) {
      res.status(400).json({ success: false, error: `Cannot delete section with ${assetCount} asset(s). Please reassign or remove them first.` });
      return;
    }

    await repo().remove(section);
    res.json({ success: true, message: 'Section deleted successfully' });
  } catch (error) { next(error); }
};
