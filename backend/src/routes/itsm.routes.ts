import { Router } from 'express';
import {
  searchHardware,
  getHardware,
  syncAsset,
} from '../controllers/itsm.controller';

const router = Router();

router.get('/hardware/search', searchHardware);
router.get('/hardware/:hardwareId', getHardware);
router.post('/sync/:hardwareId', syncAsset);

export default router;