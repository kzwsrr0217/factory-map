/**
 * asset.types.ts — TypeScript interfaces for the Asset API shape.
 *
 * These interfaces describe the JSON structure returned by `Asset.toApiResponse()` and
 * consumed by the frontend's `asset.service.ts`. They do NOT map 1:1 to database columns
 * — the entity uses flat columns while the API uses nested objects for clarity.
 *
 * The `IAsset` interface is the canonical contract between backend and frontend.
 * Both sides must stay in sync when new fields are added.
 */
import { ICoordinates } from './hierarchy.types';

export interface IAssetITSM {
  itsm_guid: string | null;
  hardware_asset_id: string | null;
  asset_class: string | null;
  itsm_modified_at: Date | null;
  source_of_truth: 'local' | 'itsm';
  is_managed: boolean;
  last_synced: Date | null;
  sync_status: 'success' | 'failed' | 'never';
  sync_errors: Array<{
    timestamp: Date;
    error: string;
  }>;
}

export interface IAssetItsmSnapshot {
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

export interface IAssetBasicInfo {
  display_name: string;
  asset_tag?: string;
  serial_number?: string;
  model?: string;
  manufacturer?: string;
  status?: string;
  type?: string;
  os_type?: string;
  os_version?: string;
  mac_address?: string;
}

export interface IAssetTechnicalSpecs {
  cpu?: string;
  ram?: string;
  storage?: string;
  gpu?: string;
  other_specs?: Record<string, unknown>;
}

export interface IAssetNetwork {
  ip_address?: string;
  hostname?: string;
  vlan?: string;
  switch_port?: string;
}

export interface IAssetAssignedPerson {
  person_id: string;
  itsm_id?: string;
  full_name: string;
}

export interface IAssetOrganization {
  itsm_id?: string;
  display_name?: string;
}

export interface IAssetCatalogItem {
  itsm_id?: string;
  display_name?: string;
}

export interface IAssetSoftware {
  software_id: string | null;
  display_name: string;
  vendor?: string;
  version?: string;
  source: 'itsm' | 'manual';
}

export interface IAssetConnectedHardware {
  hardware_id: string | null;
  display_name: string;
  model?: string;
  source: 'itsm' | 'manual';
}

export interface IAssetTicket {
  ticket_id: string;
  itsm_url: string;
}

export interface IAssetLocation {
  coordinates: ICoordinates;
  rotation?: number;
  icon_type: string;
  description?: string;
  history?: Array<{
    moved_at: Date;
    from_coordinates: ICoordinates;
    to_coordinates: ICoordinates;
    moved_by: string;
    reason?: string;
  }>;
}

export interface IAssetCustomFields {
  physical_condition?: 'Good' | 'Fair' | 'Poor';
  environment?: string;
  notes?: string;
  tags?: string[];
  object_id?: string;
  serial_object?: string;
  remote_access_tool?: string;
  backup_tool?: string;
  backup_status?: 'active' | 'inactive' | 'error' | 'not_configured';
  winupdate_date?: Date;
  fortiedr_active?: boolean;
}

export interface IAssetHierarchy {
  building_id: string;
  floor_id: string;
  workarea_id: string;
  section_id: string;
  workstation_id: string;
}

export interface IAssetConnection {
  connected_asset_id: string;
  connection_type: 'network' | 'power' | 'usb' | 'serial' | 'parallel' | 'bluetooth' | 'wifi' | 'ethernet' | 'fiber' | 'dependency' | 'parent-child' | 'peer' | 'other';
  description?: string;
  label?: string;
  bidirectional?: boolean;
  strength?: 'weak' | 'normal' | 'strong';
  created_at?: Date;
}

export interface IAssetMaintenance {
  last_date?: Date;
  next_date?: Date;
  interval_days?: number;
  notes?: string;
}

export interface IAsset {
  _id?: string;
  predecessor_id?: string | null;
  successor_id?: string | null;
  is_placed?: boolean;
  hierarchy: IAssetHierarchy;
  itsm: IAssetITSM;
  itsm_snapshot?: IAssetItsmSnapshot;
  basic_info: IAssetBasicInfo;
  organization?: IAssetOrganization;
  catalog_item?: IAssetCatalogItem;
  technical_specs?: IAssetTechnicalSpecs;
  network?: IAssetNetwork;
  assigned_person?: IAssetAssignedPerson | null;
  software?: IAssetSoftware[];
  connected_hardware?: IAssetConnectedHardware[];
  connections?: IAssetConnection[];
  tickets?: IAssetTicket[];
  location: IAssetLocation;
  custom_fields?: IAssetCustomFields;
  maintenance?: IAssetMaintenance;
  created_at?: Date;
  created_by?: string;
  updated_at?: Date;
  updated_by?: string;
}
