/**
 * workareaColors.ts — Colour palette for the floor map's zones.
 *
 * Colour identifies the **zone** (Building > Floor > Zone > WorkArea), not the
 * individual room: every room in one zone renders in the same colour, which is
 * how the map conveys "these four offices are all HR". The colour therefore
 * lives on the Zone. An earlier design put an optional colour on each work
 * area, which let two rooms of the same zone render differently and defeated
 * the grouping entirely.
 *
 * A zone may carry an explicit `color`; when it doesn't, `buildZoneColorMap`
 * assigns one per floor. Assignment is by index over the floor's zones sorted
 * by name rather than by hashing, because hashing collided on the real Werk1
 * zone set ("cummins" and "mernoki iroda" landed on the same fill), which
 * defeats the point. Tradeoff: adding or renaming a zone can shift other
 * zones' colours, accepted because the set is small and an explicit colour
 * always wins.
 */

export interface WorkareaColor {
  /** Fill hex — also the value stored in Zone.color. */
  fill: string;
  /** Border/label accent, a darker shade of the same hue. */
  stroke: string;
  label: string;
}

// Light fills with clearly distinct hues — they sit under a floor plan and
// behind text, so all fills stay pale and all strokes stay saturated.
export const WORKAREA_COLORS: WorkareaColor[] = [
  { fill: '#ddd6fe', stroke: '#7c3aed', label: 'Violet' },
  { fill: '#bfdbfe', stroke: '#2563eb', label: 'Blue' },
  { fill: '#a7f3d0', stroke: '#059669', label: 'Green' },
  { fill: '#fde68a', stroke: '#d97706', label: 'Amber' },
  { fill: '#fecaca', stroke: '#dc2626', label: 'Red' },
  { fill: '#f5d0fe', stroke: '#c026d3', label: 'Fuchsia' },
  { fill: '#99f6e4', stroke: '#0d9488', label: 'Teal' },
  { fill: '#fed7aa', stroke: '#ea580c', label: 'Orange' },
];

/** Rooms with no zone yet — deliberately neutral so they read as "ungrouped". */
export const UNZONED_COLOR: WorkareaColor = { fill: '#e5e7eb', stroke: '#9ca3af', label: 'Ungrouped' };

/** Resolves a stored hex back to its palette entry, so the stroke matches. */
export function paletteEntryFor(fill: string | null | undefined): WorkareaColor | null {
  if (!fill) return null;
  const match = WORKAREA_COLORS.find((c) => c.fill.toLowerCase() === fill.toLowerCase());
  // An unrecognised value (hand-edited, or a palette entry since dropped) is
  // still honoured as the fill rather than silently reverting to violet.
  return match ?? { fill, stroke: fill, label: 'Custom' };
}

interface ZoneLike {
  _id: string;
  name: string;
  color: string | null;
}

/**
 * The distinct zones actually present on a floor, read off the work areas' own
 * denormalised `zone` — no separate zones request needed, and a zone with no
 * rooms can't shift the colours of ones that render.
 */
export function zonesFromWorkareas(
  workareas: { zone_id?: string | null; zone?: ZoneLike | null }[],
): ZoneLike[] {
  const byId = new Map<string, ZoneLike>();
  for (const wa of workareas) {
    if (wa.zone_id && wa.zone && !byId.has(wa.zone_id)) byId.set(wa.zone_id, wa.zone);
  }
  return [...byId.values()];
}

/**
 * One colour per zone on a floor: explicit `color` where set, otherwise the
 * next palette entry by name order. Keyed by zone id.
 */
export function buildZoneColorMap(zones: ZoneLike[]): Map<string, WorkareaColor> {
  const sorted = [...zones].sort((a, b) => a.name.localeCompare(b.name));
  const map = new Map<string, WorkareaColor>();
  let autoIndex = 0;
  for (const zone of sorted) {
    const explicit = paletteEntryFor(zone.color);
    if (explicit) {
      map.set(zone._id, explicit);
    } else {
      map.set(zone._id, WORKAREA_COLORS[autoIndex % WORKAREA_COLORS.length]);
      autoIndex++;
    }
  }
  return map;
}

/** The colour a room renders with — its zone's, or the ungrouped grey. */
export function resolveWorkareaColor(
  workarea: { zone_id?: string | null },
  zoneColors: Map<string, WorkareaColor>,
): WorkareaColor {
  if (!workarea.zone_id) return UNZONED_COLOR;
  return zoneColors.get(workarea.zone_id) ?? UNZONED_COLOR;
}

/**
 * Whether a room's rectangle is wide enough to show its zone name to the right
 * of its own name without the two colliding.
 *
 * Both labels sit on the same baseline — the room name left-aligned, the zone
 * right-aligned — so on a narrow room they used to overlap into unreadable mush
 * ("Aworkspacenbert office"). The asset-count badge occupies the same right
 * corner, so it has to be accounted for too.
 *
 * The character widths are estimates for the two font sizes used (12px bold
 * name, 11px zone, both set in FloorMap.module.css) — good enough because the
 * result only gates whether to draw at all, and erring toward hiding is safe.
 */
const LABEL_EDGE_PAD = 8;
const LABEL_GAP = 10;
const NAME_CHAR_WIDTH = 6.7; // 12px bold
const ZONE_CHAR_WIDTH = 5.6; // 11px regular
const ASSET_BADGE_WIDTH = 28; // circle at r=11 plus breathing room

export function zoneLabelFits(
  areaWidth: number,
  displayName: string,
  zoneText: string,
  hasAssetBadge: boolean,
): boolean {
  if (zoneText === '') return false;
  const needed =
    LABEL_EDGE_PAD +
    displayName.length * NAME_CHAR_WIDTH +
    LABEL_GAP +
    zoneText.length * ZONE_CHAR_WIDTH +
    (hasAssetBadge ? ASSET_BADGE_WIDTH : 0) +
    LABEL_EDGE_PAD;
  return areaWidth >= needed;
}

/** Horizontal space the asset-count badge reserves in the top-right corner. */
export function assetBadgeWidth(hasAssetBadge: boolean): number {
  return hasAssetBadge ? ASSET_BADGE_WIDTH : 0;
}

/**
 * How far a zone's halo extends beyond each room's rectangle.
 *
 * The halo is how zone shape is conveyed: one inflated rounded rect per room,
 * all in the zone colour, drawn behind the rooms. Adjacent rooms' halos merge,
 * so an L- or U-shaped zone renders as that shape — where a bounding box would
 * have swallowed a *different* zone's room sitting in the notch of the L.
 * Non-adjacent rooms of one zone stay separate blobs of the same colour, which
 * is honest rather than implying contiguous floor space.
 *
 * Kept small so two adjacent rooms of DIFFERENT zones don't bleed together.
 */
export const ZONE_HALO_PAD = 8;
