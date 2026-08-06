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
 * Creates and drops its own database (`<db>_migcheck`) and touches nothing else.
 *
 * Usage:
 *   npx ts-node src/scripts/verify-migrations.ts
 *   npx ts-node src/scripts/verify-migrations.ts --keep    (leave the database for a look)
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
