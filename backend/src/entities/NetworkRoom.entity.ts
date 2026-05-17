import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, OneToMany,
} from 'typeorm';
import { NetworkRack } from './NetworkRack.entity';

export type NetworkRoomType = 'idf' | 'mdf';

@Entity('network_rooms')
export class NetworkRoom {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'nvarchar', length: 120 })
  name!: string;

  @Column({ type: 'nvarchar', length: 10, default: 'idf' })
  type!: NetworkRoomType;

  @Column({ name: 'building_id', type: 'nvarchar', length: 36 })
  building_id!: string;

  @Column({ name: 'floor_id', type: 'nvarchar', length: 36, nullable: true })
  floor_id!: string | null;

  @Column({ type: 'nvarchar', length: 500, nullable: true })
  description!: string | null;

  @Column({ name: 'redundant_pair_id', type: 'nvarchar', length: 36, nullable: true })
  redundant_pair_id!: string | null;

  @OneToMany(() => NetworkRack, (r) => r.room, { cascade: true })
  racks!: NetworkRack[];

  @CreateDateColumn({ name: 'created_at' }) created_at!: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updated_at!: Date;

  toApiResponse() {
    return {
      _id: this.id,
      name: this.name,
      type: this.type,
      building_id: this.building_id,
      floor_id: this.floor_id,
      description: this.description,
      redundant_pair_id: this.redundant_pair_id,
      racks: this.racks?.map(r => r.toApiResponse()) ?? [],
      created_at: this.created_at,
      updated_at: this.updated_at,
    };
  }
}
