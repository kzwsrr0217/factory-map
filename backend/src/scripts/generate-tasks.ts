/**
 * generate-tasks.ts — Recomputes the normalisation task list from the data.
 *
 * "Everything is consistent" is true exactly when this produces no open tasks, which is
 * the reason the list is derived rather than kept: a hand-maintained list drifts, and a
 * drifted list answers that question wrongly.
 *
 * DRY RUN BY DEFAULT: it prints what it would create, reopen and close. `--apply`
 * writes. The rules, and which kinds may close themselves, are in
 * services/itsm/taskGenerator.ts.
 *
 * Usage:
 *   npm run tasks:generate
 *   npm run tasks:generate -- --apply
 *   npm run tasks:generate -- --csv > ops/results/tasks.csv
 */
import 'reflect-metadata';
import { AppDataSource } from '../config/database';
import { NormalisationTask } from '../entities/NormalisationTask.entity';
import { deriveRequiredTasks, generateTasks, RequiredTask } from '../services/itsm/taskGenerator';

/** Human-facing labels for the kinds, in the order the work naturally happens. */
const KIND_ORDER: Array<{ kind: string; label: string }> = [
  { kind: 'check-hwa', label: 'Check an HWA the export does not contain' },
  { kind: 'decide-match', label: 'Decide which ITSM record it is' },
  { kind: 'identify-device', label: 'Read a serial off the device' },
  { kind: 'register-in-itsm', label: 'Register in ITSM, then re-export' },
  { kind: 'link-to-itsm', label: 'Link to its ITSM record' },
  { kind: 'label-device', label: 'Put a label on it (needs a person)' },
  { kind: 'resolve-field-differences', label: 'Resolve field differences with ITSM' },
  { kind: 'verify-disposal', label: 'Confirm it exists, or retire it in ITSM' },
];

function group(tasks: RequiredTask[]): Map<string, RequiredTask[]> {
  const byKind = new Map<string, RequiredTask[]>();
  for (const t of tasks) byKind.set(t.kind, [...(byKind.get(t.kind) ?? []), t]);
  return byKind;
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const csv = process.argv.includes('--csv');

  await AppDataSource.initialize();
  try {
    if (csv) {
      const required = await deriveRequiredTasks();
      const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      console.log('kind,subject,itsm_id,summary,evidence');
      for (const t of required) {
        console.log([t.kind, q(t.asset_id ?? t.itsm_id), q(t.itsm_id), q(t.summary),
                     q(t.evidence.replace(/\n/g, ' · '))].join(','));
      }
      return;
    }

    const result = await generateTasks({ apply, by: 'cli' });
    const open = await AppDataSource.getRepository(NormalisationTask)
      .createQueryBuilder('t').where("t.state = 'open'").getCount();
    const dismissed = await AppDataSource.getRepository(NormalisationTask)
      .createQueryBuilder('t').where("t.state = 'dismissed'").getCount();

    console.log(`📋 ${apply ? 'Updating' : 'Dry run —'} the normalisation task list\n`);

    const required = [...result.created, ...result.reopened];
    console.log(`${result.created.length} new · ${result.reopened.length} reopened · ${result.unchanged} unchanged · ${result.closed.length} closed by the data`);
    if (result.awaitingHuman.length > 0) {
      console.log(`${result.awaitingHuman.length} no longer derivable but only a person can close them (see below)`);
    }

    for (const { kind, label } of KIND_ORDER) {
      const rows = group(required).get(kind) ?? [];
      if (rows.length === 0) continue;
      console.log(`\n${label}: ${rows.length}`);
      for (const t of rows.slice(0, 25)) {
        console.log(`   - ${t.summary}`);
        for (const line of t.evidence.split('\n').slice(0, 3)) console.log(`        ${line}`);
      }
      if (rows.length > 25) console.log(`   … and ${rows.length - 25} more (use --csv for all of them)`);
    }

    if (result.closed.length > 0) {
      console.log(`\nClosed, because the data now shows them done: ${result.closed.length}`);
      for (const t of result.closed.slice(0, 15)) console.log(`   - ${t.summary}`);
    }

    if (result.awaitingHuman.length > 0) {
      // These are the human-attested kinds. Their cause has gone from the data, which
      // is not the same as someone having done them — a label is not in any export.
      console.log(`\nStill open, waiting for a person to confirm: ${result.awaitingHuman.length}`);
      for (const t of result.awaitingHuman.slice(0, 15)) console.log(`   - ${t.summary}`);
    }

    if (!apply) {
      console.log('\nNothing was written. Re-run with --apply to update the list.');
      console.log(`Stored right now: ${open} open, ${dismissed} dismissed.`);
      return;
    }

    console.log(`\n✅ List updated. ${open} open, ${dismissed} dismissed.`);
    if (open === 0) {
      console.log('   Nothing outstanding: the inventory, the app and ITSM agree.');
    }
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error('✖ Task generation failed:', err);
  process.exit(1);
});
