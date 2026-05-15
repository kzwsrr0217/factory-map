/**
 * workstations.routes.ts — REST routes for the Workstation resource.
 * Mounted at /api/workstations. Supports ?section_id= query filter on GET /.
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