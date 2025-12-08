import { Request, Response, NextFunction } from 'express';
import Asset from '../models/Asset';

/**
 * Get all assets
 */
export const getAllAssets = async (
  _req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const assets = await Asset.find()
      .sort({ 'basic_info.display_name': 1 });

    res.json({
      success: true,
      data: assets,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get asset by ID
 */
export const getAssetById = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const asset = await Asset.findById(req.params.id);

    if (!asset) {
      res.status(404).json({
        success: false,
        error: 'Asset not found',
      });
      return;
    }

    res.json({
      success: true,
      data: asset,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Create asset
 */
export const createAsset = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const asset = await Asset.create(req.body);

    res.status(201).json({
      success: true,
      data: asset,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update asset
 */
export const updateAsset = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const asset = await Asset.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );

    if (!asset) {
      res.status(404).json({
        success: false,
        error: 'Asset not found',
      });
      return;
    }

    res.json({
      success: true,
      data: asset,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Delete asset
 */
export const deleteAsset = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const asset = await Asset.findByIdAndDelete(req.params.id);

    if (!asset) {
      res.status(404).json({
        success: false,
        error: 'Asset not found',
      });
      return;
    }

    res.json({
      success: true,
      message: 'Asset deleted successfully',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Sync asset with ITSM
 */
export const syncAssetFromITSM = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const asset = await Asset.findById(req.params.id);

    if (!asset) {
      res.status(404).json({
        success: false,
        error: 'Asset not found',
      });
      return;
    }

    if (!asset.itsm.is_managed || !asset.itsm.hardware_id) {
      res.status(400).json({
        success: false,
        error: 'Asset is not ITSM managed',
      });
      return;
    }

    // TODO: Implement actual ITSM sync
    // For now, just update the last_synced timestamp
    asset.itsm.last_synced = new Date();
    asset.itsm.sync_status = 'success';
    await asset.save();

    res.json({
      success: true,
      data: asset,
      message: 'Asset synced successfully',
    });
  } catch (error) {
    next(error);
  }
};