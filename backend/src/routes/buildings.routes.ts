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