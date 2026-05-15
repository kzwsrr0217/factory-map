/**
 * Section.entity.ts — A subdivision within a work area.
 *
 * Sections group related workstations (e.g., "Shift A positions", "Quality bench 1-4").
 * The optional `capacity` field documents how many people or workstations the section
 * can accommodate. `shift_schedule` records which shift operates in this section
 * (e.g., "Day / Afternoon / Night").
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
import { WorkArea } from './WorkArea.entity';
import { Workstation } from './Workstation.entity';

@Entity('sections')
export class Section {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'workarea_id', type: 'nvarchar' })
  workarea_id!: string;

  @ManyToOne(() => WorkArea, (wa) => wa.sections, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'workarea_id' })
  workarea!: WorkArea;

  @Column({ type: 'nvarchar', length: 200 })
  name!: string;

  @Column({ name: 'coord_x', type: 'float', default: 0 })
  coord_x!: number;

  @Column({ name: 'coord_y', type: 'float', default: 0 })
  coord_y!: number;

  @Column({ type: 'int', nullable: true })
  capacity!: number | null;

  @Column({ name: 'shift_schedule', type: 'nvarchar', length: 200, nullable: true })
  shift_schedule!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  created_at!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updated_at!: Date;

  @OneToMany(() => Workstation, (ws) => ws.section, { cascade: true })
  workstations!: Workstation[];

  toApiResponse() {
    return {
      _id: this.id,
      workarea_id: this.workarea_id,
      name: this.name,
      coordinates: { x: this.coord_x, y: this.coord_y },
      capacity: this.capacity,
      shift_schedule: this.shift_schedule,
      created_at: this.created_at,
      updated_at: this.updated_at,
    };
  }
}
