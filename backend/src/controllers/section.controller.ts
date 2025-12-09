import { Request, Response, NextFunction } from 'express';
import Section from '../models/Section';

export const getAllSections = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { workarea_id } = req.query;
    const query = workarea_id ? { workarea_id } : {};
    const sections = await Section.find(query).sort({ name: 1 });
    res.json({ success: true, data: sections });
  } catch (error) {
    next(error);
  }
};

export const getSectionById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const section = await Section.findById(req.params.id);
    if (!section) {
      res.status(404).json({ success: false, error: 'Section not found' });
      return;
    }
    res.json({ success: true, data: section });
  } catch (error) {
    next(error);
  }
};

export const createSection = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const section = await Section.create(req.body);
    res.status(201).json({ success: true, data: section });
  } catch (error) {
    next(error);
  }
};

export const updateSection = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const section = await Section.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!section) {
      res.status(404).json({ success: false, error: 'Section not found' });
      return;
    }
    res.json({ success: true, data: section });
  } catch (error) {
    next(error);
  }
};

export const deleteSection = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const section = await Section.findByIdAndDelete(req.params.id);
    if (!section) {
      res.status(404).json({ success: false, error: 'Section not found' });
      return;
    }
    res.json({ success: true, message: 'Section deleted successfully' });
  } catch (error) {
    next(error);
  }
};