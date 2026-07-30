import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * AddZoneLevel — introduces the Zone level between Floor and WorkArea, making
 * the hierarchy Building → Floor → Zone → WorkArea (see Zone.entity.ts).
 *
 * Also **converts existing data**: `work_areas.area_type` had been doubling as
 * the zone name (there was no Zone entity), so every distinct non-empty value
 * per floor becomes a real Zone row and its work areas are pointed at it. That
 * means the zone grouping already entered by hand survives this change — no
 * re-entry needed.
 *
 * `area_type` is deliberately NOT dropped here: keeping it for one release
 * leaves the conversion auditable and this migration cheaply reversible.
 * Nothing reads it any more.
 *
 * `assets` is untouched — assets reference `workarea_id`, and the zone is
 * reached through the work area.
 */
export class AddZoneLevel1732800000000 implements MigrationInterface {
  name = 'AddZoneLevel1732800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "zones" (
        "id" uniqueidentifier NOT NULL CONSTRAINT "DF_zones_id" DEFAULT NEWSEQUENTIALID(),
        "floor_id" nvarchar(255) NOT NULL,
        "name" nvarchar(200) NOT NULL,
        "color" nvarchar(20),
        "description" nvarchar(MAX),
        "created_at" datetime2 NOT NULL CONSTRAINT "DF_zones_created_at" DEFAULT getdate(),
        "updated_at" datetime2 NOT NULL CONSTRAINT "DF_zones_updated_at" DEFAULT getdate(),
        CONSTRAINT "PK_zones_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`CREATE INDEX "IDX_zones_floor_id" ON "zones" ("floor_id")`);

    await queryRunner.query(`ALTER TABLE "work_areas" ADD "zone_id" nvarchar(255)`);
    await queryRunner.query(`CREATE INDEX "IDX_work_areas_zone_id" ON "work_areas" ("zone_id")`);

    // One Zone per distinct (floor, area_type). area_type was free text, so
    // fold case/whitespace when grouping — "HR" and " hr " were one zone in
    // the old UI's own colour logic and must not split into two rows here.
    await queryRunner.query(`
      INSERT INTO "zones" ("floor_id", "name")
      SELECT "floor_id", MIN(LTRIM(RTRIM("area_type"))) AS "name"
      FROM "work_areas"
      WHERE "area_type" IS NOT NULL AND LTRIM(RTRIM("area_type")) <> ''
      GROUP BY "floor_id", LOWER(LTRIM(RTRIM("area_type")))
    `);

    await queryRunner.query(`
      UPDATE wa
      SET wa."zone_id" = CONVERT(nvarchar(255), z."id")
      FROM "work_areas" wa
      INNER JOIN "zones" z
        ON z."floor_id" = wa."floor_id"
       AND LOWER(LTRIM(RTRIM(z."name"))) = LOWER(LTRIM(RTRIM(wa."area_type")))
      WHERE wa."area_type" IS NOT NULL AND LTRIM(RTRIM(wa."area_type")) <> ''
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // area_type was never cleared, so dropping zone_id loses nothing.
    await queryRunner.query(`DROP INDEX "IDX_work_areas_zone_id" ON "work_areas"`);
    await queryRunner.query(`ALTER TABLE "work_areas" DROP COLUMN "zone_id"`);
    await queryRunner.query(`DROP INDEX "IDX_zones_floor_id" ON "zones"`);
    await queryRunner.query(`DROP TABLE "zones"`);
  }
}
