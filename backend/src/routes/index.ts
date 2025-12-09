import { Router } from 'express';
import buildingsRoutes from './buildings.routes';
import floorsRoutes from './floors.routes';
import workareasRoutes from './workareas.routes';
import sectionsRoutes from './sections.routes';
import workstationsRoutes from './workstations.routes';
import assetsRoutes from './asset.routes';
import itsmRoutes from './itsm.routes';

const router = Router();

router.use('/buildings', buildingsRoutes);
router.use('/floors', floorsRoutes);
router.use('/workareas', workareasRoutes);
router.use('/sections', sectionsRoutes);
router.use('/workstations', workstationsRoutes);
router.use('/assets', assetsRoutes);
router.use('/itsm', itsmRoutes);

export default router;