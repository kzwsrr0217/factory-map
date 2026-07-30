/**
 * WorkArea.entity.ts — A named zone on a floor (e.g., "Assembly Line 1", "Server Room").
 *
 * Work areas are rendered as coloured rectangles on the floor plan. Their position
 * (coord_x, coord_y) and size (dim_width, dim_height) are stored in canvas units and
 * updated when the user drags or resizes the zone on the map.
 *
 * Work areas contain Sections, which in turn contain Workstations. This three-level
 * hierarchy allows granular organisation of physical space within a floor.
 *
 * `production_line_code` is a soft join (no FK/cascade) to
 * ProductionLine.code — organizational-hierarchy metadata (IFS-aligned,
 * mirrors shopfloor_visualizer's Department/ProductionLine/WorkCenter model),
 * kept separate from the spatial coord_x/y/dim_width/dim_height fields above,
 * which still drive the existing rectangle rendering unchanged.
 */
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
} from 'typeorm';
import { Floor } from './Floor.entity';
import { Section } from './Section.entity';

@Entity('work_areas')
export class WorkArea {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'floor_id', type: 'nvarchar' })
  floor_id!: string;

  @ManyToOne(() => Floor, (f) => f.workareas, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'floor_id' })
  floor!: Floor;

  @Column({ type: 'nvarchar', length: 200 })
  name!: string;

  /**
   * The zone (bigger named area) this room belongs to — see Zone.entity.ts.
   * Nullable: a room can sit on a floor without being grouped yet.
   *
   * **Soft join, no FK** — deliberately, and not just for the N+1 reason the
   * Asset hierarchy cites. A real FK here creates two cascade paths from
   * `floors` to `work_areas` (directly, and via `zones`), which SQL Server
   * rejects outright ("may cause cycles or multiple cascade paths"). The zone
   * is resolved in the controller instead, and zone deletion clears this
   * column explicitly. Same pattern as `production_line_code` below.
   */
  @Column({ name: 'zone_id', type: 'nvarchar', nullable: true })
  @Index('IDX_work_areas_zone_id')
  zone_id!: string | null;

  /** Populated by the controller from `zone_id` — not a TypeORM relation. */
  zone?: { id: string; name: string; color: string | null } | null;

  /**
   * @deprecated Superseded by `zone_id`. This column briefly doubled as the
   * zone name (there was no Zone entity yet), and the AddZoneLevel migration
   * converted every distinct value into a real Zone row. Kept for one release
   * so that conversion stays auditable/reversible; nothing reads it.
   */
  @Column({ name: 'area_type', type: 'nvarchar', length: 100, nullable: true })
  type!: string | null;

  @Column({ name: 'coord_x', type: 'float', default: 0 })
  coord_x!: number;

  @Column({ name: 'coord_y', type: 'float', default: 0 })
  coord_y!: number;

  @Column({ name: 'dim_width', type: 'float', default: 150 })
  dim_width!: number;

  @Column({ name: 'dim_height', type: 'float', default: 100 })
  dim_height!: number;

  @Column({ name: 'production_line_code', type: 'nvarchar', length: 50, nullable: true })
  @Index('IDX_work_areas_production_line_code')
  production_line_code!: string | null;

  @Column({ type: 'simple-json', nullable: true })
  metadata!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at' })
  created_at!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updated_at!: Date;

  @OneToMany(() => Section, (s) => s.workarea, { cascade: true })
  sections!: Section[];

  toApiResponse() {
    return {
      _id: this.id,
      floor_id: this.floor_id,
      name: this.name,
      zone_id: this.zone_id,
      // Present only when the caller joined the relation; the map needs the
      // name/colour to draw the zone halo without a second round-trip.
      zone: this.zone ? { _id: this.zone.id, name: this.zone.name, color: this.zone.color } : null,
      coordinates: { x: this.coord_x, y: this.coord_y },
      dimensions: { width: this.dim_width, height: this.dim_height },
      production_line_code: this.production_line_code,
      metadata: this.metadata ?? {},
      created_at: this.created_at,
      updated_at: this.updated_at,
    };
  }
}
