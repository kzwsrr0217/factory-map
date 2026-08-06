/**
 * monitor-specs.test.ts — What a monitor model is, and what may stand beside it.
 *
 * Pure lookups over strings, no database. The cases are the ones the real inventory
 * contains, because the two ways this table can be wrong are both invisible in a count:
 * a dock read as a plain monitor, and a suffix shadowed by a shorter key.
 */
import {
  heightMm,
  pairsWith,
  resolveMonitorSpec,
  sizeLabel,
  widthMm,
} from '../services/inventory/monitorSpecs';

describe('monitorSpecs — reading a model out of the text there is', () => {
  it('finds the model inside the ITSM catalogue name', () => {
    const spec = resolveMonitorSpec('Dell 24 UltraSharp Monitor U2421E (USB-C)');
    expect(spec?.model).toBe('U2421E');
    expect(spec?.dock).toBe(true);
  });

  it('finds it in the survey comment, where the walkers put it when there was no HWA', () => {
    expect(resolveMonitorSpec('HWA34704 PHILIPS 243V7QJABF/00')?.aspect).toBe('16:9');
  });

  it('searches the given texts in order and returns the first hit', () => {
    // The catalogue name is the specific one here; the display name is just "Monitor".
    const spec = resolveMonitorSpec('Monitor', 'Dell 24 UltraSharp Monitor U2415');
    expect(spec?.model).toBe('U2415');
  });

  it('ignores case, spacing and punctuation', () => {
    expect(resolveMonitorSpec('dell  u2412-mb')?.model).toBe('U2412M');
  });

  it('returns null rather than guessing', () => {
    expect(resolveMonitorSpec('Monitor')).toBeNull();
    expect(resolveMonitorSpec('Fujitsu LCD Display B24-8T')).toBeNull();
    expect(resolveMonitorSpec('')).toBeNull();
    expect(resolveMonitorSpec(null, undefined)).toBeNull();
  });
});

describe('monitorSpecs — the suffix that decides whether the screen IS the dock', () => {
  it('does not let U2424H shadow U2424HE', () => {
    expect(resolveMonitorSpec('DELL UltraSharp U2424HE')?.dock).toBe(true);
    expect(resolveMonitorSpec('DELL U2424H')?.dock).toBe(false);
  });

  it('reads a dock written without its range letter', () => {
    // "DELL 2424HE" as somebody typed it off the bezel.
    const spec = resolveMonitorSpec('DELL 2424HE');
    expect(spec?.dock).toBe(true);
    expect(sizeLabel(spec!)).toBe('24" 16:10');
  });

  it('knows the 2425 generation of the P series is 16:10 and docks', () => {
    const spec = resolveMonitorSpec('Dell P2425E');
    expect(spec).toMatchObject({ inches: 24, aspect: '16:10', dock: true });
  });

  it('knows the 2422 generation of the P series is 16:9 and does not', () => {
    const spec = resolveMonitorSpec('Dell P2422H');
    expect(spec).toMatchObject({ inches: 24, aspect: '16:9', dock: false });
  });
});

describe('monitorSpecs — panel geometry', () => {
  it('makes a 24" 16:10 about 2.5 cm taller than a 24" 16:9', () => {
    const tall = heightMm(24, '16:10');
    const short = heightMm(24, '16:9');
    expect(tall - short).toBeGreaterThanOrEqual(20);
    expect(tall - short).toBeLessThanOrEqual(30);
  });

  it('makes the 16:9 the wider of the two', () => {
    expect(widthMm(24, '16:9')).toBeGreaterThan(widthMm(24, '16:10'));
  });
});

describe('monitorSpecs — what may stand beside what', () => {
  const u2421e = resolveMonitorSpec('U2421E')!;
  const u2415 = resolveMonitorSpec('U2415')!;
  const p2422h = resolveMonitorSpec('P2422H')!;

  it('pairs a docking 16:10 with a plain 16:10 of the same size', () => {
    expect(pairsWith(u2421e, u2415)).toBe(true);
  });

  it('refuses a 16:9 beside a 16:10', () => {
    expect(pairsWith(u2421e, p2422h)).toBe(false);
  });

  it('refuses equal heights that come from different aspect ratios', () => {
    // A 22" 16:10 and a 24" 16:9 are within a few mm in height and 5 cm apart in width.
    const twentyTwoWide = { model: 'test', inches: 22, aspect: '16:10' as const, dock: false };
    const twentyFourNine = { model: 'test', inches: 24, aspect: '16:9' as const, dock: false };
    expect(Math.abs(heightMm(22, '16:10') - heightMm(24, '16:9'))).toBeLessThan(5);
    expect(pairsWith(twentyTwoWide, twentyFourNine)).toBe(false);
  });
});
