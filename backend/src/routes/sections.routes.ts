/**
 * sections.routes.ts — REST routes for the Section resource.
 * Mounted at /api/sections. Supports ?workarea_id= query filter on GET /.
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