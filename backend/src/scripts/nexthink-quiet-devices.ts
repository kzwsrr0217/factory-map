/**
 * nexthink-quiet-devices.ts — machines that have stopped reporting, and what that is worth.
 *
 * A report and deliberately NOT a task list. On the real estate seventeen devices have been quiet for
 * a fortnight or more, three of them for a month — and it is August. A month of silence in August is
 * a fortnight's leave far more often than a dead machine, so a list telling somebody to go and
 * reclaim seventeen desks would be wrong most of the way down, and a list that cries wolf takes the
 * true findings down with it.
 *
 * So this prints, ranks, and states what it cannot know. The logic lives in
 * `services/nexthink/overview.ts`, which the Nexthink page uses too; this file only prints.
 *
 * ── Why absence beats silence ───────────────────────────────────────────────────
 * Nexthink ages long-inactive devices out of its export entirely. A machine switched off months ago
 * does not appear here with an old `last_seen` — it DISAPPEARS. So `last_seen` can only ever show the
 * shallow end, from "on holiday" to "off a few weeks"; the deep end is invisible to it by
 * construction. `import_runs.present_keys` closes that gap, and it is the closest thing to a
 * decommission signal the estate produces — still a question, because a device also drops out if it
 * moved to an entity outside the export's filter.
 *
 *   npx ts-node src/scripts/nexthink-quiet-devices.ts
 */
import 'reflect-metadata';
import config from '../config/config';
import { AppDataSource } from '../config/database';
import { NexthinkDeviceSnapshot } from '../entities/NexthinkDeviceSnapshot.entity';
import { keyDeltaAgainstLastRun, lastRun } from '../services/importRun';
import { findQuietDevices, QUIET_FROM_DAYS } from '../services/nexthink/overview';

async function main(): Promise<void> {
  try {
    await AppDataSource.initialize();
  } catch (err) {
    const { host, port, database } = config.mssql;
    console.error(`\n✖ Could not connect to the database at ${host}:${port} (${database}).`);
    console.error(`  ${String(err)}`);
    process.exit(1);
  }

  try {
    const deviceRepo = AppDataSource.getRepository(NexthinkDeviceSnapshot);
    const devices = await deviceRepo.find({ select: { device_name: true } });
    if (devices.length === 0) {
      console.log('\n✖ The Nexthink device snapshot is empty. Run import:nexthink -- <dir> --apply first.');
      return;
    }

    const result = await findQuietDevices();
    if (!result.freshest) {
      console.log('\n✖ No device in the export has a readable last_seen — nothing can be measured.');
      return;
    }

    const run = await lastRun('nexthink-devices');
    console.log(`🔇 Quiet devices, measured back from ${result.freshest.toISOString().slice(0, 10)}`);
    console.log(`   (the newest sighting in the export${run ? `, imported ${run.imported_at.toISOString().slice(0, 10)}` : ''})`);

    console.log('\n  How long since each device last reported:');
    for (const b of result.buckets) {
      console.log(`    ${String(b.count).padStart(4)}  ${b.label}`);
    }

    if (result.quiet.length === 0) {
      console.log(`\n  Nothing has been quiet for ${QUIET_FROM_DAYS}+ days.`);
    } else {
      console.log(`\n  ${result.quiet.length} device(s) quiet for ${QUIET_FROM_DAYS}+ days:`);
      for (const q of result.quiet) {
        const state = q.map_state === 'absent' ? 'not in the map'
          : q.map_state === 'replaced' ? 'already replaced' : 'live in the map';
        console.log(`    ${String(q.days_quiet).padStart(3)}d  ${q.device_name.padEnd(11)} ${state.padEnd(16)}`
          + ` ${(q.person ?? '—').slice(0, 22).padEnd(23)} ${(q.room ?? '—').slice(0, 18).padEnd(19)}`
          + ` ${(q.os_name ?? '').slice(0, 26)}`);
      }

      /**
       * The caveat is printed with the list, not left in a doc nobody opens. It is the difference
       * between a useful ranking and seventeen wrong accusations.
       */
      console.log('\n  What this list is and is not:');
      console.log('    Silence means the agent did not report. It does not mean the machine is gone,');
      console.log('    and it says nothing at all about a device that carries no agent.');
      if (result.holiday_season) {
        console.log('    The export is from the holiday season, when several weeks of silence is far more');
        console.log('    often leave than a dead machine. Check the person before the device.');
      }
      const replaced = result.quiet.filter((q) => q.map_state === 'replaced').length;
      if (replaced > 0) {
        console.log(`    ${replaced} of these are already recorded as replaced — those are expected to be quiet`);
        console.log('    and need nothing. A replaced machine that is NOT quiet is the interesting case, and');
        console.log('    it is already on the task list as dispose-replaced-machine.');
      }
    }

    const delta = await keyDeltaAgainstLastRun(
      'nexthink-devices', devices.map((d) => d.device_name),
    );
    console.log('\n  Gone from the export since the previous import:');
    if (!delta.previous_run_at) {
      console.log('    No earlier import on record, so nothing can be said. This is the stronger signal of');
      console.log('    the two and it needs a second import to exist at all — the next one will have it.');
    } else if (delta.disappeared.length === 0) {
      console.log(`    Nothing, comparing against the import of ${delta.previous_run_at.toISOString().slice(0, 10)}.`);
    } else {
      console.log(`    ${delta.disappeared.length}, comparing against ${delta.previous_run_at.toISOString().slice(0, 10)}:`);
      console.log(`      ${delta.disappeared.join(', ')}`);
      console.log('    Nexthink drops a device once it has been inactive long enough, so this is the closest');
      console.log('    thing to a decommission signal here. Still a question: a device also drops out if it');
      console.log('    moved to an entity outside the export filter, or the query was scoped differently.');
    }

    console.log('\n  Nothing was written. This is a report, deliberately not a task list: on the real');
    console.log('  estate it would add seventeen items that are mostly somebody on holiday.');
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error('✖ Failed:', err);
  process.exit(1);
});
