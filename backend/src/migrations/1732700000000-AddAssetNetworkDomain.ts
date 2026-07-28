import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * AddAssetNetworkDomain — adds network_domain (e.g. "Client Operation" vs
 * "Operation Technology") to assets, sourced from the physical inventory
 * survey tool. Purely additive.
 */
export class AddAssetNetworkDomain1732700000000 implements MigrationInterface {
  name = 'AddAssetNetworkDomain1732700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "assets" ADD "network_domain" nvarchar(100)`);
    await queryRunner.query(`CREATE INDEX "IDX_assets_network_domain" ON "assets" ("network_domain")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_assets_network_domain" ON "assets"`);
    await queryRunner.query(`ALTER TABLE "assets" DROP COLUMN "network_domain"`);
  }
}
