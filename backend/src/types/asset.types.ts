/**
 * Asset Types
 */
import { Types } from 'mongoose';
import { ICoordinates } from './hierarchy.types';

export interface IAssetITSM {
  hardware_id: string | null;
  is_managed: boolean;
  last_synced: Date | null;
  sync_status: 'success' | 'failed' | 'never';
  sync_errors: Array<{
    timestamp: Date;
    error: string;
  }>;
}

export interface IAssetBasicInfo {
  display_name: string;
  asset_tag?: string;
  serial_number?: string;
  model?: string;
  manufacturer?: string;
  status?: string;
  os_type?: string;
  os_version?: string;
  mac_address?: string;
}

export interface IAssetTechnicalSpecs {
  cpu?: string;
  ram?: string;
  storage?: string;
  gpu?: string;
  other_specs?: {
    [key: string]: any;
  };
}

export interface IAssetNetwork {
  ip_address?: string;
  hostname?: string;
  vlan?: string;
  switch_port?: string;
}

export interface IAssetAssignedPerson {
  person_id: string;
  full_name: string;
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
}

export interface IAssetHierarchy {
  building_id: string;
  floor_id: string;
  workarea_id: string;
  section_id: string;
  workstation_id: string;
}

export interface IAsset {
  _id?: Types.ObjectId | string;
  hierarchy: IAssetHierarchy;
  itsm: IAssetITSM;
  basic_info: IAssetBasicInfo;
  technical_specs?: IAssetTechnicalSpecs;
  network?: IAssetNetwork;
  assigned_person?: IAssetAssignedPerson | null;
  software?: IAssetSoftware[];
  connected_hardware?: IAssetConnectedHardware[];
  tickets?: IAssetTicket[];
  location: IAssetLocation;
  custom_fields?: IAssetCustomFields;
  created_at?: Date;
  created_by?: string;
  updated_at?: Date;
  updated_by?: string;
}