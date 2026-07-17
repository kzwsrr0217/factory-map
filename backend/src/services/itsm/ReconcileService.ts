/**
 * ReconcileService.ts — READ-ONLY ITSM reconciliation.
 *
 * Philosophy (carried over from the ipcdata project): ITSM is the single source
 * of truth and is NEVER written to. Reconciliation only *reads* from ITSM and
 * compares it against the locally-stored assets, then surfaces the differences.
 * The user decides per field what to do:
 *   • fix the value in ITSM by hand (nothing happens in this app), or
 *   • accept the ITSM value → `acceptFields()` copies just that field locally.
 *
 * To avoid pulling the entire ITSM catalogue (the explicit ipcdata anti-goal),
 * we only look up the hardware IDs that actually exist locally — one filtered
 * lookup per linked asset, run with a small concurrency pool.
 *
 * The comparable fields live in one table (`RECONCILE_FIELDS`) so business rules
 * (which fields matter, how they compare, how they are written back) are all in
 * one place. Status and MAC comparisons route through `statusMapping.ts`.
 */
import { AppDataSource } from '../../config/database';
import { Asset } from '../../entities/Asset.entity';
import itsmService from './ITSMService';
import config from '../../config/config';
import {
  IITSMHardware,
  IReconcileAssetResult,
  IReconcileFieldDiff,
  IReconcileLinkedAsset,
  IReconcileSummary,
} from '../../types/itsm.types';
import {
  statusEquals,
  itsmStatusToLocal,
  normalizeMac,
} from './statusMapping';

/** Descriptor for one reconcilable field. */
interface ReconcileField {
  key: string;
  label: string;
  /** Value currently stored on the local asset. */
  getLocal: (a: Asset) => string | null;
  /** Value reported by ITSM. */
  getItsm: (hw: IITSMHardware) => string | null;
  /**
   * Display transform for the "expected" local value (defaults to the ITSM value
   * verbatim). Used so status renders in the local vocabulary.
   */
  displayItsm?: (hw: IITSMHardware) => string | null;
  /** True when local and ITSM are considered equal. */
  equals: (localValue: string | null, hw: IITSMHardware) => boolean;
  /** Write the ITSM value into the local asset when the user accepts it. */
  apply: (a: Asset, hw: IITSMHardware) => void;
}

/** Trimmed, empty-safe, case-insensitive equality for plain text fields. */
function textEquals(local: string | null, itsm: string | null): boolean {
  return (local ?? '').trim().toLowerCase() === (itsm ?? '').trim().toLowerCase();
}

/**
 * The comparable-field table. Add a row here to make a new field participate in
 * reconciliation — the report, the accept endpoint and the UI all derive from it.
 */
export const RECONCILE_FIELDS: ReconcileField[] = [
  {
    key: 'serial_number',
    label: 'Serial Number',
    getLocal: (a) => a.serial_number,
    getItsm: (hw) => hw.serial_number ?? null,
    equals: (local, hw) => textEquals(local, hw.serial_number ?? null),
    apply: (a, hw) => { a.serial_number = hw.serial_number ?? null; },
  },
  {
    key: 'status',
    label: 'Status',
    getLocal: (a) => a.status,
    getItsm: (hw) => hw.status ?? null,
    displayItsm: (hw) => itsmStatusToLocal(hw.status),
    equals: (local, hw) => statusEquals(local, hw.status),
    apply: (a, hw) => { a.status = itsmStatusToLocal(hw.status); },
  },
  {
    key: 'mac_address',
    label: 'MAC Address',
    getLocal: (a) => a.mac_address,
    getItsm: (hw) => hw.mac_address ?? null,
    equals: (local, hw) => normalizeMac(local) === normalizeMac(hw.mac_address),
    apply: (a, hw) => { a.mac_address = hw.mac_address ?? null; },
  },
  {
    key: 'display_name',
    label: 'Display Name',
    getLocal: (a) => a.display_name,
    getItsm: (hw) => hw.display_name ?? null,
    equals: (local, hw) => textEquals(local, hw.display_name ?? null),
    apply: (a, hw) => { if (hw.display_name) a.display_name = hw.display_name; },
  },
  {
    key: 'asset_tag',
    label: 'Asset Tag',
    getLocal: (a) => a.asset_tag,
    getItsm: (hw) => hw.asset_tag ?? null,
    equals: (local, hw) => textEquals(local, hw.asset_tag ?? null),
    apply: (a, hw) => { a.asset_tag = hw.asset_tag ?? null; },
  },
  {
    key: 'model',
    label: 'Model',
    getLocal: (a) => a.model,
    getItsm: (hw) => hw.model ?? null,
    equals: (local, hw) => textEquals(local, hw.model ?? null),
    apply: (a, hw) => { a.model = hw.model ?? null; },
  },
  {
    key: 'manufacturer',
    label: 'Manufacturer',
    getLocal: (a) => a.manufacturer,
    getItsm: (hw) => hw.manufacturer ?? null,
    equals: (local, hw) => textEquals(local, hw.manufacturer ?? null),
    apply: (a, hw) => { a.manufacturer = hw.manufacturer ?? null; },
  },
  {
    key: 'os_type',
    label: 'OS Type',
    getLocal: (a) => a.os_type,
    getItsm: (hw) => hw.os_type ?? null,
    equals: (local, hw) => textEquals(local, hw.os_type ?? null),
    apply: (a, hw) => { a.os_type = hw.os_type ?? null; },
  },
  {
    key: 'os_version',
    label: 'OS Version',
    getLocal: (a) => a.os_version,
    getItsm: (hw) => hw.os_version ?? null,
    equals: (local, hw) => textEquals(local, hw.os_version ?? null),
    apply: (a, hw) => { a.os_version = hw.os_version ?? null; },
  },
  {
    key: 'assigned_person',
    label: 'Assigned Person',
    getLocal: (a) => a.person_full_name,
    getItsm: (hw) => hw.assigned_person_name ?? null,
    equals: (local, hw) => textEquals(local, hw.assigned_person_name ?? null),
    apply: (a, hw) => {
      if (hw.assigned_person_name) a.person_full_name = hw.assigned_person_name;
      if (hw.assigned_to_person) {
        a.person_itsm_id = hw.assigned_to_person;
        a.person_id = a.person_id ?? hw.assigned_to_person;
      }
    },
  },
  {
    key: 'organization',
    label: 'Organization',
    getLocal: (a) => a.org_display_name,
    getItsm: (hw) => hw.organization_name ?? null,
    equals: (local, hw) => textEquals(local, hw.organization_name ?? null),
    apply: (a, hw) => {
      if (hw.organization_name) a.org_display_name = hw.organization_name;
      if (hw.organization_itsm_id) a.org_itsm_id = hw.organization_itsm_id;
    },
  },
  {
    key: 'catalog_item',
    label: 'Catalog Item',
    getLocal: (a) => a.catalog_display_name,
    getItsm: (hw) => hw.catalog_item_name ?? null,
    equals: (local, hw) => textEquals(local, hw.catalog_item_name ?? null),
    apply: (a, hw) => {
      if (hw.catalog_item_name) a.catalog_display_name = hw.catalog_item_name;
      if (hw.catalog_item_itsm_id) a.catalog_itsm_id = hw.catalog_item_itsm_id;
    },
  },
];

const FIELD_BY_KEY = new Map(RECONCILE_FIELDS.map((f) => [f.key, f]));

/** Build the ITSM deep-link for an asset, if a web URL is configured. */
function buildItsmUrl(hw: IITSMHardware | null): string | null {
  if (!hw || !config.itsm.webUrl) return null;
  // Alemba/Operaio opens records by object GUID (see ipcdata contract).
  return `${config.itsm.webUrl}/Analyst/Forms/Open/${hw.itsm_guid}`;
}

/**
 * Compute all field diffs for one asset against its ITSM record. A field is only
 * flagged when ITSM actually has a value — we never nag the user to blank out
 * local-only data that ITSM does not track.
 */
function computeDiffs(asset: Asset, hw: IITSMHardware): IReconcileFieldDiff[] {
  const diffs: IReconcileFieldDiff[] = [];
  for (const field of RECONCILE_FIELDS) {
    const itsmRaw = field.getItsm(hw);
    if (itsmRaw === null || itsmRaw === undefined || String(itsmRaw).trim() === '') continue;
    const localValue = field.getLocal(asset);
    if (field.equals(localValue, hw)) continue;
    diffs.push({
      field: field.key,
      label: field.label,
      local_value: localValue,
      itsm_value: field.displayItsm ? field.displayItsm(hw) : itsmRaw,
    });
  }
  return diffs;
}

/**
 * Split diffs into active vs. ignored. An ignore only suppresses a diff while
 * ITSM still reports the same value it was ignored at — if ITSM changes, the
 * diff resurfaces as active.
 */
function splitByIgnored(asset: Asset, allDiffs: IReconcileFieldDiff[]): {
  active: IReconcileFieldDiff[];
  ignored: IReconcileFieldDiff[];
} {
  const ignoreList = asset.reconcile_ignored ?? [];
  const active: IReconcileFieldDiff[] = [];
  const ignored: IReconcileFieldDiff[] = [];
  for (const d of allDiffs) {
    const match = ignoreList.find(
      (i) => i.field === d.field && (i.itsm_value ?? null) === (d.itsm_value ?? null),
    );
    if (match) ignored.push(d); else active.push(d);
  }
  return { active, ignored };
}

/** Persist the outcome of a check as lightweight metadata (local write only). */
async function persistResult(assetId: string, status: string, diffCount: number): Promise<void> {
  await AppDataSource.getRepository(Asset).update(assetId, {
    reconcile_last_at: new Date(),
    reconcile_last_status: status,
    reconcile_diff_count: diffCount,
  });
}

/**
 * READ-ONLY per-asset check. Performs exactly ONE ITSM read for the given asset
 * — the only time this feature ever touches ITSM. Nothing is written to ITSM.
 * Stores a small result summary locally for the drift overview.
 */
export async function reconcileAsset(assetId: string): Promise<IReconcileAssetResult> {
  const assetRepo = AppDataSource.getRepository(Asset);
  const asset = await assetRepo.findOne({ where: { id: assetId } });
  if (!asset) throw new Error('Asset not found');
  if (!asset.hardware_asset_id) throw new Error('Asset is not linked to an ITSM record');

  const base = {
    asset_id: asset.id,
    hardware_asset_id: asset.hardware_asset_id,
    itsm_guid: asset.itsm_guid,
    display_name: asset.display_name,
  };

  try {
    const hw = await itsmService.getHardware(asset.hardware_asset_id);
    const { active, ignored } = splitByIgnored(asset, computeDiffs(asset, hw));
    const status = active.length > 0 ? 'differences' : 'in_sync';
    await persistResult(asset.id, status, active.length);
    return {
      ...base,
      itsm_guid: hw.itsm_guid ?? asset.itsm_guid,
      itsm_url: buildItsmUrl(hw),
      missing_in_itsm: false,
      diffs: active,
      ignored,
      checked_at: new Date(),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const missing = /not found/i.test(message);
    await persistResult(asset.id, missing ? 'missing' : 'error', 0);
    return {
      ...base,
      itsm_url: null,
      missing_in_itsm: missing,
      diffs: [],
      ignored: [],
      checked_at: new Date(),
      ...(missing ? {} : { error: message }),
    };
  }
}

export interface IAcceptFieldsResult {
  asset: Asset;
  applied: string[];
  skipped: string[];
}

/**
 * Accept selected ITSM field values for one asset — copies just those fields
 * from ITSM into the LOCAL record (never writes to ITSM). Re-reads ITSM once so
 * the user always writes the current source-of-truth value, then refreshes the
 * stored reconcile metadata using the same fetch (no extra ITSM call).
 */
export async function acceptFields(assetId: string, fieldKeys: string[]): Promise<IAcceptFieldsResult> {
  const assetRepo = AppDataSource.getRepository(Asset);
  const asset = await assetRepo.findOne({ where: { id: assetId } });
  if (!asset) throw new Error('Asset not found');
  if (!asset.hardware_asset_id) throw new Error('Asset is not linked to an ITSM record');

  const hw = await itsmService.getHardware(asset.hardware_asset_id);

  const applied: string[] = [];
  const skipped: string[] = [];
  for (const key of fieldKeys) {
    const field = FIELD_BY_KEY.get(key);
    if (!field) { skipped.push(key); continue; }
    field.apply(asset, hw);
    applied.push(key);
  }

  if (applied.length > 0) {
    // Accepted fields now match ITSM — drop any stale ignore entries for them.
    if (asset.reconcile_ignored) {
      asset.reconcile_ignored = asset.reconcile_ignored.filter((i) => !applied.includes(i.field));
      if (asset.reconcile_ignored.length === 0) asset.reconcile_ignored = null;
    }
    const { active } = splitByIgnored(asset, computeDiffs(asset, hw));
    asset.reconcile_last_at = new Date();
    asset.reconcile_last_status = active.length > 0 ? 'differences' : 'in_sync';
    asset.reconcile_diff_count = active.length;
    asset.last_synced = new Date();
    asset.sync_status = 'success';
    await assetRepo.save(asset);
  }

  return { asset, applied, skipped };
}

/**
 * Persist a user's decision to ignore a specific field difference. The ITSM
 * value is supplied by the client (from the last check), so this does NOT call
 * ITSM. Ignoring the same field again just refreshes the stored value.
 */
export async function ignoreField(
  assetId: string,
  field: string,
  itsmValue: string | null,
  user?: string,
): Promise<Asset> {
  if (!FIELD_BY_KEY.has(field)) throw new Error(`Unknown reconcile field: ${field}`);
  const assetRepo = AppDataSource.getRepository(Asset);
  const asset = await assetRepo.findOne({ where: { id: assetId } });
  if (!asset) throw new Error('Asset not found');

  const list = (asset.reconcile_ignored ?? []).filter((i) => i.field !== field);
  list.push({ field, itsm_value: itsmValue, ignored_at: new Date(), ignored_by: user });
  asset.reconcile_ignored = list;
  if (typeof asset.reconcile_diff_count === 'number' && asset.reconcile_diff_count > 0) {
    asset.reconcile_diff_count -= 1;
    if (asset.reconcile_diff_count === 0) asset.reconcile_last_status = 'in_sync';
  }
  await assetRepo.save(asset);
  return asset;
}

/** Remove an ignore entry so the field is compared again. Local write only. */
export async function unignoreField(assetId: string, field: string): Promise<Asset> {
  const assetRepo = AppDataSource.getRepository(Asset);
  const asset = await assetRepo.findOne({ where: { id: assetId } });
  if (!asset) throw new Error('Asset not found');
  const list = (asset.reconcile_ignored ?? []).filter((i) => i.field !== field);
  asset.reconcile_ignored = list.length > 0 ? list : null;
  await assetRepo.save(asset);
  return asset;
}

/**
 * Remove the ITSM link from an asset (e.g. it no longer exists in ITSM). This is
 * a LOCAL-ONLY operation — it clears the local link fields and never contacts or
 * modifies ITSM. The asset becomes a plain local record.
 */
export async function unlinkAsset(assetId: string): Promise<Asset> {
  const assetRepo = AppDataSource.getRepository(Asset);
  const asset = await assetRepo.findOne({ where: { id: assetId } });
  if (!asset) throw new Error('Asset not found');
  asset.itsm_guid = null;
  asset.hardware_asset_id = null;
  asset.is_managed = false;
  asset.source_of_truth = 'local';
  asset.sync_status = 'never';
  asset.reconcile_ignored = null;
  asset.reconcile_last_at = null;
  asset.reconcile_last_status = null;
  asset.reconcile_diff_count = null;
  await assetRepo.save(asset);
  return asset;
}

/** List locally ITSM-linked assets. Built from the DB only — never calls ITSM. */
export async function listLinked(): Promise<IReconcileLinkedAsset[]> {
  const linked = await AppDataSource.getRepository(Asset)
    .createQueryBuilder('a')
    .where('a.hardware_asset_id IS NOT NULL')
    .orderBy('a.display_name', 'ASC')
    .getMany();
  return linked.map((a) => ({
    asset_id: a.id,
    display_name: a.display_name,
    hardware_asset_id: a.hardware_asset_id,
    source_of_truth: a.source_of_truth,
    last_status: a.reconcile_last_status,
    last_at: a.reconcile_last_at,
    diff_count: a.reconcile_diff_count,
  }));
}

/**
 * Drift overview aggregated from the STORED per-asset results. Never calls ITSM,
 * so it reflects whatever was last manually checked — safe to poll freely.
 */
export async function driftSummary(): Promise<IReconcileSummary> {
  const linked = await AppDataSource.getRepository(Asset)
    .createQueryBuilder('a')
    .where('a.hardware_asset_id IS NOT NULL')
    .getMany();

  const summary: IReconcileSummary = {
    total_linked: linked.length,
    never_checked: 0,
    in_sync: 0,
    differences: 0,
    missing: 0,
    error: 0,
    generated_at: new Date(),
  };
  for (const a of linked) {
    if (!a.reconcile_last_at) { summary.never_checked++; continue; }
    switch (a.reconcile_last_status) {
      case 'in_sync': summary.in_sync++; break;
      case 'differences': summary.differences++; break;
      case 'missing': summary.missing++; break;
      default: summary.error++; break;
    }
  }
  return summary;
}
