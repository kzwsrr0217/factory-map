/**
 * workstations.routes.ts — REST routes for the Workstation resource.
 * Mounted at /api/workstations. Supports ?section_id= query filter on GET /.
 *
 * @openapi
 * tags:
 *   - name: Workstations
 *     description: Workstations within a section
 *
 * /workstations:
 *   get:
 *     tags: [Workstations]
 *     summary: List workstations
 *     parameters:
 *       - in: query
 *         name: section_id
 *         schema: { type: string }
 *         description: Filter by section
 *     responses:
 *       200:
 *         description: Array of workstations
 *   post:
 *     tags: [Workstations]
 *     summary: Create a workstation
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [section_id, name]
 *             properties:
 *               section_id: { type: string }
 *               name: { type: string }
 *               description: { type: string }
 *     responses:
 *       201:
 *         description: Created workstation
 *
 * /workstations/{id}:
 *   get:
 *     tags: [Workstations]
 *     summary: Get a workstation by ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Workstation
 *       404:
 *         description: Not found
 *   patch:
 *     tags: [Workstations]
 *     summary: Update a workstation
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
 *               description: { type: string }
 *     responses:
 *       200:
 *         description: Updated workstation
 *   delete:
 *     tags: [Workstations]
 *     summary: Delete a workstation
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
import { getAllWorkstations, getWorkstationById, createWorkstation, updateWorkstation, deleteWorkstation } from '../controllers/workstation.controller';

const router = Router();

router.get('/', getAllWorkstations);
router.get('/:id', getWorkstationById);
router.post('/', createWorkstation);
router.patch('/:id', updateWorkstation);
router.delete('/:id', deleteWorkstation);

export default router;