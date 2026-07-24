/**
 * workCenters.routes.ts — read-only routes for the WorkCenter organizational
 * reference table. Mounted at /api/work-centers.
 *
 * @openapi
 * tags:
 *   - name: WorkCenters
 *     description: Organizational hierarchy reference data (IFS-aligned)
 *
 * /work-centers:
 *   get:
 *     tags: [WorkCenters]
 *     summary: List work centers
 *     responses:
 *       200:
 *         description: Array of work centers
 */
import { Router } from 'express';
import { getAllWorkCenters } from '../controllers/workCenter.controller';

const router = Router();

router.get('/', getAllWorkCenters);

export default router;
