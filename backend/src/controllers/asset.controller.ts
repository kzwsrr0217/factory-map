// src/controllers/asset.controller.ts
import { Request, Response, NextFunction } from 'express';
import Asset from '../models/Asset';

// --- Get All Assets ---
export const getAllAssets = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const assets = await Asset.find()
      // A populate tölti fel az ID-kat valódi adatokkal a kapcsolt táblákból
      .populate('hierarchy.building_id')
      .populate('hierarchy.floor_id')
      .populate('hierarchy.workarea_id')
      .populate('hierarchy.section_id')
      .populate('hierarchy.workstation_id');

    res.status(200).json({
      success: true,
      count: assets.length,
      data: assets,
    });
  } catch (error) {
    next(error);
  }
};

// --- Get Asset By ID ---
export const getAssetById = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const asset = await Asset.findById(req.params.id)
      .populate('hierarchy.building_id')
      .populate('hierarchy.floor_id');

    if (!asset) {
      return res.status(404).json({
        success: false,
        error: 'Asset not found',
      });
    }

    res.status(200).json({
      success: true,
      data: asset,
    });
  } catch (error) {
    next(error);
  }
};