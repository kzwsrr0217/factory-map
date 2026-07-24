/**
 * productionLines.routes.ts — read-only routes for the ProductionLine
 * organizational reference table. Mounted at /api/production-lines.
 *
 * @openapi
 * tags:
 *   - name: ProductionLines
 *     description: Organizational hierarchy reference data (IFS-aligned)
 *
 * /production-lines:
 *   get:
 *     tags: [ProductionLines]
 *     summary: List production lines
 *     responses:
 *       200:
 *         description: Array of production lines
 */
import { Router } from 'express';
import { getAllProductionLines } from '../controllers/productionLine.controller';

const router = Router();

router.get('/', getAllProductionLines);

export default router;
