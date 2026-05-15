/**
 * Asset.entity.ts — Core asset entity.
 *
 * Represents any IT hardware asset (IPC, workstation, server, switch, printer, etc.)
 * in the factory. The entity stores all data in **flat SQL columns** rather than
 * TypeORM embedded objects — this avoids complex join queries and gives SQL Server
 * efficient index coverage on the most-queried fields.
 *
 * The `toApiResponse()` method reconstructs the nested JSON shape expected by the
 * frontend from those flat columns. This is the single source of truth for the API
 * contract — every controller should call `toApiResponse()` before sending a response,
 * never expose raw entity fields directly.
 *
 * Key design decisions:
 *  - Hierarchy FKs (building_id, floor_id, etc.) are plain string columns, not TypeORM
 *    relations, to avoid N+1 query problems when listing assets.
 *  - `simple-json` columns (work_items, loc_history, tags, sync_errors, itsm_snapshot)
 *    are stored as serialised JSON strings in NVARCHAR(MAX). TypeORM handles the
 *    serialisation/deserialisation automatically.
 *  - `is_placed` is derived from coordinates (non-zero x or y) but stored as a boolean
 *    for efficient filtered queries on the floor map.
 */
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
  Index,
} from 'typeorm';
import { AssetSoftware } from './AssetSoftware.entity';
import { AssetConnection } from './AssetConnection.entity';

interface LocationHistoryEntry {
  moved_at: Date;
  from_coordinates: { x: number; y: number };
  to_coordinates: { x: number; y: number };
  moved_by?: string;
  reason?: string;
}

interface ItsmSnapshot {
  display_name?: string;
  serial_number?: string;
  asset_tag?: string;
  mac_address?: string;
  status?: string;
  person_name?: string;
  person_itsm_id?: string;
  organization_name?: string;
  organization_itsm_id?: string;
  catalog_item_name?: string;
  catalog_item_itsm_id?: string;
  synced_at?: Date;
}

@Entity('assets')
@Index(['floor_id', 'is_placed'])
@Index(['itsm_guid'], { where: 'itsm_guid IS NOT NULL' })
@Index(['hardware_asset_id'], { where: 'hardware_asset_id IS NOT NULL' })
export class Asset {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  @Column({ name: 'predecessor_id', type: 'nvarchar', length: 36, nullable: true })
  predecessor_id!: string | null;

  @Column({ name: 'successor_id', type: 'nvarchar', length: 36, nullable: true })
  successor_id!: string | null;

  @Column({ name: 'is_placed', default: false })
  @Index()
  is_placed!: boolean;

  // ── Hierarchy (FK columns — no entity relation, just string IDs) ──────────
  @Column({ name: 'building_id', type: 'nvarchar', length: 36, nullable: true })
  @Index()
  building_id!: string | null;

  @Column({ name: 'floor_id', type: 'nvarchar', length: 36, nullable: true })
  @Index()
  floor_id!: string | null;

  @Column({ name: 'workarea_id', type: 'nvarchar', length: 36, nullable: true })
  @Index()
  workarea_id!: string | null;

  @Column({ name: 'section_id', type: 'nvarchar', length: 36, nullable: true })
  section_id!: string | null;

  @Column({ name: 'workstation_id', type: 'nvarchar', length: 36, nullable: true })
  workstation_id!: string | null;

  // ── basic_info (flattened) ────────────────────────────────────────────────
  @Column({ name: 'display_name', type: 'nvarchar', length: 200 })
  @Index()
  display_name!: string;

  @Column({ name: 'asset_tag', type: 'nvarchar', length: 100, nullable: true })
  asset_tag!: string | null;

  @Column({ name: 'serial_number', type: 'nvarchar', length: 100, nullable: true })
  serial_number!: string | null;

  @Column({ name: 'model', type: 'nvarchar', length: 200, nullable: true })
  model!: string | null;

  @Column({ name: 'manufacturer', type: 'nvarchar', length: 200, nullable: true })
  manufacturer!: string | null;

  @Column({ name: 'status', type: 'nvarchar', length: 50, nullable: true })
  @Index()
  status!: string | null;

  @Column({ name: 'asset_type', type: 'nvarchar', length: 100, nullable: true })
  asset_type!: string | null;

  @Column({ name: 'os_type', type: 'nvarchar', length: 100, nullable: true })
  os_type!: string | null;

  @Column({ name: 'os_version', type: 'nvarchar', length: 100, nullable: true })
  os_version!: string | null;

  @Column({ name: 'mac_address', type: 'nvarchar', length: 50, nullable: true })
  mac_address!: string | null;

  // ── technical_specs (flattened) ───────────────────────────────────────────
  @Column({ name: 'cpu', type: 'nvarchar', length: 200, nullable: true })
  cpu!: string | null;

  @Column({ name: 'ram', type: 'nvarchar', length: 50, nullable: true })
  ram!: string | null;

  @Column({ name: 'storage', type: 'nvarchar', length: 100, nullable: true })
  storage!: string | null;

  @Column({ name: 'gpu', type: 'nvarchar', length: 100, nullable: true })
  gpu!: string | null;

  // ── network (flattened) ───────────────────────────────────────────────────
  @Column({ name: 'ip_address', type: 'nvarchar', length: 50, nullable: true })
  @Index()
  ip_address!: string | null;

  @Column({ name: 'hostname', type: 'nvarchar', length: 200, nullable: true })
  hostname!: string | null;

  @Column({ name: 'vlan', type: 'nvarchar', length: 50, nullable: true })
  vlan!: string | null;

  @Column({ name: 'switch_port', type: 'nvarchar', length: 50, nullable: true })
  switch_port!: string | null;

  @Column({ name: 'dhcp_static', type: 'nvarchar', length: 10, nullable: true })
  dhcp_static!: string | null;

  // ── assigned_person (flattened) ───────────────────────────────────────────
  @Column({ name: 'person_id', type: 'nvarchar', length: 100, nullable: true })
  @Index()
  person_id!: string | null;

  @Column({ name: 'person_itsm_id', type: 'nvarchar', length: 100, nullable: true })
  person_itsm_id!: string | null;

  @Column({ name: 'person_full_name', type: 'nvarchar', length: 200, nullable: true })
  person_full_name!: string | null;

  // ── organization / catalog_item (flattened) ───────────────────────────────
  @Column({ name: 'org_itsm_id', type: 'nvarchar', length: 100, nullable: true })
  org_itsm_id!: string | null;

  @Column({ name: 'org_display_name', type: 'nvarchar', length: 200, nullable: true })
  org_display_name!: string | null;

  @Column({ name: 'catalog_itsm_id', type: 'nvarchar', length: 100, nullable: true })
  catalog_itsm_id!: string | null;

  @Column({ name: 'catalog_display_name', type: 'nvarchar', length: 200, nullable: true })
  catalog_display_name!: string | null;

  // ── ITSM (flattened) ──────────────────────────────────────────────────────
  @Column({ name: 'itsm_guid', type: 'nvarchar', length: 100, nullable: true })
  itsm_guid!: string | null;

  @Column({ name: 'hardware_asset_id', type: 'nvarchar', length: 100, nullable: true })
  hardware_asset_id!: string | null;

  @Column({ name: 'asset_class', type: 'nvarchar', length: 100, nullable: true })
  asset_class!: string | null;

  @Column({ name: 'itsm_modified_at', type: 'datetime', nullable: true })
  itsm_modified_at!: Date | null;

  @Column({ name: 'source_of_truth', type: 'nvarchar', length: 20, default: 'local' })
  @Index()
  source_of_truth!: string;

  @Column({ name: 'is_managed', default: false })
  is_managed!: boolean;

  @Column({ name: 'last_synced', type: 'datetime', nullable: true })
  last_synced!: Date | null;

  @Column({ name: 'sync_status', type: 'nvarchar', length: 20, default: 'never' })
  sync_status!: string;

  @Column({ name: 'sync_errors', type: 'simple-json', nullable: true })
  sync_errors!: Array<{ timestamp: Date; error: string }> | null;

  @Column({ name: 'itsm_snapshot', type: 'simple-json', nullable: true })
  itsm_snapshot!: ItsmSnapshot | null;

  // ── Location (flattened) ──────────────────────────────────────────────────
  @Column({ name: 'loc_x', type: 'float', default: 0 })
  loc_x!: number;

  @Column({ name: 'loc_y', type: 'float', default: 0 })
  loc_y!: number;

  @Column({ name: 'loc_rotation', type: 'float', default: 0 })
  loc_rotation!: number;

  @Column({ name: 'loc_icon_type', type: 'nvarchar', length: 50, default: 'computer' })
  loc_icon_type!: string;

  @Column({ name: 'loc_description', type: 'nvarchar', length: 500, nullable: true })
  loc_description!: string | null;

  @Column({ name: 'loc_history', type: 'simple-json', nullable: true })
  loc_history!: LocationHistoryEntry[] | null;

  // ── custom_fields (flattened) ─────────────────────────────────────────────
  @Column({ name: 'physical_condition', type: 'nvarchar', length: 20, nullable: true })
  physical_condition!: string | null;

  @Column({ name: 'environment', type: 'nvarchar', length: 200, nullable: true })
  environment!: string | null;

  @Column({ name: 'notes', type: 'nvarchar', length: 'max' as unknown as number, nullable: true })
  notes!: string | null;

  @Column({ name: 'tags', type: 'simple-json', nullable: true })
  tags!: string[] | null;

  @Column({ name: 'object_id', type: 'nvarchar', length: 100, nullable: true })
  @Index()
  object_id!: string | null;

  @Column({ name: 'serial_object', type: 'nvarchar', length: 100, nullable: true })
  serial_object!: string | null;

  @Column({ name: 'remote_access_tool', type: 'nvarchar', length: 200, nullable: true })
  remote_access_tool!: string | null;

  @Column({ name: 'remote_access_version', type: 'nvarchar', length: 100, nullable: true })
  remote_access_version!: string | null;

  @Column({ name: 'backup_tool', type: 'nvarchar', length: 200, nullable: true })
  backup_tool!: string | null;

  @Column({ name: 'backup_status', type: 'nvarchar', length: 50, nullable: true })
  backup_status!: string | null;

  @Column({ name: 'winupdate_date', type: 'date', nullable: true })
  winupdate_date!: Date | null;

  @Column({ name: 'fortiedr_active', type: 'bit', nullable: true })
  fortiedr_active!: boolean | null;

  @Column({ name: 'work_items', type: 'simple-json', nullable: true })
  work_items!: Array<{ id: string; description: string; done: boolean; priority: 'low' | 'medium' | 'high'; created_at: string }> | null;

  // ── Maintenance (flattened) ───────────────────────────────────────────────
  @Column({ name: 'maint_last_date', type: 'date', nullable: true })
  maint_last_date!: Date | null;

  @Column({ name: 'maint_next_date', type: 'date', nullable: true })
  maint_next_date!: Date | null;

  @Column({ name: 'maint_interval_days', type: 'int', nullable: true })
  maint_interval_days!: number | null;

  @Column({ name: 'maint_notes', type: 'nvarchar', length: 'max' as unknown as number, nullable: true })
  maint_notes!: string | null;

  // ── Audit ─────────────────────────────────────────────────────────────────
  @CreateDateColumn({ name: 'created_at' })
  created_at!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updated_at!: Date;

  @Column({ name: 'created_by', type: 'nvarchar', length: 100, nullable: true })
  created_by!: string | null;

  @Column({ name: 'updated_by', type: 'nvarchar', length: 100, nullable: true })
  updated_by!: string | null;

  // ── Relations ─────────────────────────────────────────────────────────────
  @OneToMany(() => AssetSoftware, (s) => s.asset, { cascade: true })
  software!: AssetSoftware[];

  @OneToMany(() => AssetConnection, (c) => c.asset, { cascade: true })
  connections!: AssetConnection[];

  // ── API response shape (matches frontend Asset interface) ─────────────────
  toApiResponse() {
    return {
      _id: this.id,
      predecessor_id: this.predecessor_id,
      successor_id: this.successor_id,
      is_placed: this.is_placed,
      hierarchy: {
        building_id: this.building_id,
        floor_id: this.floor_id,
        workarea_id: this.workarea_id,
        section_id: this.section_id,
        workstation_id: this.workstation_id,
      },
      basic_info: {
        display_name: this.display_name,
        asset_tag: this.asset_tag,
        serial_number: this.serial_number,
        model: this.model,
        manufacturer: this.manufacturer,
        status: this.status,
        type: this.asset_type,
        os_type: this.os_type,
        os_version: this.os_version,
        mac_address: this.mac_address,
      },
      technical_specs: (this.cpu || this.ram || this.storage || this.gpu) ? {
        cpu: this.cpu,
        ram: this.ram,
        storage: this.storage,
        gpu: this.gpu,
      } : undefined,
      network: (this.ip_address || this.hostname || this.vlan || this.dhcp_static) ? {
        ip_address: this.ip_address,
        hostname: this.hostname,
        vlan: this.vlan,
        switch_port: this.switch_port,
        dhcp_static: this.dhcp_static,
      } : undefined,
      assigned_person: this.person_id ? {
        person_id: this.person_id,
        itsm_id: this.person_itsm_id,
        full_name: this.person_full_name ?? '',
      } : null,
      organization: this.org_itsm_id ? {
        itsm_id: this.org_itsm_id,
        display_name: this.org_display_name,
      } : undefined,
      catalog_item: this.catalog_itsm_id ? {
        itsm_id: this.catalog_itsm_id,
        display_name: this.catalog_display_name,
      } : undefined,
      itsm: {
        itsm_guid: this.itsm_guid,
        hardware_asset_id: this.hardware_asset_id,
        asset_class: this.asset_class,
        itsm_modified_at: this.itsm_modified_at,
        source_of_truth: this.source_of_truth as 'local' | 'itsm',
        is_managed: this.is_managed,
        last_synced: this.last_synced,
        sync_status: this.sync_status as 'success' | 'failed' | 'never',
        sync_errors: this.sync_errors ?? [],
      },
      itsm_snapshot: this.itsm_snapshot ?? null,
      location: {
        coordinates: { x: this.loc_x, y: this.loc_y },
        rotation: this.loc_rotation,
        icon_type: this.loc_icon_type,
        description: this.loc_description,
        history: this.loc_history ?? [],
      },
      custom_fields: {
        physical_condition: this.physical_condition,
        environment: this.environment,
        notes: this.notes,
        tags: this.tags ?? [],
        object_id: this.object_id,
        serial_object: this.serial_object,
        remote_access_tool: this.remote_access_tool,
        remote_access_version: this.remote_access_version,
        backup_tool: this.backup_tool,
        backup_status: this.backup_status,
        winupdate_date: this.winupdate_date,
        fortiedr_active: this.fortiedr_active,
      },
      maintenance: (this.maint_last_date || this.maint_next_date || this.maint_interval_days) ? {
        last_date: this.maint_last_date,
        next_date: this.maint_next_date,
        interval_days: this.maint_interval_days,
        notes: this.maint_notes,
      } : undefined,
      software: (this.software ?? []).map((s) => ({
        software_id: s.software_id,
        display_name: s.display_name,
        vendor: s.vendor,
        version: s.version,
        source: s.source as 'itsm' | 'manual',
      })),
      work_items: this.work_items ?? [],
      connections: (this.connections ?? []).map((c) => ({
        connected_asset_id: c.connected_asset_id,
        connection_type: c.connection_type,
        description: c.description,
        label: c.label,
        bidirectional: c.bidirectional,
        strength: c.strength,
        patch_panel: c.patch_panel,
        created_at: c.created_at,
      })),
      created_at: this.created_at,
      updated_at: this.updated_at,
    };
  }
}
