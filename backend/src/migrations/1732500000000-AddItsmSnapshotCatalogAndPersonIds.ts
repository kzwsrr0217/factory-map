import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * AddItsmSnapshotCatalogAndPersonIds — adds catalog_itsm_id, asset_type, and
 * person_itsm_id to itsm_hardware_snapshot (see ItsmHardwareSnapshot.entity.ts).
 * Purely additive.
 */
export class AddItsmSnapshotCatalogAndPersonIds1732500000000 implements MigrationInterface {
  name = 'AddItsmSnapshotCatalogAndPersonIds1732500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "itsm_hardware_snapshot" ADD "catalog_itsm_id" nvarchar(100)`);
    await queryRunner.query(`ALTER TABLE "itsm_hardware_snapshot" ADD "asset_type" nvarchar(50)`);
    await queryRunner.query(`ALTER TABLE "itsm_hardware_snapshot" ADD "person_itsm_id" nvarchar(100)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "itsm_hardware_snapshot" DROP COLUMN "person_itsm_id"`);
    await queryRunner.query(`ALTER TABLE "itsm_hardware_snapshot" DROP COLUMN "asset_type"`);
    await queryRunner.query(`ALTER TABLE "itsm_hardware_snapshot" DROP COLUMN "catalog_itsm_id"`);
  }
}
