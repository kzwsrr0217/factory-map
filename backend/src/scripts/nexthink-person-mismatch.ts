/**
 * nexthink-person-mismatch.ts — who the logon records say uses each machine, against the map.
 *
 * The question ITSM and the survey keep disagreeing about, asked of a source that is not somebody's
 * memory. It answers in four ways and only one of them is a task:
 *
 *   agree                the two sources name the same person — nothing to do
 *   the map has nobody   a gap the logon record can fill, and the safest kind of change:
 *                        filling an empty field never overwrites a decision someone made
 *   they disagree        needs a person. This is the feed for the deferred decision (#87):
 *                        "the survey is right, ITSM must be updated"
 *   shared / too little  listed, never decided
 *
 * Read-only, no --apply. Filling the gaps is a separate, deliberate act — and it belongs in the
 * app's own reconcile flow, where it gets an audit entry, not in a script that runs at night.
 *
 *   npx ts-node src/scripts/nexthink-person-mismatch.ts
 *   npx ts-node src/scripts/nexthink-person-mismatch.ts --all   # include the agreeing devices
 */
import 'reflect-metadata';
import config from '../config/config';
import { AppDataSource } from '../config/database';
import { NexthinkLoginSnapshot } from '../entities/NexthinkLoginSnapshot.entity';
import { findPersonFindings, PersonFinding } from '../services/nexthink/personEvidence';

function describeTop(f: PersonFinding): string {
  if (!f.nexthink) return 'no named logons';
  const r = f.nexthink.runner_up;
  const runner = r ? `, then ${r.full_name ?? '(no AD name)'} ${r.logins}` : '';
  return `${f.nexthink.full_name} ${f.nexthink.logins} logon(s)${runner}`;
}

async function main(): Promise<void> {
  const showAll = process.argv.includes('--all');

  try {
    await AppDataSource.initialize();
  } catch (err) {
    const { host, port, database } = config.mssql;
    console.error(`\n✖ Could not connect to the database at ${host}:${port} (${database}).`);
    console.error(`  ${String(err)}`);
    process.exit(1);
  }

  try {
    const total = await AppDataSource.getRepository(NexthinkLoginSnapshot).count();
    if (total === 0) {
      console.log('\n✖ The Nexthink logon snapshot is empty. Run import:nexthink -- <dir> --apply first.');
      return;
    }

    const findings = await findPersonFindings();
    const of = (c: PersonFinding['comparison']) => findings.filter((f) => f.comparison === c);
    const agree = of('agree');
    const gaps = of('map_has_nobody');
    const disagree = of('disagree');
    const shared = of('shared');
    const thin = of('too_little_evidence');

    console.log(`🔍 ${findings.length} device(s) in both the logon snapshot and the map`);
    console.log(`    ${agree.length} agree · ${gaps.length} the map has nobody · ${disagree.length} disagree`
      + ` · ${shared.length} shared · ${thin.length} too little evidence`);

    if (disagree.length > 0) {
      console.log(`\n── ${disagree.length} where the two sources name different people ──`);
      console.log('   Neither side is assumed right. ITSM holds who the asset was assigned to; the');
      console.log('   logons hold who signs in. A person who changed desks looks exactly like this.');
      for (const f of disagree) {
        console.log(`\n  ${f.device_name}  (${f.asset_display_name})`);
        console.log(`      map:      ${f.asset_person}`);
        console.log(`      logons:   ${describeTop(f)}`);
      }
    }

    if (gaps.length > 0) {
      console.log(`\n── ${gaps.length} where the map has nobody and the logons have a clear person ──`);
      for (const f of gaps) {
        console.log(`  ${f.device_name.padEnd(12)} ${describeTop(f)}`);
      }
      console.log('\n  Filling an empty field never overwrites a decision, so these are the safe ones.');
      console.log('  Still not automatic: a machine can be unassigned in ITSM on purpose.');
    }

    if (shared.length > 0) {
      console.log(`\n── ${shared.length} shared machines — no single answer, so none is given ──`);
      for (const f of shared) {
        console.log(`  ${f.device_name.padEnd(12)} ${describeTop(f)}`);
      }
    }

    if (thin.length > 0) {
      console.log(`\n── ${thin.length} with too little evidence to say anything ──`);
      console.log('   Fewer than 3 logons by the top named account, or none at all. A single logon is');
      console.log('   what a support visit looks like, and reassigning a machine to whoever repaired');
      console.log('   it is the one error here that would be actively harmful.');
      const sample = thin.slice(0, 20).map((f) => f.device_name).join(', ');
      console.log(`   ${sample}${thin.length > 20 ? `, … (+${thin.length - 20})` : ''}`);
    }

    if (showAll && agree.length > 0) {
      console.log(`\n── ${agree.length} that agree ──`);
      for (const f of agree) console.log(`  ${f.device_name.padEnd(12)} ${f.asset_person}`);
    } else if (agree.length > 0) {
      console.log(`\n  ${agree.length} device(s) agree and are not listed. Pass --all to see them.`);
    }

    console.log('\n  Nothing was written. The disagreements are the input to the ITSM-update decision,');
    console.log('  not the decision itself.');
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error('✖ Failed:', err);
  process.exit(1);
});
