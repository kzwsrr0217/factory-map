import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, OneToMany,
} from 'typeorm';
import { NetworkRack } from './NetworkRack.entity';
import { WallPort } from './WallPort.entity';

export type CableType = 'copper' | 'fiber' | 'mixed';

@Entity('patch_panels')
export class PatchPanel {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'nvarchar', length: 120 })
  name!: string;

  @Column({ name: 'rack_id', type: 'nvarchar' })
  rack_id!: string;

  @ManyToOne(() => NetworkRack, (r) => r.patch_panels, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'rack_id' })
  rack!: NetworkRack;

  @Column({ name: 'u_position', type: 'int', nullable: true })
  u_position!: number | null;

  @Column({ name: 'port_count', type: 'int', default: 24 })
  port_count!: number;

  @Column({ name: 'cable_type', type: 'nvarchar', length: 20, default: 'copper' })
  cable_type!: CableType;

  @Column({ type: 'nvarchar', length: 500, nullable: true })
  description!: string | null;

  @OneToMany(() => WallPort, (w) => w.patch_panel)
  wall_ports!: WallPort[];

  @CreateDateColumn({ name: 'created_at' }) created_at!: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updated_at!: Date;

  toApiResponse() {
    return {
      _id: this.id,
      name: this.name,
      rack_id: this.rack_id,
      u_position: this.u_position,
      port_count: this.port_count,
      cable_type: this.cable_type,
      description: this.description,
      created_at: this.created_at,
      updated_at: this.updated_at,
    };
  }
}
