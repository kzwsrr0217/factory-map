/**
 * nexthink-swap-check.ts — check claimed machine swaps against the logon record.
 *
 * The swaps arrive spoken, in a list, days after the fact: "17098 cserélve 23957-el, autologon
 * megy, IFS kitéve". Recording them is `record-replacement.ts`. This is the step before that:
 * does the evidence agree, and what happened to the old machine afterwards.
 *
 * Read-only. It writes nothing, ever — there is no `--apply`, on purpose. The value of a check
 * is that it can be run without deciding to act, and a script that might also modify things
 * gets run less often than one that cannot.
 *
 * It reads the tables `import:nexthink` fills, so it is only as current as the last export.
 *
 *   npx ts-node src/scripts/nexthink-swap-check.ts HWA17098=HWA23957 HWA17573=HWA17592
 */
import 'reflect-metadata';
import config from '../config/config';
import { AppDataSource } from '../config/database';
import { NexthinkDeviceSnapshot } from '../entities/NexthinkDeviceSnapshot.entity';
import { assessSwap, SwapEvidence } from '../services/nexthink/swapEvidence';

/** `HWA17098=HWA23957`, or with the arrow that is how these are actually written down. */
function parsePair(arg: string): { oldHwa: string; newHwa: string } {
  const [left, right] = arg.split(/[=>]+/);
  if (!left || !right) throw new Error(`Cannot read "${arg}" — expected OLD=NEW`);
  // A monitor named alongside the machine (`old=new+HWA38413`) is meaningful to
  // record-replacement and meaningless here: monitors carry no agent, so Nexthink has never
  // heard of them. Dropped rather than rejected, so the same argument list can feed both.
  return { oldHwa: left.trim().toUpperCase(), newHwa: right.split('+')[0].trim().toUpperCase() };
}

const VERDICT_LABEL: Record<SwapEvidence['verdict'], string> = {
  confirmed: '✔ confirmed',
  contradicted: '⚠ contradicted',
  weak_evidence: '· weak evidence',
  no_evidence: '· no evidence',
};

function describeDevice(d: NexthinkDeviceSnapshot | null, hwa: string): string {
  if (!d) return `${hwa}: not in the Nexthink export`;
  const seen = d.last_seen ? d.last_seen.toISOString().slice(0, 10) : 'never';
  return `${hwa}: ${d.entity ?? 'no entity'} · ${d.model ?? 'unknown model'} · ${d.os_name ?? 'unknown OS'} · last seen ${seen}`;
}

function printAccounts(label: string, rows: SwapEvidence['shared_people'], indent = '      '): void {
  if (rows.length === 0) return;
  console.log(`    ${label}`);
  for (const r of rows) {
    const name = r.full_name ?? '(no AD name)';
    const counts = `old ${r.old_logins} / new ${r.new_logins}`;
    const spread = r.devices_sharing > 0 ? ` · also on ${r.devices_sharing} other device(s)` : '';
    console.log(`${indent}${name} <${r.user_name}> — ${counts}${spread}`);
  }
}

function report(e: SwapEvidence): void {
  console.log(`\n=== ${e.old_hwa} → ${e.new_hwa}   ${VERDICT_LABEL[e.verdict]} ===`);

  console.log(`    ${describeDevice(e.old_device, e.old_hwa)}`);
  console.log(`    ${describeDevice(e.new_device, e.new_hwa)}`);

  // The map's own state, because "confirmed" and "recorded" are different things and the whole
  // point of the exercise is closing the gap between them.
  if (!e.old_in_map) {
    console.log(`    ⚠ ${e.old_hwa} is not in the factory map — nothing to replace`);
  } else if (!e.new_in_map) {
    console.log(`    ⚠ ${e.new_hwa} is not in the factory map yet — record-replacement can create it from the ITSM export`);
  } else if (e.already_recorded) {
    console.log('    ✔ already recorded in the map (predecessor/successor linked)');
  } else {
    console.log(`    · not recorded in the map yet — ${e.old_in_map.display_name} still holds the place`
      + `${e.old_in_map.person_full_name ? ` and ${e.old_in_map.person_full_name}` : ''}`);
  }

  printAccounts('same person on both — this is the swap:', e.shared_people);
  printAccounts('same generic account on both (weak — shared accounts are on many machines):', e.shared_generic);

  if (e.verdict === 'contradicted') {
    console.log('    ⚠ no person appears on both machines:');
    printAccounts(`only on ${e.old_hwa}:`, e.old_only_people, '        ');
    printAccounts(`only on ${e.new_hwa}:`, e.new_only_people, '        ');
    console.log('      Could still be a real swap that changed hands at the same time. Worth asking.');
  } else if (e.verdict === 'no_evidence') {
    console.log('    · no named logons on one or both sides — normal for shop-floor machines,');
    console.log('      which only ever see generic or autologon accounts. Absence of evidence only.');
  }

  // When the replacement started reporting — the handover date, but only for a genuinely new
  // machine. Stated with that condition attached rather than left to be misread.
  if (e.replacement_first_seen) {
    const when = e.replacement_first_seen.toISOString().slice(0, 10);
    console.log(e.replacement_is_recycled
      ? `    · ${e.new_hwa} first reported ${when} — a recycled machine, so that is not the handover date`
      : `    · ${e.new_hwa} first reported ${when} — new to the estate, so that is the handover`);
  }

  // What became of the old machine — the reinstall-or-set-aside question, observed.
  switch (e.fate) {
    case 'still_active':
      console.log(`    ▲ ${e.old_hwa} was reporting to the end of the export window — it is in service, not on a shelf`);
      break;
    case 'quiet':
      console.log(`    ▼ ${e.old_hwa} has not reported for ${e.old_quiet_days} day(s) → powered off or set aside`);
      break;
    case 'gone_from_nexthink':
      console.log(`    ▼ ${e.old_hwa} is absent from the export entirely — quiet longer than the export window`);
      console.log('      → set aside, and long enough that Nexthink has dropped it. A decommission candidate.');
      break;
    case 'undeterminable':
      console.log(`    · no readable last_seen on ${e.old_hwa} — cannot say what became of it`);
      break;
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  if (args.length === 0) {
    console.error('✖ Usage: nexthink-swap-check.ts OLD=NEW [OLD=NEW ...]');
    console.error('  Reads the tables filled by import:nexthink. Writes nothing.');
    process.exit(1);
  }
  const pairs = args.map(parsePair);

  try {
    await AppDataSource.initialize();
  } catch (err) {
    const { host, port, database } = config.mssql;
    console.error(`\n✖ Could not connect to the database at ${host}:${port} (${database}).`);
    console.error(`  ${String(err)}`);
    process.exit(1);
  }

  try {
    const snapshot = await AppDataSource.getRepository(NexthinkDeviceSnapshot).count();
    if (snapshot === 0) {
      console.log('\n✖ The Nexthink device snapshot is empty. Run import:nexthink -- <dir> --apply first.');
      return;
    }
    console.log(`🔍 Checking ${pairs.length} claimed swap(s) against ${snapshot} device(s) of Nexthink data`);

    const results: SwapEvidence[] = [];
    for (const p of pairs) {
      const e = await assessSwap(p.oldHwa, p.newHwa);
      report(e);
      results.push(e);
    }

    const confirmed = results.filter((r) => r.verdict === 'confirmed');
    const toRecord = results.filter((r) => !r.already_recorded && r.old_in_map);
    console.log(`\n  ${confirmed.length}/${results.length} confirmed by a shared named person`);
    /**
     * The one line here that is a question rather than a finding. An old machine still in service
     * is the expected outcome when it was Win11-capable and got reinstalled — and the expected
     * outcome when the swap never happened. Both look identical from here.
     */
    const active = results.filter((r) => r.fate === 'still_active');
    if (active.length > 0) {
      console.log(`  ${active.length} old machine(s) still reporting: ${active.map((r) => r.old_hwa).join(', ')}`);
      console.log('    Either reinstalled and reused, or still at the desk because the swap has not happened.');
      console.log('    The logon record cannot tell those apart — worth one look each.');
    }
    if (toRecord.length > 0) {
      console.log('\n  Not yet in the map. To record them:');
      console.log(`    npx ts-node src/scripts/record-replacement.ts ${toRecord.map((r) => `${r.old_hwa}=${r.new_hwa}`).join(' ')} --apply`);
    }
    /**
     * Said every run, not once in a doc: the eligibility rule is the reason anyone asks about
     * the old machines at all, and this data cannot answer it. Silence here would read as
     * "the OS line above is the answer", which is a different question.
     */
    console.log('\n  Windows 11 eligibility of the old machines is NOT in this data — the NQL hardware');
    console.log('  fields for TPM and Secure Boot do not exist. It comes from the built-in');
    console.log('  "Windows 11 - Readiness and migration" dashboard, which is a separate export.');
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error('✖ Failed:', err);
  process.exit(1);
});
