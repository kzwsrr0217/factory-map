/**
 * wallPortLabel.ts — Derives a socket's patch panel and port from its label.
 *
 * Sockets are labelled `R<rack>/<port>` — "R1/001", "R3/125" — and the port
 * numbers run **continuously across the rack's panels**: with 24-port panels,
 * 001–024 land on the rack's first panel, 025–048 on the second, and so on. So
 * the label alone says exactly where a socket terminates, and the patching step
 * becomes a confirmation rather than a lookup.
 *
 * Two things this deliberately does not do:
 *
 *   - **Guess the panel order.** Panels are ordered by `u_position` (their
 *     physical top-to-bottom position in the rack), because that is what the
 *     numbering follows. A rack with unpositioned panels is reported as
 *     unresolvable rather than ordered by some arbitrary fallback — an
 *     `u_position` is one field to fill in, a silently mis-derived patch is a
 *     wrong answer to "what goes dark if we replace this switch".
 *   - **Apply anything.** Callers get a suggestion with its reasoning
 *     (`R3/125 → PP-R3-3 port 5`) and show it before writing, so a wrong
 *     assumption about the numbering surfaces on the first rack instead of after
 *     a few hundred sockets.
 */

export interface ParsedWallPortLabel {
  /** Rack name as written in the label, e.g. "R1". */
  rackName: string;
  /** Port number within the rack, e.g. 125. */
  portNumber: number;
}

/**
 * "R1/001" → { rackName: 'R1', portNumber: 1 }. Returns null for anything that
 * isn't `<rack>/<digits>` — hand-made labels are legitimate, they just can't be
 * derived from.
 */
export function parseWallPortLabel(label: string): ParsedWallPortLabel | null {
  const match = /^\s*([A-Za-z0-9-]+)\s*\/\s*(\d+)\s*$/.exec(label ?? '');
  if (!match) return null;
  const portNumber = Number(match[2]);
  // "R1/0" — the numbering is 1-based, so 0 means the label is malformed.
  if (!Number.isInteger(portNumber) || portNumber < 1) return null;
  return { rackName: match[1], portNumber };
}

export interface PanelLike {
  id: string;
  name: string;
  u_position: number | null;
  port_count: number;
}

export interface DerivedPatchTarget {
  panel: PanelLike;
  /** 1-based port on that panel. */
  patch_port: number;
}

/**
 * Which panel and port a rack-wide port number lands on.
 *
 * Panels are consumed in `u_position` order, each taking `port_count` numbers.
 * Returns null when the number is past the rack's last port (the rack has fewer
 * panels than the labels assume — worth reporting, not worth guessing).
 *
 * Throws nothing; a rack with any panel missing a `u_position` returns null for
 * every port, because the order — and therefore every answer — would be a guess.
 */
export function derivePatchTarget(portNumber: number, panels: PanelLike[]): DerivedPatchTarget | null {
  if (panels.length === 0) return null;
  if (panels.some((p) => p.u_position == null)) return null;

  const ordered = [...panels].sort((a, b) => (a.u_position as number) - (b.u_position as number));
  let firstPortOfPanel = 1;
  for (const panel of ordered) {
    const lastPortOfPanel = firstPortOfPanel + panel.port_count - 1;
    if (portNumber <= lastPortOfPanel) {
      return { panel, patch_port: portNumber - firstPortOfPanel + 1 };
    }
    firstPortOfPanel = lastPortOfPanel + 1;
  }
  return null;
}

/** Why a socket could not be derived, in words the UI can show as-is. */
export type DerivationFailure =
  | 'label-not-parseable'
  | 'rack-name-mismatch'
  | 'panel-missing-u-position'
  | 'port-beyond-last-panel';

export interface DerivationResult {
  target: DerivedPatchTarget | null;
  failure: DerivationFailure | null;
}

/**
 * Full derivation for one socket against one rack, with the reason when it
 * fails — the reasons are the whole point, since each names a specific thing
 * someone can go and fix.
 */
export function derivePatchForLabel(label: string, rackName: string, panels: PanelLike[]): DerivationResult {
  const parsed = parseWallPortLabel(label);
  if (!parsed) return { target: null, failure: 'label-not-parseable' };
  if (parsed.rackName.toLowerCase() !== rackName.trim().toLowerCase()) {
    return { target: null, failure: 'rack-name-mismatch' };
  }
  if (panels.some((p) => p.u_position == null)) {
    return { target: null, failure: 'panel-missing-u-position' };
  }
  const target = derivePatchTarget(parsed.portNumber, panels);
  return target ? { target, failure: null } : { target: null, failure: 'port-beyond-last-panel' };
}
