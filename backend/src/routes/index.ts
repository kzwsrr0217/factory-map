/**
 * routes/index.ts — Main API router.
 *
 * Mounts all sub-routers under their respective paths. The `authenticate` middleware
 * is applied here as a blanket guard for all routes below `/auth`. This means every
 * endpoint except the auth routes requires a valid JWT — no endpoint can be accidentally
 * left unprotected by forgetting to add the middleware to a specific route file.
 *
 * Public (no auth required):
 *   /api/auth  — login, refresh, capabilities
 *
 * Protected (JWT required):
 *   /api/buildings, /api/floors, /api/zones, /api/workareas, /api/sections, /api/workstations
 *   /api/assets, /api/itsm, /api/users, /api/audit
 */
import { Router } from 'express';
import buildingsRoutes from './buildings.routes';
import floorsRoutes from './floors.routes';
import zonesRoutes from './zones.routes';
import workareasRoutes from './workareas.routes';
import sectionsRoutes from './sections.routes';
import workstationsRoutes from './workstations.routes';
import assetsRoutes from './asset.routes';
import itsmRoutes from './itsm.routes';
import authRoutes from './auth.routes';
import userRoutes from './user.routes';
import auditRoutes from './audit.routes';
import alertRoutes from './alert.routes';
import networkRoutes from './network.routes';
import entityKindsRoutes from './entityKinds.routes';
import productionLinesRoutes from './productionLines.routes';
import workCentersRoutes from './workCenters.routes';
import exportRoutes from './export.routes';
import normalisationTasksRoutes from './normalisationTasks.routes';
import inventoryRoutes from './inventory.routes';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// Public — no auth required
router.use('/auth', authRoutes);

// Protected — all routes below require a valid JWT
router.use(authenticate);

router.use('/buildings', buildingsRoutes);
router.use('/floors', floorsRoutes);
router.use('/zones', zonesRoutes);
router.use('/workareas', workareasRoutes);
router.use('/sections', sectionsRoutes);
router.use('/workstations', workstationsRoutes);
router.use('/assets', assetsRoutes);
router.use('/itsm', itsmRoutes);
router.use('/users', userRoutes);
router.use('/audit', auditRoutes);
router.use('/alerts', alertRoutes);
router.use('/network', networkRoutes);
router.use('/entity-kinds', entityKindsRoutes);
router.use('/production-lines', productionLinesRoutes);
router.use('/work-centers', workCentersRoutes);
router.use('/export', exportRoutes);
router.use('/tasks', normalisationTasksRoutes);
router.use('/inventory', inventoryRoutes);

export default router;