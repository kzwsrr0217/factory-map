import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * AddNormalisationTasks — the derived to-do list that closes the inventory.
 *
 * See NormalisationTask.entity.ts for why these rows are recomputed rather than
 * maintained, and why the only human-owned columns are the assignee, the note and the
 * dismissal.
 *
 * The unique index on (kind, subject_key) is the point of the table rather than a
 * detail: it is what makes the generator idempotent. Without it, running the generator
 * twice would double the list, and a list that grows when you look at it is worse than
 * no list.
 *
 * No FK to `assets`: a task can be about an ITSM record that has no local asset at all,
 * and one about an asset that is later deleted should survive long enough to be seen
 * rather than vanish silently (the generator closes it on the next run).
 */
export class AddNormalisationTasks1733000000000 implements MigrationInterface {
  name = 'AddNormalisationTasks1733000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "normalisation_tasks" (
        "id" uniqueidentifier NOT NULL CONSTRAINT "DF_normalisation_tasks_id" DEFAULT NEWSEQUENTIALID(),
        "kind" nvarchar(40) NOT NULL,
        "subject_key" nvarchar(100) NOT NULL,
        "asset_id" nvarchar(36),
        "itsm_id" nvarchar(100),
        "summary" nvarchar(1000) NOT NULL,
        "evidence" nvarchar(MAX),
        "evidence_hash" nvarchar(64) NOT NULL,
        "state" nvarchar(20) NOT NULL CONSTRAINT "DF_normalisation_tasks_state" DEFAULT 'open',
        "assigned_to" nvarchar(200),
        "note" nvarchar(1000),
        "closed_by" nvarchar(200),
        "closed_at" datetime2,
        "first_seen_at" datetime2 NOT NULL CONSTRAINT "DF_normalisation_tasks_first_seen" DEFAULT getdate(),
        "last_seen_at" datetime2 NOT NULL CONSTRAINT "DF_normalisation_tasks_last_seen" DEFAULT getdate(),
        CONSTRAINT "PK_normalisation_tasks" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_normalisation_tasks_subject"
      ON "normalisation_tasks" ("kind", "subject_key")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_normalisation_tasks_state" ON "normalisation_tasks" ("state")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_normalisation_tasks_state" ON "normalisation_tasks"`);
    await queryRunner.query(`DROP INDEX "UQ_normalisation_tasks_subject" ON "normalisation_tasks"`);
    await queryRunner.query(`DROP TABLE "normalisation_tasks"`);
  }
}
