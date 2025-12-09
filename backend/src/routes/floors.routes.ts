import { Router } from 'express';
import {
  getAllFloors,
  getFloorById,
  createFloor,
  updateFloor,
  deleteFloor,
} from '../controllers/floor.controller';

const router = Router();

router.get('/', getAllFloors);
router.get('/:id', getFloorById);
router.post('/', createFloor);
router.patch('/:id', updateFloor);
router.delete('/:id', deleteFloor);

export default router;