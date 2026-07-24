import { Router } from 'express';
import { exportShopfloorVisualizer } from '../controllers/export.controller';

const router = Router();

router.get('/shopfloor-visualizer', exportShopfloorVisualizer);

export default router;
