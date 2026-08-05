/**
 * normalisationTasks.routes.ts — The derived task list. Mounted at /api/tasks.
 *
 * Reading is open to any authenticated user: the list is the shared picture of what is
 * left before the inventory, the app and ITSM agree, and hiding it from the people doing
 * the walking would defeat that.
 *
 * Changing a task, and re-running the generator, need `operator` — both amount to
 * saying something about the state of the estate.
 *
 * @openapi
 * tags:
 *   - name: Tasks
 *     description: Normalisation tasks derived from the inventory, ITSM and the app
 *
 * /tasks:
 *   get:
 *     tags: [Tasks]
 *     summary: List tasks (open by default)
 *     parameters:
 *       - in: query
 *         name: state
 *         schema: { type: string, enum: [open, done, dismissed] }
 *         description: Defaults to `open` — the list is a worklist
 *       - in: query
 *         name: kind
 *         schema: { type: string }
 *       - in: query
 *         name: assigned_to
 *         schema: { type: string }
 *         description: A username, or `__unassigned__` for the ones nobody has taken
 *       - in: query
 *         name: q
 *         schema: { type: string }
 *         description: Substring of the summary or the ITSM id
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 50 }
 *     responses:
 *       200:
 *         description: >
 *           Paginated tasks. Each carries `machine_verifiable`, so the UI can say who is
 *           allowed to close it without restating the rule.
 *
 * /tasks/summary:
 *   get:
 *     tags: [Tasks]
 *     summary: Counts by kind and state
 *     responses:
 *       200:
 *         description: >
 *           `by_kind`, `by_state`, `open_unassigned`, and `consistent` — true when
 *           nothing is outstanding, which is the definition of done for the inventory.
 *
 * /tasks/worksheet:
 *   get:
 *     tags: [Tasks]
 *     summary: The whole filtered list, with each task's device and place
 *     description: >
 *       Unpaged, for the printable walking sheet and the CSV — a worksheet that stops at
 *       page one is how a floor gets skipped. Sorted in walking order (building, floor,
 *       zone, room). Capped at 5000 rows; `meta.truncated` says when the cap bit, and
 *       `meta.without_place` counts the tasks whose device has no room to walk to.
 *     parameters:
 *       - in: query
 *         name: state
 *         schema: { type: string, enum: [open, done, dismissed] }
 *       - in: query
 *         name: kind
 *         schema: { type: string }
 *       - in: query
 *         name: assigned_to
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Rows plus `meta.total`, `meta.truncated`, `meta.generated_at`
 *       400:
 *         description: Unknown state
 *
 * /tasks/{id}:
 *   patch:
 *     tags: [Tasks]
 *     summary: Take a task, note something, close it or dismiss it
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               state: { type: string, enum: [open, done, dismissed] }
 *               assigned_to: { type: string, nullable: true }
 *               note: { type: string, nullable: true }
 *     responses:
 *       200:
 *         description: >
 *           The updated task. `meta.note` warns when a tick will be undone by the next
 *           generation because the data still derives the task.
 *       400:
 *         description: Unknown state, or a dismissal with no reason
 *       404:
 *         description: Not found
 *
 * /tasks/generate:
 *   post:
 *     tags: [Tasks]
 *     summary: Re-derive the list from the current data
 *     description: >
 *       Run after every ITSM export import. Idempotent: it upserts, closes what the data
 *       now shows done, and reopens anything whose cause has returned.
 *     responses:
 *       200:
 *         description: Counts of created, reopened, unchanged, closed and awaiting-human
 */
import { Router } from 'express';
import {
  listTasks,
  taskWorksheet,
  taskSummary,
  updateTask,
  runTaskGeneration,
} from '../controllers/normalisationTask.controller';
import { requireOperator } from '../middleware/auth.middleware';
import { auditLog, captureAuditBefore } from '../middleware/audit.middleware';
import { NormalisationTask } from '../entities/NormalisationTask.entity';

const router = Router();

// Before '/:id' so the literal path wins over the parameter.
router.get('/summary', taskSummary);
router.get('/worksheet', taskWorksheet);
router.get('/', listTasks);
router.patch('/:id', requireOperator, captureAuditBefore(NormalisationTask), auditLog('normalisation_task'), updateTask);
router.post('/generate', requireOperator, runTaskGeneration);

export default router;
