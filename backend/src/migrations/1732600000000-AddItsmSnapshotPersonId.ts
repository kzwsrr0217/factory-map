import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * AddItsmSnapshotPersonId — adds person_id (the real ITSM login-style ID,
 * e.g. "mmhgeza") to itsm_hardware_snapshot, resolved via the Persons CSV
 * join in import-itsm-snapshot.ts. Purely additive.
 */
export class AddItsmSnapshotPersonId1732600000000 implements MigrationInterface {
  name = 'AddItsmSnapshotPersonId1732600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "itsm_hardware_snapshot" ADD "person_id" nvarchar(100)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "itsm_hardware_snapshot" DROP COLUMN "person_id"`);
  }
}
