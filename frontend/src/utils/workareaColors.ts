/**
 * workareaColors.ts — Colour palette for work-area rectangles on the floor map.
 *
 * Every work area used to render in the same violet, which made adjacent
 * areas (e.g. several offices along one corridor) impossible to tell apart.
 * A work area can now carry an explicit colour in `metadata.color`; when it
 * doesn't, `resolveWorkareaColor` derives one deterministically.
 *
 * The auto-derived colour keys off the work area's **`type`** (its zone /
 * group — e.g. several rooms all belonging to "HR"), falling back to the id
 * when no type is set. That means same-zone areas share a colour, which is
 * how the map conveys "these rooms are all one department" — the physical
 * survey's `helyszín` level maps onto `type` for exactly this reason (see
 * backend/src/scripts/import-inventory-survey.ts).
 *
 * Deterministic (not random) so a colour never changes between reloads, and
 * not index-based so it doesn't shift when areas are added/removed/reordered.
 */

export interface WorkareaColor {
  /** Stable key stored in metadata.color — the fill hex. */
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

const DEFAULT_WORKAREA_COLOR = WORKAREA_COLORS[0];

/** The bits of a WorkArea that determine its colour. */
export interface WorkareaColorInput {
  _id: string;
  type?: string | null;
  metadata?: { color?: string } | null;
}

/**
 * Canonical form of a zone name, so "HR" / "hr" / " Hr " are one zone rather
 * than three. Single definition because this is the join key for both the
 * colour grouping and the form's zone suggestions.
 */
export function normalizeZone(type: string | null | undefined): string {
  return (type ?? '').trim().toLowerCase();
}

/** Distinct zone names present in a set of work areas, original casing kept. */
export function distinctZones(workareas: Array<{ type?: string | null }>): string[] {
  const byNormalized = new Map<string, string>();
  for (const area of workareas) {
    const raw = (area.type ?? '').trim();
    const key = normalizeZone(raw);
    if (key && !byNormalized.has(key)) byNormalized.set(key, raw);
  }
  return [...byNormalized.values()].sort((a, b) => a.localeCompare(b));
}

/**
 * Whether a work area's rectangle is wide enough to show its zone label to the
 * right of its name without the two colliding.
 *
 * Both labels sit on the same baseline — the name left-aligned, the zone
 * right-aligned — so on a narrow area they used to overlap into unreadable mush
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

/** Stable non-cryptographic hash so the same id always maps to the same hue. */
function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0; // force int32
  }
  return Math.abs(h);
}

/**
 * The colour a work area should render with: its explicit `metadata.color` if
 * that matches a known palette entry, otherwise one derived from its id.
 */
export function resolveWorkareaColor(
  workarea: WorkareaColorInput,
  /**
   * Zone→colour assignment from `buildZoneColorMap`, built over all work areas
   * on the floor. Required, so every caller shows the same colour for the same
   * area — an earlier optional version let the form fall back to hashing and
   * therefore preview a different colour than the map rendered.
   */
  zoneColors: Map<string, WorkareaColor>,
): WorkareaColor {
  const explicit = workarea.metadata?.color;
  if (explicit) {
    const match = WORKAREA_COLORS.find((c) => c.fill.toLowerCase() === explicit.toLowerCase());
    if (match) return match;
    // An unrecognised value (hand-edited, or a palette entry we've since
    // dropped) still gets honoured as the fill; derive the stroke instead of
    // silently falling back to violet.
    return { fill: explicit, stroke: explicit, label: 'Custom' };
  }
  const zone = normalizeZone(workarea.type);
  if (zone) return zoneColors.get(zone) ?? DEFAULT_WORKAREA_COLOR;
  // No zone to group by — spread these out by id so at least they don't all
  // look identical.
  return WORKAREA_COLORS[hashString(workarea._id) % WORKAREA_COLORS.length];
}

/**
 * Assigns each distinct zone on a floor its own palette entry.
 *
 * Hashing alone collides too easily to be useful here — with 8 colours, the
 * real Werk1 zone set ("cummins" and "mernoki iroda") already landed on the
 * same fill, which defeats the whole point of colouring by zone. Assigning by
 * index over the alphabetically-sorted zone list instead guarantees distinct
 * colours for up to WORKAREA_COLORS.length zones per floor.
 *
 * Tradeoff: adding or renaming a zone can shift other zones' colours, since
 * the index depends on the full set. That's accepted because the set is small
 * and stable in practice, distinctness matters more than absolute permanence,
 * and an explicit `metadata.color` always wins anyway.
 */
export function buildZoneColorMap(
  workareas: Array<{ type?: string | null }>,
): Map<string, WorkareaColor> {
  const map = new Map<string, WorkareaColor>();
  distinctZones(workareas).forEach((zone, i) => {
    map.set(normalizeZone(zone), WORKAREA_COLORS[i % WORKAREA_COLORS.length]);
  });
  return map;
}
