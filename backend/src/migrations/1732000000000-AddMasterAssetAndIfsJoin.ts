import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * AddMasterAssetAndIfsJoin — first real migration for this project (the repo
 * previously relied on TypeORM `synchronize: true` in dev, per
 * backend/src/migrations/README.md). Written by hand rather than
 * `migration:generate` because the dev DB already had the target schema
 * applied via synchronize before this file was authored — the DDL below was
 * verified by hand against the live dev DB's actual column/index definitions
 * (see docs/DATA_MODEL_MIGRATION.md) and by running it against the same DB
 * after temporarily reverting it.
 *
 * Adds:
 *  - `master_assets`: read-only IFS/CMDB master data (see MasterAsset.entity.ts).
 *  - `assets.master_ifs_id` (+ filtered index) and `assets.loc_footprint`.
 *  - `floors.svg_ref` and `floors.scale_meters_per_unit`.
 *
 * All changes are additive — nothing existing is dropped or altered.
 */
export class AddMasterAssetAndIfsJoin1732000000000 implements MigrationInterface {
  name = 'AddMasterAssetAndIfsJoin1732000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "master_assets" (
        "ifs_id" nvarchar(50) NOT NULL,
        "ifs_site" nvarchar(20),
        "ifs_operational_status" nvarchar(50),
        "ifs_machine_id" nvarchar(50),
        "ifs_machine_part_description" nvarchar(500),
        "ifs_production_line_id" nvarchar(50),
        "ifs_workcenter_id" nvarchar(50),
        "ifs_workcenter_description" nvarchar(500),
        "ifs_cost_center" nvarchar(50),
        "cmdb_id" nvarchar(100),
        "cmdb_status" nvarchar(50),
        "cmdb_mac_address" nvarchar(50),
        "cmdb_catalog_item" nvarchar(100),
        "cmdb_os" nvarchar(100),
        "cmdb_os_version" nvarchar(100),
        "cmdb_manufacturer" nvarchar(200),
        "cmdb_received_date" datetime,
        "created_at" datetime2 NOT NULL CONSTRAINT "DF_master_assets_created_at" DEFAULT getdate(),
        "updated_at" datetime2 NOT NULL CONSTRAINT "DF_master_assets_updated_at" DEFAULT getdate(),
        "imported_at" datetime,
        CONSTRAINT "PK_master_assets_ifs_id" PRIMARY KEY ("ifs_id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_master_assets_ifs_site" ON "master_assets" ("ifs_site")`);
    await queryRunner.query(`CREATE INDEX "IDX_master_assets_ifs_machine_id" ON "master_assets" ("ifs_machine_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_master_assets_ifs_production_line_id" ON "master_assets" ("ifs_production_line_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_master_assets_ifs_workcenter_id" ON "master_assets" ("ifs_workcenter_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_master_assets_cmdb_id" ON "master_assets" ("cmdb_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_master_assets_cmdb_status" ON "master_assets" ("cmdb_status")`);

    await queryRunner.query(`ALTER TABLE "assets" ADD "master_ifs_id" nvarchar(50)`);
    await queryRunner.query(`ALTER TABLE "assets" ADD "loc_footprint" ntext`);
    await queryRunner.query(`
      CREATE INDEX "IDX_assets_master_ifs_id" ON "assets" ("master_ifs_id")
      WHERE "master_ifs_id" IS NOT NULL
    `);

    await queryRunner.query(`ALTER TABLE "floors" ADD "svg_ref" nvarchar(500)`);
    await queryRunner.query(`ALTER TABLE "floors" ADD "scale_meters_per_unit" float`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "floors" DROP COLUMN "scale_meters_per_unit"`);
    await queryRunner.query(`ALTER TABLE "floors" DROP COLUMN "svg_ref"`);

    await queryRunner.query(`DROP INDEX "IDX_assets_master_ifs_id" ON "assets"`);
    await queryRunner.query(`ALTER TABLE "assets" DROP COLUMN "loc_footprint"`);
    await queryRunner.query(`ALTER TABLE "assets" DROP COLUMN "master_ifs_id"`);

    await queryRunner.query(`DROP TABLE "master_assets"`);
  }
}
