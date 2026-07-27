import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * AddItsmHardwareSnapshot — landing table for MMH-scoped ITSM hardware data
 * (see ItsmHardwareSnapshot.entity.ts). Populated only by
 * import-itsm-snapshot.ts; the app never writes to it otherwise and never
 * calls the real ITSM API from inside the backend container.
 *
 * Purely additive — nothing existing is dropped or altered.
 */
export class AddItsmHardwareSnapshot1732400000000 implements MigrationInterface {
  name = 'AddItsmHardwareSnapshot1732400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "itsm_hardware_snapshot" (
        "itsm_guid" nvarchar(100) NOT NULL,
        "itsm_id" nvarchar(100) NOT NULL,
        "display_name" nvarchar(500),
        "serial_number" nvarchar(200),
        "asset_tag" nvarchar(100),
        "model" nvarchar(200),
        "manufacturer" nvarchar(200),
        "os_type" nvarchar(100),
        "os_version" nvarchar(100),
        "mac_address" nvarchar(50),
        "status" nvarchar(50),
        "location_name" nvarchar(200),
        "catalog_item_name" nvarchar(200),
        "assigned_person_name" nvarchar(200),
        "itsm_modified_at" nvarchar(50),
        "created_at" datetime2 NOT NULL CONSTRAINT "DF_itsm_hardware_snapshot_created_at" DEFAULT getdate(),
        "updated_at" datetime2 NOT NULL CONSTRAINT "DF_itsm_hardware_snapshot_updated_at" DEFAULT getdate(),
        "imported_at" datetime,
        CONSTRAINT "PK_itsm_hardware_snapshot_itsm_guid" PRIMARY KEY ("itsm_guid")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_itsm_hardware_snapshot_itsm_id" ON "itsm_hardware_snapshot" ("itsm_id")`);
    await queryRunner.query(`CREATE INDEX "IDX_itsm_hardware_snapshot_location_name" ON "itsm_hardware_snapshot" ("location_name")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "itsm_hardware_snapshot"`);
  }
}
