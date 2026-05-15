/**
 * Building.entity.ts — Top-level location entity.
 *
 * A Building is the root of the location hierarchy:
 *   Building → Floor → WorkArea → Section → Workstation → Asset
 *
 * The `metadata` field is a flexible key/value store for building-specific
 * properties (e.g., total area, construction year, building manager) that do
 * not warrant their own typed columns.
 *
 * Deleting a building cascades to all its floors. However, assets reference
 * `building_id` without a FK cascade — the building controller blocks deletion
 * if any assets are still assigned to the building.
 */
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { Floor } from './Floor.entity';

@Entity('buildings')
export class Building {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'nvarchar', length: 200 })
  name!: string;

  @Column({ type: 'nvarchar', length: 500, nullable: true })
  address!: string | null;

  @Column({ type: 'simple-json', nullable: true })
  metadata!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at' })
  created_at!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updated_at!: Date;

  @OneToMany(() => Floor, (f) => f.building, { cascade: true })
  floors!: Floor[];

  toApiResponse() {
    return {
      _id: this.id,
      name: this.name,
      address: this.address,
      metadata: this.metadata ?? {},
      created_at: this.created_at,
      updated_at: this.updated_at,
    };
  }
}
