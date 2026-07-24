import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * AddConnectionPairId — adds `asset_connections.pair_id` (see
 * AssetConnection.entity.ts). Additive only: a nullable column, no data
 * migration needed for existing rows (they simply have no pair, i.e.
 * one-way connections, which is a safe default for pre-existing data).
 */
export class AddConnectionPairId1732200000000 implements MigrationInterface {
  name = 'AddConnectionPairId1732200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "asset_connections" ADD "pair_id" nvarchar(36)`);
    await queryRunner.query(`CREATE INDEX "IDX_asset_connections_pair_id" ON "asset_connections" ("pair_id") WHERE "pair_id" IS NOT NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_asset_connections_pair_id" ON "asset_connections"`);
    await queryRunner.query(`ALTER TABLE "asset_connections" DROP COLUMN "pair_id"`);
  }
}
