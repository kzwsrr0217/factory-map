/**
 * buildings.routes.ts — REST routes for the Building resource.
 * Mounted at /api/buildings (see routes/index.ts).
 *
 * @openapi
 * tags:
 *   - name: Buildings
 *     description: Building management
 *
 * /buildings:
 *   get:
 *     tags: [Buildings]
 *     summary: List all buildings
 *     responses:
 *       200:
 *         description: Array of buildings
 *   post:
 *     tags: [Buildings]
 *     summary: Create a building
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name]
 *             properties:
 *               name: { type: string, example: "Main Factory" }
 *               address: { type: string }
 *               description: { type: string }
 *     responses:
 *       201:
 *         description: Created building
 *
 * /buildings/{id}:
 *   get:
 *     tags: [Buildings]
 *     summary: Get building by ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Building details with floors
 *       404:
 *         description: Not found
 *   patch:
 *     tags: [Buildings]
 *     summary: Update a building
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
 *               address: { type: string }
 *     responses:
 *       200:
 *         description: Updated building
 *   delete:
 *     tags: [Buildings]
 *     summary: Delete a building
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
  getAllBuildings,
  getBuildingById,
  createBuilding,
  updateBuilding,
  deleteBuilding,
} from '../controllers/building.controller';

const router = Router();

router.get('/', getAllBuildings);
router.get('/:id', getBuildingById);
router.post('/', createBuilding);
router.patch('/:id', updateBuilding);
router.delete('/:id', deleteBuilding);

export default router;