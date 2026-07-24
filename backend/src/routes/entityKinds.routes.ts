/**
 * entityKinds.routes.ts — read-only routes for the EntityKind reference table.
 * Mounted at /api/entity-kinds.
 *
 * @openapi
 * tags:
 *   - name: EntityKinds
 *     description: Configurable map-placeable asset types
 *
 * /entity-kinds:
 *   get:
 *     tags: [EntityKinds]
 *     summary: List entity kinds
 *     responses:
 *       200:
 *         description: Array of entity kinds
 */
import { Router } from 'express';
import { getAllEntityKinds } from '../controllers/entityKind.controller';

const router = Router();

router.get('/', getAllEntityKinds);

export default router;
