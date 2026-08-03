/**
 * scratch-verify-wallport-migration.ts — one-off verification of
 * 1732900000000-AddWallPortWorkArea against a throwaway database.
 *
 * Builds a pre-migration `wall_ports` + `work_areas` schema, seeds the three
 * cases the conversion has to distinguish (inside exactly one rectangle /
 * inside two overlapping ones / never positioned), runs up() and down(), and
 * asserts. Delete once the migration has run in production.
 *
 * Run: podman exec factory-map-backend sh -c 'cd /app && npx ts-node src/scripts/scratch-verify-wallport-migration.ts'
 */
import 'reflect-metadata';
import { DataSource } from 'typeorm';
import config from '../config/config';
import { AddWallPortWorkArea1732900000000 } from '../migrations/1732900000000-AddWallPortWorkArea';

/** Same connection settings the app uses, pointed at another database. */
function connect(database: string): DataSource {
  return new DataSource({
    type: 'mssql',
    host: config.mssql.host,
    port: config.mssql.port,
    username: config.mssql.username,
    password: config.mssql.password,
    database,
    options: { encrypt: config.mssql.encrypt, trustServerCertificate: config.mssql.trustServerCertificate },
  });
}

const DB = 'factorymap_wpmig_test';

async function main(): Promise<void> {
  const admin = connect('master');
  await admin.initialize();
  await admin.query(`IF DB_ID('${DB}') IS NOT NULL BEGIN ALTER DATABASE [${DB}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${DB}]; END`);
  await admin.query(`CREATE DATABASE [${DB}]`);
  await admin.destroy();

  const ds = connect(DB);
  await ds.initialize();

  // Pre-migration schema, only the columns the conversion reads.
  await ds.query(`
    CREATE TABLE "work_areas" (
      "id" uniqueidentifier NOT NULL DEFAULT NEWID(),
      "floor_id" nvarchar(255) NOT NULL,
      "name" nvarchar(200) NOT NULL,
      "coord_x" float NOT NULL, "coord_y" float NOT NULL,
      "dim_width" float NOT NULL, "dim_height" float NOT NULL,
      CONSTRAINT "PK_wa" PRIMARY KEY ("id")
    )`);
  await ds.query(`
    CREATE TABLE "wall_ports" (
      "id" uniqueidentifier NOT NULL DEFAULT NEWID(),
      "label" nvarchar(50) NOT NULL,
      "floor_id" nvarchar(255) NOT NULL,
      "pos_x" float NOT NULL DEFAULT 0, "pos_y" float NOT NULL DEFAULT 0,
      CONSTRAINT "PK_wp" PRIMARY KEY ("id")
    )`);

  const FLOOR = 'floor-1';
  // HR Office: 100,100 → 300,300.  Overlap A/B share 500..600 x 100..200.
  await ds.query(`INSERT INTO "work_areas" ("floor_id","name","coord_x","coord_y","dim_width","dim_height") VALUES
    ('${FLOOR}','HR Office',100,100,200,200),
    ('${FLOOR}','Overlap A',400,100,200,100),
    ('${FLOOR}','Overlap B',500,100,200,100),
    ('other-floor','Wrong Floor',100,100,200,200)`);

  await ds.query(`INSERT INTO "wall_ports" ("label","floor_id","pos_x","pos_y") VALUES
    ('R1/001','${FLOOR}',150,150),
    ('R1/002','${FLOOR}',550,150),
    ('R1/003','${FLOOR}',0,0),
    ('R1/004','${FLOOR}',900,900),
    ('R1/005','other-floor',150,150)`);

  const migration = new AddWallPortWorkArea1732900000000();
  const runner = ds.createQueryRunner();
  await migration.up(runner);

  const rows: Array<{ label: string; area: string | null }> = await ds.query(`
    SELECT wp."label", wa."name" AS "area"
    FROM "wall_ports" wp
    LEFT JOIN "work_areas" wa ON CONVERT(nvarchar(255), wa."id") = wp."workarea_id"
    ORDER BY wp."label"`);

  const got = new Map(rows.map((r) => [r.label, r.area]));
  const expected: Record<string, string | null> = {
    'R1/001': 'HR Office',   // inside exactly one rectangle
    'R1/002': null,          // inside two overlapping rectangles → not guessed
    'R1/003': null,          // never positioned (0,0)
    'R1/004': null,          // positioned, but in no rectangle
    'R1/005': 'Wrong Floor', // matches only its own floor's rectangle
  };

  let failures = 0;
  for (const [label, want] of Object.entries(expected)) {
    const actual = got.get(label) ?? null;
    const ok = actual === want;
    if (!ok) failures++;
    console.log(`${ok ? 'OK  ' : 'FAIL'} ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(want)}`);
  }

  await migration.down(runner);
  const cols: Array<{ name: string }> = await ds.query(
    `SELECT "name" FROM sys.columns WHERE object_id = OBJECT_ID('wall_ports')`,
  );
  const stillThere = cols.some((c) => c.name === 'workarea_id');
  console.log(`${stillThere ? 'FAIL' : 'OK  '} down() dropped workarea_id`);
  if (stillThere) failures++;
  const posKept = cols.some((c) => c.name === 'pos_x') && cols.some((c) => c.name === 'pos_y');
  console.log(`${posKept ? 'OK  ' : 'FAIL'} down() kept pos_x/pos_y`);
  if (!posKept) failures++;

  await runner.release();
  await ds.destroy();

  const cleanup = connect('master');
  await cleanup.initialize();
  await cleanup.query(`ALTER DATABASE [${DB}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; DROP DATABASE [${DB}]`);
  await cleanup.destroy();

  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
