import { Request, Response, NextFunction } from 'express';
import Workstation from '../models/Workstation';

export const getAllWorkstations = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { section_id } = req.query;
    const query = section_id ? { section_id } : {};
    const workstations = await Workstation.find(query).sort({ name: 1 });
    res.json({ success: true, data: workstations });
  } catch (error) {
    next(error);
  }
};

export const getWorkstationById = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const workstation = await Workstation.findById(req.params.id);
    if (!workstation) {
      res.status(404).json({ success: false, error: 'Workstation not found' });
      return;
    }
    res.json({ success: true, data: workstation });
  } catch (error) {
    next(error);
  }
};

export const createWorkstation = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const workstation = await Workstation.create(req.body);
    res.status(201).json({ success: true, data: workstation });
  } catch (error) {
    next(error);
  }
};

export const updateWorkstation = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const workstation = await Workstation.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!workstation) {
      res.status(404).json({ success: false, error: 'Workstation not found' });
      return;
    }
    res.json({ success: true, data: workstation });
  } catch (error) {
    next(error);
  }
};

export const deleteWorkstation = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const workstation = await Workstation.findByIdAndDelete(req.params.id);
    if (!workstation) {
      res.status(404).json({ success: false, error: 'Workstation not found' });
      return;
    }
    res.json({ success: true, message: 'Workstation deleted successfully' });
  } catch (error) {
    next(error);
  }
};