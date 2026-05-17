/**
 * sections.routes.ts — REST routes for the Section resource.
 * Mounted at /api/sections. Supports ?workarea_id= query filter on GET /.
 *
 * @openapi
 * tags:
 *   - name: Sections
 *     description: Sections within a work area
 *
 * /sections:
 *   get:
 *     tags: [Sections]
 *     summary: List sections
 *     parameters:
 *       - in: query
 *         name: workarea_id
 *         schema: { type: string }
 *         description: Filter by work area
 *     responses:
 *       200:
 *         description: Array of sections
 *   post:
 *     tags: [Sections]
 *     summary: Create a section
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [workarea_id, name]
 *             properties:
 *               workarea_id: { type: string }
 *               name: { type: string }
 *               description: { type: string }
 *     responses:
 *       201:
 *         description: Created section
 *
 * /sections/{id}:
 *   get:
 *     tags: [Sections]
 *     summary: Get a section by ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Section
 *       404:
 *         description: Not found
 *   patch:
 *     tags: [Sections]
 *     summary: Update a section
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
 *         description: Updated section
 *   delete:
 *     tags: [Sections]
 *     summary: Delete a section
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
import { getAllSections, getSectionById, createSection, updateSection, deleteSection } from '../controllers/section.controller';

const router = Router();

router.get('/', getAllSections);
router.get('/:id', getSectionById);
router.post('/', createSection);
router.patch('/:id', updateSection);
router.delete('/:id', deleteSection);

export default router;