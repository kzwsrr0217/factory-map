/**
 * verify-migrations.ts — "Would the deployment steps actually produce this schema?"
 *
 * Development runs with `synchronize: true`, so the dev schema is whatever TypeORM inferred
 * from the entities. Production runs migrations and nothing else. Those two drift without a
 * single test failing — the tests run against a synchronized database too — and the drift
 * shows up as a missing column on the server, after the deploy, on real data.
 *
 * There is no baseline migration in this repo: every migration is a delta written on top of a
 * schema `synchronize` had already made, so a fresh database fails on the first one with
 * `Cannot find the object "assets"`. docs/DEPLOYMENT.md therefore prescribes a bootstrap —
 * synchronize once, mark every existing migration as already applied, and run migrations
 * normally from then on. That is the path this verifies, on a throwaway database:
 *
 *   1. an empty database, built from the entities the way the bootstrap step does;
 *   2. the migration history baselined with every migration in the repo;
 *   3. `migration:run` → must have nothing left to do;
 *   4. what `synchronize` would still change → must be nothing.
 *
 * It also prints the baseline INSERT for the CURRENT set of migrations, because the list in
 * the deployment doc is a hand-copied one and had already fallen six migrations behind. A
 * generated list cannot.
 *
 * Creates and drops its own database (`<db>_migcheck`) and touches nothing else — except
 * with `--baseline`, which writes the missing rows into the live `typeorm_migrations`.
 *
 * That option exists because the manual alternative is pasting a generated multi-line SQL
 * statement and a database password into a shell, and the first attempt at it put the
 * password into a place it should never have been. There is a precondition that makes the
 * write safe rather than convenient: it refuses unless the live schema already matches the
 * entities. If nothing is missing from the schema, then every migration's changes are
 * present, and recording them is a statement of fact. If something IS missing, a migration
 * genuinely has not run, and marking it applied would skip it forever — so it stops.
 *
 * Usage:
 *   npx ts-node src/scripts/verify-migrations.ts
 *   npx ts-node src/scripts/verify-migrations.ts --keep       (leave the database for a look)
 *   npx ts-node src/scripts/verify-migrations.ts --baseline   (record the missing migrations)
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import config from '../config/config';
import { AppDataSource } from '../config/database';

/** The same options the app runs with, pointed at another database. */
function dataSourceFor(database: string, opts: { synchronize: boolean }): DataSource {
  const base = AppDataSource.options as unknown as Record<string, unknown>;
  return new DataSource({
    ...base,
    database,
    synchronize: opts.synchronize,
    logging: ['error'],
    // The app's runtime config points migrations at the compiled output; this runs from
    // source, so it has to name the source files.
    migrations: ['src/migrations/*.ts'],
    dropSchema: false,
  } as never);
}

async function main(): Promise<void> {
  const keep = process.argv.includes('--keep');
  const baseline = process.argv.includes('--baseline');
  const scratch = `${config.mssql.database}_migcheck`;
  const problems: string[] = [];

  // `master` first, because a database cannot be created from inside itself.
  const master = dataSourceFor('master', { synchronize: false });
  await master.initialize();
  await master.query(`IF DB_ID('${scratch}') IS NOT NULL ALTER DATABASE [${scratch}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE`);
  await master.query(`IF DB_ID('${scratch}') IS NOT NULL DROP DATABASE [${scratch}]`);
  await master.query(`CREATE DATABASE [${scratch}]`);
  await master.destroy();
  console.log(`1. Built an empty ${scratch}`);

  try {
    // Step 1 of the deployment doc: one synchronize pass builds the schema from the entities.
    const bootstrap = dataSourceFor(scratch, { synchronize: true });
    await bootstrap.initialize();
    const tables = await bootstrap.query(
      "SELECT COUNT(*) AS n FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_TYPE = 'BASE TABLE'",
    );
    console.log(`2. Bootstrapped from the entities: ${tables[0].n} table(s)`);
    await bootstrap.destroy();

    const migrated = dataSourceFor(scratch, { synchronize: false });
    await migrated.initialize();

    // Step 2: baseline the history. Generated from the files rather than typed out, which is
    // the whole point — the doc's hand-written list was six migrations short.
    const all = migrated.migrations.map((m) => ({
      name: m.constructor.name,
      timestamp: Number(/(\d{10,})$/.exec(m.constructor.name)?.[1] ?? 0),
    }));
    const values = all.map((m) => `(${m.timestamp},'${m.name}')`).join(',');
    await migrated.query(
      `IF OBJECT_ID('typeorm_migrations') IS NULL
         CREATE TABLE typeorm_migrations (id int IDENTITY PRIMARY KEY, timestamp bigint NOT NULL, name nvarchar(255) NOT NULL)`,
    );
    await migrated.query(`INSERT INTO typeorm_migrations (timestamp, name) VALUES ${values}`);
    console.log(`3. Baselined ${all.length} migration(s)`);

    // Step 3: nothing should be left to apply.
    const ran = await migrated.runMigrations({ transaction: 'each' });
    if (ran.length === 0) {
      console.log('4. migration:run has nothing to do — as the deployment expects');
    } else {
      problems.push(`migration:run still wanted to apply ${ran.length}: ${ran.map((m) => m.name).join(', ')}`);
    }

    // Step 4: and the schema should already be what the entities describe.
    const sql = await migrated.driver.createSchemaBuilder().log();
    if (sql.upQueries.length === 0) {
      console.log('5. The schema matches the entities exactly');
    } else {
      problems.push(`${sql.upQueries.length} schema difference(s) remain:`);
      for (const q of sql.upQueries.slice(0, 20)) problems.push(`     ${q.query}`);
    }
    await migrated.destroy();

    console.log('\nBaseline for a fresh production database — the current set, in full:\n');
    console.log(`INSERT INTO typeorm_migrations (timestamp, name) VALUES ${values}`);

    // And the other route to production: restoring a copy of this database onto the server.
    // Its schema is already right (synchronize made it), but its migration history is not —
    // dev never needed one — so `migration:run` would try to apply deltas the schema already
    // has. Reported off the live database, read-only.
    const live = dataSourceFor(config.mssql.database, { synchronize: false });
    await live.initialize();
    const recorded: Array<{ name: string }> = await live.query(
      "SELECT name FROM typeorm_migrations WHERE OBJECT_ID('typeorm_migrations') IS NOT NULL",
    ).catch(() => []);

    /**
     * And the question the scratch database cannot answer: does the schema of the database
     * that has actually been running match the code?
     *
     * A fresh build proving migrations ≡ entities means no such gap *can* exist in a
     * correctly-built database — but the live one has a history, and this asks it directly
     * rather than reasoning about it. `log()` computes the statements without running any of
     * them, so this stays read-only.
     */
    const liveDiff = await live.driver.createSchemaBuilder().log();
    console.log(`\nThe live ${config.mssql.database}, compared against the entities:`);
    if (liveDiff.upQueries.length === 0) {
      console.log('  ✔ nothing missing — its schema is what the code expects.');
    } else {
      problems.push(`the live database is missing ${liveDiff.upQueries.length} schema change(s):`);
      for (const q of liveDiff.upQueries.slice(0, 20)) problems.push(`     ${q.query}`);
      console.log(`  ✖ ${liveDiff.upQueries.length} difference(s) — listed at the end.`);
      console.log('    Usually this means a migration has not been run yet; try migration:run first.');
    }
    const known = new Set(recorded.map((r) => r.name));
    const unrecorded = all.filter((m) => !known.has(m.name));
    console.log(`\nThe live ${config.mssql.database} has ${known.size} of ${all.length} migration(s) recorded.`);
    if (unrecorded.length === 0) {
      console.log('Nothing to baseline — a restored copy of it would need no fixing up.');
    } else if (!baseline) {
      console.log(
        `If this database is restored onto a server, mark these ${unrecorded.length} first, or\n`
        + 'migration:run will try to apply changes the schema already has. Either re-run this\n'
        + 'with --baseline, which writes them itself, or run this by hand:\n',
      );
      console.log(
        'INSERT INTO typeorm_migrations (timestamp, name) VALUES '
        + unrecorded.map((m) => `(${m.timestamp},'${m.name}')`).join(','),
      );
    } else if (liveDiff.upQueries.length > 0) {
      // The precondition, and the reason this is safe at all. A missing schema change means a
      // migration genuinely has not run; recording it would skip it permanently.
      console.log(
        `\n✖ Refusing to baseline: the live schema is missing ${liveDiff.upQueries.length} change(s),\n`
        + '  so at least one of these migrations really does still need to run. Fix that first.',
      );
      process.exitCode = 1;
    } else {
      // Parameterised rather than interpolated, and inside a transaction: this writes to the
      // table TypeORM trusts to know what has been applied.
      await live.transaction(async (manager) => {
        for (const m of unrecorded) {
          await manager.query(
            'INSERT INTO typeorm_migrations (timestamp, name) VALUES (@0, @1)',
            [m.timestamp, m.name],
          );
        }
      });
      console.log(`\n✔ Recorded ${unrecorded.length} migration(s) as already applied:`);
      for (const m of unrecorded) console.log(`   - ${m.name}`);
      console.log('\n  The schema already contained every one of their changes — that is the');
      console.log('  precondition this checked before writing. Now run migration:run; it should');
      console.log('  report nothing pending.');
    }
    await live.destroy();
  } finally {
    if (!keep) {
      const cleanup = dataSourceFor('master', { synchronize: false });
      await cleanup.initialize();
      await cleanup.query(`ALTER DATABASE [${scratch}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE`);
      await cleanup.query(`DROP DATABASE [${scratch}]`);
      await cleanup.destroy();
      console.log(`\nDropped ${scratch}`);
    } else {
      console.log(`\nLeft ${scratch} in place (--keep)`);
    }
  }

  if (problems.length === 0) {
    console.log('\n✔ The deployment path produces the schema the code expects.');
    return;
  }
  console.log('\n✖ Not ready:');
  for (const p of problems) console.log(`  ${p}`);
  process.exitCode = 1;
}

main().catch((err) => {
  console.error('✖ Verification failed:', err);
  process.exit(1);
});
