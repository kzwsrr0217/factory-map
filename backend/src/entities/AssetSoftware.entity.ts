/**
 * AssetSoftware.entity.ts — Software installed on an asset.
 *
 * Each row represents one installed software title. Rows can be created from:
 *  - `source = 'itsm'`: automatically populated by ITSM sync (overwritten on each sync)
 *  - `source = 'manual'`: manually added via the asset form
 *
 * The entire software list is replaced on each update (delete + re-insert) rather
 * than being partially updated, which keeps the logic simple and the data consistent.
 *
 * CASCADE DELETE ensures that removing an asset also removes its software rows.
 */
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Asset } from './Asset.entity';

@Entity('asset_software')
export class AssetSoftware {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'asset_id', type: 'nvarchar' })
  asset_id!: string;

  @ManyToOne(() => Asset, (a) => a.software, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'asset_id' })
  asset!: Asset;

  @Column({ name: 'software_id', type: 'nvarchar', length: 100, nullable: true })
  software_id!: string | null;

  @Column({ name: 'display_name', type: 'nvarchar', length: 200 })
  display_name!: string;

  @Column({ type: 'nvarchar', length: 200, nullable: true })
  vendor!: string | null;

  @Column({ type: 'nvarchar', length: 100, nullable: true })
  version!: string | null;

  @Column({ type: 'nvarchar', length: 20, default: 'manual' })
  source!: string;
}
