/**
 * WorkArea.entity.ts — A named zone on a floor (e.g., "Assembly Line 1", "Server Room").
 *
 * Work areas are rendered as coloured rectangles on the floor plan. Their position
 * (coord_x, coord_y) and size (dim_width, dim_height) are stored in canvas units and
 * updated when the user drags or resizes the zone on the map.
 *
 * Work areas contain Sections, which in turn contain Workstations. This three-level
 * hierarchy allows granular organisation of physical space within a floor.
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
      type: this.type,
      coordinates: { x: this.coord_x, y: this.coord_y },
      dimensions: { width: this.dim_width, height: this.dim_height },
      metadata: this.metadata ?? {},
      created_at: this.created_at,
      updated_at: this.updated_at,
    };
  }
}
