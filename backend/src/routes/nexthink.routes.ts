/**
 * nexthink.routes.ts — Mounted at /api/nexthink.
 *
 * Two endpoints, because the Nexthink round is two things: load the export, then read what it says.
 * The findings that are ACTIONS are not here — they become tasks and live under /api/tasks. This is
 * the source's own state and the questions it raises.
 *
 * Reads are open to any authenticated role, matching every other read in this app. The import is
 * `requireOperator` and audited, because it replaces two tables wholesale.
 */
import { Router } from 'express';
import {
  getNexthinkOverviewHandler,
  importNexthinkFromUpload,
} from '../controllers/nexthink.controller';
import { requireOperator } from '../middleware/auth.middleware';

const router = Router();

router.get('/overview', getNexthinkOverviewHandler);
router.post('/import', requireOperator, importNexthinkFromUpload);

export default router;
