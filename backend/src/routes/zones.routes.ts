/**
 * zones.routes.ts — Zone routes, mounted at /api/zones.
 * All routes require authentication (enforced in index.ts); writes require
 * the operator role.
 *
 * @openapi
 * tags:
 *   - name: Zones
 *     description: Named groups of work areas on a floor (Building > Floor > Zone > WorkArea)
 *
 * /zones:
 *   get:
 *     tags: [Zones]
 *     summary: List zones, optionally filtered to one floor
 *     parameters:
 *       - in: query
 *         name: floor_id
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Zones, each with a workarea_count
 *   post:
 *     tags: [Zones]
 *     summary: Create a zone
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [floor_id, name]
 *             properties:
 *               floor_id: { type: string }
 *               name: { type: string }
 *               color: { type: string, nullable: true }
 *               description: { type: string, nullable: true }
 *     responses:
 *       201:
 *         description: Created
 *       400:
 *         description: Missing fields, or the name is taken on this floor
 *
 * /zones/{id}:
 *   get:
 *     tags: [Zones]
 *     summary: Get one zone
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Zone }
 *       404: { description: Not found }
 *   patch:
 *     tags: [Zones]
 *     summary: Update a zone's name, colour or description
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Updated }
 *       400: { description: Name already taken on this floor }
 *   delete:
 *     tags: [Zones]
 *     summary: Delete a zone — its work areas stay on the floor, just ungrouped
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Deleted, with the count of detached work areas }
 */
import { Router } from 'express';
import {
  getAllZones,
  getZoneById,
  createZone,
  updateZone,
  deleteZone,
} from '../controllers/zone.controller';
import { requireOperator } from '../middleware/auth.middleware';

const router = Router();

router.get('/', getAllZones);
router.get('/:id', getZoneById);
router.post('/', requireOperator, createZone);
router.patch('/:id', requireOperator, updateZone);
router.delete('/:id', requireOperator, deleteZone);

export default router;
