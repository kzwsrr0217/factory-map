/**
 * Workstation.entity.ts — An individual physical workstation position within a section.
 *
 * Workstations represent physical slots (desk positions, machine stations) rather
 * than IT assets. An asset is assigned to a workstation via `asset.workstation_id`.
 * Multiple assets can share a workstation (e.g., a PC and a monitor at the same desk).
 *
 * The `type` field describes the physical setup: "standard", "CNC station",
 * "operator panel", etc. The `rotation` allows rendering the workstation icon at
 * the correct angle on the floor map.
 */
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Section } from './Section.entity';

@Entity('workstations')
export class Workstation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'section_id', type: 'nvarchar' })
  section_id!: string;

  @ManyToOne(() => Section, (s) => s.workstations, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'section_id' })
  section!: Section;

  @Column({ type: 'nvarchar', length: 200 })
  name!: string;

  @Column({ name: 'coord_x', type: 'float', default: 0 })
  coord_x!: number;

  @Column({ name: 'coord_y', type: 'float', default: 0 })
  coord_y!: number;

  @Column({ type: 'float', default: 0 })
  rotation!: number;

  @Column({ name: 'ws_type', type: 'nvarchar', length: 100 })
  type!: string;

  @Column({ type: 'nvarchar', length: 50, default: 'active' })
  status!: string;

  @CreateDateColumn({ name: 'created_at' })
  created_at!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updated_at!: Date;

  toApiResponse() {
    return {
      _id: this.id,
      section_id: this.section_id,
      name: this.name,
      coordinates: { x: this.coord_x, y: this.coord_y },
      rotation: this.rotation,
      type: this.type,
      status: this.status,
      created_at: this.created_at,
      updated_at: this.updated_at,
    };
  }
}
