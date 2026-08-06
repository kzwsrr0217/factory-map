import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * AddAssetSurveyRowId — the one key a serial-less survey row does have.
 *
 * A device with no HWA number and no serial has nothing for a second import to match on, so
 * each run created another copy: 14 duplicates per re-import on the real survey, which is
 * the kind of thing that quietly erodes trust in the whole tool. The walk-around export
 * gives every entry a stable id; storing it makes those rows recognisable.
 *
 * Filtered index rather than a plain one: only a small minority of assets ever carry this,
 * and the lookup is always "find the asset for THIS survey row".
 */
export class AddAssetSurveyRowId1733200000000 implements MigrationInterface {
  name = 'AddAssetSurveyRowId1733200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "assets" ADD "survey_row_id" nvarchar(64)`);
    await queryRunner.query(`
      CREATE INDEX "IDX_assets_survey_row_id" ON "assets" ("survey_row_id")
      WHERE "survey_row_id" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_assets_survey_row_id" ON "assets"`);
    await queryRunner.query(`ALTER TABLE "assets" DROP COLUMN "survey_row_id"`);
  }
}
