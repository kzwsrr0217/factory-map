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

/**
 * Read-only reconciliation types.
 *
 * The reconcile flow compares each locally-stored asset that is linked to ITSM
 * (has a `hardware_asset_id`) against the ITSM record and reports per-field
 * differences. ITSM stays the single source of truth — nothing is written back
 * to ITSM. For each field diff the user can individually accept the ITSM value
 * (which writes it into the local app) or leave it (and fix it in ITSM).
 */
export interface IReconcileFieldDiff {
  /** Stable field key used by the accept endpoint (e.g. `serial_number`). */
  field: string;
  /** Human-readable label for the UI. */
  label: string;
  /** Current value stored locally in the app. */
  local_value: string | null;
  /** Value reported by ITSM (source of truth). */
  itsm_value: string | null;
}

export interface IReconcileAssetResult {
  asset_id: string;
  hardware_asset_id: string | null;
  itsm_guid: string | null;
  display_name: string;
  /** Deep-link to the record in the ITSM web UI, when resolvable. */
  itsm_url: string | null;
  /** True when the linked asset no longer exists in ITSM. */
  missing_in_itsm: boolean;
  /** Active field-level differences (ignored ones filtered out). */
  diffs: IReconcileFieldDiff[];
  /** Differences the user has chosen to ignore (still matching ITSM). */
  ignored: IReconcileFieldDiff[];
  /** When this asset was last checked against ITSM. */
  checked_at: Date | null;
  /** Populated when the ITSM lookup itself errored (network/auth). */
  error?: string;
}

/** Lightweight list row built from the LOCAL DB only — never calls ITSM. */
export interface IReconcileLinkedAsset {
  asset_id: string;
  display_name: string;
  hardware_asset_id: string | null;
  source_of_truth: string;
  last_status: string | null;
  last_at: Date | null;
  diff_count: number | null;
}

/** Drift overview aggregated from stored per-asset results — never calls ITSM. */
export interface IReconcileSummary {
  total_linked: number;
  never_checked: number;
  in_sync: number;
  differences: number;
  missing: number;
  error: number;
  generated_at: Date;
}

export interface IReconcileReport {
  /** Assets that carry a hardware_asset_id and were therefore checked. */
  checked: number;
  /** Assets with at least one difference or missing in ITSM. */
  with_differences: number;
  /** Assets checked that matched ITSM exactly. */
  in_sync: number;
  /** Only the assets that have something to review. */
  results: IReconcileAssetResult[];
  started_at: Date;
  completed_at: Date;
}