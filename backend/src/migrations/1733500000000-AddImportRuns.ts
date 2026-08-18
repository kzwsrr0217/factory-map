import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * AddImportRuns — a ledger of imports, so full-replace snapshots stop being amnesiac.
 *
 * `counts`, `present_keys` and `detail` are `ntext`, which is what TypeORM's `simple-json` maps to
 * on SQL Server and what every other json column in this schema already is. See
 * AddReconcileItsmWrong for why that mapping is followed rather than improved here.
 *
 * Indexed on `source` and `imported_at` because the only two access patterns are "the latest run
 * for this source" (which needs both) and "the history of this source". No composite index: at one
 * or two runs a day this table is measured in hundreds of rows for years.
 */
export class AddImportRuns1733500000000 implements MigrationInterface {
  name = 'AddImportRuns1733500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "import_runs" (
        "id" uniqueidentifier NOT NULL CONSTRAINT "DF_import_runs_id" DEFAULT NEWSEQUENTIALID(),
        "source" nvarchar(40) NOT NULL,
        "taken_at" datetime2,
        "imported_at" datetime2 NOT NULL,
        "row_count" int NOT NULL,
        "counts" ntext,
        "present_keys" ntext,
        "detail" ntext,
        "imported_by" nvarchar(100),
        "created_at" datetime2 NOT NULL CONSTRAINT "DF_import_runs_created_at" DEFAULT getdate(),
        CONSTRAINT "PK_import_runs" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_import_runs_source" ON "import_runs" ("source")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_import_runs_imported_at" ON "import_runs" ("imported_at")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_import_runs_imported_at" ON "import_runs"`);
    await queryRunner.query(`DROP INDEX "IDX_import_runs_source" ON "import_runs"`);
    await queryRunner.query(`DROP TABLE "import_runs"`);
  }
}
