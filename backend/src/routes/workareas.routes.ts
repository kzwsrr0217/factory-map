/**
 * workareas.routes.ts — REST routes for the WorkArea resource.
 * Mounted at /api/workareas. Supports ?floor_id= query filter on GET /.
 *
 * @openapi
 * tags:
 *   - name: WorkAreas
 *     description: Work area zones within a floor
 *
 * /workareas:
 *   get:
 *     tags: [WorkAreas]
 *     summary: List work areas
 *     parameters:
 *       - in: query
 *         name: floor_id
 *         schema: { type: string }
 *         description: Filter by floor
 *     responses:
 *       200:
 *         description: Array of work areas
 *   post:
 *     tags: [WorkAreas]
 *     summary: Create a work area
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [floor_id, name]
 *             properties:
 *               floor_id: { type: string }
 *               name: { type: string }
 *               type: { type: string }
 *               coordinates: { type: object, properties: { x: { type: number }, y: { type: number } } }
 *               dimensions: { type: object, properties: { width: { type: number }, height: { type: number } } }
 *     responses:
 *       201:
 *         description: Created work area
 *
 * /workareas/{id}:
 *   get:
 *     tags: [WorkAreas]
 *     summary: Get a work area by ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Work area
 *       404:
 *         description: Not found
 *   patch:
 *     tags: [WorkAreas]
 *     summary: Update a work area
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
 *               coordinates: { type: object }
 *               dimensions: { type: object }
 *     responses:
 *       200:
 *         description: Updated work area
 *   delete:
 *     tags: [WorkAreas]
 *     summary: Delete a work area
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Deleted
 *
 * /workareas/{id}/auto-place:
 *   post:
 *     tags: [WorkAreas]
 *     summary: Arrange this work area's unplaced assets on a grid inside it
 *     description: |
 *       The inventory survey assigns a work area but no coordinates, so imported
 *       assets sit in the map's unplaced tray. Since the exact spot inside a room
 *       carries no information, arranging them on a grid is the answer rather than
 *       a compromise — and anything needing an exact spot can still be dragged.
 *
 *       Only touches assets already assigned to this work area that are not
 *       placed, not rack-mounted and not superseded. Nothing already on the map
 *       moves, and cells occupied by placed assets are skipped.
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: |
 *           `{ placed: [{_id, display_name, x, y}], skipped: [{_id, display_name, reason}],
 *           crowded: boolean }` — `crowded` warns that the cells are small enough
 *           that icons will overlap.
 *       404:
 *         description: No such work area
 */
import { Router } from 'express';
import {
  getAllWorkAreas,
  getWorkAreaById,
  createWorkArea,
  updateWorkArea,
  autoPlaceWorkAreaAssets,
  deleteWorkArea,
} from '../controllers/workarea.controller';
import { requireOperator } from '../middleware/auth.middleware';

const router = Router();

router.get('/', getAllWorkAreas);
router.get('/:id', getWorkAreaById);
router.post('/', requireOperator, createWorkArea);
router.patch('/:id', requireOperator, updateWorkArea);
router.post('/:id/auto-place', requireOperator, autoPlaceWorkAreaAssets);
router.delete('/:id', requireOperator, deleteWorkArea);

export default router;