/**
 * childPlacement.ts — when a machine moves room, its screens go with it.
 *
 * A desk move is ONE physical act: somebody carries the machine, its two monitors and the dock to
 * another room. In the app it was several separate edits, and the ones nobody remembered simply did
 * not happen — so a monitor kept pointing at a room its machine had left months ago.
 *
 * That makes this different from the other gaps in the process model. The rest cost somebody extra
 * work; this one silently produced WRONG DATA, with nothing anywhere to say so. A screen recorded in
 * the wrong room is worse than a screen recorded nowhere: the map looks complete and is lying.
 *
 * ── The rule, and the exception it protects ─────────────────────────────────────
 * A child follows its parent **only if it was in the same place as the parent before the move.**
 *
 * That distinction is the whole design. A screen sitting in the machine's room was clearly following
 * it, so it should keep following. A child recorded somewhere ELSE was not — an OT device mounted in
 * a cabinet down the hall, a spare screen parked in a store room — and dragging that along would
 * destroy a deliberate placement to fix an accidental one. Same rule the survey import uses in
 * spirit: act where the intent is unambiguous, leave the rest alone and say so.
 *
 * ── One level, deliberately ─────────────────────────────────────────────────────
 * Children only, never grandchildren. A monitor has no children, so recursion buys nothing real, and
 * `parent-child` rows are user-editable with no cycle guard — a two-row loop would make a recursive
 * walk hang. Depth is not worth a graph traversal here.
 *
 * ── What it does NOT touch ──────────────────────────────────────────────────────
 * Map coordinates, rack position and wall port. A monitor's x/y inside its old room means nothing in
 * the new one, and rooms differ in size and shape, so carrying the numbers over would place it
 * confidently in the wrong spot — worse than leaving it unplaced in the right room for somebody to
 * drag. A rack slot and a wall socket are physical facts about the old location and cannot follow a
 * device that has left it.
 */
import { EntityManager } from 'typeorm';
import { AppDataSource } from '../../config/database';
import { Asset } from '../../entities/Asset.entity';
import { AssetConnection } from '../../entities/AssetConnection.entity';

/** The fields that answer "which room is this in". Coordinates are not part of it — see the header. */
export interface Placement {
  building_id: string | null;
  floor_id: string | null;
  workarea_id: string | null;
  section_id: string | null;
  workstation_id: string | null;
}

export function placementOf(asset: Asset): Placement {
  return {
    building_id: asset.building_id,
    floor_id: asset.floor_id,
    workarea_id: asset.workarea_id,
    section_id: asset.section_id,
    workstation_id: asset.workstation_id,
  };
}

/**
 * Whether two placements name the same spot.
 *
 * Null-safe on every field: "no room recorded" is a real state here — 176 assets sit on a floor with
 * no room — and two devices both lacking a room on the same floor genuinely are in the same place as
 * far as this app knows.
 */
export function samePlacement(a: Placement, b: Placement): boolean {
  return a.building_id === b.building_id
    && a.floor_id === b.floor_id
    && a.workarea_id === b.workarea_id
    && a.section_id === b.section_id
    && a.workstation_id === b.workstation_id;
}

export function placementChanged(before: Placement, after: Placement): boolean {
  return !samePlacement(before, after);
}

export interface ChildMoveResult {
  /** Children that were with the parent and have been moved with it. */
  moved: Array<{ id: string; display_name: string }>;
  /**
   * Children that were somewhere else and were left there. Reported, never moved — and worth
   * surfacing, because it is the one case where the app knowingly leaves a child behind.
   */
  left_behind: Array<{ id: string; display_name: string }>;
}

/**
 * Move the parent's co-located children to its new placement.
 *
 * Call AFTER the parent has been saved, with the placement it had BEFORE. `options.manager` lets a
 * caller already inside a transaction keep the children in it: a half-moved desk is worse than an
 * unmoved one, because nothing would say which half landed.
 *
 * A `parent-child` row is directed — the child's `asset_id` points at itself and
 * `connected_asset_id` names its PARENT (see AssetRelationships.tsx). So a machine's children are
 * the rows pointing AT it, not the rows it owns. Getting that backwards would move the machine's
 * parent instead.
 */
export async function moveChildrenWithParent(
  parentId: string,
  before: Placement,
  after: Placement,
  options?: {
    manager?: EntityManager;
    /**
     * Children to leave alone because the caller is already moving them itself.
     *
     * The bulk path needs this: a screen that is itself in the selection has already been given the
     * new address, and re-deriving it from a parent's old placement would clear its coordinates a
     * second time for nothing.
     */
    skipIds?: Set<string>;
  },
): Promise<ChildMoveResult> {
  const { manager, skipIds } = options ?? {};
  const result: ChildMoveResult = { moved: [], left_behind: [] };
  if (samePlacement(before, after)) return result;

  const connRepo = manager ? manager.getRepository(AssetConnection) : AppDataSource.getRepository(AssetConnection);
  const assetRepo = manager ? manager.getRepository(Asset) : AppDataSource.getRepository(Asset);

  const links = await connRepo.find({
    where: { connected_asset_id: parentId, connection_type: 'parent-child' },
  });
  if (links.length === 0) return result;

  for (const link of links) {
    const child = await assetRepo.findOne({ where: { id: link.asset_id } });
    // A link to an asset that no longer exists, or the parent linked to itself. Neither is
    // something to move, and neither should stop the rest.
    if (!child || child.id === parentId) continue;
    if (skipIds?.has(child.id)) continue;
    // A replaced device has already been cleared out of its slot; moving it would put a retired
    // machine back on the map.
    if (child.successor_id) continue;

    if (!samePlacement(placementOf(child), before)) {
      result.left_behind.push({ id: child.id, display_name: child.display_name });
      continue;
    }

    child.building_id = after.building_id;
    child.floor_id = after.floor_id;
    child.workarea_id = after.workarea_id;
    child.section_id = after.section_id;
    child.workstation_id = after.workstation_id;
    /**
     * Coordinates are cleared rather than carried. The child is now in the right ROOM and not yet
     * on the plan, which is honest; keeping the old x/y would place it confidently somewhere
     * meaningless in a room of a different shape.
     */
    child.loc_x = 0;
    child.loc_y = 0;
    child.is_placed = false;
    await assetRepo.save(child);
    result.moved.push({ id: child.id, display_name: child.display_name });
  }

  return result;
}
