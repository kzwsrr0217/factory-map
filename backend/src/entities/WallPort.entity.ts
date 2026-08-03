/**
 * WallPort.entity.ts — One network socket on a wall.
 *
 * The `label` is the identity: sockets are labelled "R1/001" (rack 1, port 001),
 * which is what is printed on the faceplate and on the patch panel, and what a
 * technician reads out on the phone. Because the label encodes the rack, it says
 * where the socket goes even before any patching is recorded.
 *
 * `patch_panel_id`, `patch_port`, `switch_asset_id` and `switch_port` are all
 * nullable on purpose: "this socket exists but is not patched yet" is a normal
 * state, and an empty switch side reads honestly as "not surveyed" where a
 * guessed one would be indistinguishable from a verified one. See
 * docs/CONNECTIONS_WORKFLOW.md.
 */
import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn, Index,
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

  /**
   * The room the socket is in — the level at which "find a free socket here" is
   * actually asked. Nullable: sockets are bulk-created from their label range
   * first and assigned to rooms afterwards.
   *
   * **Soft join, no FK** — same reason as WorkArea.zone_id: a real FK would give
   * `floors` a second cascade path to this table, which SQL Server rejects. The
   * work area is resolved in the controller.
   */
  @Column({ name: 'workarea_id', type: 'nvarchar', nullable: true })
  @Index('IDX_wall_ports_workarea_id')
  workarea_id!: string | null;

  /**
   * @deprecated Map coordinates. Wall ports are no longer drawn on the floor
   * plan — a socket is on a wall, so an x/y on a top-down plan was never
   * accurate, and maintaining hundreds of them by dragging cost more than the
   * dot was worth. `workarea_id` above answers the question the position was
   * standing in for. Columns kept so existing values aren't destroyed.
   */
  @Column({ name: 'pos_x', type: 'float', default: 0 })
  pos_x!: number;

  /** @deprecated See pos_x. */
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

  /** Populated by the controller from `workarea_id` — not a TypeORM relation. */
  workarea?: { id: string; name: string } | null;

  @CreateDateColumn({ name: 'created_at' }) created_at!: Date;
  @UpdateDateColumn({ name: 'updated_at' }) updated_at!: Date;

  toApiResponse() {
    return {
      _id: this.id,
      label: this.label,
      floor_id: this.floor_id,
      workarea_id: this.workarea_id,
      // Present only when the caller resolved it (see listWallPorts).
      workarea: this.workarea ? { _id: this.workarea.id, name: this.workarea.name } : null,
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
