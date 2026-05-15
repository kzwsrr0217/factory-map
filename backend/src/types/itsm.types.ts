/**
 * ITSM Types (READ-ONLY integration)
 */

export interface IITSMHardware {
  itsm_guid: string;
  itsm_id: string;
  display_name: string;
  serial_number: string;
  asset_tag: string;
  model: string;
  manufacturer: string;
  asset_class?: string;
  os_type?: string;
  os_version?: string;
  mac_address?: string;
  status: 'Deployed' | 'In Stock' | 'Maintenance' | 'Retired';
  itsm_modified_at?: string;
  assigned_to_person?: string;
  assigned_person_name?: string;
  organization_itsm_id?: string;
  organization_name?: string;
  catalog_item_itsm_id?: string;
  catalog_item_name?: string;
  installed_software?: string[];
  related_tickets?: string[];
}

export interface IITSMPerson {
  person_id: string;
  full_name: string;
  assigned_hardware?: string[];
}

export interface IITSMSoftware {
  software_id: string;
  display_name: string;
  vendor: string;
  version: string;
  installations?: {
    hardware_id: string;
    installed_date: string;
  }[];
}

export interface IITSMTicket {
  ticket_id: string;
  itsm_url: string;
}

export interface IITSMSyncResult {
  success: boolean;
  hardware?: IITSMHardware;
  person?: IITSMPerson | null;
  software?: Array<{
    software_id: string;
    display_name: string;
    source: 'itsm';
  }>;
  tickets?: IITSMTicket[];
  synced_at: string;
  error?: string;
}

export interface ISyncAllResult {
  total: number;
  created: number;
  updated: number;
  snapshotted: number;
  skipped: number;
  errors: Array<{ itsm_guid: string; error: string }>;
  started_at: Date;
  completed_at: Date;
}