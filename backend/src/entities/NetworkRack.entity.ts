import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, OneToMany,
} from 'typeorm';
import { NetworkRoom } from './NetworkRoom.entity';
import { PatchPanel } from './PatchPanel.entity';

@Entity('network_racks')
export class NetworkRack {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'nvarchar', length: 120 })
  name!: string;

  @Column({ name: 'network_room_id', type: 'nvarchar' })
  network_room_id!: string;

  @ManyToOne(() => NetworkRoom, (r) => r.racks, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'network_room_id' })
  room!: NetworkRoom;

  @Column({ name: 'u_count', type: 'int', default: 42 })
  u_count!: number;

  @Column({ type: 'nvarchar', length: 500, nullable: true })
  description!: string | null;

  @OneToMany(() => PatchPanel, (p) => p.rack, { cascade: true })
  patch_panels!: PatchPanel[];

  @CreateDateColumn({ name: 'created_at' }) created_at!: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updated_at!: Date;

  toApiResponse() {
    return {
      _id: this.id,
      name: this.name,
      network_room_id: this.network_room_id,
      u_count: this.u_count,
      description: this.description,
      patch_panels: this.patch_panels?.map(p => p.toApiResponse()) ?? [],
      created_at: this.created_at,
      updated_at: this.updated_at,
    };
  }
}
