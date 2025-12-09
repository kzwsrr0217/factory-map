import { Request, Response, NextFunction } from 'express';
import WorkArea from '../models/WorkArea';

/**
 * Get all work areas
 */
export const getAllWorkAreas = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { floor_id } = req.query;
    
    const query = floor_id ? { floor_id } : {};
    const workAreas = await WorkArea.find(query)
      .populate('floor_id', 'name')  // ← CSAK floor_id
      .sort({ name: 1 });

    res.json({
      success: true,
      data: workAreas,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get work area by ID
 */
export const getWorkAreaById = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const workArea = await WorkArea.findById(req.params.id)
      .populate('floor_id', 'name');  // ← CSAK floor_id

    if (!workArea) {
      res.status(404).json({
        success: false,
        error: 'Work area not found',
      });
      return;
    }

    res.json({
      success: true,
      data: workArea,
    });
  } catch (error) {
    next(error);
  }
};


/**
 * Create work area
 */
export const createWorkArea = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const workArea = await WorkArea.create(req.body);

    res.status(201).json({
      success: true,
      data: workArea,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update work area
 */
export const updateWorkArea = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const workArea = await WorkArea.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );

    if (!workArea) {
      res.status(404).json({
        success: false,
        error: 'Work area not found',
      });
      return;
    }

    res.json({
      success: true,
      data: workArea,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Delete work area
 */
export const deleteWorkArea = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const workArea = await WorkArea.findByIdAndDelete(req.params.id);

    if (!workArea) {
      res.status(404).json({
        success: false,
        error: 'Work area not found',
      });
      return;
    }

    res.json({
      success: true,
      message: 'Work area deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};