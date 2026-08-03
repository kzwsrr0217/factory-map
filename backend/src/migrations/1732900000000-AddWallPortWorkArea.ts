import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * AddWallPortWorkArea — gives each wall port the room it is in.
 *
 * Wall ports were located only to a floor, with `pos_x`/`pos_y` on the map
 * standing in for "which room". Sockets are no longer drawn on the floor plan
 * (a socket is on a wall, so a top-down x/y was never accurate, and maintaining
 * hundreds by dragging cost more than the dot was worth), so the room becomes an
 * explicit column — which is also the level at which "find a free socket here"
 * is actually asked. See docs/CONNECTIONS_WORKFLOW.md.
 *
 * Soft join with no FK, same as `work_areas.zone_id`: a real FK would give
 * `floors` a second cascade path to `wall_ports`, which SQL Server rejects
 * outright ("may cause cycles or multiple cascade paths").
 *
 * **Converts existing data** where it can be done unambiguously: a wall port
 * whose stored position falls inside exactly one of its floor's work-area
 * rectangles is assigned to it. Ports inside overlapping rectangles, or at the
 * default (0,0) with no rectangle covering it, are left NULL rather than guessed
 * — an unassigned socket is a visible to-do, a wrongly assigned one is invisible.
 *
 * `pos_x`/`pos_y` are deliberately NOT dropped: keeping them makes this
 * conversion auditable and the migration reversible.
 */
export class AddWallPortWorkArea1732900000000 implements MigrationInterface {
  name = 'AddWallPortWorkArea1732900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "wall_ports" ADD "workarea_id" nvarchar(255)`);
    await queryRunner.query(`CREATE INDEX "IDX_wall_ports_workarea_id" ON "wall_ports" ("workarea_id")`);

    // Only where exactly one rectangle contains the point — hence the
    // COUNT(*) = 1 guard rather than a plain join, which would pick an
    // arbitrary rectangle when two overlap.
    await queryRunner.query(`
      UPDATE wp
      SET wp."workarea_id" = m."workarea_id"
      FROM "wall_ports" wp
      INNER JOIN (
        SELECT w."id" AS "wall_port_id", MIN(CONVERT(nvarchar(255), wa."id")) AS "workarea_id"
        FROM "wall_ports" w
        INNER JOIN "work_areas" wa
          ON wa."floor_id" = w."floor_id"
         AND w."pos_x" >= wa."coord_x" AND w."pos_x" <= wa."coord_x" + wa."dim_width"
         AND w."pos_y" >= wa."coord_y" AND w."pos_y" <= wa."coord_y" + wa."dim_height"
        WHERE NOT (w."pos_x" = 0 AND w."pos_y" = 0)
        GROUP BY w."id"
        HAVING COUNT(*) = 1
      ) m ON m."wall_port_id" = wp."id"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // pos_x/pos_y were never cleared, so dropping workarea_id loses nothing.
    await queryRunner.query(`DROP INDEX "IDX_wall_ports_workarea_id" ON "wall_ports"`);
    await queryRunner.query(`ALTER TABLE "wall_ports" DROP COLUMN "workarea_id"`);
  }
}
