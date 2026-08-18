import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * AddReconcileItsmWrong — storage for the third reconcile decision.
 *
 * Two decisions existed: accept the ITSM value, or ignore the difference. Neither covers the case
 * that dominates after a physical survey — the record is stale and the room is right — so that
 * case had nowhere to be recorded and was carried outside the system.
 *
 * `ntext`, not `nvarchar(MAX)`. That is what TypeORM's `simple-json` maps to on SQL Server, and
 * what `reconcile_ignored`, `itsm_snapshot` and `sync_errors` beside it already are. `ntext` is
 * deprecated by Microsoft and `nvarchar(MAX)` would be the better column — but a migration that
 * disagrees with the entity means `migration:generate` proposes the same change forever and
 * `verify:migrations` never goes green. Changing the mapping is a separate decision for all four
 * columns at once, not a thing to do quietly in the fourth one.
 *
 * Nullable with no default, so an asset with no such decision stores nothing rather than an empty
 * array — the same convention as the ignore list, which keeps "never decided" and "decided
 * nothing" distinguishable.
 */
export class AddReconcileItsmWrong1733400000000 implements MigrationInterface {
  name = 'AddReconcileItsmWrong1733400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "assets" ADD "reconcile_itsm_wrong" ntext NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "assets" DROP COLUMN "reconcile_itsm_wrong"
    `);
  }
}
