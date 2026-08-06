/**
 * replacement.ts — One device taking another's place.
 *
 * A swap is not an edit of two records. The new machine inherits the old one's place on the
 * map, its room, its rack slot, its wall port and every connection pointing at it — the
 * screens, the switch port, the lot — and the old record stays, unplaced, marked as
 * superseded so it drops out of the counts without losing its history.
 *
 * All of that used to live inside the POST endpoint, and so could only happen through a
 * click. It is here because a swap also arrives as "we changed this machine today, put it
 * in" — a list of HWA numbers, no browser — and the two paths must mean the same thing.
 * Duplicating sixty lines of "and don't forget the wall ports" is how they stop meaning it.
 *
 * The caller decides what to do afterwards (respond, emit, print); this does the change and
 * says what it did.
 */
import { AppDataSource } from '../../config/database';
import { Asset } from '../../entities/Asset.entity';
import { AssetConnection } from '../../entities/AssetConnection.entity';
import { AuditLog } from '../../entities/AuditLog.entity';
import { WallPort } from '../../entities/WallPort.entity';

export interface ReplacementResult {
  old_id: string;
  new_id: string;
  /** Connections re-pointed at the replacement, either direction. */
  connections_moved: number;
  /** Wall ports that were wired into the old asset as a switch. */
  wall_ports_moved: number;
  /** True when the old asset was on the map, so the new one now is. */
  inherited_placement: boolean;
  /**
   * True when this swap was already recorded and nothing was done a second time. Running it
   * again is not harmless: the first run empties the old asset's room, so a second would hand
   * the replacement that emptiness and quietly take it off the floor plan.
   */
  already_recorded: boolean;
}

/** Raised for the cases a caller has to turn into a 404 or a 422 rather than a 500. */
export class ReplacementError extends Error {
  constructor(message: string, readonly kind: 'not-found' | 'invalid') {
    super(message);
    this.name = 'ReplacementError';
  }
}

export async function replaceAssetWith(
  oldId: string,
  newId: string,
  by?: { id: string; username: string },
): Promise<ReplacementResult> {
  if (!newId) throw new ReplacementError('replacement_id is required', 'invalid');
  if (newId === oldId) throw new ReplacementError('An asset cannot replace itself', 'invalid');

  const assetRepo = AppDataSource.getRepository(Asset);
  const connRepo = AppDataSource.getRepository(AssetConnection);
  const wallPortRepo = AppDataSource.getRepository(WallPort);

  const oldAsset = await assetRepo.findOne({ where: { id: oldId } });
  const newAsset = await assetRepo.findOne({ where: { id: newId } });
  if (!oldAsset) throw new ReplacementError('Asset to replace not found', 'not-found');
  if (!newAsset) throw new ReplacementError('Replacement asset not found', 'not-found');

  // Already done. Not an error and not a no-op worth hiding: a second run would copy the old
  // asset's now-empty room onto the replacement and take it off the map, which is how a
  // recorded swap silently unplaces the machine it just placed.
  if (oldAsset.successor_id === newId && newAsset.predecessor_id === oldId) {
    return {
      old_id: oldId,
      new_id: newId,
      connections_moved: 0,
      wall_ports_moved: 0,
      inherited_placement: newAsset.is_placed,
      already_recorded: true,
    };
  }

  // Transfer position, hierarchy, and physical wiring to the replacement.
  newAsset.building_id = oldAsset.building_id;
  newAsset.floor_id = oldAsset.floor_id;
  newAsset.workarea_id = oldAsset.workarea_id;
  newAsset.section_id = oldAsset.section_id;
  newAsset.workstation_id = oldAsset.workstation_id;
  newAsset.rack_id = oldAsset.rack_id;
  newAsset.u_position = oldAsset.u_position;
  newAsset.rack_u_size = oldAsset.rack_u_size;
  newAsset.loc_x = oldAsset.loc_x;
  newAsset.loc_y = oldAsset.loc_y;
  newAsset.loc_rotation = oldAsset.loc_rotation;
  newAsset.loc_footprint = oldAsset.loc_footprint;
  newAsset.is_placed = oldAsset.is_placed;
  newAsset.wall_port_id = oldAsset.wall_port_id;
  newAsset.predecessor_id = oldId;
  const inheritedPlacement = oldAsset.is_placed;
  await assetRepo.save(newAsset);

  // Clear the old asset out of its physical slot — it's been removed.
  oldAsset.successor_id = newId;
  oldAsset.is_placed = false;
  oldAsset.loc_x = 0;
  oldAsset.loc_y = 0;
  oldAsset.workarea_id = null;
  oldAsset.section_id = null;
  oldAsset.workstation_id = null;
  oldAsset.rack_id = null;
  oldAsset.u_position = null;
  await assetRepo.save(oldAsset);
  // wall_port_id=null bypasses the same TypeORM identity-map quirk worked around in
  // updateAsset — see the comment there.
  await AppDataSource.createQueryBuilder().update(Asset)
    .set({ wall_port_id: () => 'NULL' }).where('id = :id', { id: oldId }).execute();

  // Re-point every connection (either direction) from the old asset to the replacement. A
  // row that would become self-referencing (the old asset was directly connected to its own
  // replacement) is dropped instead.
  const outbound = await connRepo.createQueryBuilder().update().set({ asset_id: newId })
    .where('asset_id = :oldId AND connected_asset_id != :newId', { oldId, newId }).execute();
  const inbound = await connRepo.createQueryBuilder().update().set({ connected_asset_id: newId })
    .where('connected_asset_id = :oldId AND asset_id != :newId', { oldId, newId }).execute();
  await connRepo.delete({ asset_id: newId, connected_asset_id: newId });

  // If the old asset was itself a switch, every WallPort wired into one of its ports
  // (switch_asset_id) needs to follow it to the replacement too — otherwise those wall ports
  // keep pointing at the now-retired switch.
  const ports = await wallPortRepo.createQueryBuilder().update().set({ switch_asset_id: newId })
    .where('switch_asset_id = :oldId', { oldId }).execute();

  if (by) {
    // Written by hand rather than through the audit middleware: that middleware infers the
    // action from the HTTP method and expects one flat asset in the response, neither of
    // which fits a swap — and there is no request at all when this runs from a script.
    const logRepo = AppDataSource.getRepository(AuditLog);
    await logRepo.save(logRepo.create({
      user_id: by.id, username: by.username, action: 'update',
      entity_type: 'asset', document_id: oldId,
      diff: { replaced_by: newId, note: 'Asset replaced — cleared to unplaced, connections transferred to replacement' },
    })).catch(() => { /* audit failure must never fail the change */ });
    await logRepo.save(logRepo.create({
      user_id: by.id, username: by.username, action: 'update',
      entity_type: 'asset', document_id: newId,
      diff: { replaces: oldId, note: 'Inherited position, hierarchy, wall-port assignment, and connections from replaced asset' },
    })).catch(() => { /* audit failure must never fail the change */ });
  }

  return {
    old_id: oldId,
    new_id: newId,
    connections_moved: (outbound.affected ?? 0) + (inbound.affected ?? 0),
    wall_ports_moved: ports.affected ?? 0,
    inherited_placement: inheritedPlacement,
    already_recorded: false,
  };
}
