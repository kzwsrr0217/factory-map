/**
 * MasterAsset.entity.ts — Read-only IFS/CMDB master data.
 *
 * Mirrors the export the OT/IFS team already produces (site, production line,
 * work center, machine + IPC identity, CMDB hardware detail). `ifs_id` is the
 * single stable join key: for a plain production machine it equals
 * `ifs_machine_id`; for an IPC/IT-managed device it is its own `444444-*`
 * IFS id, and `ifs_machine_id` points back to the physical machine it is
 * mounted on. `cmdb_id` (HWA##### / MMHIPC#### / MMAGIPC#### / CX###) is the
 * secondary CMDB identifier — `cmdb_status` records whether a CMDB match
 * exists at all (a meaningful fraction of rows have none).
 *
 * This table is written **only by an import process**, never by the CRUD
 * API — `Asset` rows reference it by `master_ifs_id` (see Asset.entity.ts),
 * a soft join with no FK/cascade, so a row disappearing on re-import never
 * deletes the app-owned Asset/layout data; it just becomes unmatched.
 *
 * Column set verified directly against shopfloor_visualizer's real ingest
 * scripts (`databricks-ingest/ingest-mmag-machines.py` /
 * `ingest-mmag-ot-assets.py`, both reading the same
 * `ot_governance_prd.gold.ot_asset` Databricks table with two different
 * column projections) and real sample exports (`masterData.json`,
 * `OTAssetData.json`) — not guessed. The fields below the "machines" /
 * "OT assets" split are **all optional**: a row from either export shape
 * populates only the half that query actually selects, and `import-master-
 * data.ts` (see that script) is the thing that knows how to merge both
 * shapes into one row per `ifs_id`.
 *
 * Populated by `backend/src/scripts/import-master-data.ts` against exported
 * JSON files today; swapping in a live Databricks/IFS call later only
 * touches that script, not this entity or anything that reads it.
 */
import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('master_assets')
export class MasterAsset {
  @PrimaryColumn({ name: 'ifs_id', type: 'nvarchar', length: 50 })
  ifs_id!: string;

  @Column({ name: 'ifs_site', type: 'nvarchar', length: 20, nullable: true })
  @Index('IDX_master_assets_ifs_site')
  ifs_site!: string | null;

  @Column({ name: 'ifs_operational_status', type: 'nvarchar', length: 50, nullable: true })
  ifs_operational_status!: string | null;

  // Points back to the physical machine's own ifs_id for IPCs/IT-managed
  // devices (444444-*); equals ifs_id itself for plain machines and
  // standalone IT devices.
  @Column({ name: 'ifs_machine_id', type: 'nvarchar', length: 50, nullable: true })
  @Index('IDX_master_assets_ifs_machine_id')
  ifs_machine_id!: string | null;

  @Column({ name: 'ifs_machine_part_description', type: 'nvarchar', length: 500, nullable: true })
  ifs_machine_part_description!: string | null;

  // The part number without the -N instance suffix — e.g. `366663` for
  // ifs_machine_id `366663-2`. This is exactly shopfloor_visualizer's
  // "objectType" (the Object-ID prefix before the first `-`, PRD 6.1), which
  // it uses to look up a polygon template. Present in masterData.json's
  // `ifs_machine_part_no`.
  @Column({ name: 'ifs_machine_part_no', type: 'nvarchar', length: 50, nullable: true })
  ifs_machine_part_no!: string | null;

  @Column({ name: 'ifs_production_line_id', type: 'nvarchar', length: 50, nullable: true })
  @Index('IDX_master_assets_ifs_production_line_id')
  ifs_production_line_id!: string | null;

  @Column({ name: 'ifs_workcenter_id', type: 'nvarchar', length: 50, nullable: true })
  @Index('IDX_master_assets_ifs_workcenter_id')
  ifs_workcenter_id!: string | null;

  @Column({ name: 'ifs_workcenter_description', type: 'nvarchar', length: 500, nullable: true })
  ifs_workcenter_description!: string | null;

  @Column({ name: 'ifs_cost_center', type: 'nvarchar', length: 50, nullable: true })
  ifs_cost_center!: string | null;

  // ── OT-asset shape extras (OTAssetData.json — IT/network devices) ──────────
  // These come from the ingest-mmag-ot-assets.py projection, which selects a
  // different set of columns than the machines projection. A plain-machine
  // row leaves them null; an IT-managed-device row populates them.
  @Column({ name: 'ifs_part_no', type: 'nvarchar', length: 50, nullable: true })
  ifs_part_no!: string | null; // e.g. '444444' for IT-managed devices

  @Column({ name: 'ifs_part_description', type: 'nvarchar', length: 500, nullable: true })
  ifs_part_description!: string | null; // e.g. 'IT-Managed Device'

  @Column({ name: 'ifs_serial_state', type: 'nvarchar', length: 50, nullable: true })
  ifs_serial_state!: string | null; // e.g. 'Contained'

  @Column({ name: 'ifs_operational_condition', type: 'nvarchar', length: 50, nullable: true })
  ifs_operational_condition!: string | null; // e.g. 'Operational'

  @Column({ name: 'ifs_server_path', type: 'nvarchar', length: 500, nullable: true })
  ifs_server_path!: string | null;

  // ── CMDB (secondary identity, may be absent — see cmdb_status) ────────────
  @Column({ name: 'cmdb_id', type: 'nvarchar', length: 100, nullable: true })
  @Index('IDX_master_assets_cmdb_id')
  cmdb_id!: string | null;

  @Column({ name: 'cmdb_status', type: 'nvarchar', length: 50, nullable: true })
  @Index('IDX_master_assets_cmdb_status')
  cmdb_status!: string | null; // e.g. 'Deployed' | 'MISSING'

  @Column({ name: 'cmdb_mac_address', type: 'nvarchar', length: 50, nullable: true })
  cmdb_mac_address!: string | null;

  @Column({ name: 'cmdb_catalog_item', type: 'nvarchar', length: 100, nullable: true })
  cmdb_catalog_item!: string | null;

  @Column({ name: 'cmdb_os', type: 'nvarchar', length: 100, nullable: true })
  cmdb_os!: string | null;

  @Column({ name: 'cmdb_os_version', type: 'nvarchar', length: 100, nullable: true })
  cmdb_os_version!: string | null;

  @Column({ name: 'cmdb_manufacturer', type: 'nvarchar', length: 200, nullable: true })
  cmdb_manufacturer!: string | null;

  @Column({ name: 'cmdb_model', type: 'nvarchar', length: 200, nullable: true })
  cmdb_model!: string | null;

  @Column({ name: 'cmdb_serial_number', type: 'nvarchar', length: 100, nullable: true })
  cmdb_serial_number!: string | null;

  @Column({ name: 'cmdb_received_date', type: 'datetime', nullable: true })
  cmdb_received_date!: Date | null;

  // ── Import bookkeeping ─────────────────────────────────────────────────────
  @CreateDateColumn({ name: 'created_at' })
  created_at!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updated_at!: Date;

  // Timestamp of the import run that last wrote this row (distinct from
  // updated_at, which TypeORM would also bump on a manual edit — this column
  // is set explicitly by the (future) import script and by nothing else).
  @Column({ name: 'imported_at', type: 'datetime', nullable: true })
  imported_at!: Date | null;

  toApiResponse() {
    return {
      ifs_id: this.ifs_id,
      ifs_site: this.ifs_site,
      ifs_operational_status: this.ifs_operational_status,
      ifs_machine_id: this.ifs_machine_id,
      ifs_machine_part_no: this.ifs_machine_part_no,
      ifs_machine_part_description: this.ifs_machine_part_description,
      ifs_production_line_id: this.ifs_production_line_id,
      ifs_workcenter_id: this.ifs_workcenter_id,
      ifs_workcenter_description: this.ifs_workcenter_description,
      ifs_cost_center: this.ifs_cost_center,
      ifs_part_no: this.ifs_part_no,
      ifs_part_description: this.ifs_part_description,
      ifs_serial_state: this.ifs_serial_state,
      ifs_operational_condition: this.ifs_operational_condition,
      ifs_server_path: this.ifs_server_path,
      cmdb_id: this.cmdb_id,
      cmdb_status: this.cmdb_status,
      cmdb_mac_address: this.cmdb_mac_address,
      cmdb_catalog_item: this.cmdb_catalog_item,
      cmdb_os: this.cmdb_os,
      cmdb_os_version: this.cmdb_os_version,
      cmdb_manufacturer: this.cmdb_manufacturer,
      cmdb_model: this.cmdb_model,
      cmdb_serial_number: this.cmdb_serial_number,
      cmdb_received_date: this.cmdb_received_date,
      imported_at: this.imported_at,
    };
  }
}
