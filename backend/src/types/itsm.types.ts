/**
 * ITSM Types (READ-ONLY integration)
 */

export interface IITSMHardware {
  itsm_id: string;
  display_name: string;
  serial_number: string;
  asset_tag: string;
  model: string;
  manufacturer: string;
  os_type?: string;
  os_version?: string;
  mac_address?: string;
  status: 'Deployed' | 'In Stock' | 'Maintenance' | 'Retired';
  assigned_to_person?: string;
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