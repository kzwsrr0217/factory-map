/**
 * floors.routes.ts — REST routes for the Floor resource.
 * Mounted at /api/floors. Supports ?building_id= query filter on GET /.
 *
 * @openapi
 * tags:
 *   - name: Floors
 *     description: Floor management
 *
 * /floors:
 *   get:
 *     tags: [Floors]
 *     summary: List all floors (optionally filtered by building)
 *     parameters:
 *       - in: query
 *         name: building_id
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Array of floors
 *   post:
 *     tags: [Floors]
 *     summary: Create a floor
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [building_id, floor_number]
 *             properties:
 *               building_id: { type: string }
 *               floor_number: { type: integer, example: 1 }
 *               name: { type: string }
 *               floor_plan_image: { type: string, description: Base64 image data URL }
 *     responses:
 *       201:
 *         description: Created floor
 *
 * /floors/{id}/svg:
 *   get:
 *     tags: [Floors]
 *     summary: Serve the floor plan file referenced by Floor.svg_ref
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: SVG file content
 *       404:
 *         description: Floor not found, no svg_ref set, or file missing on disk
 *
 * /floors/{id}:
 *   get:
 *     tags: [Floors]
 *     summary: Get floor by ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Floor details
 *       404:
 *         description: Not found
 *   patch:
 *     tags: [Floors]
 *     summary: Update a floor
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name: { type: string }
 *               floor_plan_image: { type: string }
 *     responses:
 *       200:
 *         description: Updated floor
 *   delete:
 *     tags: [Floors]
 *     summary: Delete a floor
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Deleted
 */
import { Router } from 'express';
import {
  getAllFloors,
  getFloorById,
  getFloorSvg,
  createFloor,
  updateFloor,
  deleteFloor,
} from '../controllers/floor.controller';
import { requireOperator } from '../middleware/auth.middleware';

const router = Router();

router.get('/', getAllFloors);
router.get('/:id/svg', getFloorSvg);
router.get('/:id', getFloorById);
router.post('/', requireOperator, createFloor);
router.patch('/:id', requireOperator, updateFloor);
router.delete('/:id', requireOperator, deleteFloor);

export default router;