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

export const DEFAULT_WORKAREA_COLOR = WORKAREA_COLORS[0];

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
  workarea: { _id?: string; type?: string | null; metadata?: { color?: string } | null },
  /**
   * Optional zone→colour assignment from `buildZoneColorMap`. Pass it when
   * rendering a whole floor so distinct zones are guaranteed distinct colours;
   * omit it for single-area contexts (e.g. the form's swatch preview), which
   * fall back to hashing.
   */
  zoneColors?: Map<string, WorkareaColor>,
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
  // Zone/group first, so every room in the same zone matches. Normalised so
  // "HR" / "hr" / " Hr " don't split one zone across three colours.
  const zone = (workarea.type ?? '').trim().toLowerCase();
  if (zone) {
    return zoneColors?.get(zone) ?? WORKAREA_COLORS[hashString(zone) % WORKAREA_COLORS.length];
  }
  if (!workarea._id) return DEFAULT_WORKAREA_COLOR;
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
  const zones = [...new Set(
    workareas
      .map((w) => (w.type ?? '').trim().toLowerCase())
      .filter((z) => z !== ''),
  )].sort();
  const map = new Map<string, WorkareaColor>();
  zones.forEach((zone, i) => map.set(zone, WORKAREA_COLORS[i % WORKAREA_COLORS.length]));
  return map;
}
