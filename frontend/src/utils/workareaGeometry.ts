import { WorkArea } from '../services/workarea.service';

/**
 * Finds which work area's rectangle contains a point, if any — used to keep
 * `asset.workarea_id` in sync with where an asset actually is on the map
 * after a drag. Without this, dragging an asset from one work area's
 * rectangle into another's only ever moved its x/y; the underlying
 * workarea_id foreign key never changed, so the asset stayed structurally
 * "in" its old work area while sitting visually inside a different one —
 * silently wrong for any work-area-scoped grouping, filter, or capacity count.
 *
 * When rectangles overlap, the first match in array order wins — a rare
 * edge case with no stronger signal to break the tie on here.
 */
export function findContainingWorkareaId(x: number, y: number, workareas: WorkArea[]): string | null {
  for (const wa of workareas) {
    const wx = wa.coordinates?.x ?? 0;
    const wy = wa.coordinates?.y ?? 0;
    const ww = wa.dimensions?.width ?? 150;
    const wh = wa.dimensions?.height ?? 100;
    if (x >= wx && x <= wx + ww && y >= wy && y <= wy + wh) return wa._id;
  }
  return null;
}
