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
import { Asset } from '../entities/Asset.entity';

const roomRepo  = () => AppDataSource.getRepository(NetworkRoom);
const rackRepo  = () => AppDataSource.getRepository(NetworkRack);
const ppRepo    = () => AppDataSource.getRepository(PatchPanel);
const wpRepo    = () => AppDataSource.getRepository(WallPort);
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

export const listWallPorts = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { floor_id, patch_panel_id } = req.query as Record<string, string | undefined>;
    const qb = wpRepo().createQueryBuilder('w')
      .leftJoinAndSelect('w.patch_panel', 'pp')
      .leftJoinAndSelect('pp.rack', 'rack')
      .leftJoinAndSelect('rack.room', 'room');
    if (floor_id)       qb.andWhere('w.floor_id = :floor_id', { floor_id });
    if (patch_panel_id) qb.andWhere('w.patch_panel_id = :patch_panel_id', { patch_panel_id });
    const ports = await qb.getMany();
    res.json({ success: true, data: ports.map(w => ({
      ...w.toApiResponse(),
      patch_panel_name: w.patch_panel?.name ?? null,
      rack_name: w.patch_panel?.rack?.name ?? null,
      room_name: w.patch_panel?.rack?.room?.name ?? null,
      room_type: w.patch_panel?.rack?.room?.type ?? null,
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

export const createWallPort = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { label, floor_id, pos_x, pos_y, patch_panel_id, patch_port, switch_asset_id, switch_port, description } = req.body;

    const collision = await findWallPortCollision(patch_panel_id, patch_port, switch_asset_id, switch_port);
    if (collision) { res.status(409).json({ success: false, error: collision }); return; }

    const port = wpRepo().create({ label, floor_id, pos_x: pos_x ?? 0, pos_y: pos_y ?? 0, patch_panel_id: patch_panel_id ?? null, patch_port: patch_port ?? null, switch_asset_id: switch_asset_id ?? null, switch_port: switch_port ?? null, description: description ?? null });
    await wpRepo().save(port);
    res.status(201).json({ success: true, data: port.toApiResponse() });
  } catch (e) { next(e); }
};

export const updateWallPort = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const port = await wpRepo().findOneBy({ id: req.params.id });
    if (!port) { notFound(res); return; }

    const body = req.body as Partial<{ patch_panel_id: string | null; patch_port: number | null; switch_asset_id: string | null; switch_port: string | null }>;
    const patch_panel_id   = body.patch_panel_id   !== undefined ? body.patch_panel_id   : port.patch_panel_id;
    const patch_port       = body.patch_port       !== undefined ? body.patch_port       : port.patch_port;
    const switch_asset_id  = body.switch_asset_id  !== undefined ? body.switch_asset_id  : port.switch_asset_id;
    const switch_port      = body.switch_port      !== undefined ? body.switch_port      : port.switch_port;
    const collision = await findWallPortCollision(patch_panel_id, patch_port, switch_asset_id, switch_port, port.id);
    if (collision) { res.status(409).json({ success: false, error: collision }); return; }

    Object.assign(port, req.body);
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
