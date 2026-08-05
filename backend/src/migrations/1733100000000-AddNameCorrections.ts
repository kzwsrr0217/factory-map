import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * AddNameCorrections — the survey's free text, mapped onto the app's names.
 *
 * See NameCorrection.entity.ts for why this is a table rather than the
 * `inventory-corrections.json` file it replaces: the mapping is a lasting decision, and
 * as a file it only existed on the machine that last ran the importer.
 *
 * `from_folded` is 300 characters and part of a unique index, which is well inside
 * MSSQL's 1700-byte key limit for the two columns together (20 + 600 bytes).
 *
 * No FK anywhere on purpose. A correction may name a room that does not exist yet — that
 * is the normal case, since the point is often to make the survey point at a room
 * somebody is about to draw.
 */
export class AddNameCorrections1733100000000 implements MigrationInterface {
  name = 'AddNameCorrections1733100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "name_corrections" (
        "id" uniqueidentifier NOT NULL CONSTRAINT "DF_name_corrections_id" DEFAULT NEWSEQUENTIALID(),
        "scope" nvarchar(20) NOT NULL,
        "from_value" nvarchar(300) NOT NULL,
        "from_folded" nvarchar(300) NOT NULL,
        "to_value" nvarchar(300) NOT NULL,
        "note" nvarchar(500),
        "created_by" nvarchar(200),
        "created_at" datetime2 NOT NULL CONSTRAINT "DF_name_corrections_created" DEFAULT getdate(),
        "updated_at" datetime2 NOT NULL CONSTRAINT "DF_name_corrections_updated" DEFAULT getdate(),
        CONSTRAINT "PK_name_corrections" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_name_corrections_scope_from"
      ON "name_corrections" ("scope", "from_folded")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "UQ_name_corrections_scope_from" ON "name_corrections"`);
    await queryRunner.query(`DROP TABLE "name_corrections"`);
  }
}
