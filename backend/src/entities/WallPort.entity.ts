import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn,
} from 'typeorm';
import { PatchPanel } from './PatchPanel.entity';

@Entity('wall_ports')
export class WallPort {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'nvarchar', length: 50 })
  label!: string;

  @Column({ name: 'floor_id', type: 'nvarchar', length: 36 })
  floor_id!: string;

  @Column({ name: 'pos_x', type: 'float', default: 0 })
  pos_x!: number;

  @Column({ name: 'pos_y', type: 'float', default: 0 })
  pos_y!: number;

  @Column({ name: 'patch_panel_id', type: 'nvarchar', nullable: true })
  patch_panel_id!: string | null;

  @ManyToOne(() => PatchPanel, (p) => p.wall_ports, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'patch_panel_id' })
  patch_panel!: PatchPanel | null;

  @Column({ name: 'patch_port', type: 'int', nullable: true })
  patch_port!: number | null;

  @Column({ name: 'switch_asset_id', type: 'nvarchar', nullable: true })
  switch_asset_id!: string | null;

  @Column({ name: 'switch_port', type: 'nvarchar', length: 50, nullable: true })
  switch_port!: string | null;

  @Column({ type: 'nvarchar', length: 500, nullable: true })
  description!: string | null;

  @CreateDateColumn({ name: 'created_at' }) created_at!: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updated_at!: Date;

  toApiResponse() {
    return {
      _id: this.id,
      label: this.label,
      floor_id: this.floor_id,
      pos_x: this.pos_x,
      pos_y: this.pos_y,
      patch_panel_id: this.patch_panel_id,
      patch_port: this.patch_port,
      switch_asset_id: this.switch_asset_id,
      switch_port: this.switch_port,
      description: this.description,
      created_at: this.created_at,
      updated_at: this.updated_at,
    };
  }
}
