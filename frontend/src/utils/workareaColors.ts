/**
 * workareaColors.ts — Colour palette for work-area rectangles on the floor map.
 *
 * Every work area used to render in the same violet, which made adjacent
 * areas (e.g. several offices along one corridor) impossible to tell apart.
 * A work area can now carry an explicit colour in `metadata.color`; when it
 * doesn't, `resolveWorkareaColor` derives one deterministically from its id so
 * existing areas are immediately distinguishable without anyone editing them.
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
  workarea: { _id?: string; metadata?: { color?: string } | null },
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
  if (!workarea._id) return DEFAULT_WORKAREA_COLOR;
  return WORKAREA_COLORS[hashString(workarea._id) % WORKAREA_COLORS.length];
}
