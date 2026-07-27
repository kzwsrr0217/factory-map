/**
 * ItsmHardwareSnapshot.entity.ts — Read-only landing table for MMH-scoped ITSM
 * hardware data.
 *
 * The backend runs in a Podman container with no working path to the real
 * Alemba View API — its only proven access pattern today is Windows
 * Integrated/Kerberos SSO from a domain-joined machine (see
 * ops/itsm/Export-ItsmMmhSnapshot.ps1, adapted from the live
 * `Run-ItsmValidation.ps1` reconciliation script). So instead of an adapter
 * making live HTTP calls from inside the container, this table is populated by
 * importing the JSON that script exports — one
 * `$filter=contains(HardwareAssetIsAssignedToLocation/DisplayName/Value,'MMH')`
 * OData call, run outside the container — via
 * `backend/src/scripts/import-itsm-snapshot.ts`. `SnapshotITSMAdapter` reads
 * only from this table; the app itself never talks to ITSM over the network.
 *
 * Full-replace on each import: this table always reflects "MMH hardware assets
 * as of the last export run", not an incrementally-merged cache, so a device
 * that moves off-MMH or is retired in ITSM disappears on the next import
 * rather than lingering.
 */
import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('itsm_hardware_snapshot')
export class ItsmHardwareSnapshot {
  @PrimaryColumn({ name: 'itsm_guid', type: 'nvarchar', length: 100 })
  itsm_guid!: string;

  @Column({ name: 'itsm_id', type: 'nvarchar', length: 100 })
  @Index('IDX_itsm_hardware_snapshot_itsm_id')
  itsm_id!: string;

  @Column({ name: 'display_name', type: 'nvarchar', length: 500, nullable: true })
  display_name!: string | null;

  @Column({ name: 'serial_number', type: 'nvarchar', length: 200, nullable: true })
  serial_number!: string | null;

  @Column({ name: 'asset_tag', type: 'nvarchar', length: 100, nullable: true })
  asset_tag!: string | null;

  // Not populated — Model isn't exposed anywhere queryable in this ITSM
  // instance (confirmed: not on the Hardware Asset, and the Catalog Items
  // reference list's grid/CSV export doesn't carry it either, only Type).
  @Column({ name: 'model', type: 'nvarchar', length: 200, nullable: true })
  model!: string | null;

  // Derived, not queried: first word of the Catalog Item's display name
  // (e.g. "DELL Optiplex..." -> "DELL"), via the reference-list join in
  // import-itsm-snapshot.ts — Manufacturer isn't in that list's export either,
  // only visible on each Catalog Item's own individual record form.
  @Column({ name: 'manufacturer', type: 'nvarchar', length: 200, nullable: true })
  manufacturer!: string | null;

  // Not populated — confirmed no OS relationship/field exists anywhere on the
  // Hardware Asset in this ITSM instance (its Software Assets list is
  // applications only, no OS entry).
  @Column({ name: 'os_type', type: 'nvarchar', length: 100, nullable: true })
  os_type!: string | null;

  @Column({ name: 'os_version', type: 'nvarchar', length: 100, nullable: true })
  os_version!: string | null;

  @Column({ name: 'mac_address', type: 'nvarchar', length: 50, nullable: true })
  mac_address!: string | null;

  @Column({ name: 'status', type: 'nvarchar', length: 50, nullable: true })
  status!: string | null;

  // The Alemba "Location" nav-property display value — this is the field the
  // export script filters on (`contains(..., 'MMH')`), kept distinct from a
  // generic "Organization" concept (see IITSMHardware.organization_name).
  @Column({ name: 'location_name', type: 'nvarchar', length: 200, nullable: true })
  @Index('IDX_itsm_hardware_snapshot_location_name')
  location_name!: string | null;

  @Column({ name: 'catalog_item_name', type: 'nvarchar', length: 200, nullable: true })
  catalog_item_name!: string | null;

  // The Catalog Item's own $Id$ GUID (from the Hardware Asset's nav
  // expansion — free, no extra ITSM call). Manufacturer/model/type-of-device
  // are NOT exposed on this nav object, only Class/Id/DisplayName — those
  // come from a separate one-time join against an exported Hardware Catalog
  // Items reference list (see import-itsm-snapshot.ts), keyed by this ID.
  @Column({ name: 'catalog_itsm_id', type: 'nvarchar', length: 100, nullable: true })
  catalog_itsm_id!: string | null;

  // Derived, not queried: the app's asset_type bucket (workstation/laptop/
  // server/...), resolved at import time from the Catalog Item's own "Type"
  // field (via the reference-list join) plus a name-based tiebreak for the
  // ambiguous "Network Device" ITSM type. See import-itsm-snapshot.ts.
  @Column({ name: 'asset_type', type: 'nvarchar', length: 50, nullable: true })
  asset_type!: string | null;

  @Column({ name: 'assigned_person_name', type: 'nvarchar', length: 200, nullable: true })
  assigned_person_name!: string | null;

  // The Person's own $Id$ GUID (free, from the same nav expansion as the name).
  @Column({ name: 'person_itsm_id', type: 'nvarchar', length: 100, nullable: true })
  person_itsm_id!: string | null;

  // The Person's human-readable ITSM login-style ID (e.g. "mmhgeza") — NOT
  // exposed on the Hardware Asset's nav expansion (only the GUID + display
  // name are, same limitation as the Catalog Item's Manufacturer/Model).
  // Resolved via a one-time join against an exported Persons CSV (ITSM web
  // UI: Asset Management > Master Data > Persons, filtered to MMH), keyed by
  // display name — see import-itsm-snapshot.ts.
  @Column({ name: 'person_id', type: 'nvarchar', length: 100, nullable: true })
  person_id!: string | null;

  // Stored verbatim (string, not Date) since the export's date format may vary.
  @Column({ name: 'itsm_modified_at', type: 'nvarchar', length: 50, nullable: true })
  itsm_modified_at!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  created_at!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updated_at!: Date;

  // Timestamp of the import run that (re)wrote this row.
  @Column({ name: 'imported_at', type: 'datetime', nullable: true })
  imported_at!: Date | null;

  toApiResponse() {
    return {
      itsm_guid: this.itsm_guid,
      itsm_id: this.itsm_id,
      display_name: this.display_name,
      serial_number: this.serial_number,
      asset_tag: this.asset_tag,
      model: this.model,
      manufacturer: this.manufacturer,
      os_type: this.os_type,
      os_version: this.os_version,
      mac_address: this.mac_address,
      status: this.status,
      location_name: this.location_name,
      catalog_item_name: this.catalog_item_name,
      catalog_itsm_id: this.catalog_itsm_id,
      asset_type: this.asset_type,
      assigned_person_name: this.assigned_person_name,
      person_itsm_id: this.person_itsm_id,
      person_id: this.person_id,
      itsm_modified_at: this.itsm_modified_at,
      imported_at: this.imported_at,
    };
  }
}
