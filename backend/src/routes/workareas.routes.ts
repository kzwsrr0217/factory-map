/**
 * workareas.routes.ts — REST routes for the WorkArea resource.
 * Mounted at /api/workareas. Supports ?floor_id= query filter on GET /.
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