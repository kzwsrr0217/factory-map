import { Request, Response, NextFunction } from 'express';
import { AppDataSource } from '../config/database';
import { NetworkRoom } from '../entities/NetworkRoom.entity';
import { NetworkRack } from '../entities/NetworkRack.entity';
import { PatchPanel } from '../entities/PatchPanel.entity';
import { WallPort } from '../entities/WallPort.entity';

const roomRepo  = () => AppDataSource.getRepository(NetworkRoom);
const rackRepo  = () => AppDataSource.getRepository(NetworkRack);
const ppRepo    = () => AppDataSource.getRepository(PatchPanel);
const wpRepo    = () => AppDataSource.getRepository(WallPort);

const notFound = (res: Response) => { res.status(404).json({ success: false, error: 'Not found' }); };

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

export const deleteRack = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const rack = await rackRepo().findOneBy({ id: req.params.id });
    if (!rack) { notFound(res); return; }
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

export const createWallPort = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { label, floor_id, pos_x, pos_y, patch_panel_id, patch_port, switch_asset_id, switch_port, description } = req.body;
    const port = wpRepo().create({ label, floor_id, pos_x: pos_x ?? 0, pos_y: pos_y ?? 0, patch_panel_id: patch_panel_id ?? null, patch_port: patch_port ?? null, switch_asset_id: switch_asset_id ?? null, switch_port: switch_port ?? null, description: description ?? null });
    await wpRepo().save(port);
    res.status(201).json({ success: true, data: port.toApiResponse() });
  } catch (e) { next(e); }
};

export const updateWallPort = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const port = await wpRepo().findOneBy({ id: req.params.id });
    if (!port) { notFound(res); return; }
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
