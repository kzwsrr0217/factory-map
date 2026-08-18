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
import {
  reconcileAsset,
  acceptFields,
  ignoreField,
  unignoreField,
  markItsmWrong,
  unmarkItsmWrong,
  unlinkAsset,
  listLinked,
  driftSummary,
  findUnlinkedMmhAssets,
  createAssetsFromUnlinkedMmh,
  reconcileAllFromSnapshot,
} from '../services/itsm/ReconcileService';
import { planSnapshotImport, parsePortalHardwareCsv } from '../services/itsm/snapshotImport';
import { AppDataSource } from '../config/database';
import { Asset } from '../entities/Asset.entity';
import { AuditLog } from '../entities/AuditLog.entity';
import { io } from '../server';
import { AuthRequest } from '../middleware/auth.middleware';

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

const notFound = (message: string) => /not found|not linked/i.test(message);

/**
 * listLinked: ITSM-linked assets built from the LOCAL DB — no ITSM call. Feeds
 * the reconcile list so the page can render without touching ITSM.
 */
export const reconcileLinked = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    res.json({ success: true, data: await listLinked() });
  } catch (error) { next(error); }
};

/**
 * summary: drift overview aggregated from stored per-asset results — no ITSM call.
 */
export const reconcileSummary = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    res.json({ success: true, data: await driftSummary() });
  } catch (error) { next(error); }
};

/**
 * compareAll: compares every linked asset against the LOADED EXPORT in one pass.
 *
 * Not an ITSM call at all — it reads the imported snapshot table, which is what makes it
 * safe to offer as a button: a thousand live lookups is exactly what this integration is
 * forbidden to do. The response carries the export's own age so the caller can say what
 * the verdicts are true of.
 */
export const reconcileCompareAll = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await reconcileAllFromSnapshot({ by: req.user?.username ?? 'system' });
    res.json({ success: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Nothing loaded is a state the caller can fix, not a server fault.
    if (/no itsm export is loaded/i.test(message)) {
      res.status(409).json({ success: false, error: message });
      return;
    }
    next(error);
  }
};

/**
 * checkAsset: READ-ONLY per-asset reconcile. Performs exactly one ITSM read for
 * this asset — the only time the feature contacts ITSM — and returns the diffs.
 */
export const reconcileCheckAsset = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const result = await reconcileAsset(req.params.id);
    res.json({ success: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (notFound(message)) { res.status(404).json({ success: false, error: message }); return; }
    next(error);
  }
};

/**
 * acceptReconcileFields: Copy selected ITSM field values into one local asset.
 * Body: { fields: string[] }. Writes ONLY to the local DB, never to ITSM.
 */
export const acceptReconcileFields = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const fields = req.body?.fields;
    if (!Array.isArray(fields) || fields.length === 0) {
      res.status(400).json({ success: false, error: 'Body must include a non-empty "fields" array' });
      return;
    }
    const { asset, applied, skipped } = await acceptFields(id, fields.map(String));
    const payload = asset.toApiResponse();
    if (applied.length > 0) io.emit('asset:updated', payload);
    res.json({ success: true, data: { asset: payload, applied, skipped } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (notFound(message)) { res.status(404).json({ success: false, error: message }); return; }
    next(error);
  }
};

/**
 * ignoreReconcileDiff: Persist "ignore this field difference". The ITSM value is
 * provided by the client (from the last check), so this does not call ITSM.
 * Body: { field: string, itsm_value?: string | null }.
 */
export const ignoreReconcileDiff = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const field = req.body?.field;
    if (!field || typeof field !== 'string') {
      res.status(400).json({ success: false, error: 'Body must include a "field"' });
      return;
    }
    const itsmValue = req.body?.itsm_value ?? null;
    const asset = await ignoreField(id, field, itsmValue, req.user?.username);
    res.json({ success: true, data: asset.toApiResponse() });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (notFound(message)) { res.status(404).json({ success: false, error: message }); return; }
    if (/unknown reconcile field/i.test(message)) { res.status(400).json({ success: false, error: message }); return; }
    next(error);
  }
};

/**
 * markReconcileItsmWrong: the third decision — the map is right, Alemba must be corrected.
 *
 * A sibling of the ignore endpoint rather than a flag on it, because the two mean opposite
 * things: an ignore says the difference does not matter, this says it does and the other system
 * is the one that has to change. It produces a `correct-in-itsm` task for a person.
 */
export const markReconcileItsmWrong = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const field = req.body?.field;
    if (!field || typeof field !== 'string') {
      res.status(400).json({ success: false, error: 'Body must include a "field"' });
      return;
    }
    const asset = await markItsmWrong(
      id, field, req.body?.itsm_value ?? null, req.user?.username, req.body?.note,
    );
    res.json({ success: true, data: asset.toApiResponse() });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (notFound(message)) { res.status(404).json({ success: false, error: message }); return; }
    if (/unknown reconcile field/i.test(message)) { res.status(400).json({ success: false, error: message }); return; }
    next(error);
  }
};

/** unmarkReconcileItsmWrong: withdraw it, e.g. the app turned out to be wrong after all. */
export const unmarkReconcileItsmWrong = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id, field } = req.params;
    const asset = await unmarkItsmWrong(id, field);
    res.json({ success: true, data: asset.toApiResponse() });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (notFound(message)) { res.status(404).json({ success: false, error: message }); return; }
    next(error);
  }
};

/** unignoreReconcileDiff: Remove an ignore so the field is compared again. */
export const unignoreReconcileDiff = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id, field } = req.params;
    const asset = await unignoreField(id, field);
    res.json({ success: true, data: asset.toApiResponse() });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (notFound(message)) { res.status(404).json({ success: false, error: message }); return; }
    next(error);
  }
};

/**
 * unlinkReconcileAsset: Remove the ITSM link from an asset (LOCAL-only; never
 * touches ITSM). Used for records that no longer exist in ITSM.
 */
export const unlinkReconcileAsset = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const asset = await unlinkAsset(req.params.id);
    const payload = asset.toApiResponse();
    io.emit('asset:updated', payload);
    res.json({ success: true, data: payload });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (notFound(message)) { res.status(404).json({ success: false, error: message }); return; }
    next(error);
  }
};

/**
 * unlinkedMmh: ITSM hardware in the MMH snapshot that no local asset links to
 * (hardware_asset_id). Local DB + snapshot table only — never calls ITSM.
 */
export const unlinkedMmh = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    res.json({ success: true, data: await findUnlinkedMmhAssets() });
  } catch (error) { next(error); }
};

/**
 * createUnlinkedMmhAssets: materialise selected MMH snapshot rows into real,
 * unplaced local assets (see createAssetsFromUnlinkedMmh). Body: { itsm_guids: string[] }.
 * Local-DB-only write — never calls ITSM.
 */
export const createUnlinkedMmhAssets = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const guids = req.body?.itsm_guids;
    if (!Array.isArray(guids) || guids.length === 0) {
      res.status(400).json({ success: false, error: 'Body must include a non-empty "itsm_guids" array' });
      return;
    }
    const result = await createAssetsFromUnlinkedMmh(guids.map(String));
    const created = result.created.map((a) => a.toApiResponse());
    // Serial-matched rows adopted an ITSM identity onto an asset that already
    // existed (see createAssetsFromUnlinkedMmh) — an update, not a create, so
    // clients refresh the existing row rather than adding a second one.
    const linked = result.linked.map((a) => a.toApiResponse());
    for (const c of created) io.emit('asset:created', c);
    for (const l of linked) io.emit('asset:updated', l);

    // Written manually rather than via the auditLog middleware — that
    // middleware expects a single created entity (or an array of them), not
    // this bulk endpoint's {created, skipped} response shape. One row per
    // created asset, matching the pattern in asset.controller.ts's replaceAsset.
    const user = req.user;
    if (user) {
      const logRepo = AppDataSource.getRepository(AuditLog);
      const write = (
        action: 'create' | 'update',
        rows: ReturnType<Asset['toApiResponse']>[],
        note: string,
      ) => rows.map((r) => logRepo.save(logRepo.create({
        user_id: user.id, username: user.username, action,
        entity_type: 'asset', document_id: r._id,
        diff: {
          display_name: r.basic_info?.display_name,
          type: r.basic_info?.type,
          status: r.basic_info?.status,
          manufacturer: r.basic_info?.manufacturer,
          serial_number: r.basic_info?.serial_number,
          hardware_asset_id: r.itsm?.hardware_asset_id,
          note,
        },
      })).catch(() => { /* audit failure must never fail the request */ }));

      await Promise.all([
        ...write('create', created, 'Created from an unlinked MMH ITSM snapshot row'),
        ...write('update', linked, 'Linked to an ITSM record by matching serial number — existing local asset adopted the ITSM identity instead of being duplicated'),
      ]);
    }

    res.json({ success: true, data: { created, linked, skipped: result.skipped } });
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

/**
 * POST /itsm/snapshot/import — loads an ITSM export handed over by the browser.
 *
 * Two things make this different from the other write endpoints:
 *
 *  - **The file never reaches the server's disk.** The browser parses it and posts rows,
 *    the same way the asset CSV import already works. An ITSM export is Confidential; not
 *    storing it is easier than remembering to delete it.
 *  - **`apply` is opt-in.** Without it the same code path returns what the load WOULD
 *    change and writes nothing, so the person can look before a snapshot replaces the
 *    previous one. That replacement is the correct semantic — an export is a point in
 *    time, and whatever is absent from it is absent from ITSM — but it is destructive
 *    enough to deserve a preview.
 */
export const importSnapshotFromUpload = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const body = req.body as {
      hardware?: unknown;
      hardwareCsv?: string | null;
      catalogItemsCsv?: string | null;
      personsCsv?: string | null;
      apply?: boolean;
    };

    /**
     * Either the OData JSON's rows, or the portal's own "Export to CSV" as text.
     *
     * The CSV matters because of who can produce it: the OData export needs PowerShell on a
     * domain-joined machine, while the CSV is two clicks in the portal by whoever is already
     * looking at the list. Parsed here rather than in the browser so that one place knows the
     * portal's column names, next to the mapper that consumes them.
     */
    let csv: { malformed: number; ignored: string[] } | null = null;
    if (!Array.isArray(body.hardware) && typeof body.hardwareCsv === 'string') {
      try {
        const parsed = parsePortalHardwareCsv(body.hardwareCsv);
        body.hardware = parsed.rows;
        csv = { malformed: parsed.malformed, ignored: parsed.ignored };
      } catch (err) {
        res.status(400).json({
          success: false,
          error: err instanceof Error ? err.message : 'Could not read that CSV',
        });
        return;
      }
    }

    if (!Array.isArray(body.hardware)) {
      res.status(400).json({ success: false, error: 'hardware must be an array of exported rows' });
      return;
    }
    if (body.hardware.length === 0) {
      // Refused rather than applied: an empty export would clear the table, and "the file
      // failed to parse" looks exactly like "ITSM has nothing" once it has happened.
      res.status(400).json({
        success: false,
        error: 'The hardware export is empty. Applying it would clear the snapshot, so it is refused.',
      });
      return;
    }

    const plan = await planSnapshotImport({
      hardware: body.hardware as Array<Record<string, unknown>>,
      catalogItemsCsv: body.catalogItemsCsv ?? null,
      personsCsv: body.personsCsv ?? null,
      apply: body.apply === true,
    });
    // The CSV's own notes travel in meta: how many rows did not fit the header, and which
    // columns this parser has no use for. A changed export should be noticed, not absorbed.
    res.json({ success: true, data: plan, ...(csv ? { meta: { csv } } : {}) });
  } catch (error) { next(error); }
};
