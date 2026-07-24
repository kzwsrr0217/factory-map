import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * AddIfsExportOptionalColumns — widens master_assets / production_lines /
 * work_centers / entity_kinds with the remaining columns present in
 * shopfloor_visualizer's real IFS/Databricks export shapes (verified against
 * its ingest scripts and sample JSON — see each entity's class doc). Every
 * column added here is **nullable**: existing hand-seeded rows keep working
 * unchanged, and an IFS export can populate the extra fields when one arrives.
 *
 * Additive only, no data migration needed.
 */
export class AddIfsExportOptionalColumns1732300000000 implements MigrationInterface {
  name = 'AddIfsExportOptionalColumns1732300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // master_assets — machines-projection extra + OT-assets-projection extras
    await queryRunner.query(`ALTER TABLE "master_assets" ADD "ifs_machine_part_no" nvarchar(50)`);
    await queryRunner.query(`ALTER TABLE "master_assets" ADD "ifs_part_no" nvarchar(50)`);
    await queryRunner.query(`ALTER TABLE "master_assets" ADD "ifs_part_description" nvarchar(500)`);
    await queryRunner.query(`ALTER TABLE "master_assets" ADD "ifs_serial_state" nvarchar(50)`);
    await queryRunner.query(`ALTER TABLE "master_assets" ADD "ifs_operational_condition" nvarchar(50)`);
    await queryRunner.query(`ALTER TABLE "master_assets" ADD "ifs_server_path" nvarchar(500)`);
    await queryRunner.query(`ALTER TABLE "master_assets" ADD "cmdb_model" nvarchar(200)`);
    await queryRunner.query(`ALTER TABLE "master_assets" ADD "cmdb_serial_number" nvarchar(100)`);

    // production_lines — IFS Contract (site)
    await queryRunner.query(`ALTER TABLE "production_lines" ADD "contract" nvarchar(20)`);

    // work_centers — IFS Contract / Objstate / DepartmentNo / CostCenterId
    await queryRunner.query(`ALTER TABLE "work_centers" ADD "contract" nvarchar(20)`);
    await queryRunner.query(`ALTER TABLE "work_centers" ADD "objstate" nvarchar(30)`);
    await queryRunner.query(`ALTER TABLE "work_centers" ADD "department_no" nvarchar(50)`);
    await queryRunner.query(`ALTER TABLE "work_centers" ADD "cost_center_id" nvarchar(50)`);

    // entity_kinds — 3D-view fields (stored for lossless round-trip only)
    await queryRunner.query(`ALTER TABLE "entity_kinds" ADD "model" nvarchar(200)`);
    await queryRunner.query(`ALTER TABLE "entity_kinds" ADD "model_scale" float`);
    await queryRunner.query(`ALTER TABLE "entity_kinds" ADD "preserve_model_colors" bit`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "entity_kinds" DROP COLUMN "preserve_model_colors"`);
    await queryRunner.query(`ALTER TABLE "entity_kinds" DROP COLUMN "model_scale"`);
    await queryRunner.query(`ALTER TABLE "entity_kinds" DROP COLUMN "model"`);

    await queryRunner.query(`ALTER TABLE "work_centers" DROP COLUMN "cost_center_id"`);
    await queryRunner.query(`ALTER TABLE "work_centers" DROP COLUMN "department_no"`);
    await queryRunner.query(`ALTER TABLE "work_centers" DROP COLUMN "objstate"`);
    await queryRunner.query(`ALTER TABLE "work_centers" DROP COLUMN "contract"`);

    await queryRunner.query(`ALTER TABLE "production_lines" DROP COLUMN "contract"`);

    await queryRunner.query(`ALTER TABLE "master_assets" DROP COLUMN "cmdb_serial_number"`);
    await queryRunner.query(`ALTER TABLE "master_assets" DROP COLUMN "cmdb_model"`);
    await queryRunner.query(`ALTER TABLE "master_assets" DROP COLUMN "ifs_server_path"`);
    await queryRunner.query(`ALTER TABLE "master_assets" DROP COLUMN "ifs_operational_condition"`);
    await queryRunner.query(`ALTER TABLE "master_assets" DROP COLUMN "ifs_serial_state"`);
    await queryRunner.query(`ALTER TABLE "master_assets" DROP COLUMN "ifs_part_description"`);
    await queryRunner.query(`ALTER TABLE "master_assets" DROP COLUMN "ifs_part_no"`);
    await queryRunner.query(`ALTER TABLE "master_assets" DROP COLUMN "ifs_machine_part_no"`);
  }
}
