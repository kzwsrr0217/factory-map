import { Request, Response, NextFunction } from 'express';
import itsmService from '../services/itsm/ITSMService';

/**
 * Search hardware in ITSM
 */
export const searchHardware = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { q } = req.query;

    if (!q || typeof q !== 'string') {
      res.status(400).json({  
        success: false,
        error: 'Query parameter "q" is required',
      });
      return; 
    }

    const results = await itsmService.searchHardware(q);

    res.json({
      success: true,
      data: results,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get hardware details from ITSM
 */
export const getHardware = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {  
  try {
    const { hardwareId } = req.params;

    const hardware = await itsmService.getHardware(hardwareId);

    res.json({
      success: true,
      data: hardware,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Sync asset from ITSM (full sync)
 */
export const syncAsset = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {  
  try {
    const { hardwareId } = req.params;

    const result = await itsmService.syncAsset(hardwareId);

    if (!result.success) {
      res.status(500).json({  
        success: false,
        error: result.error,
      });
      return;  
    }

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};