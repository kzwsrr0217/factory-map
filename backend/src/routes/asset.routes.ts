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
 *   GET    /stats                         — headline counts over the WHOLE table
 *                                           (the list endpoint caps at 1000, so
 *                                           the UI must not derive totals from it).
 *   GET    /lookups                       — autocomplete values (departments,
 *                                           VLANs, persons, etc.).
 *   GET    /:id                           — single asset with all relations.
 *   POST   /                              — create one asset.
 *   POST   /bulk                          — bulk-create from CSV/JSON import.
 *   PATCH  /bulk                          — apply the same few changes to many
 *                                           assets (room / person / status /
 *                                           clear placement) in one request.
 *   PATCH  /:id                           — partial update.
 *   DELETE /:id                           — delete asset.
 *   POST   /:id/sync                      — pull latest data from ITSM.
 *   POST   /:id/connections               — add a connection to another asset.
 *   PATCH  /:id/connections/:connectionId — update a connection.
 *   DELETE /:id/connections/:connectionId — remove a connection.
 *                                           Keyed on the connection row's own
 *                                           id, not the connected asset's: a
 *                                           pair can have several cables.
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
 *         name: rack_id
 *         schema: { type: string }
 *         description: Assets mounted in this rack
 *       - in: query
 *         name: ids
 *         schema: { type: string }
 *         description: >
 *           Comma-separated asset ids to resolve, max 500 (400 above that, never a
 *           silent short answer). For naming the far end of a connection without
 *           fetching the whole list. An empty value returns nothing, not everything.
 *       - in: query
 *         name: connected_to
 *         schema: { type: string }
 *         description: >
 *           Assets whose connections point at this asset id. Only one-way links show
 *           up here — bidirectional ones are already mirrored onto both assets.
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
 *               wall_port_id:
 *                 type: string
 *                 nullable: true
 *                 description: FK to wall_ports — physical network drop this asset plugs into
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
 *             description: Nested asset body (same shape as POST). Set wall_port_id to assign/clear the physical port.
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
  getAssetOtChildren,
  createAsset,
  bulkCreateAssets,
  getAssetStats,
  getAssetPersons,
  bulkUpdateAssets,
  updateAsset,
  deleteAsset,
  syncAssetFromITSM,
  addConnection,
  updateConnection,
  removeConnection,
  replaceAsset,
} from '../controllers/asset.controller';
import { auditLog, captureAuditBefore } from '../middleware/audit.middleware';
import { requireOperator } from '../middleware/auth.middleware';
import { Asset } from '../entities/Asset.entity';
import { notifyTask } from '../controllers/alert.controller';
import { validate, AssetCreateSchema, AssetUpdateSchema, BulkAssetSchema } from '../utils/validate';

const router = Router();

// Read — any authenticated role
router.get('/',                    getAllAssets);
router.get('/lookups',             getAssetLookups);
// Before '/:id' so the literal path wins over the parameter.
router.get('/stats',               getAssetStats);
router.get('/persons',             getAssetPersons);
router.get('/maintenance-counts',  getMaintenanceCounts);
router.get('/:id',                 getAssetById);
router.get('/:id/ot-children',     getAssetOtChildren);

// Write — operator or admin only
router.post('/',    requireOperator, validate(AssetCreateSchema), auditLog('asset'), createAsset);
router.post('/bulk', requireOperator, validate(BulkAssetSchema), auditLog('asset'), bulkCreateAssets);
// No auditLog() middleware: it infers the action from req.method and expects one
// flat asset in the response, so it would misfile this. The handler writes one
// entry per asset itself.
router.patch('/bulk', requireOperator, bulkUpdateAssets);
router.patch('/:id',
  requireOperator,
  validate(AssetUpdateSchema),
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

router.post('/:id/connections',               requireOperator, addConnection);
router.patch('/:id/connections/:connectionId', requireOperator, updateConnection);
router.delete('/:id/connections/:connectionId', requireOperator, removeConnection);

// Replace a broken/retired asset with another, transferring its map position,
// hierarchy, wall-port assignment, and connections — see replaceAsset.
router.post('/:id/replace', requireOperator, replaceAsset);

// Work-item immediate notification — any authenticated operator/admin
router.post('/:assetId/work-items/:itemId/notify', requireOperator, notifyTask);

export default router;
