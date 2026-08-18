import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * AddSurveyObservation — the survey finally gets a landing table.
 *
 * ITSM had `itsm_hardware_snapshot` and Nexthink has `nexthink_device_snapshot`. The survey — the
 * only source where a person physically stood in the room and looked — was read, applied to
 * `assets`, and discarded. So the most direct evidence in the system was the only evidence not kept.
 *
 * No foreign key on `resolved_asset_id`, for the same reason the other two landing tables have
 * none: this is evidence from outside, and a FK would refuse to keep an observation whose asset was
 * later deleted — precisely the row somebody would want to look at afterwards.
 *
 * `suppressed_fields` is `ntext`, matching every other `simple-json` column in this schema. See
 * AddReconcileItsmWrong for why that mapping is followed rather than improved.
 */
export class AddSurveyObservation1733600000000 implements MigrationInterface {
  name = 'AddSurveyObservation1733600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "survey_observation" (
        "id" uniqueidentifier NOT NULL CONSTRAINT "DF_survey_observation_id" DEFAULT NEWSEQUENTIALID(),
        "survey_row_id" nvarchar(100),
        "terulet" nvarchar(200),
        "epulet" nvarchar(200),
        "emelet" nvarchar(200),
        "helyszin" nvarchar(300),
        "work_area" nvarchar(300),
        "szemely" nvarchar(200),
        "megjegyzes" nvarchar(1000),
        "azonosito_mod" nvarchar(100),
        "hwa" nvarchar(100),
        "eszkoz_tipus" nvarchar(200),
        "sorozatszam" nvarchar(200),
        "resolved_asset_id" uniqueidentifier,
        "resolution" nvarchar(20) NOT NULL,
        "suppressed_fields" ntext,
        "imported_at" datetime2,
        "created_at" datetime2 NOT NULL CONSTRAINT "DF_survey_observation_created_at" DEFAULT getdate(),
        CONSTRAINT "PK_survey_observation" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_survey_observation_row_id" ON "survey_observation" ("survey_row_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_survey_observation_hwa" ON "survey_observation" ("hwa")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_survey_observation_asset" ON "survey_observation" ("resolved_asset_id")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_survey_observation_resolution" ON "survey_observation" ("resolution")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_survey_observation_resolution" ON "survey_observation"`);
    await queryRunner.query(`DROP INDEX "IDX_survey_observation_asset" ON "survey_observation"`);
    await queryRunner.query(`DROP INDEX "IDX_survey_observation_hwa" ON "survey_observation"`);
    await queryRunner.query(`DROP INDEX "IDX_survey_observation_row_id" ON "survey_observation"`);
    await queryRunner.query(`DROP TABLE "survey_observation"`);
  }
}
