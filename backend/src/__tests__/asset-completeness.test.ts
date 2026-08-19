/**
 * asset-completeness.test.ts — the indicator has to be wrong in neither direction.
 *
 * Two failure modes, and they are not symmetrical.
 *
 * Showing red for data an asset CANNOT have is the one that kills the feature: all 405 monitors would
 * sit permanently incomplete for lacking a Nexthink agent, and within a fortnight nobody reads the
 * number — at which point the genuinely incomplete records hide among the false ones. Most of what is
 * pinned here is therefore about the denominator, not the score.
 *
 * The other is accusing a record of a problem the app itself created. 1038 live assets carry a
 * reconcile verdict recorded BEFORE the loaded export, from a compare that ran while the snapshot table
 * was empty; 1045 of them read `missing`. Reporting that as a real disagreement would be a thousand
 * false accusations, and the first version of this file did exactly that — printing the self-refuting
 * line "Agrees with ITSM — 0 field(s) still disagree".
 *
 * Pure assessAsset() throughout, no database: the applicability rules are the part worth pinning, and
 * they are decided entirely by the asset and the loaded sets.
 */
import request from 'supertest';
import { Asset } from '../entities/Asset.entity';
import {
  assessAsset,
  isOutOfService,
  isUnstartedStage,
  CheckKey,
  CompletenessInputs,
} from '../services/asset/completeness';
import { setupTests } from './helpers/testApp';

/** An export loaded at a fixed instant, so "before" and "after" are unambiguous. */
const EXPORT_AT = new Date('2026-08-18T14:00:00Z');
const BEFORE_EXPORT = new Date('2026-08-17T09:00:00Z');
const AFTER_EXPORT = new Date('2026-08-19T09:00:00Z');

function inputs(over: Partial<CompletenessInputs> = {}): CompletenessInputs {
  return {
    itsmImportedAt: EXPORT_AT,
    itsmIds: new Set<string>(),
    nexthinkNames: new Set<string>(),
    surveyedAssetIds: new Set<string>(),
    hasParent: new Set<string>(),
    ...over,
  };
}

function asset(over: Partial<Asset> = {}): Asset {
  return {
    id: 'a1',
    display_name: 'HWA00001',
    asset_type: 'workstation',
    status: 'active',
    hardware_asset_id: 'HWA00001',
    serial_number: 'SN1',
    manufacturer: 'Dell',
    person_full_name: 'Somebody',
    reconcile_last_at: null,
    reconcile_last_status: null,
    reconcile_diff_count: null,
    ...over,
  } as Asset;
}

/** The one check under discussion, so a failing test names it rather than an array index. */
function check(a: Asset, key: CheckKey, ins: CompletenessInputs = inputs()) {
  const found = assessAsset(a, ins).checks.find((c) => c.key === key);
  if (!found) throw new Error(`no check '${key}'`);
  return found;
}

describe('the denominator — what each asset can even be measured on', () => {
  it('does not ask a monitor for a Nexthink agent', () => {
    const c = check(asset({ asset_type: 'monitor' }), 'nexthink-seen');
    expect(c.applicable).toBe(false);
    // Not applicable is not a pass either: it must not quietly inflate the score.
    expect(c.satisfied).toBe(false);
    expect(c.detail).toMatch(/monitor/i);
  });

  it('does not ask a pre-Windows-10 machine for a Nexthink agent', () => {
    // The agent does not run there at all, so absence says nothing about the record.
    expect(check(asset({ os_type: 'Windows 7 Professional' }), 'nexthink-seen').applicable).toBe(false);
    expect(check(asset({ os_type: 'Windows Server 2008 R2' }), 'nexthink-seen').applicable).toBe(false);
  });

  it('still asks a machine with no recorded OS', () => {
    /**
     * The direction that matters. An unknown OS must not excuse the check — otherwise every record
     * missing an `os_type`, which is all of them right now, would silently lose the Nexthink check and
     * the estate would look more complete for being less well recorded.
     */
    expect(check(asset({ os_type: null }), 'nexthink-seen').applicable).toBe(true);
  });

  it('does not put a rack-mounted server on the floor plan, or a monitor on a wall socket', () => {
    expect(check(asset({ asset_type: 'server' }), 'on-the-plan').applicable).toBe(false);
    expect(check(asset({ asset_type: 'monitor' }), 'network-socket').applicable).toBe(false);
  });

  it('asks only peripherals which machine they belong to', () => {
    expect(check(asset({ asset_type: 'monitor' }), 'attached-to-a-machine').applicable).toBe(true);
    expect(check(asset({ asset_type: 'workstation' }), 'attached-to-a-machine').applicable).toBe(false);
  });

  it('counts only the applicable checks', () => {
    const monitor = assessAsset(asset({ asset_type: 'monitor' }), inputs());
    const workstation = assessAsset(asset({ asset_type: 'workstation' }), inputs());
    expect(monitor.applicable).toBeLessThan(workstation.applicable);
    expect(monitor.applicable).toBe(monitor.checks.filter((c) => c.applicable).length);
    // A score can never exceed its own denominator, whatever the type.
    expect(monitor.satisfied).toBeLessThanOrEqual(monitor.applicable);
  });

  it('gives every unsatisfied and inapplicable check a reason', () => {
    // A red tick with no reason is a question, not information.
    for (const c of assessAsset(asset({ asset_type: 'monitor' }), inputs()).checks) {
      if (!c.applicable || !c.satisfied) expect(c.detail).toBeTruthy();
    }
  });
});

describe('a verdict older than the export it describes', () => {
  it('says nothing, whatever it happens to say', () => {
    /**
     * The thousand-false-accusations case. `missing` recorded before this export is a statement about
     * data that has since been replaced — on the real estate, about an empty table.
     */
    const c = check(
      asset({ reconcile_last_at: BEFORE_EXPORT, reconcile_last_status: 'missing', reconcile_diff_count: 0 }),
      'itsm-compared',
      inputs({ itsmIds: new Set(['HWA00001']) }),
    );
    expect(c.satisfied).toBe(false);
    expect(c.detail).toMatch(/before the current export/i);
    // And specifically NOT the sentence that made the first version self-refuting.
    expect(c.detail).not.toMatch(/disagree/i);
  });

  it('does not let a stale in_sync count as agreement', () => {
    // The dangerous direction: a green tick vouching for a comparison against replaced data.
    const c = check(
      asset({ reconcile_last_at: BEFORE_EXPORT, reconcile_last_status: 'in_sync' }),
      'itsm-compared',
      inputs({ itsmIds: new Set(['HWA00001']) }),
    );
    expect(c.satisfied).toBe(false);
  });

  it('accepts a compare made after the export', () => {
    const c = check(
      asset({ reconcile_last_at: AFTER_EXPORT, reconcile_last_status: 'in_sync' }),
      'itsm-compared',
      inputs({ itsmIds: new Set(['HWA00001']) }),
    );
    expect(c.satisfied).toBe(true);
    expect(c.detail).toBeNull();
  });

  it('separates never-compared from disagreeing', () => {
    const c = check(
      asset({ reconcile_last_at: null, reconcile_last_status: null }),
      'itsm-compared',
      inputs({ itsmIds: new Set(['HWA00001']) }),
    );
    expect(c.satisfied).toBe(false);
    expect(c.detail).toMatch(/never compared/i);
  });

  it('has nothing to compare when the asset is not in the export', () => {
    const c = check(asset(), 'itsm-compared', inputs({ itsmIds: new Set() }));
    expect(c.applicable).toBe(false);
  });

  it('reports a real disagreement with its count', () => {
    const c = check(
      asset({ reconcile_last_at: AFTER_EXPORT, reconcile_last_status: 'differences', reconcile_diff_count: 3 }),
      'itsm-compared',
      inputs({ itsmIds: new Set(['HWA00001']) }),
    );
    expect(c.satisfied).toBe(false);
    expect(c.detail).toMatch(/3 field/);
  });
});

describe('a device that has left service', () => {
  it('is not measured against anything', () => {
    // 61 retired devices would otherwise be 61 permanent reds no work could ever clear.
    const result = assessAsset(asset({ status: 'decommissioned' }), inputs());
    expect(result.tracked).toBe(false);
    expect(result.applicable).toBe(0);
    expect(result.satisfied).toBe(0);
    expect(result.checks.every((c) => !c.applicable)).toBe(true);
  });

  it('recognises the status whatever its casing', () => {
    // Two vocabularies share the column: 946 rows read `active`, 22 read `Deployed` from the ITSM export.
    expect(isOutOfService(asset({ status: 'Decommissioned' }))).toBe(true);
    expect(isOutOfService(asset({ status: 'disposed' }))).toBe(true);
    expect(isOutOfService(asset({ status: 'Deployed' }))).toBe(false);
    expect(isOutOfService(asset({ status: null }))).toBe(false);
  });
});

describe('the checks that read a source', () => {
  it('matches Nexthink on the HWA and on the display name', () => {
    // device.name IS the HWA; display_name is the fallback the import uses, so both must count.
    expect(check(asset(), 'nexthink-seen', inputs({ nexthinkNames: new Set(['HWA00001']) })).satisfied).toBe(true);
    expect(check(
      asset({ hardware_asset_id: null, display_name: 'MMHPC1234' }),
      'nexthink-seen', inputs({ nexthinkNames: new Set(['MMHPC1234']) }),
    ).satisfied).toBe(true);
  });

  it('does not credit an empty HWA against an ITSM export', () => {
    // A blank must not match a blank: 295 live assets have no HWA at all.
    const c = check(asset({ hardware_asset_id: '  ' }), 'itsm-record', inputs({ itsmIds: new Set(['']) }));
    expect(c.satisfied).toBe(false);
    expect(c.detail).toMatch(/never registered/i);
  });

  it('names the missing core fields rather than just failing', () => {
    const c = check(asset({ serial_number: null, manufacturer: '   ' }), 'core-fields');
    expect(c.satisfied).toBe(false);
    expect(c.detail).toMatch(/serial_number/);
    expect(c.detail).toMatch(/manufacturer/);
  });

  it('does not demand a person for a printer', () => {
    // Shared kit has no personal owner, so requiring one would fail every printer forever.
    expect(check(asset({ asset_type: 'printer', person_full_name: null }), 'core-fields').satisfied).toBe(true);
  });
});

describe('the estate summary', () => {
  it('still calls a stage unstarted when one stray asset satisfies it', () => {
    /**
     * The flag exists to stop the panel blaming one asset for a programme nobody has begun. Written as
     * `satisfied === 0` it stayed silent on exactly the two checks it was built for: the floor-plan
     * position stands at 1 of 1197 and the wall socket at 1 of 434, so a single stray record out of a
     * thousand switched the context message off.
     *
     * Pinned as a pure ratio rather than through the database: the rule is arithmetic, and the estate
     * numbers that motivated it will move.
     */
    expect(isUnstartedStage(1, 1197)).toBe(true);   // the floor plan, as measured
    expect(isUnstartedStage(1, 434)).toBe(true);    // the wall sockets, as measured
    expect(isUnstartedStage(0, 988)).toBe(true);    // never compared against the export
    expect(isUnstartedStage(63, 453)).toBe(false);  // 14% — under way, and this asset's own gap
    expect(isUnstartedStage(0, 3)).toBe(false);     // three devices is not a programme stage
  });
});

describe('the endpoints', () => {
  let app: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  let token: string;

  beforeAll(async () => {
    let getAdminToken: () => Promise<string>;
    ({ app, getAdminToken } = await setupTests());
    token = await getAdminToken();
  }, 40000);

  it('reads /assets/completeness as the estate summary, not as an asset id', async () => {
    /**
     * The one routing mistake this pair invites. Express matches in order, so with the literal path
     * declared after '/:id' the estate summary would be handled as a lookup for an asset called
     * "completeness" — a 404 that looks like an empty estate rather than a misroute.
     */
    const res = await request(app).get('/api/assets/completeness').set({ Authorization: `Bearer ${token}` });
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveProperty('by_check');
    expect(Array.isArray(res.body.data.by_check)).toBe(true);
  });

  it('404s for an unknown asset rather than returning an empty checklist', async () => {
    // An empty checklist would read as "nothing is missing", which is the opposite of the truth.
    const res = await request(app)
      .get('/api/assets/00000000-0000-0000-0000-000000000000/completeness')
      .set({ Authorization: `Bearer ${token}` });
    expect(res.status).toBe(404);
  });
});
