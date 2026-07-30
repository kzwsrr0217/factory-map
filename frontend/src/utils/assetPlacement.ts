import { Asset } from '../services/asset.service';

/**
 * Whether an asset is genuinely awaiting placement on a floor map.
 *
 * "Unplaced" is coordinate-driven (`is_placed`), but a *replaced* asset
 * (`successor_id` set — see the backend's replaceAsset) is unplaced on purpose:
 * it was decommissioned and cleared off the map, and will never be placed
 * again. Without excluding it, it nags forever in the unplaced lists alongside
 * genuinely new equipment.
 *
 * Shared because this predicate previously existed in three slightly different
 * forms — the Unplaced Assets page, and both pools feeding the floor map's
 * tray, one of which omitted the `successor_id` guard and so offered
 * decommissioned devices for placement while its sibling list excluded them.
 */
export function isAwaitingPlacement(asset: Asset): boolean {
  return !asset.is_placed && !asset.successor_id;
}

/**
 * `isAwaitingPlacement`, narrowed to assets not yet assigned to any floor —
 * e.g. those bulk-created from the ITSM snapshot, which carries no floor-plan
 * geometry. These only surface via explicit search, since the pool can run to
 * thousands of rows.
 */
export function isAwaitingFloorAssignment(asset: Asset): boolean {
  return isAwaitingPlacement(asset) && !asset.hierarchy.floor_id;
}
