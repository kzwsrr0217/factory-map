/**
 * inventory-match.test.ts — The rules behind matching a surveyed device to ITSM.
 *
 * Pure functions over plain objects, no database: these are decision rules, and they
 * are worth being able to read as a list of cases.
 *
 * The cases that matter are the ones taken from the real export rather than imagined:
 * a Dell PPID shared by every unit of a model, a dock's MAC appearing on the laptop
 * docked in it, and hand-typed placeholder serials. A matcher that trusts "the serial
 * is equal" links the wrong machines on exactly this data.
 */
import {
  buildSnapshotIndex,
  matchRecord,
  isUsableMac,
  macKey,
  SnapshotCandidateRow,
} from '../services/itsm/inventoryMatch';

function row(over: Partial<SnapshotCandidateRow> & { itsm_id: string }): SnapshotCandidateRow {
  return { display_name: over.itsm_id, ...over };
}

describe('inventoryMatch — MAC keys', () => {
  it('compares equal across separator styles', () => {
    expect(macKey('18:03:73:DE:BE:1D')).toBe(macKey('18-03-73-de-be-1d'));
    expect(macKey('18:03:73:DE:BE:1D')).toBe(macKey('180373DEBE1D'));
  });

  it('rejects a partial address', () => {
    // The real data holds 11-hex-digit values (an O typed for a zero). Half a MAC is
    // not a key; treating it as one would match on a prefix.
    expect(isUsableMac('10:65:30:0D:0E:CO')).toBe(false);
    expect(isUsableMac('18:03:73:DE:BE:1D')).toBe(true);
  });
});

describe('inventoryMatch — verdicts', () => {
  it('is confident when a unique serial is corroborated', () => {
    const index = buildSnapshotIndex([
      row({ itsm_id: 'HWA1', serial_number: '6WXSRM3', model: 'OptiPlex 7020', manufacturer: 'DELL' }),
      row({ itsm_id: 'HWA2', serial_number: 'JCPQLM2', model: 'Latitude 5490' }),
    ]);
    const result = matchRecord(
      { serial_number: '6wxsrm3', model: 'OptiPlex 7020', manufacturer: 'Dell' },
      index,
    );
    expect(result.verdict).toBe('confident');
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].row.itsm_id).toBe('HWA1');
    expect(result.reason).toMatch(/serial/);
  });

  it('demotes a serial that several ITSM rows share', () => {
    // The Dell PPID case: the "serial" is on every unit of the model, so it identifies
    // a model. This is the difference between this matcher and a join.
    const ppid = 'CN-05FDDV-74261-44L-59WS';
    const index = buildSnapshotIndex([
      row({ itsm_id: 'HWA10', serial_number: ppid, model: 'WD19S' }),
      row({ itsm_id: 'HWA11', serial_number: ppid, model: 'WD19S' }),
      row({ itsm_id: 'HWA12', serial_number: ppid, model: 'WD19S' }),
    ]);
    const result = matchRecord({ serial_number: ppid, model: 'WD19S' }, index);
    expect(result.verdict).toBe('ambiguous');
    expect(result.reason).toMatch(/not unique in ITSM/);
    expect(result.reason).toMatch(/model or a shared component/);
    expect(result.candidates).toHaveLength(3);
  });

  it('demotes a MAC that a dock and its laptop share', () => {
    const mac = 'D8:D0:90:15:40:53';
    const index = buildSnapshotIndex([
      row({ itsm_id: 'HWA20', mac_address: mac, model: 'WD15' }),
      row({ itsm_id: 'HWA21', mac_address: mac, model: 'Precision 7530' }),
    ]);
    const result = matchRecord({ mac_address: 'd8d090154053' }, index);
    expect(result.verdict).toBe('ambiguous');
    expect(result.reason).toMatch(/MAC on 2 ITSM rows/);
  });

  it('ignores a placeholder serial rather than matching on it', () => {
    // "..." appears in the real survey data. Matching on it would link every device
    // whose surveyor skipped the field.
    const index = buildSnapshotIndex([row({ itsm_id: 'HWA30', serial_number: '...' })]);
    const result = matchRecord({ serial_number: '...' }, index);
    expect(result.verdict).toBe('no-evidence');
    expect(result.reason).toMatch(/nothing recorded to match on/);
  });

  it('calls a lone strong key ambiguous when there is nothing to corroborate it', () => {
    // A serial and nothing else on either side: no agreement, but no disagreement
    // either. Not enough to link on, and the reason has to say which of the two it is.
    const index = buildSnapshotIndex([row({ itsm_id: 'HWA40', serial_number: 'ABC12345' })]);
    const result = matchRecord({ serial_number: 'abc12345' }, index);
    expect(result.verdict).toBe('ambiguous');
    expect(result.reason).toMatch(/nothing else agrees/);
    expect(result.candidates[0].conflicts).toEqual([]);
  });

  it('refuses a strong key when a filled field contradicts it', () => {
    // The mistyped-serial case: one field agrees, another says it is a different kind
    // of device altogether. That must reach a person, not a link.
    const index = buildSnapshotIndex([
      row({ itsm_id: 'HWA45', serial_number: 'ZZZ99999', asset_type: 'monitor', catalog_name: 'Dell U2413' }),
    ]);
    const result = matchRecord(
      { serial_number: 'zzz99999', asset_type: 'laptop', catalog_name: 'Latitude 5490' },
      index,
    );
    expect(result.verdict).toBe('ambiguous');
    expect(result.reason).toMatch(/disagree/);
    expect(result.candidates[0].conflicts.join(' ')).toMatch(/type/);
  });

  it('corroborates on the model wherever each side keeps it', () => {
    // The export leaves `model` empty on every row and puts the model in
    // catalog_item_name, so a matcher reading only `model` would find no corroboration
    // at all on real data.
    const index = buildSnapshotIndex([
      row({ itsm_id: 'HWA46', serial_number: 'MDL55555', model: null, catalog_name: 'Dell U2413' }),
    ]);
    const result = matchRecord({ serial_number: 'mdl55555', catalog_name: 'Dell U2413' }, index);
    expect(result.verdict).toBe('confident');
    expect(result.reason).toMatch(/model/);
  });

  it('says nothing about a field only one side has filled', () => {
    // Most snapshot rows have no person; treating a blank as disagreement would make
    // almost every match ambiguous.
    const index = buildSnapshotIndex([
      row({ itsm_id: 'HWA47', serial_number: 'BLK00001', asset_type: 'laptop', person_name: null }),
    ]);
    const result = matchRecord(
      { serial_number: 'blk00001', asset_type: 'laptop', person_name: 'Kovacs Bela' },
      index,
    );
    expect(result.verdict).toBe('confident');
    expect(result.candidates[0].conflicts).toEqual([]);
  });

  it('never turns a shared model into a candidate on its own', () => {
    // Half the estate is a Latitude 5490. If model alone introduced candidates, every
    // unlabelled laptop would "match" hundreds of records.
    const index = buildSnapshotIndex([
      row({ itsm_id: 'HWA50', catalog_name: 'Latitude 5490', person_name: 'Kovacs Bela' }),
      row({ itsm_id: 'HWA51', catalog_name: 'Latitude 5490', person_name: 'Szabo Anna' }),
    ]);
    const result = matchRecord({ catalog_name: 'Latitude 5490', person_name: 'Kovacs Bela' }, index);
    expect(result.verdict).toBe('no-evidence');
    expect(result.candidates).toHaveLength(0);
  });

  it('treats a matching name as corroboration, not identity', () => {
    const index = buildSnapshotIndex([row({ itsm_id: 'HWA60', display_name: 'MMH-PC-42' })]);
    const result = matchRecord({ display_name: 'mmh-pc-42' }, index);
    expect(result.verdict).toBe('weak-only');
    expect(result.reason).toMatch(/not an identity/);
  });

  it('matches "Surname, Forename" from the export against the survey spelling', () => {
    // The real export writes "Móder, Hajnalka"; the surveyor writes "moder hajnalka".
    // Comparing those as strings made the same person look like a conflict, which then
    // blocked the confident verdict — found on real data, not in review.
    const index = buildSnapshotIndex([
      row({ itsm_id: 'HWA75', serial_number: 'R58T4006YRK', asset_type: 'phone', person_name: 'Móder, Hajnalka' }),
    ]);
    const result = matchRecord(
      { serial_number: 'r58t4006yrk', asset_type: 'phone', person_name: 'moder hajnalka' },
      index,
    );
    expect(result.verdict).toBe('confident');
    expect(result.candidates[0].conflicts).toEqual([]);
    expect(result.reason).toMatch(/person/);
  });

  it('still calls two different people a conflict', () => {
    const index = buildSnapshotIndex([
      row({ itsm_id: 'HWA76', serial_number: 'DIF00001', person_name: 'Szabó, Anna' }),
    ]);
    const result = matchRecord({ serial_number: 'dif00001', person_name: 'Kovacs Bela' }, index);
    expect(result.verdict).toBe('ambiguous');
    expect(result.candidates[0].conflicts.join(' ')).toMatch(/person/);
  });

  it('matches an informal person name across diacritics and spacing', () => {
    // The survey's names are typed without accents; refusing them would lose the one
    // corroborating field most devices have.
    const index = buildSnapshotIndex([
      row({ itsm_id: 'HWA70', serial_number: 'SN0099X', person_name: 'Görög  Tamás' }),
    ]);
    const result = matchRecord({ serial_number: 'sn0099x', person_name: 'gorog tamas' }, index);
    expect(result.verdict).toBe('confident');
    expect(result.reason).toMatch(/person/);
  });

  it('separates "absent from ITSM" from "cannot be checked"', () => {
    const index = buildSnapshotIndex([row({ itsm_id: 'HWA80', serial_number: 'KNOWN123' })]);

    const hasKey = matchRecord({ serial_number: 'UNSEEN456' }, index);
    expect(hasKey.verdict).toBe('no-evidence');
    expect(hasKey.reason).toMatch(/genuinely absent from ITSM/);

    // No key at all is a different situation with a different task: registering it
    // might duplicate hardware ITSM already holds, and nobody can tell.
    const noKey = matchRecord({ model: 'Some Monitor' }, index);
    expect(noKey.verdict).toBe('no-evidence');
    expect(noKey.reason).toMatch(/risks a duplicate/);
  });

  it('reports several matching records rather than choosing one', () => {
    const index = buildSnapshotIndex([
      row({ itsm_id: 'HWA90', serial_number: 'AAA11111', model: 'X1' }),
      row({ itsm_id: 'HWA91', asset_tag: 'TAG-777', model: 'X1' }),
    ]);
    const result = matchRecord(
      { serial_number: 'aaa11111', asset_tag: 'tag-777', model: 'X1' },
      index,
    );
    expect(result.verdict).toBe('ambiguous');
    expect(result.reason).toMatch(/2 ITSM records match/);
  });
});
