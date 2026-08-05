/**
 * set-password.ts — Sets a local user's password on a development database.
 *
 * Why this exists: forgetting the seeded dev password otherwise means running
 * `seed-mssql.ts`, which deletes ALL existing data (its own header says so) — an
 * absurd price for getting back into a local login, and on a database holding a real
 * ITSM import it would be a disaster.
 *
 * ── How the password is handled ─────────────────────────────────────────────────
 * Read from stdin with echo switched off. Deliberately NOT from an argument or an
 * environment variable: argv lands in shell history and in `ps` output, and an env var
 * lands in the shell's own history the moment someone types it. It is never printed,
 * never logged, and the script's own output says only which user changed.
 *
 * Hashing is left to the entity's `@BeforeUpdate` hook (bcrypt, cost 12) so there is
 * exactly one place in the codebase that knows how a password is stored.
 *
 * ── Refuses on production ───────────────────────────────────────────────────────
 * A password-setting script that runs anywhere is a way in. This one stops when
 * NODE_ENV is production, and says so.
 *
 * Usage (it will prompt):
 *   npm run set:password -- --username admin
 */
import 'reflect-metadata';
import * as readline from 'readline';
import { AppDataSource } from '../config/database';
import { User } from '../entities/User.entity';

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (hit) return hit.slice(name.length + 3);
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

/**
 * Prompts without echoing. `readline` has no built-in for this, so the tty's raw mode
 * does it: characters are consumed and never written back to the terminal.
 */
function promptHidden(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!process.stdin.isTTY) {
      reject(new Error('No terminal to prompt on. Run this interactively — the password is never taken from an argument or an environment variable.'));
      return;
    }
    process.stdout.write(question);
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    // Swallow the echo of every keystroke.
    const onData = () => { /* nothing is written back */ };
    (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = onData;
    rl.question('', (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    console.error('✖ Refusing to run with NODE_ENV=production.');
    console.error('  Change a production password through the app\'s user management, where it is audited.');
    process.exit(1);
  }

  const username = arg('username');
  if (!username) {
    console.error('✖ Which user? e.g. npm run set:password -- --username admin');
    process.exit(1);
  }

  await AppDataSource.initialize();
  try {
    const repo = AppDataSource.getRepository(User);
    const user = await repo.findOne({ where: { username } });
    if (!user) {
      // Named rather than silently doing nothing: a typo here otherwise looks like a
      // password that did not take.
      console.error(`✖ No user "${username}".`);
      const all = await repo.find();
      console.error(`  Users on this database: ${all.map((u) => u.username).join(', ') || '(none)'}`);
      process.exit(1);
    }

    const first = await promptHidden(`New password for "${username}" (not shown): `);
    if (first.length < 8) {
      console.error('✖ Too short — at least 8 characters.');
      process.exit(1);
    }
    const second = await promptHidden('Again, to be sure: ');
    if (first !== second) {
      console.error('✖ They do not match. Nothing was changed.');
      process.exit(1);
    }

    // Assigning the plain value on purpose: @BeforeUpdate hashes it, and that hook is
    // the single place that decides how (see User.entity.ts).
    user.password = first;
    await repo.save(user);

    console.log(`✅ Password set for "${username}" on database ${AppDataSource.options.database}.`);
    console.log('   It was not printed, logged, or passed on a command line.');
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error('✖ Failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
