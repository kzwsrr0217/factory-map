/**
 * nexthink-quiet-devices.ts — machines that have stopped reporting, and what that is worth.
 *
 * A report and deliberately NOT a task list. On the real estate 20 devices have been quiet for two
 * weeks or more, six of them for a month — and it is August. A month of silence in August is a
 * fortnight's leave far more often than a dead machine, so a list telling somebody to go and
 * reclaim twenty desks would be wrong most of the way down. Today's other lesson applies: a list
 * that cries wolf is a list nobody reads, and it takes the true findings down with it.
 *
 * So this prints, ranks, and states what it cannot know. The one thing here that IS strong enough
 * to act on comes from the import ledger, not from `last_seen` — see below.
 *
 * ── Why absence beats silence ───────────────────────────────────────────────────
 * Nexthink ages long-inactive devices out of its export entirely. A machine that was switched off
 * months ago does not appear here with an old `last_seen` — it DISAPPEARS. So `last_seen` can only
 * ever show the shallow end: everything from "on holiday" to "off for a few weeks". The deep end is
 * invisible to it by construction.
 *
 * `import_runs.present_keys` closes that gap. A device in the previous import and not in this one
 * has crossed out of the retention window, which is the closest thing to a decommission signal the
 * estate produces. It is still not proof — a device also drops out if it moved to an entity outside
 * the export's filter — so it is printed as a question.
 *
 * ── Measured against the export's own clock ─────────────────────────────────────
 * "Quiet for N days" counts back from the newest sighting in the export, not from today. Run
 * against a three-week-old export, today's date would add three weeks of imaginary silence to every
 * device in the estate.
 */
import 'reflect-metadata';
import { In } from 'typeorm';
import config from '../config/config';
import { AppDataSource } from '../config/database';
import { Asset } from '../entities/Asset.entity';
import { WorkArea } from '../entities/WorkArea.entity';
import { NexthinkDeviceSnapshot } from '../entities/NexthinkDeviceSnapshot.entity';
import { keyDeltaAgainstLastRun, lastRun } from '../services/importRun';

/** Below this, silence is a long weekend. */
const QUIET_FROM_DAYS = 14;

function days(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}

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
    const devices = await deviceRepo.find();
    if (devices.length === 0) {
      console.log('\n✖ The Nexthink device snapshot is empty. Run import:nexthink -- <dir> --apply first.');
      return;
    }

    // The export's own "now". See the file header.
    const freshest = devices.reduce<Date | null>(
      (max, d) => (d.last_seen && (!max || d.last_seen > max) ? d.last_seen : max), null,
    );
    if (!freshest) {
      console.log('\n✖ No device in the export has a readable last_seen — nothing can be measured.');
      return;
    }

    const run = await lastRun('nexthink-devices');
    console.log(`🔇 Quiet devices, measured back from ${freshest.toISOString().slice(0, 10)}`);
    console.log(`   (the newest sighting in the export${run ? `, imported ${run.imported_at.toISOString().slice(0, 10)}` : ''})`);

    // ── The shallow end: present, but not lately ──────────────────────────────
    const withDates = devices.filter((d) => d.last_seen);
    const buckets: Array<[string, number, number]> = [
      ['60+ days', 60, Infinity],
      ['30–59 days', 30, 60],
      ['14–29 days', 14, 30],
      ['7–13 days', 7, 14],
      ['under 7 days', 0, 7],
    ];
    console.log('\n  How long since each device last reported:');
    for (const [label, lo, hi] of buckets) {
      const n = withDates.filter((d) => {
        const q = days(d.last_seen!, freshest);
        return q >= lo && q < hi;
      }).length;
      if (n > 0) console.log(`    ${String(n).padStart(4)}  ${label}`);
    }

    const quiet = withDates
      .map((d) => ({ d, q: days(d.last_seen!, freshest) }))
      .filter((x) => x.q >= QUIET_FROM_DAYS)
      .sort((a, b) => b.q - a.q);

    if (quiet.length === 0) {
      console.log(`\n  Nothing has been quiet for ${QUIET_FROM_DAYS}+ days.`);
    } else {
      // Resolve the map's view of each, so the list says who and where rather than only a number.
      const names = quiet.map((x) => x.d.device_name);
      const assetRepo = AppDataSource.getRepository(Asset);
      const byName = new Map<string, Asset>();
      for (let i = 0; i < names.length; i += 500) {
        const chunk = names.slice(i, i + 500);
        for (const a of await assetRepo.find({
          where: [{ hardware_asset_id: In(chunk) }, { display_name: In(chunk) }],
        })) {
          if (a.hardware_asset_id) byName.set(a.hardware_asset_id, a);
          if (!byName.has(a.display_name)) byName.set(a.display_name, a);
        }
      }
      const roomIds = [...new Set([...byName.values()].map((a) => a.workarea_id).filter(Boolean))] as string[];
      const rooms = new Map(
        roomIds.length > 0
          ? (await AppDataSource.getRepository(WorkArea).find({ where: { id: In(roomIds) } }))
            .map((w) => [w.id, w.name])
          : [],
      );

      console.log(`\n  ${quiet.length} device(s) quiet for ${QUIET_FROM_DAYS}+ days:`);
      for (const { d, q } of quiet) {
        const a = byName.get(d.device_name);
        const state = !a ? 'not in the map' : a.successor_id ? 'already replaced' : 'live in the map';
        const where = a?.workarea_id ? rooms.get(a.workarea_id) ?? '—' : '—';
        console.log(`    ${String(q).padStart(3)}d  ${d.device_name.padEnd(11)} ${state.padEnd(16)}`
          + ` ${(a?.person_full_name ?? '—').slice(0, 22).padEnd(23)} ${String(where).slice(0, 18).padEnd(19)}`
          + ` ${(d.os_name ?? '').slice(0, 26)}`);
      }

      /**
       * The caveat is printed with the list, not in a doc nobody opens. It is the difference between
       * a useful ranking and twenty wrong accusations.
       */
      const month = freshest.getUTCMonth();
      const holidaySeason = month === 6 || month === 7; // July, August
      console.log('\n  What this list is and is not:');
      console.log('    Silence means the agent did not report. It does not mean the machine is gone,');
      console.log('    and it says nothing at all about a device that carries no agent.');
      if (holidaySeason) {
        console.log('    The export is from the holiday season, when several weeks of silence is far more');
        console.log('    often leave than a dead machine. Check the person before the device.');
      }
      const replaced = quiet.filter(({ d }) => byName.get(d.device_name)?.successor_id).length;
      if (replaced > 0) {
        console.log(`    ${replaced} of these are already recorded as replaced — those are expected to be quiet`);
        console.log('    and need nothing. A replaced machine that is NOT quiet is the interesting case, and');
        console.log('    it is already on the task list as dispose-replaced-machine.');
      }
    }

    // ── The deep end: gone from the export since last time ────────────────────
    const delta = await keyDeltaAgainstLastRun('nexthink-devices', devices.map((d) => d.device_name));
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
    console.log('  estate it would add twenty items that are mostly somebody on holiday.');
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error('✖ Failed:', err);
  process.exit(1);
});
