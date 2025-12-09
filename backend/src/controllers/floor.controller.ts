import { Request, Response, NextFunction } from 'express';
import Floor from '../models/Floor';

/**
 * Get all floors
 */
export const getAllFloors = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { building_id } = req.query;
    
    const query = building_id ? { building_id } : {};
    const floors = await Floor.find(query)
      .populate('building_id', 'name')
      .sort({ floor_number: 1 });

    res.json({
      success: true,
      data: floors,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get floor by ID
 */
export const getFloorById = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const floor = await Floor.findById(req.params.id)
      .populate('building_id', 'name');

    if (!floor) {
      res.status(404).json({
        success: false,
        error: 'Floor not found',
      });
      return;
    }

    res.json({
      success: true,
      data: floor,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Create floor
 */
export const createFloor = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const floor = await Floor.create(req.body);

    res.status(201).json({
      success: true,
      data: floor,
    });
  } catch (error: any) {
    // Check for duplicate key error
    if (error.code === 11000) {
      res.status(400).json({
        success: false,
        error: `Floor number ${req.body.floor_number} already exists in this building`,
      });
      return;
    }
    next(error);
  }
};

/**
 * Update floor
 */
export const updateFloor = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const floor = await Floor.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );

    if (!floor) {
      res.status(404).json({
        success: false,
        error: 'Floor not found',
      });
      return;
    }

    res.json({
      success: true,
      data: floor,
    });
  } catch (error: any) {
    // Check for duplicate key error
    if (error.code === 11000) {
      res.status(400).json({
        success: false,
        error: `Floor number ${req.body.floor_number} already exists in this building`,
      });
      return;
    }
    next(error);
  }
};

/**
 * Delete floor
 */
export const deleteFloor = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const floor = await Floor.findByIdAndDelete(req.params.id);

    if (!floor) {
      res.status(404).json({
        success: false,
        error: 'Floor not found',
      });
      return;
    }

    res.json({
      success: true,
      message: 'Floor deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};