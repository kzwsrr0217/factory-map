/**
 * AssetConnection.entity.ts — Physical or logical connection between two assets.
 *
 * Each row represents a directed link from `asset_id` → `connected_asset_id`.
 * When `bidirectional = true` (the default), the UI displays the connection on
 * both assets. However, the database stores only one row; the reverse connection
 * is implied by the bidirectional flag rather than duplicated.
 *
 * `patch_panel` is stored as a simple-json object and records the physical
 * cable routing: which patch panel port and which switch port the link uses.
 * This is critical for network troubleshooting and documentation.
 *
 * CASCADE DELETE is set on the FK so that deleting an asset automatically
 * removes all of its connection rows.
 */
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Asset } from './Asset.entity';

@Entity('asset_connections')
export class AssetConnection {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'asset_id', type: 'nvarchar' })
  asset_id!: string;

  @ManyToOne(() => Asset, (a) => a.connections, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'asset_id' })
  asset!: Asset;

  @Column({ name: 'connected_asset_id', type: 'nvarchar', length: 36 })
  connected_asset_id!: string;

  @Column({ name: 'connection_type', type: 'nvarchar', length: 50 })
  connection_type!: string;

  @Column({ type: 'nvarchar', length: 500, nullable: true })
  description!: string | null;

  @Column({ type: 'nvarchar', length: 200, nullable: true })
  label!: string | null;

  @Column({ default: true })
  bidirectional!: boolean;

  @Column({ type: 'nvarchar', length: 20, default: 'normal' })
  strength!: string;

  @Column({ name: 'patch_panel', type: 'simple-json', nullable: true })
  patch_panel!: { panel_name?: string; panel_port?: string; switch_name?: string; switch_port?: string } | null;

  @CreateDateColumn({ name: 'created_at' })
  created_at!: Date;
}
