/**
 * monitorSpecs.ts — What a monitor model actually is, for the redistribution.
 *
 * The docks built into the older screens are failing, and the plan is one laptop, one
 * docking monitor and one plain monitor per desk — with **the two panels the same
 * height**, because a 24" 16:10 next to a 24" 16:9 sits about 2.5 cm taller and the pair
 * looks and works wrong. So the question "which monitors can stand beside each other" has
 * to be answerable from the inventory, and it isn't: the estate records a model string,
 * not a size or an aspect ratio.
 *
 * This is that lookup, and it is deliberately a table rather than a clever parse:
 *  - `dock` is not guessable from the number. On Dell's U/P series the trailing `E`/`HE`
 *    means USB-C with Ethernet — the screen IS the dock — while the same panel without
 *    the suffix is a plain monitor. U2424HE docks, U2424H does not.
 *  - Height is computed from the diagonal and the aspect ratio rather than stored, so the
 *    two numbers that decide a pairing cannot drift apart. Sizes are the nominal ones the
 *    maker prints (a "24 inch" panel is usually 23.8"), which makes the millimetres
 *    comparable to each other but not absolute — the decision rests on the aspect ratio.
 *
 * A model that is not in this table comes back `null`, and the report lists it as
 * unknown. That is the point: guessing a resolution would quietly produce a mismatched
 * pair on somebody's desk, and an unknown is a question a person can answer in seconds.
 */

export type MonitorAspect = '5:4' | '4:3' | '16:10' | '16:9' | '21:9';

export interface MonitorSpec {
  /** The model as the maker writes it, so a report can name what it matched. */
  model: string;
  /** Nominal diagonal in inches. */
  inches: number;
  aspect: MonitorAspect;
  /** True when the screen carries the dock (USB-C with Ethernet), not just a USB hub. */
  dock: boolean;
}

const ASPECT_RATIO: Record<MonitorAspect, [number, number]> = {
  '5:4': [5, 4],
  '4:3': [4, 3],
  '16:10': [16, 10],
  '16:9': [16, 9],
  '21:9': [21, 9],
};

/** Panel height in mm from the diagonal and the aspect ratio. */
export function heightMm(inches: number, aspect: MonitorAspect): number {
  const [w, h] = ASPECT_RATIO[aspect];
  return Math.round((inches * 25.4 * h) / Math.sqrt(w * w + h * h));
}

/** Panel width in mm — reported alongside the height so a swap can be sanity-checked. */
export function widthMm(inches: number, aspect: MonitorAspect): number {
  const [w, h] = ASPECT_RATIO[aspect];
  return Math.round((inches * 25.4 * w) / Math.sqrt(w * w + h * h));
}

/**
 * Every model the estate actually holds, keyed by the folded model token.
 *
 * Keys are matched as substrings of a folded text, longest first, so `U2424HE` is found
 * before `U2424H` — the two differ only in whether the screen is the dock, which is the
 * one thing this table exists to get right.
 */
const SPECS: MonitorSpec[] = [
  // ── Dell UltraSharp 24", 1920×1200 (16:10) ──
  { model: 'U2415', inches: 24, aspect: '16:10', dock: false },
  { model: 'U2412M', inches: 24, aspect: '16:10', dock: false },
  { model: 'U2413', inches: 24, aspect: '16:10', dock: false },
  { model: 'U2424H', inches: 24, aspect: '16:10', dock: false },
  { model: 'U2424HE', inches: 24, aspect: '16:10', dock: true },
  { model: 'U2421E', inches: 24, aspect: '16:10', dock: true },
  // Written on the device as `DELL 2424HE`, without the range letter. Sorted after the
  // full key above, so a proper `U2424HE` still matches that one first.
  { model: '2424HE', inches: 24, aspect: '16:10', dock: true },
  // `U2412` on its own: the only 2412 Dell made is the U2412M.
  { model: 'U2412', inches: 24, aspect: '16:10', dock: false },
  // The 2425 generation moved the P series to 16:10 as well — same height as the
  // UltraSharps above, which is why it pairs with them.
  { model: 'P2425E', inches: 24, aspect: '16:10', dock: true },

  // ── 24", 1920×1080 (16:9) — about 2.5 cm shorter than the panels above ──
  { model: 'P2422H', inches: 24, aspect: '16:9', dock: false },
  { model: 'U2419H', inches: 24, aspect: '16:9', dock: false },
  { model: 'P2419H', inches: 24, aspect: '16:9', dock: false },
  { model: 'P2417H', inches: 24, aspect: '16:9', dock: false },
  { model: 'P2412H', inches: 24, aspect: '16:9', dock: false },
  { model: 'U2414H', inches: 24, aspect: '16:9', dock: false },
  { model: 'F24T370', inches: 24, aspect: '16:9', dock: false },
  // Philips' V-line 24" is 1920×1080 throughout — the range has no 16:10 panel — so the
  // catalogue name alone is enough to place it, even where nobody wrote the model.
  { model: '243V7Q', inches: 24, aspect: '16:9', dock: false },
  { model: 'VLINE24', inches: 24, aspect: '16:9', dock: false },

  // ── Other sizes ──
  { model: 'U3425WE', inches: 34, aspect: '21:9', dock: true },
  { model: '27UP550K', inches: 27, aspect: '16:9', dock: false },
  { model: '27US500', inches: 27, aspect: '16:9', dock: false },
  { model: 'U2515', inches: 25, aspect: '16:9', dock: false },
  { model: 'E2318H', inches: 23, aspect: '16:9', dock: false },
  { model: 'P2214H', inches: 22, aspect: '16:9', dock: false },
  { model: 'P2217H', inches: 22, aspect: '16:9', dock: false },
  { model: 'E2221HN', inches: 22, aspect: '16:9', dock: false },
  { model: 'E2220H', inches: 22, aspect: '16:9', dock: false },
  { model: 'U2212', inches: 22, aspect: '16:9', dock: false },
  { model: 'V226HQL', inches: 22, aspect: '16:9', dock: false },
  { model: 'TD2220', inches: 22, aspect: '16:9', dock: false },
  { model: 'P1917', inches: 19, aspect: '5:4', dock: false },
  { model: 'P1913', inches: 19, aspect: '16:10', dock: false },
  { model: '19S4Q', inches: 19, aspect: '5:4', dock: false },
  { model: '19B4L', inches: 19, aspect: '5:4', dock: false },
  { model: 'L1940T', inches: 19, aspect: '5:4', dock: false },
  { model: 'L1965', inches: 19, aspect: '5:4', dock: false },
  { model: 'TF1934', inches: 19, aspect: '5:4', dock: false },
  { model: 'L1804', inches: 18, aspect: '5:4', dock: false },
  { model: 'E1715S', inches: 17, aspect: '5:4', dock: false },
  { model: 'E1912H', inches: 19, aspect: '16:9', dock: false },
  { model: '1708FP', inches: 17, aspect: '5:4', dock: false },
  // The Philips 17S1 family: 17", 1280×1024. The survey notes call these "4:3", which is
  // what an old square screen looks like; the panel is 5:4. Nothing turns on the
  // difference — neither pairs with a 16:10 — but the spec is the spec.
  { model: '17S1', inches: 17, aspect: '5:4', dock: false },
];

/** Longest key first, so a suffix that changes the meaning is never shadowed. */
const BY_KEY = [...SPECS].sort((a, b) => b.model.length - a.model.length);

/** Uppercase alphanumerics only, so `Dell 24 UltraSharp U2421E (USB-C)` matches `U2421E`. */
function fold(text: string): string {
  return text.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * The first known model named by any of the given texts.
 *
 * Several columns can carry it and none reliably does: `model` is filled for the survey's
 * own rows, `catalog_display_name` for the ITSM-managed ones, and where the walkers had no
 * HWA number to write they put the model in the comment — which the import stores as the
 * note, and as the display name of a device that had nothing else to be called. So all of
 * them are searched, in the order of how specific they are.
 */
export function resolveMonitorSpec(...texts: Array<string | null | undefined>): MonitorSpec | null {
  for (const text of texts) {
    if (!text) continue;
    const folded = fold(text);
    if (!folded) continue;
    const hit = BY_KEY.find((s) => folded.includes(fold(s.model)));
    if (hit) return hit;
  }
  return null;
}

/**
 * Two monitors can stand side by side when their panels are the same height. Written as a
 * comparison of size and aspect rather than of the millimetres, because equal heights from
 * different aspect ratios (a 22" 16:10 and a 24" 16:9 are within 3 mm) would still look
 * wrong side by side — the widths differ by 5 cm.
 */
export function pairsWith(a: MonitorSpec, b: MonitorSpec): boolean {
  return a.inches === b.inches && a.aspect === b.aspect;
}

/** How a size/aspect group is written in a report — the grouping key and the label both. */
export function sizeLabel(spec: MonitorSpec): string {
  return `${spec.inches}" ${spec.aspect}`;
}
