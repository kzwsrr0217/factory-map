/**
 * itsm.service.ts — API calls for the READ-ONLY ITSM reconcile feature.
 *
 * Design goal (demo/pilot): never write to ITSM, and never bulk-hammer it. The
 * list of linked assets and the drift summary come from the LOCAL DB (no ITSM
 * call). ITSM is contacted only when the user explicitly checks ONE asset
 * (`checkAsset`). Accept / ignore / unlink all write to the local DB only.
 */
import api from './api';

export interface ReconcileFieldDiff {
  field: string;
  label: string;
  local_value: string | null;
  itsm_value: string | null;
}

export interface ReconcileAssetResult {
  asset_id: string;
  hardware_asset_id: string | null;
  itsm_guid: string | null;
  display_name: string;
  itsm_url: string | null;
  missing_in_itsm: boolean;
  diffs: ReconcileFieldDiff[];
  ignored: ReconcileFieldDiff[];
  checked_at: string | null;
  error?: string;
}

export interface ReconcileLinkedAsset {
  asset_id: string;
  display_name: string;
  hardware_asset_id: string | null;
  source_of_truth: string;
  last_status: string | null;   // 'in_sync' | 'differences' | 'missing' | 'error' | null
  last_at: string | null;
  diff_count: number | null;
}


/** What loading an ITSM export would change — see backend snapshotImport.ts. */
export interface SnapshotImportPlan {
  parsed: number;
  /** Rows with no HardwareAssetID/Guid: nothing can be done with them. */
  skipped: number;
  added: Array<{ itsm_id: string; display_name: string | null }>;
  /**
   * In the current snapshot, absent from this export. These become `verify-disposal`
   * tasks — and a large number here usually means the export is partial, not that the
   * estate vanished.
   */
  removed: Array<{ itsm_id: string; display_name: string | null }>;
  changed: Array<{ itsm_id: string; display_name: string | null; changes: string[] }>;
  unchanged: number;
  enrichment: {
    catalog_items: number;
    catalog_malformed: number;
    persons: number;
    persons_malformed: number;
    classified: number;
    manufacturer: number;
    person_id_resolved: number;
    with_person_name: number;
  };
  applied: boolean;
}

export interface SnapshotImportInput {
  /** The Hardware Asset export, parsed in the browser — the file never leaves it. */
  hardware?: Array<Record<string, unknown>>;
  /**
   * The portal's own "Export to CSV" of the Hardware Assets view, as text.
   *
   * An alternative to `hardware` and the easier one to come by: the OData JSON needs
   * PowerShell on a domain-joined machine, this is two clicks by whoever is looking at the
   * list. The server maps the columns, so only one place knows the portal's header names.
   */
  hardwareCsv?: string | null;
  catalogItemsCsv?: string | null;
  personsCsv?: string | null;
  apply: boolean;
}

export interface ReconcileSummary {
  total_linked: number;
  never_checked: number;
  in_sync: number;
  differences: number;
  missing: number;
  error: number;
  generated_at: string;
  /**
   * The ITSM source the server reads. Shown on the page because the verdicts are
   * only as meaningful as the source: a check run in `mock` mode marks every real
   * asset missing, which is a configuration fact, not a data problem.
   */
  itsm_mode?: 'mock' | 'real' | 'snapshot';
}

/**
 * ITSM hardware in the imported MMH snapshot that no local asset links to —
 * the reverse of the usual reconcile direction. Built from the LOCAL DB + the
 * imported snapshot table only (no ITSM call, see itsm_hardware_snapshot).
 */
export interface UnlinkedMmhAsset {
  itsm_guid: string;
  itsm_id: string;
  display_name: string;
  catalog_item_name: string | null;
  status: string | null;
  location_name: string | null;
  itsm_url: string | null;
  /**
   * An existing local asset with no ITSM link whose serial number matches this
   * ITSM record — the same physical device, surveyed before it was registered
   * in ITSM. Acting on the row LINKS that asset instead of creating a second
   * one, so its placement/person data survives.
   */
  serial_match: { asset_id: string; display_name: string } | null;
}

export const itsmService = {
  /**
   * Loads an ITSM export, or (with `apply: false`) says what loading it would change.
   *
   * The rows are parsed in the browser and posted as JSON, the same way the asset CSV
   * import works: an ITSM export is Confidential, and not putting it on the server's disk
   * is easier than remembering to delete it.
   */
  importSnapshot: async (input: SnapshotImportInput): Promise<SnapshotImportPlan> => {
    const response = await api.post('/itsm/snapshot/import', input);
    return response.data.data as SnapshotImportPlan;
  },

  // ── Read from LOCAL DB (no ITSM call) ─────────────────────────────────────
  getLinked: async (): Promise<ReconcileLinkedAsset[]> => {
    const res = await api.get('/itsm/reconcile/linked');
    return res.data.data;
  },
  getSummary: async (): Promise<ReconcileSummary> => {
    const res = await api.get('/itsm/reconcile/summary');
    return res.data.data;
  },
  getUnlinkedMmh: async (): Promise<UnlinkedMmhAsset[]> => {
    const res = await api.get('/itsm/reconcile/unlinked-mmh');
    return res.data.data;
  },
  createFromUnlinkedMmh: async (itsmGuids: string[]): Promise<{ created: unknown[]; linked: unknown[]; skipped: { itsm_guid: string; error: string }[] }> => {
    const res = await api.post('/itsm/reconcile/unlinked-mmh/create', { itsm_guids: itsmGuids });
    return res.data.data;
  },

  // ── The ONLY ITSM read: one asset, on explicit user action ────────────────
  checkAsset: async (assetId: string): Promise<ReconcileAssetResult> => {
    const res = await api.post(`/itsm/reconcile/${assetId}/check`);
    return res.data.data;
  },

  // ── Local writes (never touch ITSM) ───────────────────────────────────────
  acceptFields: async (assetId: string, fields: string[]): Promise<{ applied: string[]; skipped: string[] }> => {
    const res = await api.patch(`/itsm/reconcile/${assetId}/accept`, { fields });
    return res.data.data;
  },
  ignore: async (assetId: string, field: string, itsmValue: string | null): Promise<void> => {
    await api.patch(`/itsm/reconcile/${assetId}/ignore`, { field, itsm_value: itsmValue });
  },
  unignore: async (assetId: string, field: string): Promise<void> => {
    await api.patch(`/itsm/reconcile/${assetId}/unignore/${encodeURIComponent(field)}`);
  },
  unlink: async (assetId: string): Promise<void> => {
    await api.patch(`/itsm/reconcile/${assetId}/unlink`);
  },
};
