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
import { randomUUID } from 'crypto';
import { AppDataSource } from '../../config/database';
import { chunkForEntity, chunked, findByIn, MSSQL_PARAM_BUDGET } from '../../utils/mssqlBatch';
import { Asset } from '../../entities/Asset.entity';
import { AuditLog } from '../../entities/AuditLog.entity';
import { ItsmHardwareSnapshot } from '../../entities/ItsmHardwareSnapshot.entity';
import itsmService from './ITSMService';
import { snapshotRowToHardware } from './SnapshotITSMAdapter';
import config from '../../config/config';
import {
  IITSMHardware,
  IReconcileAssetResult,
  IReconcileFieldDiff,
  IReconcileLinkedAsset,
  IReconcileSummary,
  IUnlinkedMmhAsset,
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

/**
 * The third decision: record that ITSM is wrong about this field and Alemba must be corrected.
 *
 * Neither of the other two fits what happens most often after a physical survey. Accepting the
 * ITSM value overwrites what somebody verified by standing in the room; ignoring it parks a
 * difference that is not going to resolve itself. Until now that case had nowhere to go, so it
 * lived in someone's head.
 *
 * Local write only, like everything else here — the app never writes to Alemba. What this
 * produces is a `correct-in-itsm` task for a person, and that task closes itself when a later
 * export carries the app's value. Which is why `app_value` is snapshotted here rather than read
 * from the asset later: if someone edits the asset again in the meantime, the task must still be
 * judged against what was claimed at the time, not against a moving target.
 */
export async function markItsmWrong(
  assetId: string,
  field: string,
  itsmValue: string | null,
  user?: string,
  note?: string,
): Promise<Asset> {
  const def = FIELD_BY_KEY.get(field);
  if (!def) throw new Error(`Unknown reconcile field: ${field}`);
  const assetRepo = AppDataSource.getRepository(Asset);
  const asset = await assetRepo.findOne({ where: { id: assetId } });
  if (!asset) throw new Error('Asset not found');

  const list = (asset.reconcile_itsm_wrong ?? []).filter((w) => w.field !== field);
  list.push({
    field,
    app_value: def.getLocal(asset),
    itsm_value: itsmValue,
    marked_at: new Date(),
    marked_by: user,
    note,
  });
  asset.reconcile_itsm_wrong = list;
  /**
   * An ignore on the same field is dropped: the two are mutually exclusive decisions about one
   * difference, and leaving both would mean the diff is simultaneously parked and escalated.
   * The diff counter is deliberately NOT decremented — unlike an ignore, this difference is still
   * real and still there until Alemba changes.
   */
  if (asset.reconcile_ignored) {
    const kept = asset.reconcile_ignored.filter((i) => i.field !== field);
    asset.reconcile_ignored = kept.length > 0 ? kept : null;
  }
  await assetRepo.save(asset);
  return asset;
}

/** Withdraw a "correct in ITSM" mark, e.g. it turned out the app was wrong after all. */
export async function unmarkItsmWrong(assetId: string, field: string): Promise<Asset> {
  const assetRepo = AppDataSource.getRepository(Asset);
  const asset = await assetRepo.findOne({ where: { id: assetId } });
  if (!asset) throw new Error('Asset not found');
  const list = (asset.reconcile_itsm_wrong ?? []).filter((w) => w.field !== field);
  asset.reconcile_itsm_wrong = list.length > 0 ? list : null;
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
  // The assigned-person data came from ITSM (person_itsm_id/person_id/
  // person_full_name) — clear it along with the rest of the link so an
  // unlinked asset doesn't keep showing a stale ITSM-sourced assignee.
  asset.person_itsm_id = null;
  asset.person_id = null;
  asset.person_full_name = null;
  await assetRepo.save(asset);
  return asset;
}

/** List locally ITSM-linked assets. Built from the DB only — never calls ITSM. */
export async function listLinked(): Promise<IReconcileLinkedAsset[]> {
  // Excludes replaced assets (successor_id set, see replaceAsset) — a
  // decommissioned device will never be reconciled again; without this it
  // sits in the queue forever alongside genuinely active, ITSM-managed assets.
  const linked = await AppDataSource.getRepository(Asset)
    .createQueryBuilder('a')
    .where('a.hardware_asset_id IS NOT NULL')
    .andWhere('a.successor_id IS NULL')
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

// ── Serial-number matching for the "surveyed locally, registered in ITSM
// later" case ──────────────────────────────────────────────────────────────
//
// The physical inventory survey creates local-only assets for devices ITSM
// doesn't track yet (mostly monitors — see import-inventory-survey.ts). Once
// somebody registers one in Alemba it appears in the next snapshot, and since
// no local asset carries its brand-new hardware_asset_id, the unlinked-MMH
// list would offer to CREATE it — producing a second row for one physical
// device, with the duplicate lacking all the placement work from the survey.
// Serial number is the only identifier both sides record, so it's the join
// key that closes that loop.

export function normalizeSerial(serial: string | null | undefined): string {
  return (serial ?? '').trim().toLowerCase();
}

/**
 * Whether a serial is trustworthy enough to auto-link two records on.
 *
 * Real survey data contains hand-typed placeholders — "..." and "...2" both
 * appear in the first Werk1 export — and matching on those would link
 * unrelated devices, which is far worse than leaving a duplicate for a human
 * to spot. Requires some real length and enough alphanumeric content that a
 * punctuation placeholder can't qualify. Genuine serials in that same export
 * ("111207", "6wxsrm3", "cn-00ffxd-74261-44l-59ws") all pass comfortably.
 */
export function isUsableSerial(serial: string | null | undefined): boolean {
  const s = normalizeSerial(serial);
  if (s.length < 5) return false;
  return (s.match(/[a-z0-9]/g) ?? []).length >= 3;
}

/**
 * Indexes local assets that have NO ITSM link by usable serial number.
 *
 * A serial appearing on more than one such asset is dropped rather than
 * guessed at — an ambiguous match must never silently pick one.
 */
async function buildUnlinkedSerialIndex(): Promise<Map<string, Asset>> {
  const candidates = await AppDataSource.getRepository(Asset)
    .createQueryBuilder('a')
    .where('a.hardware_asset_id IS NULL')
    .andWhere('a.serial_number IS NOT NULL')
    .andWhere('a.successor_id IS NULL')
    .getMany();

  const bySerial = new Map<string, Asset>();
  const ambiguous = new Set<string>();
  for (const asset of candidates) {
    if (!isUsableSerial(asset.serial_number)) continue;
    const key = normalizeSerial(asset.serial_number);
    if (bySerial.has(key)) { ambiguous.add(key); continue; }
    bySerial.set(key, asset);
  }
  for (const key of ambiguous) bySerial.delete(key);
  return bySerial;
}

/**
 * MMH-scoped ITSM hardware (from the imported itsm_hardware_snapshot table)
 * that no local asset links to via hardware_asset_id — the reverse of the
 * usual reconcile direction. Pure local-DB + snapshot-table read; never calls
 * ITSM (the snapshot itself was populated out-of-band — see
 * SnapshotITSMAdapter / import-itsm-snapshot.ts).
 *
 * Each row carries a `serial_match` when an existing unlinked local asset has
 * the same serial, so the caller can link instead of duplicating.
 */
export async function findUnlinkedMmhAssets(): Promise<IUnlinkedMmhAsset[]> {
  const snapshotRows = await AppDataSource.getRepository(ItsmHardwareSnapshot).find();
  if (snapshotRows.length === 0) return [];

  const linked = await AppDataSource.getRepository(Asset)
    .createQueryBuilder('a')
    .select('a.hardware_asset_id', 'hardware_asset_id')
    .where('a.hardware_asset_id IS NOT NULL')
    .getRawMany<{ hardware_asset_id: string }>();
  const linkedIds = new Set(linked.map((r) => r.hardware_asset_id.toUpperCase()));
  const bySerial = await buildUnlinkedSerialIndex();

  return snapshotRows
    .filter((row) => !linkedIds.has(row.itsm_id.toUpperCase()))
    .map((row) => {
      const match = isUsableSerial(row.serial_number)
        ? bySerial.get(normalizeSerial(row.serial_number))
        : undefined;
      return {
        itsm_guid: row.itsm_guid,
        itsm_id: row.itsm_id,
        display_name: row.display_name ?? row.itsm_id,
        catalog_item_name: row.catalog_item_name,
        status: row.status,
        location_name: row.location_name,
        serial_match: match ? { asset_id: match.id, display_name: match.display_name } : null,
        itsm_url: config.itsm.webUrl ? `${config.itsm.webUrl}/Analyst/Forms/Open/${row.itsm_guid}` : null,
      };
    })
    .sort((a, b) => a.display_name.localeCompare(b.display_name));
}

export interface ICreateAssetsFromMmhResult {
  created: Asset[];
  /**
   * Existing local assets matched to an ITSM record by serial number and
   * linked, rather than duplicated — the survey-first-then-registered-in-ITSM
   * case. See buildUnlinkedSerialIndex.
   */
  linked: Asset[];
  skipped: Array<{ itsm_guid: string; error: string }>;
}

/**
 * Materialise selected MMH snapshot rows into real, **unplaced** local assets
 * (`is_placed` defaults to false — the snapshot carries no floor-plan geometry,
 * so a human still has to drag each one onto the map afterward). Only ever
 * reads the already-imported snapshot table + local DB; never calls ITSM.
 *
 * Idempotent per call: a row whose hardware_asset_id already has a local
 * asset (created by a previous call, or linked some other way since the
 * snapshot was last read) is skipped rather than duplicated.
 *
 * A row whose SERIAL matches an existing unlinked local asset is **linked** to
 * that asset instead of creating a second one — the device was surveyed
 * locally before it existed in ITSM, and the local row holds the placement
 * work. See buildUnlinkedSerialIndex for the safety rules on that match.
 */
export async function createAssetsFromUnlinkedMmh(itsmGuids: string[]): Promise<ICreateAssetsFromMmhResult> {
  const snapshotRepo = AppDataSource.getRepository(ItsmHardwareSnapshot);
  const assetRepo = AppDataSource.getRepository(Asset);
  const result: ICreateAssetsFromMmhResult = { created: [], linked: [], skipped: [] };

  // Batch both lookups up front instead of one round-trip per guid — this can
  // be called with the entire unlinked-MMH list at once (1000+ rows).
  const uniqueGuids = [...new Set(itsmGuids)];
  const rows = await findByIn(snapshotRepo, 'itsm_guid', uniqueGuids);
  const rowByGuid = new Map(rows.map((r) => [r.itsm_guid, r]));

  const itsmIds = rows.map((r) => r.itsm_id);
  const existingAssets = await findByIn(assetRepo, 'hardware_asset_id', itsmIds);
  const existingIdByHardwareId = new Map(existingAssets.map((a) => [a.hardware_asset_id!, a.id]));
  // Also guards against two rows in the SAME batch resolving to the same
  // hardware_asset_id, since existingAssets alone can't catch that.
  const claimedHardwareIds = new Set(existingIdByHardwareId.keys());
  const bySerial = await buildUnlinkedSerialIndex();
  // A serial can only be claimed once per batch, in case two ITSM records
  // carry the same one.
  const claimedSerials = new Set<string>();

  const toCreate: Asset[] = [];
  const toLink: Asset[] = [];
  for (const guid of itsmGuids) {
    const row = rowByGuid.get(guid);
    if (!row) { result.skipped.push({ itsm_guid: guid, error: 'Not found in the imported snapshot' }); continue; }

    const existingId = existingIdByHardwareId.get(row.itsm_id);
    if (existingId) { result.skipped.push({ itsm_guid: guid, error: `Already linked locally (asset ${existingId})` }); continue; }
    if (claimedHardwareIds.has(row.itsm_id)) { result.skipped.push({ itsm_guid: guid, error: 'Duplicate hardware_asset_id within this batch' }); continue; }
    claimedHardwareIds.add(row.itsm_id);

    const modifiedAt = row.itsm_modified_at ? new Date(row.itsm_modified_at) : null;

    // Same physical device already here from the survey — adopt the ITSM
    // identity onto it rather than creating a twin. Only fills fields the
    // local row is missing, so surveyed placement/person data is never
    // clobbered by the snapshot (same rule as backfillAssetsFromSnapshot).
    const serialKey = normalizeSerial(row.serial_number);
    const localMatch = isUsableSerial(row.serial_number) && !claimedSerials.has(serialKey)
      ? bySerial.get(serialKey)
      : undefined;
    if (localMatch) {
      claimedSerials.add(serialKey);
      localMatch.hardware_asset_id = row.itsm_id;
      localMatch.itsm_guid = row.itsm_guid;
      localMatch.source_of_truth = 'itsm';
      localMatch.is_managed = true;
      localMatch.sync_status = 'success';
      localMatch.last_synced = new Date();
      localMatch.itsm_modified_at = modifiedAt && !isNaN(modifiedAt.getTime()) ? modifiedAt : localMatch.itsm_modified_at;
      const fillIfEmpty = <K extends keyof Asset>(field: K, value: Asset[K] | null | undefined) => {
        if (value == null || value === '') return;
        if (localMatch[field] != null && localMatch[field] !== '') return;
        localMatch[field] = value;
      };
      fillIfEmpty('asset_tag', row.asset_tag);
      fillIfEmpty('model', row.model);
      fillIfEmpty('manufacturer', row.manufacturer);
      fillIfEmpty('asset_type', row.asset_type);
      fillIfEmpty('mac_address', row.mac_address);
      fillIfEmpty('catalog_display_name', row.catalog_item_name);
      fillIfEmpty('catalog_itsm_id', row.catalog_itsm_id);
      fillIfEmpty('person_full_name', row.assigned_person_name);
      fillIfEmpty('person_itsm_id', row.person_itsm_id);
      fillIfEmpty('person_id', row.person_id);
      toLink.push(localMatch);
      continue;
    }

    toCreate.push(assetRepo.create({
      display_name: row.display_name ?? row.itsm_id,
      hardware_asset_id: row.itsm_id,
      itsm_guid: row.itsm_guid,
      serial_number: row.serial_number,
      asset_tag: row.asset_tag,
      model: row.model,
      manufacturer: row.manufacturer,
      asset_type: row.asset_type,
      os_type: row.os_type,
      os_version: row.os_version,
      mac_address: row.mac_address,
      status: itsmStatusToLocal(row.status),
      catalog_display_name: row.catalog_item_name,
      catalog_itsm_id: row.catalog_itsm_id,
      org_display_name: row.location_name,
      person_full_name: row.assigned_person_name,
      person_itsm_id: row.person_itsm_id,
      person_id: row.person_id,
      itsm_modified_at: modifiedAt && !isNaN(modifiedAt.getTime()) ? modifiedAt : null,
      source_of_truth: 'itsm',
      is_managed: true,
      sync_status: 'success',
      last_synced: new Date(),
    }));
  }

  // Chunked because a bulk INSERT of ~1000 Assets would blow MSSQL's
  // 2100-parameter cap — see utils/mssqlBatch.ts.
  if (toCreate.length > 0) await assetRepo.save(toCreate, { chunk: chunkForEntity(Asset) });
  result.created.push(...toCreate);

  if (toLink.length > 0) await assetRepo.save(toLink, { chunk: chunkForEntity(Asset) });
  result.linked.push(...toLink);

  return result;
}

export interface IBackfillResult {
  checked: number;
  updated: number;
  fieldsWritten: number;
}

/**
 * Backfills manufacturer/asset_type/catalog_itsm_id/person_itsm_id (and
 * person_full_name) onto already-linked local assets from the current
 * snapshot table. For assets created before a snapshot re-import resolved
 * these fields (e.g. the initial MMH bulk-create, done before the Catalog
 * Items reference-list join existed) or before an export-script bug fix.
 *
 * Never overwrites a field the asset already has a value for — only fills
 * genuine gaps, so a manual edit is never clobbered. Local-DB + snapshot-table
 * read/write only; never calls ITSM.
 */
export async function backfillAssetsFromSnapshot(): Promise<IBackfillResult> {
  const assetRepo = AppDataSource.getRepository(Asset);
  const snapshotRepo = AppDataSource.getRepository(ItsmHardwareSnapshot);

  const linked = await assetRepo
    .createQueryBuilder('a')
    .where('a.hardware_asset_id IS NOT NULL')
    .getMany();

  const result: IBackfillResult = { checked: linked.length, updated: 0, fieldsWritten: 0 };
  if (linked.length === 0) return result;

  // One batched snapshot lookup for every linked asset instead of one
  // round-trip per row — this runs over the entire linked-asset set (~1000+).
  const hardwareIds = linked.map((a) => a.hardware_asset_id!);
  const rows = await findByIn(snapshotRepo, 'itsm_id', hardwareIds);
  const rowByHardwareId = new Map(rows.map((r) => [r.itsm_id, r]));

  const toSave: Asset[] = [];
  for (const asset of linked) {
    const row = rowByHardwareId.get(asset.hardware_asset_id!);
    if (!row) continue;

    let changed = false;
    const fill = <K extends keyof Asset>(field: K, value: Asset[K] | null | undefined) => {
      if (value == null || value === '') return;
      if (asset[field] != null && asset[field] !== '') return;
      asset[field] = value;
      changed = true;
      result.fieldsWritten++;
    };

    fill('manufacturer', row.manufacturer);
    fill('asset_type', row.asset_type);
    fill('catalog_itsm_id', row.catalog_itsm_id);
    fill('person_itsm_id', row.person_itsm_id);
    fill('person_full_name', row.assigned_person_name);
    fill('person_id', row.person_id);

    if (changed) toSave.push(asset);
  }

  if (toSave.length > 0) {
    // These all carry ids, so TypeORM issues per-row UPDATEs and the parameter
    // cap isn't actually in play — the chunk is a safety net in case this ever
    // saves a mix that includes new rows (where it would be INSERTs).
    await assetRepo.save(toSave, { chunk: chunkForEntity(Asset) });
    result.updated = toSave.length;
  }

  return result;
}

// ── Comparing everything at once ────────────────────────────────────────────
//
// The per-asset check above is the honest unit of work — one asset, one ITSM read, a
// person looking at the answer. It is also why the overview went stale without saying
// so: nobody clicks it a thousand times, so the drift summary described whatever had
// last been checked by hand, and after an export and a survey landed it was describing
// the past. Every linked asset read `missing` from a run made before the export existed.
//
// So this compares the lot in one pass, against the LOADED EXPORT rather than against
// live ITSM. That is the only way to do it within the rule this whole feature is built
// on — read-only, and never a thousand requests at Alemba — and it is why the result
// carries the export's own timestamp: "in sync" means in sync with an export somebody
// loaded, which is a different claim from "in sync with ITSM right now".

/** The audit `entity_type` that marks one bulk comparison. */
export const RECONCILE_RUN_ENTITY = 'reconcile_run';

export interface IReconcileAllResult {
  checked: number;
  in_sync: number;
  differences: number;
  /** Linked locally, absent from the loaded export. */
  missing: number;
  /** Field-level differences across all assets — the size of the work, not of the list. */
  diff_fields: number;
  /**
   * Differences per field, most first. A total says how much there is to do; this says what
   * kind of work it is, and they call for different answers — 34 assets whose assignee has
   * moved on is a list to walk, one wrong serial is a typo to fix.
   */
  by_field: Array<{ field: string; label: string; count: number }>;
  compared_at: Date;
  /** When the export it compared against was loaded, and how much of it there was. */
  export_loaded_at: Date | null;
  export_records: number;
}

async function recordReconcileRun(by: string, result: IReconcileAllResult): Promise<void> {
  const repo = AppDataSource.getRepository(AuditLog);
  await repo.save(repo.create({
    user_id: by,
    username: by,
    action: 'compare',
    entity_type: RECONCILE_RUN_ENTITY,
    // Not an entity id: the run is what this row is about, and it needs an identity to be
    // referred to at all. Same reasoning as the task generator's run record.
    document_id: randomUUID(),
    diff: {
      checked: result.checked,
      in_sync: result.in_sync,
      differences: result.differences,
      missing: result.missing,
      diff_fields: result.diff_fields,
      by_field: result.by_field,
      export_records: result.export_records,
    },
  })).catch(() => { /* the comparison happened; failing to log it must not undo it */ });
}

/**
 * Compares every ITSM-linked asset against the loaded export, in one pass.
 *
 * Local reads and local writes only — zero requests to ITSM, by construction rather than
 * by discipline: it never goes through the adapter. The per-asset verdicts it stores are
 * the same ones the "Check ITSM" button stores, computed by the same rules on the same
 * row shape, so the two cannot drift apart.
 *
 * Refuses to run with no export loaded. Marking a thousand assets `missing` because the
 * table is empty is exactly the wrong answer, and it is the answer this used to give.
 */
export async function reconcileAllFromSnapshot(
  { by = 'system' }: { by?: string } = {},
): Promise<IReconcileAllResult> {
  const assetRepo = AppDataSource.getRepository(Asset);
  const snapshotRepo = AppDataSource.getRepository(ItsmHardwareSnapshot);

  const rows = await snapshotRepo.find();
  if (rows.length === 0) {
    throw new Error('No ITSM export is loaded, so there is nothing to compare against. Load one first.');
  }
  const byItsmId = new Map(rows.map((r) => [r.itsm_id.toUpperCase(), r]));
  const loadedAt = rows.reduce<Date | null>((newest, r) => {
    const at = r.imported_at ? new Date(r.imported_at) : null;
    if (!at || Number.isNaN(at.getTime())) return newest;
    return !newest || at > newest ? at : newest;
  }, null);

  const linked = await assetRepo
    .createQueryBuilder('a')
    .where('a.hardware_asset_id IS NOT NULL')
    .andWhere('a.successor_id IS NULL')
    .getMany();

  const comparedAt = new Date();
  const result: IReconcileAllResult = {
    checked: linked.length,
    in_sync: 0,
    differences: 0,
    missing: 0,
    diff_fields: 0,
    by_field: [],
    compared_at: comparedAt,
    export_loaded_at: loadedAt,
    export_records: rows.length,
  };
  const perField = new Map<string, number>();

  // Grouped by the verdict they end up with, so the write is a handful of UPDATEs over id
  // lists rather than one round-trip per asset. There are only a few distinct verdicts, and
  // one statement per asset is what made the bulk report take minutes.
  const buckets = new Map<string, string[]>();
  for (const asset of linked) {
    const row = byItsmId.get(asset.hardware_asset_id!.toUpperCase());
    let status: string;
    let count = 0;
    if (!row) {
      status = 'missing';
      result.missing++;
    } else {
      const { active } = splitByIgnored(asset, computeDiffs(asset, snapshotRowToHardware(row)));
      count = active.length;
      status = count > 0 ? 'differences' : 'in_sync';
      if (count > 0) { result.differences++; result.diff_fields += count; } else { result.in_sync++; }
      for (const d of active) perField.set(d.field, (perField.get(d.field) ?? 0) + 1);
    }
    const key = `${status}|${count}`;
    const list = buckets.get(key);
    if (list) list.push(asset.id); else buckets.set(key, [asset.id]);
  }

  result.by_field = [...perField.entries()]
    .map(([field, count]) => ({ field, label: FIELD_BY_KEY.get(field)?.label ?? field, count }))
    .sort((a, b) => b.count - a.count);

  for (const [key, ids] of buckets) {
    const [status, count] = key.split('|');
    // One parameter per id, so the budget IS the row count — see utils/mssqlBatch.ts.
    for (const chunk of chunked(ids, MSSQL_PARAM_BUDGET)) {
      await assetRepo.createQueryBuilder()
        .update(Asset)
        .set({
          reconcile_last_at: comparedAt,
          reconcile_last_status: status,
          reconcile_diff_count: Number(count),
        })
        .whereInIds(chunk)
        .execute();
    }
  }

  await recordReconcileRun(by, result);
  return result;
}

/** When everything was last compared at once. Null only when it never has been. */
export async function lastReconcileRunAt(): Promise<Date | null> {
  const row = await AppDataSource.getRepository(AuditLog).findOne({
    where: { entity_type: RECONCILE_RUN_ENTITY },
    order: { timestamp: 'DESC' },
  });
  return row?.timestamp ?? null;
}

/**
 * Drift overview aggregated from the STORED per-asset results. Never calls ITSM,
 * so it reflects whatever was last manually checked — safe to poll freely.
 */
export async function driftSummary(): Promise<IReconcileSummary> {
  const linked = await AppDataSource.getRepository(Asset)
    .createQueryBuilder('a')
    .where('a.hardware_asset_id IS NOT NULL')
    .andWhere('a.successor_id IS NULL')
    .getMany();

  const summary: IReconcileSummary = {
    total_linked: linked.length,
    never_checked: 0,
    in_sync: 0,
    differences: 0,
    missing: 0,
    error: 0,
    generated_at: new Date(),
    itsm_mode: config.itsm.mode,
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
