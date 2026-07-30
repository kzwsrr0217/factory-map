/**
 * Zone.entity.ts — A named group of work areas on a floor (e.g. "HR",
 * "Cummins", "Maintenance").
 *
 * The hierarchy is Building → Floor → **Zone** → WorkArea. A zone is the
 * bigger area people name in conversation ("the HR wing"); the work areas
 * inside it are the individual rooms ("Reception", "HR office", "Andrea
 * Lambert office"). This maps directly onto the physical inventory survey,
 * whose `helyszín` field is the zone and whose `work_area` field is the room.
 *
 * **A zone deliberately has no coordinates or size.** Its shape is derived on
 * the map from the work areas that belong to it: each room gets a slightly
 * inflated halo in the zone's colour drawn behind it, and adjacent halos merge
 * visually. That handles L- and U-shaped zones correctly — a bounding box
 * would swallow a room belonging to a *different* zone sitting in the notch of
 * the L — and it can never drift out of sync with the rooms, since there is no
 * second geometry to maintain.
 *
 * Colour lives here rather than on the individual work area so that "one zone
 * = one colour" holds by construction. An earlier design put an optional
 * colour on each work area, which let two rooms of the same zone render in
 * different colours and defeated the grouping.
 *
 * Assets still reference the WorkArea (`asset.workarea_id`), not the zone —
 * the zone is reached through the work area. That keeps the asset table out of
 * this hierarchy change entirely.
 *
 * `WorkArea.zone_id` is a soft join with no FK: a real one would give `floors`
 * two cascade paths to `work_areas` (direct, and via `zones`), which SQL
 * Server rejects. Deleting a zone therefore clears its rooms' `zone_id` in the
 * controller rather than relying on ON DELETE SET NULL.
 */
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Floor } from './Floor.entity';

@Entity('zones')
@Index(['floor_id'])
export class Zone {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'floor_id', type: 'nvarchar' })
  floor_id!: string;

  @ManyToOne(() => Floor, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'floor_id' })
  floor!: Floor;

  @Column({ type: 'nvarchar', length: 200 })
  name!: string;

  /**
   * Map fill colour as a hex string, from the shared palette
   * (frontend/src/utils/workareaColors.ts). Null means "assign automatically"
   * — the map derives a distinct colour per zone on the floor so neighbouring
   * zones never collide.
   */
  @Column({ type: 'nvarchar', length: 20, nullable: true })
  color!: string | null;

  @Column({ type: 'nvarchar', length: 'max' as unknown as number, nullable: true })
  description!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  created_at!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updated_at!: Date;

  toApiResponse() {
    return {
      _id: this.id,
      floor_id: this.floor_id,
      name: this.name,
      color: this.color,
      description: this.description,
      created_at: this.created_at,
      updated_at: this.updated_at,
    };
  }
}
