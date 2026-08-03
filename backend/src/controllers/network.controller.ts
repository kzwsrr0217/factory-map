/**
 * network.controller.ts — CRUD for the network infrastructure hierarchy
 * (NetworkRoom → NetworkRack → PatchPanel → WallPort).
 *
 * Room→Rack→PatchPanel cascades via real FKs (`onDelete: 'CASCADE'`), and
 * WallPort.patch_panel_id is `onDelete: 'SET NULL'` — those are all safe.
 * `Asset.rack_id`/`u_position` is a soft join (no FK) though, so deleting a
 * rack (or a room, which cascades into its racks) with assets still mounted
 * in it would silently orphan those assets — see deleteRoom/deleteRack,
 * matching the asset-count-guard pattern used for WorkArea/Section/Floor.
 *
 * WallPort patch-panel-port and switch-port assignments are also guarded
 * against collisions (two wall ports can't terminate the same physical
 * port) — see findWallPortCollision, the wall-port analogue of the rack
 * U-position collision check in asset.controller.ts.
 */
import { Request, Response, NextFunction } from 'express';
import { AppDataSource } from '../config/database';
import { NetworkRoom } from '../entities/NetworkRoom.entity';
import { NetworkRack } from '../entities/NetworkRack.entity';
import { PatchPanel } from '../entities/PatchPanel.entity';
import { WallPort } from '../entities/WallPort.entity';
import { WorkArea } from '../entities/WorkArea.entity';
import { Floor } from '../entities/Floor.entity';
import { Asset } from '../entities/Asset.entity';
import { In, IsNull } from 'typeorm';
import { chunkForEntity, findByIn } from '../utils/mssqlBatch';
import { derivePatchForLabel, DerivationFailure, PanelLike } from '../utils/wallPortLabel';

const roomRepo  = () => AppDataSource.getRepository(NetworkRoom);
const rackRepo  = () => AppDataSource.getRepository(NetworkRack);
const ppRepo    = () => AppDataSource.getRepository(PatchPanel);
const wpRepo    = () => AppDataSource.getRepository(WallPort);
const waRepo    = () => AppDataSource.getRepository(WorkArea);
const assetRepo = () => AppDataSource.getRepository(Asset);

const notFound = (res: Response) => { res.status(404).json({ success: false, error: 'Not found' }); };

// asset.rack_id is a soft join (no FK) — deleting a rack (or a room, which
// cascades to its racks via a real FK) would silently leave mounted assets'
// rack_id/u_position pointing at nothing, exactly the bug class already
// fixed for WorkArea/Section/Floor/Building. Guard both levels.
async function assetsInRacks(rackIds: string[]): Promise<number> {
  if (rackIds.length === 0) return 0;
  return assetRepo().createQueryBuilder('a').where('a.rack_id IN (:...rackIds)', { rackIds }).getCount();
}

// ── Network Rooms ─────────────────────────────────────────────────────────────

export const listRooms = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { building_id, floor_id, type } = req.query as Record<string, string | undefined>;
    const qb = roomRepo().createQueryBuilder('r')
      .leftJoinAndSelect('r.racks', 'rack')
      .leftJoinAndSelect('rack.patch_panels', 'pp');
    if (building_id) qb.andWhere('r.building_id = :building_id', { building_id });
    if (floor_id)    qb.andWhere('r.floor_id = :floor_id', { floor_id });
    if (type)        qb.andWhere('r.type = :type', { type });
    const rooms = await qb.getMany();
    res.json({ success: true, data: rooms.map(r => r.toApiResponse()) });
  } catch (e) { next(e); }
};

export const getRoom = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const room = await roomRepo().findOne({ where: { id: req.params.id }, relations: ['racks', 'racks.patch_panels'] });
    if (!room) { notFound(res); return; }
    res.json({ success: true, data: room.toApiResponse() });
  } catch (e) { next(e); }
};

export const createRoom = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { name, type, building_id, floor_id, description, redundant_pair_id } = req.body;
    const room = roomRepo().create({ name, type: type ?? 'idf', building_id, floor_id: floor_id ?? null, description: description ?? null, redundant_pair_id: redundant_pair_id ?? null });
    await roomRepo().save(room);
    res.status(201).json({ success: true, data: room.toApiResponse() });
  } catch (e) { next(e); }
};

export const updateRoom = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const room = await roomRepo().findOneBy({ id: req.params.id });
    if (!room) { notFound(res); return; }
    Object.assign(room, req.body);
    await roomRepo().save(room);
    res.json({ success: true, data: room.toApiResponse() });
  } catch (e) { next(e); }
};

export const deleteRoom = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const room = await roomRepo().findOneBy({ id: req.params.id });
    if (!room) { notFound(res); return; }

    const rackIds = (await rackRepo().find({ where: { network_room_id: room.id }, select: ['id'] })).map((r) => r.id);
    const assetCount = await assetsInRacks(rackIds);
    if (assetCount > 0) {
      res.status(400).json({ success: false, error: `Cannot delete room with ${assetCount} rack-mounted asset(s). Please reassign or remove them first.` });
      return;
    }

    await roomRepo().remove(room);
    res.json({ success: true });
  } catch (e) { next(e); }
};

// ── Network Racks ─────────────────────────────────────────────────────────────

export const listRacks = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { network_room_id } = req.query as Record<string, string | undefined>;
    const where = network_room_id ? { network_room_id } : {};
    const racks = await rackRepo().find({ where, relations: ['patch_panels'] });
    res.json({ success: true, data: racks.map(r => r.toApiResponse()) });
  } catch (e) { next(e); }
};

export const getRack = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const rack = await rackRepo().findOne({ where: { id: req.params.id }, relations: ['patch_panels'] });
    if (!rack) { notFound(res); return; }
    res.json({ success: true, data: rack.toApiResponse() });
  } catch (e) { next(e); }
};

export const createRack = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { name, network_room_id, u_count, description } = req.body;
    const rack = rackRepo().create({ name, network_room_id, u_count: u_count ?? 42, description: description ?? null });
    await rackRepo().save(rack);
    res.status(201).json({ success: true, data: rack.toApiResponse() });
  } catch (e) { next(e); }
};

export const updateRack = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const rack = await rackRepo().findOneBy({ id: req.params.id });
    if (!rack) { notFound(res); return; }
    Object.assign(rack, req.body);
    await rackRepo().save(rack);
    res.json({ success: true, data: rack.toApiResponse() });
  } catch (e) { next(e); }
};

// ── POST /network/racks/:id/replace ───────────────────────────────────────────
// A physical cabinet swap: rather than blocking on deleteRack's asset-count
// guard and forcing manual reassignment of every patch panel and mounted
// asset one at a time, this moves everything in one shot — patch panels
// (rack_id) and mounted assets (rack_id, keeping their u_position/
// rack_u_size) — from the old rack to the replacement, then removes the
// now-empty old rack. Unlike Asset (which has predecessor_id/successor_id
// for audit history), NetworkRack has no asset-identity fields of its own,
// so there is nothing worth keeping the old shell around for.
export const replaceRack = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const oldId = req.params.id;
    const { replacement_id: newId } = req.body as { replacement_id: string };
    if (!newId) { res.status(400).json({ success: false, error: 'replacement_id is required' }); return; }
    if (newId === oldId) { res.status(422).json({ success: false, error: 'A rack cannot replace itself' }); return; }

    const oldRack = await rackRepo().findOneBy({ id: oldId });
    const newRack = await rackRepo().findOneBy({ id: newId });
    if (!oldRack) { res.status(404).json({ success: false, error: 'Rack to replace not found' }); return; }
    if (!newRack) { res.status(404).json({ success: false, error: 'Replacement rack not found' }); return; }

    const movingAssets = await assetRepo().find({ where: { rack_id: oldId } });
    const existingInNew = await assetRepo().find({ where: { rack_id: newId } });
    for (const a of movingAssets) {
      if (a.u_position == null) continue;
      const start = a.u_position, end = a.u_position + (a.rack_u_size || 1) - 1;
      const collide = existingInNew.find((o) => {
        if (o.u_position == null) return false;
        const oStart = o.u_position, oEnd = o.u_position + (o.rack_u_size || 1) - 1;
        return start <= oEnd && oStart <= end;
      });
      if (collide) {
        res.status(409).json({ success: false, error: `Cannot replace rack: "${a.display_name}" at U${a.u_position} would collide with "${collide.display_name}" already mounted in the replacement rack` });
        return;
      }
    }

    await ppRepo().update({ rack_id: oldId }, { rack_id: newId });
    await assetRepo().update({ rack_id: oldId }, { rack_id: newId });
    await rackRepo().remove(oldRack);

    const fullNew = await rackRepo().findOne({ where: { id: newId }, relations: ['patch_panels'] });
    res.json({ success: true, data: fullNew!.toApiResponse(), message: 'Rack replaced successfully' });
  } catch (e) { next(e); }
};

export const deleteRack = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const rack = await rackRepo().findOneBy({ id: req.params.id });
    if (!rack) { notFound(res); return; }

    const assetCount = await assetsInRacks([rack.id]);
    if (assetCount > 0) {
      res.status(400).json({ success: false, error: `Cannot delete rack with ${assetCount} mounted asset(s). Please reassign or remove them first.` });
      return;
    }

    await rackRepo().remove(rack);
    res.json({ success: true });
  } catch (e) { next(e); }
};

// ── Patch Panels ──────────────────────────────────────────────────────────────

export const listPatchPanels = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { rack_id } = req.query as Record<string, string | undefined>;
    const where = rack_id ? { rack_id } : {};
    const panels = await ppRepo().find({ where });
    res.json({ success: true, data: panels.map(p => p.toApiResponse()) });
  } catch (e) { next(e); }
};

export const getPatchPanel = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const panel = await ppRepo().findOneBy({ id: req.params.id });
    if (!panel) { notFound(res); return; }
    res.json({ success: true, data: panel.toApiResponse() });
  } catch (e) { next(e); }
};

export const createPatchPanel = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { name, rack_id, u_position, port_count, cable_type, description } = req.body;
    const panel = ppRepo().create({ name, rack_id, u_position: u_position ?? null, port_count: port_count ?? 24, cable_type: cable_type ?? 'copper', description: description ?? null });
    await ppRepo().save(panel);
    res.status(201).json({ success: true, data: panel.toApiResponse() });
  } catch (e) { next(e); }
};

export const updatePatchPanel = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const panel = await ppRepo().findOneBy({ id: req.params.id });
    if (!panel) { notFound(res); return; }
    Object.assign(panel, req.body);
    await ppRepo().save(panel);
    res.json({ success: true, data: panel.toApiResponse() });
  } catch (e) { next(e); }
};

// ── POST /network/patch-panels/:id/replace ────────────────────────────────────
// A physical patch-panel cassette swap: moves every wall port wired into
// the old panel (patch_panel_id, keeping its patch_port) over to the
// replacement, then removes the now-empty old panel. Mirrors replaceRack.
export const replacePatchPanel = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const oldId = req.params.id;
    const { replacement_id: newId } = req.body as { replacement_id: string };
    if (!newId) { res.status(400).json({ success: false, error: 'replacement_id is required' }); return; }
    if (newId === oldId) { res.status(422).json({ success: false, error: 'A patch panel cannot replace itself' }); return; }

    const oldPanel = await ppRepo().findOneBy({ id: oldId });
    const newPanel = await ppRepo().findOneBy({ id: newId });
    if (!oldPanel) { res.status(404).json({ success: false, error: 'Patch panel to replace not found' }); return; }
    if (!newPanel) { res.status(404).json({ success: false, error: 'Replacement patch panel not found' }); return; }

    const movingPorts = await wpRepo().find({ where: { patch_panel_id: oldId } });
    const existingInNew = await wpRepo().find({ where: { patch_panel_id: newId } });
    for (const p of movingPorts) {
      if (p.patch_port == null) continue;
      const collide = existingInNew.find((o) => o.patch_port === p.patch_port);
      if (collide) {
        res.status(409).json({ success: false, error: `Cannot replace patch panel: port ${p.patch_port} would collide with an existing wall port already assigned to the replacement panel` });
        return;
      }
    }

    await wpRepo().update({ patch_panel_id: oldId }, { patch_panel_id: newId });
    await ppRepo().remove(oldPanel);

    const fullNew = await ppRepo().findOneBy({ id: newId });
    res.json({ success: true, data: fullNew!.toApiResponse(), message: 'Patch panel replaced successfully' });
  } catch (e) { next(e); }
};

export const deletePatchPanel = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const panel = await ppRepo().findOneBy({ id: req.params.id });
    if (!panel) { notFound(res); return; }
    await ppRepo().remove(panel);
    res.json({ success: true });
  } catch (e) { next(e); }
};

// ── Wall Ports ────────────────────────────────────────────────────────────────

/**
 * How far along the patching chain a socket is. Deliberately separate from
 * occupancy (`occupied_by`) — they are two independent axes, and a picker has to
 * show both: assigning a device to a *free but unpatched* socket looks like the
 * job is done while the device has no network. See docs/CONNECTIONS_WORKFLOW.md.
 */
export type WallPortPatchStatus = 'unpatched' | 'patched' | 'live';

function patchStatusOf(port: WallPort): WallPortPatchStatus {
  if (port.switch_asset_id && port.switch_port) return 'live';
  if (port.patch_panel_id && port.patch_port != null) return 'patched';
  return 'unpatched';
}

/**
 * Attaches each socket's room. `workarea_id` is a soft join with no TypeORM
 * relation (see WallPort.entity.ts), so it's resolved in one extra query rather
 * than per row — same shape as workarea.controller.ts's withZones().
 */
async function withWorkAreas(ports: WallPort[]): Promise<void> {
  const ids = [...new Set(ports.map((p) => p.workarea_id).filter((id): id is string => !!id))];
  if (ids.length === 0) return;
  const areas = await waRepo().find({ where: { id: In(ids) } });
  const byId = new Map(areas.map((a) => [a.id, a]));
  for (const port of ports) {
    const area = port.workarea_id ? byId.get(port.workarea_id) : undefined;
    port.workarea = area ? { id: area.id, name: area.name } : null;
  }
}

/** Which asset currently holds each socket, keyed by wall-port id. */
async function occupantsOf(ports: WallPort[]): Promise<Map<string, { _id: string; display_name: string }>> {
  const byPort = new Map<string, { _id: string; display_name: string }>();
  if (ports.length === 0) return byPort;
  const assets = await findByIn(assetRepo(), 'wall_port_id', ports.map((p) => p.id));
  for (const asset of assets) {
    if (asset.wall_port_id) byPort.set(asset.wall_port_id, { _id: asset.id, display_name: asset.display_name });
  }
  return byPort;
}

export const listWallPorts = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { floor_id, patch_panel_id, workarea_id } = req.query as Record<string, string | undefined>;
    const qb = wpRepo().createQueryBuilder('w')
      .leftJoinAndSelect('w.patch_panel', 'pp')
      .leftJoinAndSelect('pp.rack', 'rack')
      .leftJoinAndSelect('rack.room', 'room')
      // Label-ordered because labels are the identity ("R1/001") and are what
      // every list and picker is read by.
      .orderBy('w.label', 'ASC');
    if (floor_id)       qb.andWhere('w.floor_id = :floor_id', { floor_id });
    if (patch_panel_id) qb.andWhere('w.patch_panel_id = :patch_panel_id', { patch_panel_id });
    if (workarea_id)    qb.andWhere('w.workarea_id = :workarea_id', { workarea_id });
    const ports = await qb.getMany();
    await withWorkAreas(ports);
    const occupants = await occupantsOf(ports);
    res.json({ success: true, data: ports.map(w => ({
      ...w.toApiResponse(),
      patch_panel_name: w.patch_panel?.name ?? null,
      rack_name: w.patch_panel?.rack?.name ?? null,
      room_name: w.patch_panel?.rack?.room?.name ?? null,
      room_type: w.patch_panel?.rack?.room?.type ?? null,
      patch_status: patchStatusOf(w),
      occupied_by: occupants.get(w.id) ?? null,
    })) });
  } catch (e) { next(e); }
};

export const getWallPort = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const port = await wpRepo().findOne({ where: { id: req.params.id }, relations: ['patch_panel', 'patch_panel.rack', 'patch_panel.rack.room'] });
    if (!port) { notFound(res); return; }
    res.json({ success: true, data: {
      ...port.toApiResponse(),
      patch_panel_name: port.patch_panel?.name ?? null,
      rack_name: port.patch_panel?.rack?.name ?? null,
      room_name: port.patch_panel?.rack?.room?.name ?? null,
    }});
  } catch (e) { next(e); }
};

// Two wall ports wired into the same patch-panel port (or the same switch
// port) would both claim to terminate the same physical link — a real-world
// impossibility. `excludePortId` lets update-in-place skip colliding with itself.
async function findWallPortCollision(
  patch_panel_id: string | null | undefined,
  patch_port: number | null | undefined,
  switch_asset_id: string | null | undefined,
  switch_port: string | null | undefined,
  excludePortId?: string,
): Promise<string | null> {
  if (patch_panel_id != null && patch_port != null) {
    const qb = wpRepo().createQueryBuilder('w')
      .where('w.patch_panel_id = :patch_panel_id', { patch_panel_id })
      .andWhere('w.patch_port = :patch_port', { patch_port });
    if (excludePortId) qb.andWhere('w.id != :excludePortId', { excludePortId });
    if (await qb.getOne()) return 'This patch panel port is already assigned to another wall port';
  }
  if (switch_asset_id != null && switch_port != null) {
    const qb = wpRepo().createQueryBuilder('w')
      .where('w.switch_asset_id = :switch_asset_id', { switch_asset_id })
      .andWhere('w.switch_port = :switch_port', { switch_port });
    if (excludePortId) qb.andWhere('w.id != :excludePortId', { excludePortId });
    if (await qb.getOne()) return 'This switch port is already assigned to another wall port';
  }
  return null;
}

/**
 * Socket labels ("R1/001") are unique **per building**, not globally: rack names
 * repeat across buildings (each has its own R1) but never inside one. Checked
 * across the building's floors rather than just the given floor, because one
 * rack's sockets are spread over several floors.
 */
async function labelsTakenInBuilding(floorId: string, labels: string[]): Promise<Set<string>> {
  const taken = new Set<string>();
  if (labels.length === 0) return taken;
  const floorRepo = AppDataSource.getRepository(Floor);
  const floor = await floorRepo.findOneBy({ id: floorId });
  if (!floor) return taken;
  const siblings = await floorRepo.find({ where: { building_id: floor.building_id } });
  const existing = await wpRepo().find({ where: { floor_id: In(siblings.map((f) => f.id)) } });
  const wanted = new Set(labels.map((l) => l.trim().toLowerCase()));
  for (const port of existing) {
    const folded = port.label.trim().toLowerCase();
    if (wanted.has(folded)) taken.add(folded);
  }
  return taken;
}

export const createWallPort = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { label, floor_id, workarea_id, pos_x, pos_y, patch_panel_id, patch_port, switch_asset_id, switch_port, description } = req.body;
    if (!label || !String(label).trim()) { res.status(400).json({ success: false, error: 'label is required' }); return; }
    if (!floor_id) { res.status(400).json({ success: false, error: 'floor_id is required' }); return; }

    const taken = await labelsTakenInBuilding(floor_id, [String(label)]);
    if (taken.size > 0) {
      res.status(409).json({ success: false, error: `A wall port labelled "${String(label).trim()}" already exists in this building` });
      return;
    }

    const collision = await findWallPortCollision(patch_panel_id, patch_port, switch_asset_id, switch_port);
    if (collision) { res.status(409).json({ success: false, error: collision }); return; }

    const port = wpRepo().create({ label: String(label).trim(), floor_id, workarea_id: workarea_id ?? null, pos_x: pos_x ?? 0, pos_y: pos_y ?? 0, patch_panel_id: patch_panel_id ?? null, patch_port: patch_port ?? null, switch_asset_id: switch_asset_id ?? null, switch_port: switch_port ?? null, description: description ?? null });
    await wpRepo().save(port);
    res.status(201).json({ success: true, data: port.toApiResponse() });
  } catch (e) { next(e); }
};

/** Hard cap on one bulk call — a rack has tens of ports, not thousands. */
const MAX_BULK_WALL_PORTS = 512;

/**
 * Creates a contiguous range of sockets from their label pattern
 * (`R1/001`…`R1/048`). A rack's sockets *are* a range, so generating them is
 * what makes "which sockets exist on this floor" cheap to fill in rather than 48
 * rows of typing — see docs/CONNECTIONS_WORKFLOW.md Phase A.
 *
 * Labels that already exist in the building are skipped and reported, not
 * treated as an error: re-running a range after adding a few by hand is a normal
 * thing to do, and failing the whole batch would punish it.
 */
export const createWallPortRange = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { floor_id, workarea_id, prefix, from, to, pad, description } = req.body as {
      floor_id?: string; workarea_id?: string | null; prefix?: string;
      from?: number; to?: number; pad?: number; description?: string | null;
    };

    if (!floor_id) { res.status(400).json({ success: false, error: 'floor_id is required' }); return; }
    if (!prefix || !prefix.trim()) { res.status(400).json({ success: false, error: 'prefix is required, e.g. "R1/"' }); return; }
    const start = Number(from), end = Number(to);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) {
      res.status(400).json({ success: false, error: 'from/to must be whole numbers with from <= to' });
      return;
    }
    const count = end - start + 1;
    if (count > MAX_BULK_WALL_PORTS) {
      res.status(400).json({ success: false, error: `That range is ${count} sockets; the maximum per request is ${MAX_BULK_WALL_PORTS}` });
      return;
    }

    const width = Number.isInteger(pad) ? Number(pad) : 3;
    const labels: string[] = [];
    for (let n = start; n <= end; n++) labels.push(`${prefix.trim()}${String(n).padStart(width, '0')}`);

    const taken = await labelsTakenInBuilding(floor_id, labels);
    const fresh = labels.filter((l) => !taken.has(l.trim().toLowerCase()));

    const ports = fresh.map((label) => wpRepo().create({
      label,
      floor_id,
      workarea_id: workarea_id ?? null,
      pos_x: 0,
      pos_y: 0,
      patch_panel_id: null,
      patch_port: null,
      switch_asset_id: null,
      switch_port: null,
      description: description ?? null,
    }));
    // Chunked: one parameter per column per row hits MSSQL's 2100-parameter cap
    // well before 512 rows (see utils/mssqlBatch.ts).
    if (ports.length > 0) await wpRepo().save(ports, { chunk: chunkForEntity(WallPort) });

    res.status(201).json({
      success: true,
      data: {
        created: ports.map((p) => p.toApiResponse()),
        skipped: labels.filter((l) => taken.has(l.trim().toLowerCase())),
      },
    });
  } catch (e) { next(e); }
};

interface PatchSuggestion {
  wall_port_id: string;
  label: string;
  workarea_name: string | null;
  patch_panel_id: string;
  patch_panel_name: string;
  patch_port: number;
  /** Set when the derived port is already claimed by a different socket. */
  conflict: string | null;
}

interface PatchSuggestionProblem {
  wall_port_id: string;
  label: string;
  reason: DerivationFailure;
}

/**
 * Works out, from their labels alone, where a rack's unpatched sockets belong.
 *
 * Sockets are labelled `R<rack>/<port>` with the numbers running continuously
 * across the rack's panels, so the label already says which panel port a socket
 * lands on — see utils/wallPortLabel.ts. This turns the patching step from
 * hundreds of lookups into a list to confirm.
 *
 * Read-only on purpose: it returns suggestions and the reason for every socket
 * it could not place, and writes nothing until the caller posts back the subset
 * it accepts (applyWallPortPatchSuggestions). A wrong assumption about the
 * numbering therefore shows up on the first rack, not after 300 sockets.
 */
export const suggestWallPortPatches = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { rack_id } = req.query as { rack_id?: string };
    if (!rack_id) { res.status(400).json({ success: false, error: 'rack_id is required' }); return; }

    const rack = await rackRepo().findOne({ where: { id: rack_id }, relations: ['patch_panels', 'room'] });
    if (!rack) { notFound(res); return; }

    const panels: PanelLike[] = (rack.patch_panels ?? []).map((p) => ({
      id: p.id, name: p.name, u_position: p.u_position, port_count: p.port_count,
    }));

    // Sockets on the same building's floors that aren't wired to a panel yet.
    // Scoped to the building because socket labels are unique per building, not
    // globally — another building's R1 is a different rack.
    const floorRepo = AppDataSource.getRepository(Floor);
    const buildingFloors = await floorRepo.find({ where: { building_id: rack.room.building_id } });
    const floorIds = buildingFloors.map((f) => f.id);
    const candidates = floorIds.length === 0
      ? []
      : await wpRepo().find({ where: { floor_id: In(floorIds), patch_panel_id: IsNull() } });
    await withWorkAreas(candidates);

    // Panel ports already taken, so a suggestion can flag rather than collide.
    const takenByPanelPort = new Map<string, string>();
    if (panels.length > 0) {
      const existing = await wpRepo().find({ where: { patch_panel_id: In(panels.map((p) => p.id)) } });
      for (const port of existing) {
        if (port.patch_panel_id && port.patch_port != null) {
          takenByPanelPort.set(`${port.patch_panel_id}|${port.patch_port}`, port.label);
        }
      }
    }

    const suggestions: PatchSuggestion[] = [];
    const problems: PatchSuggestionProblem[] = [];
    for (const port of candidates) {
      const { target, failure } = derivePatchForLabel(port.label, rack.name, panels);
      if (!target) {
        // A label naming a different rack isn't a problem with this rack — it
        // simply belongs to another one, so it's left out entirely.
        if (failure && failure !== 'rack-name-mismatch') {
          problems.push({ wall_port_id: port.id, label: port.label, reason: failure });
        }
        continue;
      }
      suggestions.push({
        wall_port_id: port.id,
        label: port.label,
        workarea_name: port.workarea?.name ?? null,
        patch_panel_id: target.panel.id,
        patch_panel_name: target.panel.name,
        patch_port: target.patch_port,
        conflict: takenByPanelPort.get(`${target.panel.id}|${target.patch_port}`) ?? null,
      });
    }

    suggestions.sort((a, b) => a.label.localeCompare(b.label));
    res.json({ success: true, data: { rack_name: rack.name, suggestions, problems } });
  } catch (e) { next(e); }
};

/**
 * Applies the suggestions the caller accepted. Each is re-checked against the
 * collision guard rather than trusted, because the list may have been on screen
 * while someone else patched one of the same ports.
 */
export const applyWallPortPatchSuggestions = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { assignments } = req.body as {
      assignments?: Array<{ wall_port_id: string; patch_panel_id: string; patch_port: number }>;
    };
    if (!Array.isArray(assignments) || assignments.length === 0) {
      res.status(400).json({ success: false, error: 'assignments is required and must not be empty' });
      return;
    }
    if (assignments.length > MAX_BULK_WALL_PORTS) {
      res.status(400).json({ success: false, error: `At most ${MAX_BULK_WALL_PORTS} assignments per request` });
      return;
    }

    const applied: string[] = [];
    const rejected: Array<{ wall_port_id: string; reason: string }> = [];

    for (const a of assignments) {
      const port = await wpRepo().findOneBy({ id: a.wall_port_id });
      if (!port) { rejected.push({ wall_port_id: a.wall_port_id, reason: 'Wall port no longer exists' }); continue; }
      if (port.patch_panel_id) {
        rejected.push({ wall_port_id: a.wall_port_id, reason: `${port.label} is already patched` });
        continue;
      }
      const collision = await findWallPortCollision(a.patch_panel_id, a.patch_port, port.switch_asset_id, port.switch_port, port.id);
      if (collision) { rejected.push({ wall_port_id: a.wall_port_id, reason: `${port.label}: ${collision}` }); continue; }

      port.patch_panel_id = a.patch_panel_id;
      port.patch_port = a.patch_port;
      await wpRepo().save(port);
      applied.push(port.label);
    }

    res.json({ success: true, data: { applied, rejected } });
  } catch (e) { next(e); }
};

/**
 * Everything that goes dark if a switch is taken out of service.
 *
 * The question behind a Saturday maintenance window: which sockets hang off this
 * switch, which devices are in them, whose devices are they, and which rooms are
 * affected. The socket chain is the only thing that can answer it — an
 * asset-to-asset connection row records that two things are connected but not
 * which switch port, so it cannot produce this list at all
 * (docs/CONNECTIONS_WORKFLOW.md §4).
 *
 * Read-only.
 */
export const getSwitchImpact = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const switchId = req.params.id;
    const switchAsset = await assetRepo().findOneBy({ id: switchId });
    if (!switchAsset) { notFound(res); return; }

    const ports = await wpRepo().find({
      where: { switch_asset_id: switchId },
      relations: ['patch_panel', 'patch_panel.rack', 'patch_panel.rack.room'],
    });
    await withWorkAreas(ports);
    const occupants = await occupantsOf(ports);

    // The people and rooms behind those sockets — the part that decides whether
    // a window is safe, and who to tell.
    const occupiedIds = [...occupants.values()].map((o) => o._id);
    const devices = occupiedIds.length === 0 ? [] : await findByIn(assetRepo(), 'id', occupiedIds);
    const deviceById = new Map(devices.map((d) => [d.id, d]));

    const affected = ports.map((port) => {
      const occupant = occupants.get(port.id);
      const device = occupant ? deviceById.get(occupant._id) : undefined;
      return {
        wall_port_id: port.id,
        label: port.label,
        switch_port: port.switch_port,
        patch_panel_name: port.patch_panel?.name ?? null,
        patch_port: port.patch_port,
        room_name: port.workarea?.name ?? null,
        device: device
          ? {
              _id: device.id,
              display_name: device.display_name,
              asset_type: device.asset_type,
              person_full_name: device.person_full_name,
            }
          : null,
      };
    });
    affected.sort((a, b) => a.label.localeCompare(b.label));

    const rooms = [...new Set(affected.map((a) => a.room_name).filter((n): n is string => !!n))].sort();
    const people = [...new Set(
      affected.map((a) => a.device?.person_full_name).filter((n): n is string => !!n),
    )].sort();

    res.json({
      success: true,
      data: {
        switch: { _id: switchAsset.id, display_name: switchAsset.display_name },
        socket_count: affected.length,
        // Sockets with nothing plugged in are still listed — they are capacity
        // that goes away during the window, and someone may be about to use one.
        device_count: affected.filter((a) => a.device).length,
        rooms,
        people,
        sockets: affected,
      },
    });
  } catch (e) { next(e); }
};

export const updateWallPort = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const port = await wpRepo().findOneBy({ id: req.params.id });
    if (!port) { notFound(res); return; }

    const body = req.body as Partial<{
      label: string; workarea_id: string | null; description: string | null;
      pos_x: number; pos_y: number;
      patch_panel_id: string | null; patch_port: number | null;
      switch_asset_id: string | null; switch_port: string | null;
    }>;
    const patch_panel_id   = body.patch_panel_id   !== undefined ? body.patch_panel_id   : port.patch_panel_id;
    const patch_port       = body.patch_port       !== undefined ? body.patch_port       : port.patch_port;
    const switch_asset_id  = body.switch_asset_id  !== undefined ? body.switch_asset_id  : port.switch_asset_id;
    const switch_port      = body.switch_port      !== undefined ? body.switch_port      : port.switch_port;
    const collision = await findWallPortCollision(patch_panel_id, patch_port, switch_asset_id, switch_port, port.id);
    if (collision) { res.status(409).json({ success: false, error: collision }); return; }

    if (body.label !== undefined && body.label.trim() !== port.label) {
      const taken = await labelsTakenInBuilding(port.floor_id, [body.label]);
      if (taken.size > 0) {
        res.status(409).json({ success: false, error: `A wall port labelled "${body.label.trim()}" already exists in this building` });
        return;
      }
      port.label = body.label.trim();
    }
    // Explicit field list rather than Object.assign(port, req.body): the body is
    // client-supplied, and a blanket assign would happily overwrite `id` or
    // `floor_id` and silently move a socket to another floor.
    if (body.workarea_id     !== undefined) port.workarea_id     = body.workarea_id ?? null;
    if (body.description     !== undefined) port.description     = body.description ?? null;
    if (body.pos_x           !== undefined) port.pos_x           = body.pos_x;
    if (body.pos_y           !== undefined) port.pos_y           = body.pos_y;
    if (body.patch_panel_id  !== undefined) port.patch_panel_id  = body.patch_panel_id ?? null;
    if (body.patch_port      !== undefined) port.patch_port      = body.patch_port ?? null;
    if (body.switch_asset_id !== undefined) port.switch_asset_id = body.switch_asset_id ?? null;
    if (body.switch_port     !== undefined) port.switch_port     = body.switch_port ?? null;

    await wpRepo().save(port);
    res.json({ success: true, data: port.toApiResponse() });
  } catch (e) { next(e); }
};

export const deleteWallPort = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const port = await wpRepo().findOneBy({ id: req.params.id });
    if (!port) { notFound(res); return; }
    await wpRepo().remove(port);
    res.json({ success: true });
  } catch (e) { next(e); }
};
