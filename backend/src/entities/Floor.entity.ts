/**
 * Floor.entity.ts — A single floor within a building.
 *
 * Each floor has a unique floor_number within its building (enforced by a
 * composite unique index). Floor numbers can be negative (basement levels).
 *
 * Floor plan storage:
 *  - `map_file`: the original upload filename (informational only)
 *  - `svg_background`: the full image content stored as a base64-encoded data URI
 *    or an SVG string. Stored as NVARCHAR(MAX) to avoid size limitations.
 *    The 20 MB body limit in server.ts accommodates large floor plan images.
 *
 * Deleting a floor cascades to its work areas (and transitively to sections,
 * workstations). The floor controller blocks deletion if assets exist on the floor.
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
import { Building } from './Building.entity';
import { WorkArea } from './WorkArea.entity';

@Entity('floors')
@Index(['building_id', 'floor_number'], { unique: true })
export class Floor {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'building_id', type: 'nvarchar' })
  building_id!: string;

  @ManyToOne(() => Building, (b) => b.floors, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'building_id' })
  building!: Building;

  @Column({ type: 'int' })
  floor_number!: number;

  @Column({ type: 'nvarchar', length: 200 })
  name!: string;

  @Column({ name: 'map_file', type: 'nvarchar', length: 500, nullable: true })
  map_file!: string | null;

  @Column({ name: 'svg_background', type: 'nvarchar', length: 'max' as unknown as number, nullable: true })
  svg_background!: string | null;

  @Column({ type: 'simple-json', nullable: true })
  metadata!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at' })
  created_at!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updated_at!: Date;

  @OneToMany(() => WorkArea, (wa) => wa.floor, { cascade: true })
  workareas!: WorkArea[];

  toApiResponse() {
    return {
      _id: this.id,
      building_id: this.building_id,
      floor_number: this.floor_number,
      name: this.name,
      map_file: this.map_file,
      svg_background: this.svg_background,
      metadata: this.metadata ?? {},
      created_at: this.created_at,
      updated_at: this.updated_at,
    };
  }
}
