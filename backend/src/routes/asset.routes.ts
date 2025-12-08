// src/routes/asset.routes.ts
import { Router } from 'express';
import { getAllAssets, getAssetById } from '../controllers/asset.controller';

const router = Router();

// GET /api/assets
router.get('/', getAllAssets);

// GET /api/assets/:id
router.get('/:id', getAssetById);

export default router;