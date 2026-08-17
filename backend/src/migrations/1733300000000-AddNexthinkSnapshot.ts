import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * AddNexthinkSnapshot — two landing tables for what the machines report about themselves.
 *
 * Separate tables rather than columns on `assets` on purpose: these are evidence from an
 * outside system, replaced wholesale on every import, and mixing that into the record the
 * app owns would make it impossible to say which of the two a value came from. Same reasoning
 * as `itsm_hardware_snapshot`.
 *
 * No foreign key to `assets` either. `device_name` corresponds to `Asset.hardware_asset_id`,
 * which is nullable and not unique-constrained, so it could not be a FK target anyway — but the
 * stronger reason is that the whole point of the first report built on this is the rows that
 * DON'T match. A machine Nexthink can see that the map has never heard of is the interesting
 * case, and a FK would refuse to store it.
 */
export class AddNexthinkSnapshot1733300000000 implements MigrationInterface {
  name = 'AddNexthinkSnapshot1733300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "nexthink_device_snapshot" (
        "device_name" nvarchar(100) NOT NULL,
        "entity" nvarchar(100),
        "first_seen" datetime2,
        "last_seen" datetime2,
        "hardware_type" nvarchar(50),
        "manufacturer" nvarchar(100),
        "model" nvarchar(200),
        "bios_serial" nvarchar(100),
        "os_name" nvarchar(200),
        "created_at" datetime2 NOT NULL CONSTRAINT "DF_nexthink_device_created_at" DEFAULT getdate(),
        "updated_at" datetime2 NOT NULL CONSTRAINT "DF_nexthink_device_updated_at" DEFAULT getdate(),
        "imported_at" datetime,
        CONSTRAINT "PK_nexthink_device_snapshot" PRIMARY KEY ("device_name")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_nexthink_device_entity" ON "nexthink_device_snapshot" ("entity")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_nexthink_device_last_seen" ON "nexthink_device_snapshot" ("last_seen")
    `);

    await queryRunner.query(`
      CREATE TABLE "nexthink_login_snapshot" (
        "device_name" nvarchar(100) NOT NULL,
        "user_name" nvarchar(200) NOT NULL,
        "full_name" nvarchar(200),
        "logins" int NOT NULL CONSTRAINT "DF_nexthink_login_logins" DEFAULT 0,
        "account_kind" nvarchar(20) NOT NULL,
        "created_at" datetime2 NOT NULL CONSTRAINT "DF_nexthink_login_created_at" DEFAULT getdate(),
        "updated_at" datetime2 NOT NULL CONSTRAINT "DF_nexthink_login_updated_at" DEFAULT getdate(),
        "imported_at" datetime,
        CONSTRAINT "PK_nexthink_login_snapshot" PRIMARY KEY ("device_name", "user_name")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_nexthink_login_device_name" ON "nexthink_login_snapshot" ("device_name")
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_nexthink_login_account_kind" ON "nexthink_login_snapshot" ("account_kind")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_nexthink_login_account_kind" ON "nexthink_login_snapshot"`);
    await queryRunner.query(`DROP INDEX "IDX_nexthink_login_device_name" ON "nexthink_login_snapshot"`);
    await queryRunner.query(`DROP TABLE "nexthink_login_snapshot"`);
    await queryRunner.query(`DROP INDEX "IDX_nexthink_device_last_seen" ON "nexthink_device_snapshot"`);
    await queryRunner.query(`DROP INDEX "IDX_nexthink_device_entity" ON "nexthink_device_snapshot"`);
    await queryRunner.query(`DROP TABLE "nexthink_device_snapshot"`);
  }
}
