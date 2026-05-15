/**
 * asset.routes.ts — REST routes for the Asset resource.
 * Mounted at /api/assets. All routes require authentication (applied in index.ts).
 *
 * Audit middleware:
 *   POST /        — `auditLog('asset')` records the new asset after creation.
 *   POST /bulk    — `auditLog('asset')` records each created asset.
 *   PATCH /:id    — `captureAuditBefore(Asset)` snapshots the before-state;
 *                   `auditLog('asset')` records the diff after update.
 *   DELETE /:id   — same before/after pair for the delete action.
 *
 * Routes:
 *   GET    /                              — list all assets (with filters).
 *   GET    /lookups                       — autocomplete values (departments,
 *                                           VLANs, persons, etc.).
 *   GET    /:id                           — single asset with all relations.
 *   POST   /                              — create one asset.
 *   POST   /bulk                          — bulk-create from CSV/JSON import.
 *   PATCH  /:id                           — partial update.
 *   DELETE /:id                           — delete asset.
 *   POST   /:id/sync                      — pull latest data from ITSM.
 *   POST   /:id/connections               — add a connection to another asset.
 *   PATCH  /:id/connections/:connected    — update a connection.
 *   DELETE /:id/connections/:connected    — remove a connection.
 *
 * @openapi
 * tags:
 *   - name: Assets
 *     description: IT asset management
 *
 * /assets:
 *   get:
 *     tags: [Assets]
 *     summary: List all assets
 *     parameters:
 *       - in: query
 *         name: building_id
 *         schema: { type: string }
 *       - in: query
 *         name: floor_id
 *         schema: { type: string }
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [active, maintenance, inactive, retired] }
 *       - in: query
 *         name: type
 *         schema: { type: string }
 *       - in: query
 *         name: search
 *         schema: { type: string }
 *         description: Search across name, serial, IP, hostname, manufacturer
 *       - in: query
 *         name: page
 *         schema: { type: integer, default: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, default: 50 }
 *     responses:
 *       200:
 *         description: Paginated asset list
 *   post:
 *     tags: [Assets]
 *     summary: Create an asset
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [basic_info]
 *             properties:
 *               basic_info:
 *                 type: object
 *                 required: [display_name]
 *                 properties:
 *                   display_name: { type: string, example: "CUMMINS-IPC-001" }
 *                   asset_type: { type: string }
 *                   status: { type: string, enum: [active, maintenance, inactive, retired] }
 *               location:
 *                 type: object
 *                 properties:
 *                   building_id: { type: string }
 *                   floor_id: { type: string }
 *     responses:
 *       201:
 *         description: Created asset
 *
 * /assets/lookups:
 *   get:
 *     tags: [Assets]
 *     summary: Get autocomplete lookup values
 *     responses:
 *       200:
 *         description: Lookup arrays for manufacturers, VLANs, persons, etc.
 *
 * /assets/{id}:
 *   get:
 *     tags: [Assets]
 *     summary: Get asset by ID (with connections, software, audit history)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Full asset details
 *       404:
 *         description: Not found
 *   patch:
 *     tags: [Assets]
 *     summary: Update asset fields
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
 *             description: Nested asset body (same shape as POST)
 *     responses:
 *       200:
 *         description: Updated asset
 *   delete:
 *     tags: [Assets]
 *     summary: Delete an asset
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Deleted
 *
 * /assets/bulk:
 *   post:
 *     tags: [Assets]
 *     summary: Bulk-create assets from CSV/JSON import
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               assets:
 *                 type: array
 *                 items:
 *                   type: object
 *     responses:
 *       201:
 *         description: Import results
 *
 * /assets/{id}/connections:
 *   post:
 *     tags: [Assets]
 *     summary: Add a connection between two assets
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
 *             required: [connected_asset_id, connection_type]
 *             properties:
 *               connected_asset_id: { type: string }
 *               connection_type: { type: string, enum: [ethernet, wifi, usb, fiber, serial, other] }
 *               label: { type: string }
 *               bidirectional: { type: boolean, default: true }
 *               patch_panel: { type: object }
 *     responses:
 *       201:
 *         description: Connection created
 */
import { Router } from 'express';
import {
  getAllAssets,
  getAssetById,
  getAssetLookups,
  getMaintenanceCounts,
  createAsset,
  bulkCreateAssets,
  updateAsset,
  deleteAsset,
  syncAssetFromITSM,
  addConnection,
  updateConnection,
  removeConnection,
} from '../controllers/asset.controller';
import { auditLog, captureAuditBefore } from '../middleware/audit.middleware';
import { requireOperator } from '../middleware/auth.middleware';
import { Asset } from '../entities/Asset.entity';
import { notifyTask } from '../controllers/alert.controller';

const router = Router();

// Read — any authenticated role
router.get('/',                    getAllAssets);
router.get('/lookups',             getAssetLookups);
router.get('/maintenance-counts',  getMaintenanceCounts);
router.get('/:id',                 getAssetById);

// Write — operator or admin only
router.post('/',    requireOperator, auditLog('asset'), createAsset);
router.post('/bulk', requireOperator, auditLog('asset'), bulkCreateAssets);
router.patch('/:id',
  requireOperator,
  captureAuditBefore(Asset),
  auditLog('asset'),
  updateAsset,
);
router.delete('/:id',
  requireOperator,
  captureAuditBefore(Asset),
  auditLog('asset'),
  deleteAsset,
);
router.post('/:id/sync', requireOperator, syncAssetFromITSM);

router.post('/:id/connections',                    requireOperator, addConnection);
router.patch('/:id/connections/:connectedAssetId', requireOperator, updateConnection);
router.delete('/:id/connections/:connectedAssetId', requireOperator, removeConnection);

// Work-item immediate notification — any authenticated operator/admin
router.post('/:assetId/work-items/:itemId/notify', requireOperator, notifyTask);

export default router;
