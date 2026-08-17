/**
 * nexthink-evidence.test.ts — the judgements the Nexthink snapshot makes, without a database.
 *
 * Every case here is a row that exists in the real export, or a mistake that was actually made
 * while writing this. It is not coverage for its own sake: the swap `fate` decision shipped wrong
 * and was caught by a person reading the output and noticing "871 days" was absurd. That is not a
 * control that scales, and it is the reason `decideFate` is a pure function at all.
 */
import { classifyAccount, parseNexthinkDate } from '../services/nexthink/snapshotImport';
import {
  decideVerdict,
  decideFate,
  isRecycledReplacement,
  SharedAccount,
} from '../services/nexthink/swapEvidence';
import { comparePerson, sameName } from '../services/nexthink/personEvidence';
import { NexthinkAccountKind } from '../entities/NexthinkLoginSnapshot.entity';

/** A named person, with only the fields the decisions read. */
function person(userName: string, oldLogins = 5, newLogins = 5): SharedAccount {
  return {
    user_name: userName,
    full_name: 'Teszt, Elek',
    old_logins: oldLogins,
    new_logins: newLogins,
    devices_sharing: 0,
  };
}

describe('classifyAccount — half the logon rows are not people', () => {
  it('reads a named person as a person', () => {
    expect(classifyAccount('HWA24144', 'MMHTIKU@MAXON_IES', 'Kuti, Tivadar')).toBe('person');
  });

  it('separates a person with no AD name rather than guessing one', () => {
    // 73 of 671 real rows. They follow the same MMH+initials shape as the named accounts and
    // are near-certainly people — but the name is missing, and inventing it would be worse.
    expect(classifyAccount('HWA24144', 'MMHXXYY@MAXON_IES', null)).toBe('person_unnamed');
    expect(classifyAccount('HWA24144', 'MMHXXYY@MAXON_IES', '   ')).toBe('person_unnamed');
  });

  it('catches the local account before the machine rule can claim it', () => {
    // `win11local@HWA32005` starts with neither the device name nor "admin", but it WOULD match
    // the machine test if the device happened to be HWA32005 and that test ran first. Order in
    // classifyAccount is load-bearing, so it is pinned here.
    expect(classifyAccount('HWA32005', 'win11local@HWA32005', null)).toBe('local');
  });

  it('reads the machine own account', () => {
    expect(classifyAccount('HWA35858', 'HWA35858@MAXON_IES', null)).toBe('machine');
    // Case varies in the export; matching must fold it or the row lands in person_unnamed.
    expect(classifyAccount('hwa35858', 'HWA35858@MAXON_IES', null)).toBe('machine');
  });

  it('catches an admin account before the person fallback', () => {
    // Real shape: an admin account that also carries a full name would otherwise be counted as
    // evidence of who sits at a desk.
    expect(classifyAccount('HWA24144', 'mmhbabaAdmin@MAXON_IES', 'Baba, Bela')).toBe('admin');
  });

  it('reads the shared shop-floor accounts as generic', () => {
    expect(classifyAccount('HWA25204', 'MMHGEN0004@MAXON_IES', null)).toBe('generic');
    expect(classifyAccount('HWA25204', 'MMH_SHOP_FLOOR_WB2@MAXON_IES', null)).toBe('generic');
    expect(classifyAccount('HWA25204', 'IPC@MAXON_IES', null)).toBe('generic');
  });
});

describe('parseNexthinkDate — a bad date must not become the oldest device in the estate', () => {
  it('reads the export format', () => {
    const d = parseNexthinkDate('2026-08-14 12:16:03');
    expect(d).not.toBeNull();
    expect(d!.getFullYear()).toBe(2026);
    expect(d!.getMonth()).toBe(7); // August, zero-based
    expect(d!.getDate()).toBe(14);
    expect(d!.getHours()).toBe(12);
  });

  it('accepts the ISO separator too, since the API may send it', () => {
    expect(parseNexthinkDate('2026-08-14T12:16:03')).not.toBeNull();
  });

  it('returns null rather than 1970 for anything unreadable', () => {
    // The failure that matters: epoch-zero would make the device look quiet for 56 years and put
    // it straight at the top of every decommission list.
    for (const bad of ['', '   ', 'never', '14/08/2026', '2026-08', undefined]) {
      expect(parseNexthinkDate(bad as string | undefined)).toBeNull();
    }
  });
});

describe('decideVerdict — what the logon overlap is allowed to conclude', () => {
  const none: SharedAccount[] = [];

  it('confirms on a shared named person', () => {
    // HWA24830 -> HWA38235: Meszaros, Zsolt on both, 16 and 4 logons.
    expect(decideVerdict({
      sharedPeople: [person('MMHZSME@MAXON_IES', 16, 4)],
      sharedGeneric: none,
      oldOnlyPeople: none,
      newOnlyPeople: none,
    })).toBe('confirmed');
  });

  it('calls it weak when only a generic account is shared', () => {
    // HWA17098 -> HWA23957: only MMHGEN0004 on both. A shared account is not identification.
    expect(decideVerdict({
      sharedPeople: none,
      sharedGeneric: [person('MMHGEN0004@MAXON_IES', 14, 2)],
      oldOnlyPeople: none,
      newOnlyPeople: none,
    })).toBe('weak_evidence');
  });

  it('only contradicts when BOTH sides have named people to compare', () => {
    expect(decideVerdict({
      sharedPeople: none,
      sharedGeneric: none,
      oldOnlyPeople: [person('MMHAAA@MAXON_IES')],
      newOnlyPeople: [person('MMHBBB@MAXON_IES')],
    })).toBe('contradicted');
  });

  it('does not contradict when one side simply has no named logons', () => {
    // The shop-floor case, and the reason this is not a majority vote: an IPC with no named
    // logons must not land on a list of swaps to go and re-check. Ignorance is not disagreement.
    expect(decideVerdict({
      sharedPeople: none,
      sharedGeneric: none,
      oldOnlyPeople: [person('MMHAAA@MAXON_IES')],
      newOnlyPeople: none,
    })).toBe('no_evidence');
  });

  it('prefers the named overlap over a contradiction elsewhere', () => {
    // A machine can have one shared person and other people on each side — HWA24144 had two
    // shared and more besides. The shared person still settles it.
    expect(decideVerdict({
      sharedPeople: [person('MMHTIKU@MAXON_IES', 26, 3)],
      sharedGeneric: none,
      oldOnlyPeople: [person('MMHAAA@MAXON_IES')],
      newOnlyPeople: [person('MMHBBB@MAXON_IES')],
    })).toBe('confirmed');
  });
});

describe('decideFate — the reinstall-or-set-aside question, and the bug it shipped with', () => {
  const freshest = new Date(2026, 7, 14, 12, 0, 0); // the export's newest sighting

  it('calls a machine seen at the end of the window still in service', () => {
    // All four dictated swaps looked like this: the old machine reported yesterday. Either it was
    // reinstalled and reused, or the swap has not physically happened — indistinguishable here,
    // and the report must say so rather than pick.
    const r = decideFate({
      oldDevicePresent: true,
      oldLastSeen: new Date(2026, 7, 13, 9, 0, 0),
      freshest,
    });
    expect(r.fate).toBe('still_active');
    expect(r.quietDays).toBe(1);
  });

  /**
   * The regression this whole describe block exists for: the first version compared the old
   * machine's last sighting against the REPLACEMENT's first_seen and reported "still reporting
   * 871 days after the swap" for HWA17098 -> HWA23957, because HWA23957 is a recycled machine
   * first seen in March 2024. There is no test for that here, deliberately — `decideFate` has no
   * parameter the replacement's dates could enter through, and TypeScript enforces that at
   * compile time. A runtime assertion about a signature would only be theatre.
   *
   * What IS worth pinning is the boundary, because it is the one number a reader would tune.
   */
  it('puts the active/quiet boundary exactly at ACTIVE_DAYS', () => {
    const atBoundary = decideFate({
      oldDevicePresent: true,
      oldLastSeen: new Date(2026, 7, 7, 12, 0, 0), // 7 days before freshest
      freshest,
    });
    expect(atBoundary.quietDays).toBe(7);
    expect(atBoundary.fate).toBe('still_active');

    const justPast = decideFate({
      oldDevicePresent: true,
      oldLastSeen: new Date(2026, 7, 6, 12, 0, 0), // 8 days
      freshest,
    });
    expect(justPast.quietDays).toBe(8);
    expect(justPast.fate).toBe('quiet');
  });

  it('calls a machine quiet past the active window quiet', () => {
    const r = decideFate({
      oldDevicePresent: true,
      oldLastSeen: new Date(2026, 6, 1, 9, 0, 0),
      freshest,
    });
    expect(r.fate).toBe('quiet');
    expect(r.quietDays).toBeGreaterThan(30);
  });

  it('treats absence from the export as the strongest set-aside signal', () => {
    // Nexthink ages inactive devices out entirely, so a decommissioned machine does not appear
    // with a stale last_seen — it disappears. Absence is the signal, not an old timestamp.
    expect(decideFate({ oldDevicePresent: false, oldLastSeen: null, freshest }).fate)
      .toBe('gone_from_nexthink');
  });

  it('says undeterminable rather than guessing when a date is missing', () => {
    expect(decideFate({ oldDevicePresent: true, oldLastSeen: null, freshest }).fate)
      .toBe('undeterminable');
    expect(decideFate({ oldDevicePresent: true, oldLastSeen: freshest, freshest: null }).fate)
      .toBe('undeterminable');
  });
});

describe('isRecycledReplacement — whose first_seen is a handover date', () => {
  const freshest = new Date(2026, 7, 14, 12, 0, 0);

  it('reads a brand-new machine first seen ten days ago as new', () => {
    // HWA38235, first reported 2026-08-04. That IS the handover.
    expect(isRecycledReplacement(new Date(2026, 7, 4), freshest)).toBe(false);
  });

  it('reads a machine first seen two years ago as recycled', () => {
    // HWA23957, first reported 2024-03-25. Reusing an older machine is the normal path here,
    // so this is the common case, not the exception.
    expect(isRecycledReplacement(new Date(2024, 2, 25), freshest)).toBe(true);
  });

  it('claims nothing when either date is missing', () => {
    expect(isRecycledReplacement(null, freshest)).toBe(false);
    expect(isRecycledReplacement(freshest, null)).toBe(false);
  });
});

describe('sameName — a disagreement must not be a spelling difference', () => {
  it('ignores accents, because the export drops them and ITSM does not', () => {
    // Real pair: the logon export writes "Palotas, Monika", ITSM writes "Palotás, Mónika".
    expect(sameName('Palotas, Monika', 'Palotás, Mónika')).toBe(true);
  });

  it('ignores case, because the export is inconsistent about it', () => {
    // "vasarhelyi, Zsuzsanna" and "MMHATKO" both occur in the same real file.
    expect(sameName('vasarhelyi, Zsuzsanna', 'Vásárhelyi, Zsuzsanna')).toBe(true);
  });

  it('ignores spacing around the comma', () => {
    expect(sameName('Kuti,Tivadar', 'Kuti, Tivadar')).toBe(true);
    expect(sameName('Kuti ,  Tivadar', 'Kuti, Tivadar')).toBe(true);
  });

  it('still tells different people apart', () => {
    expect(sameName('Szabó, István', 'Asbóth, Kinga')).toBe(false);
  });

  it('treats an empty name as matching nothing, including another empty one', () => {
    // Two blanks are not an agreement. Returning true here would report every unassigned
    // machine as confirmed by the logon record.
    expect(sameName(null, null)).toBe(false);
    expect(sameName('', '')).toBe(false);
    expect(sameName('   ', 'Kuti, Tivadar')).toBe(false);
  });
});

describe('comparePerson — what the logon record is allowed to say about a desk', () => {
  const row = (
    fullName: string | null,
    logins: number,
    kind: NexthinkAccountKind = 'person',
  ) => ({ full_name: fullName, user_name: 'MMHTEST@MAXON_IES', logins, account_kind: kind });

  it('agrees when the map names the same person', () => {
    const r = comparePerson([row('Kuti, Tivadar', 26)], 'Kuti, Tivadar');
    expect(r.comparison).toBe('agree');
  });

  it('reports a disagreement when both name somebody and they differ', () => {
    // Real: HWA16758, the map says Molnár, Sándor and the logons say Asbóth, Kinga (21 vs 9).
    const r = comparePerson([row('Asbóth, Kinga', 21), row('Nagy, Hajnalka', 9)], 'Molnár, Sándor');
    expect(r.comparison).toBe('disagree');
    expect(r.top!.runner_up!.logins).toBe(9);
  });

  it('offers to fill an empty field rather than calling it a disagreement', () => {
    expect(comparePerson([row('Kuti, Tivadar', 26)], null).comparison).toBe('map_has_nobody');
    expect(comparePerson([row('Kuti, Tivadar', 26)], '  ').comparison).toBe('map_has_nobody');
  });

  it('refuses to decide a shared machine', () => {
    // 26 vs 21 is the real HWA24144 pair. A tool that named one of them would be inventing a
    // fact, and that person would be the one asked to explain it.
    expect(comparePerson([row('Kuti, Tivadar', 26), row('Szilágyi, Gábor', 21)], 'Kuti, Tivadar')
      .comparison).toBe('shared');
    // 4 vs 3 is noise at a different scale, and must land in the same place.
    expect(comparePerson([row('A, A', 4), row('B, B', 3)], 'A, A').comparison).toBe('shared');
  });

  it('does not treat a clear majority as shared', () => {
    // 17 vs 2 — a real pair, and a genuine single owner.
    expect(comparePerson([row('Séra-Varga, Eszter', 17), row('Turner, Eszter', 2)], 'X, Y')
      .comparison).toBe('disagree');
  });

  it('says nothing on a single logon, which is what a support visit looks like', () => {
    const r = comparePerson([row('Support, Person', 1)], 'Owner, Real');
    expect(r.comparison).toBe('too_little_evidence');
    // The name is still returned, so a reader can see what was disregarded and why.
    expect(r.top!.full_name).toBe('Support, Person');
  });

  it('ignores an admin account even when it carries an AD display name', () => {
    /**
     * The regression the filter was moved for. `mmhbabaAdmin` resolves to a real display name, so
     * a full_name-only filter would let it through and reassign the machine to whoever
     * administered it. Only account_kind decides.
     */
    const r = comparePerson([row('Baba, Bela', 40, 'admin')], 'Owner, Real');
    expect(r.comparison).toBe('too_little_evidence');
    expect(r.top).toBeNull();
  });

  it('counts a generic-only machine as no evidence rather than dropping it', () => {
    // Most of the shop floor. It must stay in the denominator.
    const r = comparePerson([row(null, 30, 'generic'), row(null, 12, 'machine')], null);
    expect(r.comparison).toBe('too_little_evidence');
    expect(r.top).toBeNull();
  });
});
