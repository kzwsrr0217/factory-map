import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * AddOrgHierarchyAndEntityKind — second hand-written migration (see
 * 1732000000000-AddMasterAssetAndIfsJoin.ts for why: the dev DB runs
 * `synchronize: true`, so `migration:generate` has nothing to diff against
 * once the entities are already applied there). Verified the same way: DDL
 * below matches the live dev DB's actual column/index definitions after
 * synchronize applied it, and `up()`/`down()` were both run against that DB
 * after temporarily reverting it (see docs/DATA_MODEL_MIGRATION.md).
 *
 * Adds:
 *  - `production_lines` / `work_centers`: organizational reference data
 *    (see ProductionLine.entity.ts / WorkCenter.entity.ts).
 *  - `entity_kinds`: configurable map-placeable types (see EntityKind.entity.ts).
 *  - `work_areas.production_line_code`, `sections.workcenter_code`,
 *    `assets.entity_kind` — soft joins to the above.
 *
 * All changes are additive — nothing existing is dropped or altered.
 */
export class AddOrgHierarchyAndEntityKind1732100000000 implements MigrationInterface {
  name = 'AddOrgHierarchyAndEntityKind1732100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "production_lines" (
        "code" nvarchar(50) NOT NULL,
        "description" nvarchar(500),
        CONSTRAINT "PK_production_lines_code" PRIMARY KEY ("code")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE "work_centers" (
        "code" nvarchar(50) NOT NULL,
        "description" nvarchar(500),
        "production_line_code" nvarchar(50),
        CONSTRAINT "PK_work_centers_code" PRIMARY KEY ("code")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_work_centers_production_line_code" ON "work_centers" ("production_line_code")`);

    await queryRunner.query(`
      CREATE TABLE "entity_kinds" (
        "value" nvarchar(50) NOT NULL,
        "label" nvarchar(200) NOT NULL,
        "geometry_type" nvarchar(20) NOT NULL CONSTRAINT "DF_entity_kinds_geometry_type" DEFAULT 'point',
        "default_color" nvarchar(20),
        "rotatable" bit NOT NULL CONSTRAINT "DF_entity_kinds_rotatable" DEFAULT 0,
        "exempt_from_orphan" bit NOT NULL CONSTRAINT "DF_entity_kinds_exempt_from_orphan" DEFAULT 0,
        "footprint" ntext,
        CONSTRAINT "PK_entity_kinds_value" PRIMARY KEY ("value")
      )
    `);

    await queryRunner.query(`ALTER TABLE "work_areas" ADD "production_line_code" nvarchar(50)`);
    await queryRunner.query(`CREATE INDEX "IDX_work_areas_production_line_code" ON "work_areas" ("production_line_code")`);

    await queryRunner.query(`ALTER TABLE "sections" ADD "workcenter_code" nvarchar(50)`);
    await queryRunner.query(`CREATE INDEX "IDX_sections_workcenter_code" ON "sections" ("workcenter_code")`);

    await queryRunner.query(`ALTER TABLE "assets" ADD "entity_kind" nvarchar(50)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "assets" DROP COLUMN "entity_kind"`);

    await queryRunner.query(`DROP INDEX "IDX_sections_workcenter_code" ON "sections"`);
    await queryRunner.query(`ALTER TABLE "sections" DROP COLUMN "workcenter_code"`);

    await queryRunner.query(`DROP INDEX "IDX_work_areas_production_line_code" ON "work_areas"`);
    await queryRunner.query(`ALTER TABLE "work_areas" DROP COLUMN "production_line_code"`);

    await queryRunner.query(`DROP TABLE "entity_kinds"`);
    await queryRunner.query(`DROP TABLE "work_centers"`);
    await queryRunner.query(`DROP TABLE "production_lines"`);
  }
}
