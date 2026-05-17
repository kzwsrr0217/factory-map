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
 */
import { Router } from 'express';
import {
  getAllWorkAreas,
  getWorkAreaById,
  createWorkArea,
  updateWorkArea,
  deleteWorkArea,
} from '../controllers/workarea.controller';

const router = Router();

router.get('/', getAllWorkAreas);
router.get('/:id', getWorkAreaById);
router.post('/', createWorkArea);
router.patch('/:id', updateWorkArea);
router.delete('/:id', deleteWorkArea);

export default router;