/**
 * inventory.routes.ts — The physical inventory, handed to the app. Mounted at /api/inventory.
 *
 * Reading the corrections is open to any authenticated user: they explain why the app
 * reads a survey the way it does, and that explanation should not be privileged.
 *
 * Importing a survey and editing a correction both need `operator`. An import re-places
 * devices and creates assets; a correction changes how every future import is read.
 *
 * @openapi
 * tags:
 *   - name: Inventory
 *     description: Importing the physical survey, and the name corrections it needs
 *
 * /inventory/survey/import:
 *   post:
 *     tags: [Inventory]
 *     summary: Preview or apply a physical inventory survey
 *     description: >
 *       The survey file is parsed in the browser; only its rows are sent. With
 *       `apply: false` (the default) nothing is written and the response is the plan —
 *       what would be updated, what would be created, and every name that did not
 *       resolve, each with a suggestion where one is close enough to be worth proposing.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [rows]
 *             properties:
 *               rows:
 *                 type: array
 *                 description: The survey tool's own `eszkozok` entries
 *                 items: { type: object }
 *               corrections:
 *                 type: object
 *                 description: >
 *                   Not-yet-saved fixes, layered over the stored ones for this run only —
 *                   how the preview shows the effect of a fix before it is kept.
 *               create_missing_workareas:
 *                 type: boolean
 *                 description: >
 *                   Create the rooms the survey names and the map lacks, as default-size
 *                   rectangles below what is already drawn. Only acts with `apply`.
 *               apply:
 *                 type: boolean
 *                 default: false
 *     responses:
 *       200:
 *         description: The plan, applied or not
 *       400:
 *         description: No "rows" array, or an empty survey
 *
 * /inventory/corrections:
 *   get:
 *     tags: [Inventory]
 *     summary: Every stored "the survey says X, we mean Y"
 *     responses:
 *       200:
 *         description: Corrections, by scope then name
 *   put:
 *     tags: [Inventory]
 *     summary: Store or replace one correction
 *     description: >
 *       Upsert on (scope, folded from-name). Two rules for one name would make an import
 *       depend on row order, so a repeat replaces rather than adds.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [scope, from_value, to_value]
 *             properties:
 *               scope: { type: string, enum: [building, floor, helyszin, work_area, persons] }
 *               from_value: { type: string, description: As the survey spells it }
 *               to_value: { type: string, description: As the app spells it }
 *               note: { type: string, nullable: true }
 *     responses:
 *       200: { description: Replaced an existing correction }
 *       201: { description: Stored a new one }
 *       400: { description: Unknown scope, a missing side, or a pair that already matches }
 *
 * /inventory/corrections/{id}:
 *   delete:
 *     tags: [Inventory]
 *     summary: Remove a correction
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200: { description: Removed }
 *       400: { description: Not a correction id }
 *       404: { description: Not found }
 */
import { Router } from 'express';
import {
  importSurvey,
  listCorrections,
  upsertCorrection,
  deleteCorrection,
} from '../controllers/inventory.controller';
import { requireOperator } from '../middleware/auth.middleware';

const router = Router();

router.post('/survey/import', requireOperator, importSurvey);
router.get('/corrections', listCorrections);
router.put('/corrections', requireOperator, upsertCorrection);
router.delete('/corrections/:id', requireOperator, deleteCorrection);

export default router;
