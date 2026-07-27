/**
 * itsm.routes.ts — ITSM integration routes.
 * Mounted at /api/itsm. All routes require authentication (enforced in index.ts).
 *
 * Routes:
 *   GET  /hardware/search?q=   — search ITSM hardware by name/serial/tag
 *   GET  /hardware/:id         — fetch a specific ITSM hardware record
 *   POST /sync/all             — full sync of all ITSM hardware into the DB
 *   POST /sync/:hardwareId     — sync a single ITSM hardware record
 *   PATCH /assets/:id/accept-snapshot — promote pending snapshot → live asset data
 *
 * @openapi
 * tags:
 *   - name: ITSM
 *     description: ITSM integration and hardware sync
 *
 * /itsm/hardware/search:
 *   get:
 *     tags: [ITSM]
 *     summary: Search ITSM hardware records
 *     parameters:
 *       - in: query
 *         name: q
 *         required: true
 *         schema: { type: string }
 *         description: Search query (name, serial number, or asset tag)
 *     responses:
 *       200:
 *         description: Matching hardware records
 *
 * /itsm/hardware/{hardwareId}:
 *   get:
 *     tags: [ITSM]
 *     summary: Get a single ITSM hardware record
 *     parameters:
 *       - in: path
 *         name: hardwareId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Hardware record
 *       404:
 *         description: Not found in ITSM
 *
 * /itsm/sync/all:
 *   post:
 *     tags: [ITSM]
 *     summary: Sync all ITSM hardware into the database
 *     responses:
 *       200:
 *         description: Sync report (created, updated, snapshotted, skipped, errors)
 *
 * /itsm/sync/{hardwareId}:
 *   post:
 *     tags: [ITSM]
 *     summary: Sync a single ITSM hardware record
 *     parameters:
 *       - in: path
 *         name: hardwareId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Sync result for this record
 *
 * /itsm/reconcile/unlinked-mmh:
 *   get:
 *     tags: [ITSM]
 *     summary: MMH-scoped ITSM hardware not linked to any local asset (reverse reconcile direction)
 *     responses:
 *       200:
 *         description: List of unlinked ITSM hardware records from the imported MMH snapshot
 *
 * /itsm/reconcile/unlinked-mmh/create:
 *   post:
 *     tags: [ITSM]
 *     summary: Create unplaced local assets from selected MMH snapshot rows
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               itsm_guids: { type: array, items: { type: string } }
 *     responses:
 *       200:
 *         description: Created and skipped results
 *
 * /itsm/assets/{id}/accept-snapshot:
 *   patch:
 *     tags: [ITSM]
 *     summary: Accept ITSM snapshot — apply pending ITSM data to local asset
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Snapshot applied
 */
import { Router } from 'express';
import {
  searchHardware,
  getHardware,
  syncAsset,
  syncAll,
  acceptSnapshot,
  reconcileLinked,
  reconcileSummary,
  reconcileCheckAsset,
  acceptReconcileFields,
  ignoreReconcileDiff,
  unignoreReconcileDiff,
  unlinkReconcileAsset,
  unlinkedMmh,
  createUnlinkedMmhAssets,
} from '../controllers/itsm.controller';
import { requireOperator } from '../middleware/auth.middleware';
import { auditLog, captureAuditBefore } from '../middleware/audit.middleware';
import { Asset } from '../entities/Asset.entity';

const router = Router();

router.get('/hardware/search', searchHardware);
router.get('/hardware/:hardwareId', getHardware);
router.post('/sync/all', requireOperator, syncAll);
router.post('/sync/:hardwareId', requireOperator, syncAsset);
router.patch('/assets/:id/accept-snapshot', requireOperator, acceptSnapshot);

// ── READ-ONLY reconciliation (ITSM is the single source of truth) ───────────
// List + summary are built from the LOCAL DB only — they never call ITSM.
router.get('/reconcile/linked', reconcileLinked);
router.get('/reconcile/summary', reconcileSummary);

// MMH-scoped ITSM hardware not linked to any local asset (the reverse
// direction) — built from the imported snapshot table + local DB only.
router.get('/reconcile/unlinked-mmh', unlinkedMmh);

// Materialise selected snapshot rows into real, unplaced local assets. Local
// DB write only — never calls ITSM. Body: { itsm_guids: string[] }.
// Audited manually inside the controller (one row per created asset) rather
// than via auditLog('asset') — that middleware expects a single created
// entity or an array of them, not this endpoint's {created, skipped} shape.
router.post('/reconcile/unlinked-mmh/create', requireOperator, createUnlinkedMmhAssets);

// Per-asset check: the ONLY endpoint that reads ITSM, and only for one asset,
// on explicit user action. Nothing is ever written back to ITSM.
router.post('/reconcile/:id/check', requireOperator, reconcileCheckAsset);

// Local writes (audited). None of these touch ITSM.
router.patch('/reconcile/:id/accept', requireOperator, captureAuditBefore(Asset), auditLog('asset'), acceptReconcileFields);
router.patch('/reconcile/:id/ignore', requireOperator, captureAuditBefore(Asset), auditLog('asset'), ignoreReconcileDiff);
router.patch('/reconcile/:id/unignore/:field', requireOperator, unignoreReconcileDiff);
router.patch('/reconcile/:id/unlink', requireOperator, captureAuditBefore(Asset), auditLog('asset'), unlinkReconcileAsset);

export default router;