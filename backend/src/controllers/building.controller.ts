import { Request, Response, NextFunction } from 'express';
import Building from '../models/Building';

/**
 * Get all buildings
 */
export const getAllBuildings = async (
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {  
  try {
    const buildings = await Building.find().sort({ name: 1 });

    res.json({
      success: true,
      data: buildings,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get building by ID
 */
export const getBuildingById = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {  
  try {
    const building = await Building.findById(req.params.id);

    if (!building) {
      res.status(404).json({  
        success: false,
        error: 'Building not found',
      });
      return;  
    }

    res.json({
      success: true,
      data: building,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Create building
 */
export const createBuilding = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {  
  try {
    const building = await Building.create(req.body);

    res.status(201).json({
      success: true,
      data: building,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update building
 */
export const updateBuilding = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {  
  try {
    const building = await Building.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );

    if (!building) {
      res.status(404).json({  
        success: false,
        error: 'Building not found',
      });
      return;  
    }

    res.json({
      success: true,
      data: building,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Delete building
 */
export const deleteBuilding = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => { 
  try {
    const building = await Building.findByIdAndDelete(req.params.id);

    if (!building) {
      res.status(404).json({  
        success: false,
        error: 'Building not found',
      });
      return;  
    }

    res.json({
      success: true,
      message: 'Building deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};