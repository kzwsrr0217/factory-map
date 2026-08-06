/**
 * prune-dev-accounts.ts — The accounts a copy of the development database brings with it.
 *
 * The first production database is a restore of the development one, because the survey, the
 * rooms and the corrections exist nowhere else. The accounts come with it: the test suites
 * create users as they go (`bulk_viewer_1784808889307`, `rbactest_viewer`) and the seeded
 * `admin` / `operator` / `viewer` carry development passwords. On dev that is noise; on a
 * server reachable by other machines it is a way in.
 *
 * So this names them and removes them. Dry run by default, because "delete users matching a
 * pattern" is exactly the command that should be read before it is run.
 *
 * What it will not do:
 *  - touch an admin. Deleting the only administrator locks everyone out of an app whose user
 *    endpoints require one, and no pattern is worth that risk.
 *  - decide about the seeded accounts. `operator` and `viewer` may be real accounts someone
 *    intends to use; they are reported, with the reminder that their password came from a
 *    seed script, and left alone.
 *
 * Usage:
 *   npx ts-node src/scripts/prune-dev-accounts.ts             (reports, deletes nothing)
 *   npx ts-node src/scripts/prune-dev-accounts.ts --apply
 */
import 'reflect-metadata';
import { AppDataSource } from '../config/database';
import { ActiveSession } from '../entities/ActiveSession.entity';
import { User } from '../entities/User.entity';

/**
 * Names only a test suite produces. Anchored and specific on purpose: a loose pattern like
 * /test/ would match a real person whose username happens to contain it.
 */
const TEST_ACCOUNT = [
  /^bulk_viewer_\d+$/i,
  /^rbactest_/i,
  /^rbac_test_/i,
  /^__test/i,
  /^perftest_/i,
];

/** Seeded by seed-mssql.ts, so their passwords are in the repository. */
const SEEDED = new Set(['admin', 'operator', 'viewer']);

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');

  await AppDataSource.initialize();
  try {
    const userRepo = AppDataSource.getRepository(User);
    const users = await userRepo.find();

    const testAccounts = users.filter(
      (u) => u.role !== 'admin' && TEST_ACCOUNT.some((p) => p.test(u.username)),
    );
    const seeded = users.filter((u) => SEEDED.has(u.username.toLowerCase()));
    const rest = users.filter((u) => !testAccounts.includes(u) && !seeded.includes(u));
    const adminsMatchingPattern = users.filter(
      (u) => u.role === 'admin' && TEST_ACCOUNT.some((p) => p.test(u.username)),
    );

    console.log(`\n${users.length} account(s) in this database.\n`);

    if (testAccounts.length === 0) {
      console.log('  No test accounts found — nothing to remove.');
    } else {
      console.log(`  ${apply ? 'Removing' : 'Would remove'} ${testAccounts.length} test account(s):`);
      for (const u of testAccounts) console.log(`   - ${u.username} (${u.role})`);
    }

    if (adminsMatchingPattern.length > 0) {
      console.log('\n  Matches the pattern but is an admin, so left alone — delete by hand if it is really a test account:');
      for (const u of adminsMatchingPattern) console.log(`   - ${u.username}`);
    }

    if (seeded.length > 0) {
      console.log('\n  Seeded accounts — kept, but their passwords are in the repository:');
      for (const u of seeded) console.log(`   - ${u.username} (${u.role})`);
      console.log('     Change each one: npm run set:password -- --username <name>');
    }

    if (rest.length > 0) {
      console.log('\n  Real accounts, untouched:');
      for (const u of rest) console.log(`   - ${u.username} (${u.role})`);
    }

    if (!apply) {
      console.log('\n  Nothing written. Re-run with --apply.\n');
      return;
    }
    if (testAccounts.length === 0) return;

    // Sessions first: a deleted user's session row would otherwise point at nobody, and the
    // revocation check reads that table on every request.
    const sessionRepo = AppDataSource.getRepository(ActiveSession);
    let sessions = 0;
    for (const u of testAccounts) {
      const result = await sessionRepo.delete({ user_id: u.id });
      sessions += result.affected ?? 0;
    }
    await userRepo.remove(testAccounts);
    console.log(`\n  Removed ${testAccounts.length} account(s) and ${sessions} session(s).\n`);
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error('Prune failed:', err);
  process.exit(1);
});
