/**
 * asset-evidence.test.ts — the rule that decides whether the sources disagree.
 *
 * Every case here is a false alarm this rule actually produced. The first version of the evidence
 * panel flagged three disagreements on the very first real device tried, and all three were
 * artefacts of comparing things that should not be compared:
 *
 *   - Nexthink's `desktop` against the app's `workstation` — different vocabularies
 *   - ITSM's `Deployed` against the app's `active` — the same fact in two vocabularies
 *   - ITSM's site-level `MMH Veszprém` against a room name
 *
 * A panel that cries wolf on a thousand devices is worse than no panel, so the rule that suppresses
 * these is worth pinning down harder than the code that renders them.
 */
import { disagrees } from '../services/evidence/assetEvidence';

const has = (value: string | null) => ({ value, has_opinion: true });
const none = { value: null, has_opinion: false };
const shown = (value: string | null) => ({ value, has_opinion: true, comparable: false });

describe('disagrees', () => {
  it('flags two sources that state different values', () => {
    expect(disagrees([has('Molnár, Sándor'), has('Asbóth, Kinga')])).toBe(true);
  });

  it('does not flag agreement', () => {
    expect(disagrees([has('DELL'), has('DELL'), none])).toBe(false);
  });

  it('ignores a source that cannot know the field', () => {
    // Nexthink has no opinion on who a device is assigned to. Counting that as a blank answer
    // would make every assigned device look contradicted.
    expect(disagrees([has('Kuti, Tivadar'), none, none])).toBe(false);
  });

  it('ignores an empty value rather than treating it as a distinct answer', () => {
    // "ITSM has nobody assigned" is a gap, not a contradiction of the survey having found somebody.
    expect(disagrees([has('Kuti, Tivadar'), has(null)])).toBe(false);
  });

  it('ignores a value that is shown but not comparable', () => {
    // The regression this flag exists for: Nexthink's hardware.type is desktop/laptop/virtual and
    // has no workstation or monitor bucket, so a difference carries no meaning.
    expect(disagrees([has('workstation'), has('workstation'), shown('desktop')])).toBe(false);
  });

  it('does not flag when the only stated values are all uncomparable', () => {
    // The place row: ITSM's site and a Nexthink entity are both shown, neither is a room.
    expect(disagrees([has(null), shown('MMH Veszprém'), shown('Veszprem-Client')])).toBe(false);
  });

  it('folds accents and case, so spelling is never a disagreement', () => {
    expect(disagrees([has('Palotas, Monika'), has('Palotás, Mónika')])).toBe(false);
    expect(disagrees([has('DELL'), has('Dell')])).toBe(false);
  });

  it('folds whitespace but still separates different names', () => {
    expect(disagrees([has('Optiplex  7090'), has('Optiplex 7090')])).toBe(false);
    expect(disagrees([has('Optiplex 7090'), has('Optiplex 7060')])).toBe(true);
  });

  it('says nothing about a single source', () => {
    // One opinion cannot contradict itself, however odd the value looks.
    expect(disagrees([has('IPC')])).toBe(false);
  });
});
