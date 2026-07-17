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

export interface ReconcileSummary {
  total_linked: number;
  never_checked: number;
  in_sync: number;
  differences: number;
  missing: number;
  error: number;
  generated_at: string;
}

export const itsmService = {
  // ── Read from LOCAL DB (no ITSM call) ─────────────────────────────────────
  getLinked: async (): Promise<ReconcileLinkedAsset[]> => {
    const res = await api.get('/itsm/reconcile/linked');
    return res.data.data;
  },
  getSummary: async (): Promise<ReconcileSummary> => {
    const res = await api.get('/itsm/reconcile/summary');
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
