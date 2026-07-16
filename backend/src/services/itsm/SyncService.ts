/**
 * SyncService.ts — Full ITSM-to-database synchronisation logic.
 *
 * `runSyncAll()` fetches the complete hardware list from the ITSM adapter and
 * reconciles it with the local asset database using this strategy:
 *
 *   New hardware (no matching itsm_guid locally):
 *     → Create a new asset with source_of_truth = 'itsm'
 *
 *   Existing asset, source_of_truth = 'itsm':
 *     → If ITSM has newer data (itsm_modified_at > last_synced): overwrite all ITSM fields
 *     → If unchanged: skip (no write)
 *
 *   Existing asset, source_of_truth = 'local':
 *     → Store the ITSM data as itsm_snapshot (pending review)
 *     → The operator reviews and either accepts or dismisses the snapshot
 *
 * This design ensures that locally curated data is never silently overwritten by
 * the ITSM system — the operator always has a chance to review conflicts.
 *
 * `applyItsmHardwareToAsset()`: Maps ITSM hardware fields to entity columns.
 * `buildSnapshot()`: Creates the itsm_snapshot object stored on local assets.
 */
import { AppDataSource } from '../../config/database';
import { Asset } from '../../entities/Asset.entity';
import itsmService from './ITSMService';
import { ISyncAllResult, IITSMHardware } from '../../types/itsm.types';

function applyItsmHardwareToAsset(asset: Asset, hw: IITSMHardware): void {
  asset.itsm_guid = hw.itsm_guid;
  asset.hardware_asset_id = hw.itsm_id;
  asset.asset_class = hw.asset_class ?? null;
  asset.itsm_modified_at = hw.itsm_modified_at ? new Date(hw.itsm_modified_at) : null;
  asset.is_managed = true;
  asset.source_of_truth = 'itsm';
  asset.last_synced = new Date();
  asset.sync_status = 'success';
  asset.display_name = hw.display_name;
  asset.serial_number = hw.serial_number ?? null;
  asset.asset_tag = hw.asset_tag ?? null;
  asset.model = hw.model ?? null;
  asset.manufacturer = hw.manufacturer ?? null;
  asset.os_type = hw.os_type ?? null;
  asset.os_version = hw.os_version ?? null;
  asset.mac_address = hw.mac_address ?? null;
  asset.status = hw.status ?? null;
  if (hw.assigned_to_person) {
    asset.person_id = hw.assigned_to_person;
    asset.person_itsm_id = hw.assigned_to_person;
    asset.person_full_name = hw.assigned_person_name ?? null;
  }
  if (hw.organization_itsm_id) {
    asset.org_itsm_id = hw.organization_itsm_id;
    asset.org_display_name = hw.organization_name ?? null;
  }
  if (hw.catalog_item_itsm_id) {
    asset.catalog_itsm_id = hw.catalog_item_itsm_id;
    asset.catalog_display_name = hw.catalog_item_name ?? null;
  }
}

function buildSnapshot(hw: IITSMHardware) {
  return {
    display_name: hw.display_name,
    serial_number: hw.serial_number,
    asset_tag: hw.asset_tag,
    mac_address: hw.mac_address,
    status: hw.status,
    person_name: hw.assigned_person_name,
    person_itsm_id: hw.assigned_to_person,
    organization_name: hw.organization_name,
    organization_itsm_id: hw.organization_itsm_id,
    catalog_item_name: hw.catalog_item_name,
    catalog_item_itsm_id: hw.catalog_item_itsm_id,
    synced_at: new Date(),
  };
}

export async function runSyncAll(): Promise<ISyncAllResult> {
  const started_at = new Date();
  const result: ISyncAllResult = { total: 0, created: 0, updated: 0, snapshotted: 0, skipped: 0, errors: [], started_at, completed_at: new Date() };

  let allHardware: IITSMHardware[];
  try {
    allHardware = await itsmService.syncAll();
  } catch (err) {
    throw new Error(`Failed to fetch hardware list from ITSM: ${err instanceof Error ? err.message : String(err)}`);
  }

  result.total = allHardware.length;
  const assetRepo = AppDataSource.getRepository(Asset);

  for (const hw of allHardware) {
    try {
      const existing = await assetRepo.findOne({ where: { itsm_guid: hw.itsm_guid } });

      if (!existing) {
        const asset = assetRepo.create({ source_of_truth: 'itsm', sync_status: 'success', is_managed: true });
        applyItsmHardwareToAsset(asset, hw);
        await assetRepo.save(asset);
        result.created++;
        continue;
      }

      const sourceOfTruth = existing.source_of_truth ?? 'local';

      if (sourceOfTruth === 'itsm') {
        const itsmModifiedAt = hw.itsm_modified_at ? new Date(hw.itsm_modified_at) : null;
        if (itsmModifiedAt && existing.last_synced && itsmModifiedAt <= existing.last_synced) {
          result.skipped++;
          continue;
        }
        applyItsmHardwareToAsset(existing, hw);
        await assetRepo.save(existing);

        // NOTE: previously this deleted all AssetSoftware rows for the asset and
        // never re-created them, silently wiping the software list on every sync.
        // The bulk hardware payload does not carry resolved software details, so
        // we leave existing software untouched here. Software is (re)populated by
        // the per-asset sync path (syncAsset), which resolves installed_software.
        result.updated++;
      } else {
        existing.itsm_snapshot = buildSnapshot(hw);
        existing.last_synced = new Date();
        existing.sync_status = 'success';
        await assetRepo.save(existing);
        result.snapshotted++;
      }
    } catch (err) {
      result.errors.push({ itsm_guid: hw.itsm_guid, error: err instanceof Error ? err.message : String(err) });
    }
  }

  result.completed_at = new Date();
  return result;
}
