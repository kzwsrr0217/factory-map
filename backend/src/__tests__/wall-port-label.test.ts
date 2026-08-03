/**
 * Unit tests for the socket-label derivation (no DB, no HTTP).
 *
 * The arithmetic here decides where hundreds of sockets get patched, and a
 * silent off-by-one would be invisible until someone traced a cable by hand — so
 * the boundaries between panels are tested explicitly.
 */
import {
  parseWallPortLabel,
  derivePatchTarget,
  derivePatchForLabel,
  PanelLike,
} from '../utils/wallPortLabel';

const panels: PanelLike[] = [
  { id: 'p1', name: 'PP-R3-1', u_position: 1, port_count: 24 },
  { id: 'p2', name: 'PP-R3-2', u_position: 3, port_count: 24 },
  { id: 'p3', name: 'PP-R3-3', u_position: 5, port_count: 48 },
];

describe('parseWallPortLabel', () => {
  it('parses the standard form', () => {
    expect(parseWallPortLabel('R1/001')).toEqual({ rackName: 'R1', portNumber: 1 });
    expect(parseWallPortLabel('R3/125')).toEqual({ rackName: 'R3', portNumber: 125 });
  });

  it('tolerates surrounding and inner whitespace', () => {
    expect(parseWallPortLabel('  R1 / 007 ')).toEqual({ rackName: 'R1', portNumber: 7 });
  });

  it('rejects labels it cannot derive from rather than guessing', () => {
    expect(parseWallPortLabel('WP-F1-A01')).toBeNull();
    expect(parseWallPortLabel('R1/')).toBeNull();
    expect(parseWallPortLabel('R1/abc')).toBeNull();
    expect(parseWallPortLabel('R1/000')).toBeNull(); // numbering is 1-based
    expect(parseWallPortLabel('')).toBeNull();
  });
});

describe('derivePatchTarget', () => {
  it('maps the first port of the rack to the first port of the first panel', () => {
    expect(derivePatchTarget(1, panels)).toEqual({ panel: panels[0], patch_port: 1 });
  });

  it('maps the last port of a panel without spilling over', () => {
    expect(derivePatchTarget(24, panels)).toEqual({ panel: panels[0], patch_port: 24 });
  });

  it('rolls the next number onto the next panel', () => {
    expect(derivePatchTarget(25, panels)).toEqual({ panel: panels[1], patch_port: 1 });
    expect(derivePatchTarget(48, panels)).toEqual({ panel: panels[1], patch_port: 24 });
    expect(derivePatchTarget(49, panels)).toEqual({ panel: panels[2], patch_port: 1 });
  });

  it('handles a panel with a different port count', () => {
    // 24 + 24 = 48 consumed, so R3/125 is port 125-48 = 77 of the 48-port panel…
    expect(derivePatchTarget(96, panels)).toEqual({ panel: panels[2], patch_port: 48 });
    // …which is past its end.
    expect(derivePatchTarget(125, panels)).toBeNull();
  });

  it('orders panels by u_position, not by array order', () => {
    const shuffled = [panels[2], panels[0], panels[1]];
    expect(derivePatchTarget(25, shuffled)).toEqual({ panel: panels[1], patch_port: 1 });
  });

  it('refuses to derive when any panel has no u_position', () => {
    const unpositioned = [...panels, { id: 'p4', name: 'PP-R3-4', u_position: null, port_count: 24 }];
    expect(derivePatchTarget(1, unpositioned)).toBeNull();
  });

  it('returns null for a rack with no panels', () => {
    expect(derivePatchTarget(1, [])).toBeNull();
  });
});

describe('derivePatchForLabel', () => {
  it('names the specific reason it could not derive', () => {
    expect(derivePatchForLabel('WP-A1', 'R3', panels).failure).toBe('label-not-parseable');
    expect(derivePatchForLabel('R1/001', 'R3', panels).failure).toBe('rack-name-mismatch');
    expect(derivePatchForLabel('R3/999', 'R3', panels).failure).toBe('port-beyond-last-panel');
    expect(
      derivePatchForLabel('R3/001', 'R3', [{ id: 'x', name: 'PP', u_position: null, port_count: 24 }]).failure,
    ).toBe('panel-missing-u-position');
  });

  it('matches the rack name case-insensitively', () => {
    expect(derivePatchForLabel('r3/025', 'R3', panels).target).toEqual({ panel: panels[1], patch_port: 1 });
  });

  it('derives a real example end to end', () => {
    const result = derivePatchForLabel('R3/049', 'R3', panels);
    expect(result.failure).toBeNull();
    expect(result.target).toEqual({ panel: panels[2], patch_port: 1 });
  });
});
