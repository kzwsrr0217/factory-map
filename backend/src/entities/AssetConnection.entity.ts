/**
 * AssetConnection.entity.ts — Physical or logical connection between two assets.
 *
 * Each row represents a directed link from `asset_id` → `connected_asset_id`.
 * When `bidirectional = true`, asset.controller.ts addConnection() creates a
 * second, mirrored row (connected_asset_id → asset_id) so the link shows up
 * — and can be edited/removed — from either asset's own connections list.
 * `pair_id` is a shared UUID stamped on both rows of a bidirectional pair (or
 * left null for a one-way connection) so update/remove can find and act on
 * both sides together without re-deriving the pair from asset ids alone —
 * multiple distinct connections can exist between the same two assets (e.g.
 * two physical cables), so (asset_id, connected_asset_id) is no longer a
 * unique identifier; each row's own `id` is.
 *
 * `patch_panel` is stored as a simple-json object and records the physical
 * cable routing: which patch panel port and which switch port the link uses.
 * This is critical for network troubleshooting and documentation.
 *
 * CASCADE DELETE is set on the FK so that deleting an asset automatically
 * removes all of its own outgoing connection rows. Rows where this asset is
 * only the `connected_asset_id` (an inbound reference with no FK) are cleaned
 * up explicitly in deleteAsset() — see asset.controller.ts.
 */
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Asset } from './Asset.entity';

@Entity('asset_connections')
@Index('IDX_asset_connections_pair_id', ['pair_id'], { where: 'pair_id IS NOT NULL' })
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

  @Column({ name: 'source_port', type: 'nvarchar', length: 50, nullable: true })
  source_port!: string | null;

  @Column({ name: 'target_port', type: 'nvarchar', length: 50, nullable: true })
  target_port!: string | null;

  @Column({ name: 'pair_id', type: 'nvarchar', length: 36, nullable: true })
  pair_id!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  created_at!: Date;
}
