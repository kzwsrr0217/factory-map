import { Router } from 'express';
import buildingsRoutes from './buildings.routes';
import itsmRoutes from './itsm.routes';

const router = Router();

router.use('/buildings', buildingsRoutes);
router.use('/itsm', itsmRoutes);

// TODO: Add more routes
// router.use('/floors', floorsRoutes);
// router.use('/workareas', workareasRoutes);
// router.use('/sections', sectionsRoutes);
// router.use('/workstations', workstationsRoutes);
// router.use('/assets', assetsRoutes);

export default router;