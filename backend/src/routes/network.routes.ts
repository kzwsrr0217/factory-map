/**
 * network.routes.ts — Physical network infrastructure routes.
 * Mounted at /api/network.
 *
 * @openapi
 * tags:
 *   - name: Network
 *     description: Physical network infrastructure (rooms, racks, patch panels, wall ports)
 *
 * /network/rooms:
 *   get:
 *     tags: [Network]
 *     summary: List network rooms (IDF / MDF)
 *     parameters:
 *       - in: query
 *         name: building_id
 *         schema: { type: string }
 *       - in: query
 *         name: floor_id
 *         schema: { type: string }
 *       - in: query
 *         name: type
 *         schema: { type: string, enum: [idf, mdf] }
 *     responses:
 *       200:
 *         description: Array of network rooms with nested racks and patch panels
 *   post:
 *     tags: [Network]
 *     summary: Create a network room
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, building_id]
 *             properties:
 *               name: { type: string }
 *               type: { type: string, enum: [idf, mdf], default: idf }
 *               building_id: { type: string }
 *               floor_id: { type: string }
 *               description: { type: string }
 *               redundant_pair_id: { type: string }
 *     responses:
 *       201:
 *         description: Created room
 *
 * /network/rooms/{id}:
 *   get:
 *     tags: [Network]
 *     summary: Get a network room with its racks
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Network room
 *   patch:
 *     tags: [Network]
 *     summary: Update a network room
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
 *     responses:
 *       200:
 *         description: Updated room
 *   delete:
 *     tags: [Network]
 *     summary: Delete a network room (cascades to racks and patch panels)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Deleted
 *
 * /network/racks:
 *   get:
 *     tags: [Network]
 *     summary: List racks
 *     parameters:
 *       - in: query
 *         name: network_room_id
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Array of racks
 *   post:
 *     tags: [Network]
 *     summary: Create a rack
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, network_room_id]
 *             properties:
 *               name: { type: string }
 *               network_room_id: { type: string }
 *               u_count: { type: integer, default: 42 }
 *               description: { type: string }
 *     responses:
 *       201:
 *         description: Created rack
 *
 * /network/racks/{id}:
 *   get:
 *     tags: [Network]
 *     summary: Get a rack
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Rack
 *   patch:
 *     tags: [Network]
 *     summary: Update a rack
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
 *     responses:
 *       200:
 *         description: Updated rack
 *   delete:
 *     tags: [Network]
 *     summary: Delete a rack
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Deleted
 *
 * /network/patch-panels:
 *   get:
 *     tags: [Network]
 *     summary: List patch panels
 *     parameters:
 *       - in: query
 *         name: rack_id
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Array of patch panels
 *   post:
 *     tags: [Network]
 *     summary: Create a patch panel
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [name, rack_id]
 *             properties:
 *               name: { type: string }
 *               rack_id: { type: string }
 *               u_position: { type: integer }
 *               port_count: { type: integer, default: 24 }
 *               cable_type: { type: string, enum: [copper, fiber, mixed], default: copper }
 *               description: { type: string }
 *     responses:
 *       201:
 *         description: Created patch panel
 *
 * /network/patch-panels/{id}:
 *   get:
 *     tags: [Network]
 *     summary: Get a patch panel
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Patch panel
 *   patch:
 *     tags: [Network]
 *     summary: Update a patch panel
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
 *     responses:
 *       200:
 *         description: Updated
 *   delete:
 *     tags: [Network]
 *     summary: Delete a patch panel
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Deleted
 *
 * /network/wall-ports:
 *   get:
 *     tags: [Network]
 *     summary: List wall ports (face plates) on a floor
 *     parameters:
 *       - in: query
 *         name: floor_id
 *         schema: { type: string }
 *         description: Filter by floor (returns all if omitted)
 *       - in: query
 *         name: patch_panel_id
 *         schema: { type: string }
 *       - in: query
 *         name: workarea_id
 *         schema: { type: string }
 *         description: Filter to the sockets in one room
 *     responses:
 *       200:
 *         description: |
 *           Wall ports with resolved patch panel / rack / room names, plus
 *           `patch_status` (unpatched | patched | live) and `occupied_by` — two
 *           independent axes, both needed before assigning a device to a socket.
 *   post:
 *     tags: [Network]
 *     summary: Create a wall port
 *     description: |
 *       The patch panel and switch sides are optional: "this socket exists but is
 *       not patched yet" is a normal state. Labels ("R1/001") must be unique
 *       within the building.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [label, floor_id]
 *             properties:
 *               label: { type: string, example: R1/001 }
 *               floor_id: { type: string }
 *               workarea_id: { type: string, nullable: true, description: The room the socket is in }
 *               patch_panel_id: { type: string }
 *               patch_port: { type: integer }
 *               switch_asset_id: { type: string }
 *               switch_port: { type: string, example: "Gi1/0/12" }
 *               description: { type: string }
 *     responses:
 *       201:
 *         description: Created wall port
 *       409:
 *         description: Label already used in this building, or the panel/switch port is taken
 *
 * /network/wall-ports/range:
 *   post:
 *     tags: [Network]
 *     summary: Create a contiguous range of wall ports from their label pattern
 *     description: |
 *       A rack's sockets are a range (`R1/001`…`R1/048`), so they are generated
 *       rather than typed one at a time. Labels that already exist in the
 *       building are skipped and returned in `skipped`, not treated as an error —
 *       re-running a range after adding a few by hand is normal.
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [floor_id, prefix, from, to]
 *             properties:
 *               floor_id: { type: string }
 *               workarea_id: { type: string, nullable: true }
 *               prefix: { type: string, example: "R1/" }
 *               from: { type: integer, example: 1 }
 *               to: { type: integer, example: 48 }
 *               pad: { type: integer, default: 3, description: Digits to zero-pad the number to }
 *               description: { type: string, nullable: true }
 *     responses:
 *       201:
 *         description: "{ created: WallPort[], skipped: string[] }"
 *       400:
 *         description: Bad range, or more than 512 sockets in one request
 *
 * /network/wall-ports/{id}:
 *   get:
 *     tags: [Network]
 *     summary: Get a wall port
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Wall port with full path info
 *   patch:
 *     tags: [Network]
 *     summary: Update a wall port (reposition or re-cable)
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
 *     responses:
 *       200:
 *         description: Updated wall port
 *   delete:
 *     tags: [Network]
 *     summary: Delete a wall port
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Deleted
 */
import { Router } from 'express';
import {
  listRooms, getRoom, createRoom, updateRoom, deleteRoom,
  listRacks, getRack, createRack, updateRack, deleteRack, replaceRack,
  listPatchPanels, getPatchPanel, createPatchPanel, updatePatchPanel, deletePatchPanel, replacePatchPanel,
  listWallPorts, getWallPort, createWallPort, createWallPortRange, updateWallPort, deleteWallPort,
} from '../controllers/network.controller';
import { validate, RoomCreateSchema, RoomUpdateSchema, RackCreateSchema, RackUpdateSchema } from '../utils/validate';
import { requireOperator } from '../middleware/auth.middleware';

const router = Router();

router.get('/rooms',              listRooms);
router.get('/rooms/:id',          getRoom);
router.post('/rooms',             requireOperator, validate(RoomCreateSchema), createRoom);
router.patch('/rooms/:id',        requireOperator, validate(RoomUpdateSchema), updateRoom);
router.delete('/rooms/:id',       requireOperator, deleteRoom);

router.get('/racks',              listRacks);
router.get('/racks/:id',          getRack);
router.post('/racks',             requireOperator, validate(RackCreateSchema), createRack);
router.patch('/racks/:id',        requireOperator, validate(RackUpdateSchema.partial()), updateRack);
router.delete('/racks/:id',       requireOperator, deleteRack);
router.post('/racks/:id/replace', requireOperator, replaceRack);

router.get('/patch-panels',       listPatchPanels);
router.get('/patch-panels/:id',   getPatchPanel);
router.post('/patch-panels',      requireOperator, createPatchPanel);
router.patch('/patch-panels/:id', requireOperator, updatePatchPanel);
router.delete('/patch-panels/:id',requireOperator, deletePatchPanel);
router.post('/patch-panels/:id/replace', requireOperator, replacePatchPanel);

router.get('/wall-ports',         listWallPorts);
// Before '/wall-ports/:id' would ever be consulted for a POST — kept adjacent to
// the plain create so the pair is obvious.
router.post('/wall-ports/range',  requireOperator, createWallPortRange);
router.get('/wall-ports/:id',     getWallPort);
router.post('/wall-ports',        requireOperator, createWallPort);
router.patch('/wall-ports/:id',   requireOperator, updateWallPort);
router.delete('/wall-ports/:id',  requireOperator, deleteWallPort);

export default router;
