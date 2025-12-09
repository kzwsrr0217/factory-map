import { Router } from 'express';
import {
  getAllAssets,
  getAssetById,
  createAsset,
  updateAsset,
  deleteAsset,
  syncAssetFromITSM,
} from '../controllers/asset.controller';

const router = Router();

router.get('/', getAllAssets);
router.get('/:id', getAssetById);
router.post('/', createAsset);
router.patch('/:id', updateAsset);
router.delete('/:id', deleteAsset);
router.post('/:id/sync', syncAssetFromITSM);

export default router;