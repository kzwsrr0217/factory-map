/**
 * itsm.controller.ts — ITSM integration endpoints.
 *
 * `searchHardware`: Proxy to ITSM adapter's hardware search. Used by the asset form
 * when an operator wants to link an existing ITSM record to a new asset.
 *
 * `syncAll`: Triggers a full sync of all hardware from ITSM into the local database.
 * Uses the strategy in SyncService (create / overwrite / snapshot depending on
 * source_of_truth).
 *
 * `acceptSnapshot`: Applies a pending ITSM snapshot to the local asset. When an ITSM
 * sync encounters a locally-managed asset, it stores the ITSM data as `itsm_snapshot`
 * rather than overwriting the local record. The operator reviews the snapshot and
 * calls this endpoint to accept the changes, which sets source_of_truth = 'itsm' and
 * clears the snapshot.
 */
import { Request, Response, NextFunction } from 'express';
import itsmService from '../services/itsm/ITSMService';
import { runSyncAll } from '../services/itsm/SyncService';
import { AppDataSource } from '../config/database';
import { Asset } from '../entities/Asset.entity';

export const searchHardware = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { q } = req.query;
    if (!q || typeof q !== 'string') { res.status(400).json({ success: false, error: 'Query parameter "q" is required' }); return; }
    const results = await itsmService.searchHardware(q);
    res.json({ success: true, data: results });
  } catch (error) { next(error); }
};

export const getHardware = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const hardware = await itsmService.getHardware(req.params.hardwareId);
    res.json({ success: true, data: hardware });
  } catch (error) { next(error); }
};

export const syncAsset = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await itsmService.syncAsset(req.params.hardwareId);
    if (!result.success) { res.status(500).json({ success: false, error: result.error }); return; }
    res.json({ success: true, data: result });
  } catch (error) { next(error); }
};

export const syncAll = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await runSyncAll();
    res.json({ success: true, data: result });
  } catch (error) { next(error); }
};

export const acceptSnapshot = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const repo = AppDataSource.getRepository(Asset);
    const asset = await repo.findOne({ where: { id } });
    if (!asset) { res.status(404).json({ success: false, error: 'Asset not found' }); return; }

    const snap = asset.itsm_snapshot;
    if (!snap?.display_name) { res.status(400).json({ success: false, error: 'No ITSM snapshot available for this asset' }); return; }

    if (snap.display_name) asset.display_name = snap.display_name;
    if (snap.serial_number) asset.serial_number = snap.serial_number;
    if (snap.asset_tag) asset.asset_tag = snap.asset_tag;
    if (snap.mac_address) asset.mac_address = snap.mac_address;
    if (snap.status) asset.status = snap.status;
    if (snap.person_itsm_id) { asset.person_itsm_id = snap.person_itsm_id; asset.person_full_name = snap.person_name ?? asset.person_full_name; }
    if (snap.organization_itsm_id) { asset.org_itsm_id = snap.organization_itsm_id; asset.org_display_name = snap.organization_name ?? null; }
    if (snap.catalog_item_itsm_id) { asset.catalog_itsm_id = snap.catalog_item_itsm_id; asset.catalog_display_name = snap.catalog_item_name ?? null; }

    asset.source_of_truth = 'itsm';
    asset.sync_status = 'success';
    asset.last_synced = new Date();
    asset.itsm_snapshot = null;

    await repo.save(asset);
    res.json({ success: true, data: asset.toApiResponse() });
  } catch (error) { next(error); }
};
