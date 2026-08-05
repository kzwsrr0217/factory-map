/**
 * inventory.controller.ts — Handing the app the physical inventory.
 *
 * The round the app is built around: download the ITSM export, walk the site with the
 * survey tool, give both to the app, and work from what disagrees. This is the survey half
 * of that (the export half is itsm.controller's `importSnapshotFromUpload`).
 *
 * Two things shape these endpoints:
 *
 *  - **Preview, then apply.** A survey import updates the placement of every device it
 *    matched and creates local assets for the ones ITSM has never heard of. Both are worth
 *    seeing first, so `apply: false` returns the plan and writes nothing.
 *  - **The corrections are the work.** What a survey import actually needs from a person
 *    is not a button press, it is decisions: "hr iroda" means "HR Iroda", "gorog tomi" is
 *    Görög Tamás. Those live in `name_corrections` and are edited here, so the loop is
 *    preview → fix a name → preview again, rather than editing a JSON file on a server.
 *
 * The survey file is parsed in the browser and only its rows are posted. It records who
 * uses which device, so it is Confidential; not putting it on the server's disk beats
 * remembering to delete it.
 */
import { Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { AppDataSource } from '../config/database';
import { AuditLog } from '../entities/AuditLog.entity';
import {
  NameCorrection,
  NameCorrectionScope,
  NAME_CORRECTION_SCOPES,
} from '../entities/NameCorrection.entity';
import {
  Corrections,
  SurveyRow,
  fold,
  planSurveyImport,
} from '../services/inventory/surveyImport';
import { io } from '../server';
import { AuthRequest } from '../middleware/auth.middleware';

/**
 * POST /api/inventory/survey/import
 * Body: { rows: SurveyRow[], corrections?, create_missing_workareas?, apply? }
 */
export const importSurvey = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const rows = req.body?.rows;
    if (!Array.isArray(rows)) {
      res.status(400).json({ success: false, error: 'Body must include a "rows" array of survey entries' });
      return;
    }
    if (rows.length === 0) {
      // Unlike the ITSM snapshot import this would not delete anything, but a run over
      // nothing still reports "0 unmatched", which reads like a clean survey.
      res.status(400).json({ success: false, error: 'The survey holds no entries. Is it the right export file?' });
      return;
    }

    const apply = req.body?.apply === true;
    const { plan, created } = await planSurveyImport({
      rows: rows as SurveyRow[],
      corrections: (req.body?.corrections ?? {}) as Corrections,
      createMissingWorkAreas: req.body?.create_missing_workareas === true,
      apply,
    });

    if (apply) {
      for (const asset of created) io.emit('asset:created', asset.toApiResponse());
      // No per-asset event for the updates. A survey run re-places every device it found —
      // pushing a thousand `asset:updated` payloads to every connected client costs more
      // than the refresh it saves, and the one client that asked for the import refetches
      // from the response anyway.
      await writeImportAudit(req, plan.to_update, created, plan.to_create);
    }

    res.json({ success: true, data: plan });
  } catch (error) { next(error); }
};

/**
 * One row per created asset — a local-only asset has no other provenance, and "where did
 * this monitor come from" is a question someone will ask.
 *
 * The updates get a single summary row instead. A survey run re-places every device it
 * found; per-asset rows would add a thousand entries per run and bury the individual edits
 * the audit log exists to show.
 */
async function writeImportAudit(
  req: AuthRequest,
  updated: number,
  created: Array<{ id: string; display_name: string; asset_type: string | null; serial_number: string | null }>,
  createdCount: number,
): Promise<void> {
  const user = req.user;
  if (!user) return;
  const logRepo = AppDataSource.getRepository(AuditLog);
  const base = { user_id: user.id, username: user.username };
  const writes = created.map((a) => logRepo.save(logRepo.create({
    ...base,
    action: 'create',
    entity_type: 'asset',
    document_id: a.id,
    diff: {
      display_name: a.display_name,
      type: a.asset_type,
      serial_number: a.serial_number,
      note: 'created by an inventory survey import — not in ITSM yet',
    },
  })));
  writes.push(logRepo.save(logRepo.create({
    ...base,
    action: 'update',
    entity_type: 'inventory_survey',
    // Not an entity id: this row is about the run. Kept in the same column because the
    // audit log has one shape, and a run needs an identity to be referred to.
    document_id: randomUUID(),
    diff: { assets_updated: updated, assets_created: createdCount },
  })));
  await Promise.all(writes.map((w) => w.catch(() => { /* audit failure must never fail the request */ })));
}

// ── Corrections ───────────────────────────────────────────────────────────────

/** GET /api/inventory/corrections */
export const listCorrections = async (_req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const rows = await AppDataSource.getRepository(NameCorrection).find({
      order: { scope: 'ASC', from_value: 'ASC' },
    });
    res.json({ success: true, data: rows.map((r) => r.toApiResponse()) });
  } catch (error) { next(error); }
};

/**
 * PUT /api/inventory/corrections
 * Body: { scope, from_value, to_value, note? }
 *
 * Upsert rather than create: the natural key is (scope, folded from), and someone
 * correcting the same name twice means "I got it wrong the first time", not "add a second
 * rule". Two rules for one name would make the import depend on row order.
 */
export const upsertCorrection = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const scope = String(req.body?.scope ?? '') as NameCorrectionScope;
    const fromValue = String(req.body?.from_value ?? '').trim();
    const toValue = String(req.body?.to_value ?? '').trim();
    const note = req.body?.note ? String(req.body.note).trim() : null;

    if (!NAME_CORRECTION_SCOPES.includes(scope)) {
      res.status(400).json({ success: false, error: `"scope" must be one of: ${NAME_CORRECTION_SCOPES.join(', ')}` });
      return;
    }
    if (!fromValue || !toValue) {
      res.status(400).json({ success: false, error: 'Both "from_value" and "to_value" are required' });
      return;
    }
    const fromFolded = fold(fromValue);
    if (fromFolded === fold(toValue)) {
      // It would match on its own already; storing it suggests a fix that is doing
      // nothing, which is worse than no row.
      res.status(400).json({ success: false, error: 'Those two names already match once case and accents are ignored — no correction is needed.' });
      return;
    }

    const repo = AppDataSource.getRepository(NameCorrection);
    const existing = await repo.findOne({ where: { scope, from_folded: fromFolded } });
    const saved = existing
      ? await repo.save(Object.assign(existing, { from_value: fromValue, to_value: toValue, note }))
      : await repo.save(repo.create({
        scope,
        from_value: fromValue,
        from_folded: fromFolded,
        to_value: toValue,
        note,
        created_by: req.user?.username ?? null,
      }));

    res.status(existing ? 200 : 201).json({ success: true, data: saved.toApiResponse() });
  } catch (error) { next(error); }
};

/** Checked before the query: the MSSQL driver throws on a malformed GUID, which
 * surfaces as a 500 for what is a bad request. */
const UUID_SHAPE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** DELETE /api/inventory/corrections/:id */
export const deleteCorrection = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!UUID_SHAPE.test(req.params.id)) {
      res.status(400).json({ success: false, error: 'Not a correction id' });
      return;
    }
    const repo = AppDataSource.getRepository(NameCorrection);
    const existing = await repo.findOne({ where: { id: req.params.id } });
    if (!existing) { res.status(404).json({ success: false, error: 'Correction not found' }); return; }
    await repo.remove(existing);
    res.json({ success: true, data: { _id: req.params.id } });
  } catch (error) { next(error); }
};
