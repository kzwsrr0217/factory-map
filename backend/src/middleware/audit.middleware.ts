/**
 * audit.middleware.ts — Automatic audit logging for mutating API operations.
 *
 * Two middleware factories are exported:
 *
 * `captureAuditBefore(Entity)` — Must be placed BEFORE `auditLog` in the middleware
 * chain. Loads the current entity state from the database and attaches it to
 * `req._auditBefore`. This snapshot is used to produce a before/after diff for
 * update operations. If the entity cannot be loaded (not found, DB error), the
 * middleware continues without a snapshot — audit still fires, just without the
 * before state.
 *
 * `auditLog(collection)` — Wraps `res.json` to intercept the response body after
 * the handler runs, then writes an AuditLog row on `res.finish`. Only fires for
 * successful responses (status < 400). Bulk operations are excluded (path ends
 * with '/bulk') because they produce per-item results handled differently.
 *
 * The audit write is fire-and-forget (`catch` logs the error but does not affect
 * the response) — an audit failure should never cause a visible API error.
 */
import { Response, NextFunction } from 'express';
import { EntityTarget, ObjectLiteral } from 'typeorm';
import { AppDataSource } from '../config/database';
import { AuditLog } from '../entities/AuditLog.entity';
import { AuthRequest } from './auth.middleware';

type AuditAction = 'create' | 'update' | 'delete';

let auditFailureCount = 0;
const AUDIT_FAILURE_THRESHOLD = 5;

const methodToAction: Record<string, AuditAction> = {
  POST: 'create',
  PATCH: 'update',
  PUT: 'update',
  DELETE: 'delete',
};

export const captureAuditBefore = <T extends ObjectLiteral>(
  Entity: EntityTarget<T>,
  _select?: string
) => {
  return async (req: AuthRequest, _res: Response, next: NextFunction): Promise<void> => {
    const id = req.params.id;
    if (id) {
      try {
        const repo = AppDataSource.getRepository(Entity);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const doc = await repo.findOne({ where: { id } as any });
        if (doc) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (req as any)._auditBefore = doc;
        }
      } catch {
        // Non-fatal: proceed without before snapshot
      }
    }
    next();
  };
};

export const auditLog = (collection: string) => {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const originalJson = (res as any).json.bind(res);
    let capturedResponse: unknown;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (res as any).json = function (data: unknown) {
      capturedResponse = data;
      return originalJson(data);
    };

    res.on('finish', () => {
      if (res.statusCode >= 400) return;

      const action = methodToAction[req.method];
      if (!action) return;

      const user = req.user;
      if (!user) return;

      if (req.path.endsWith('/bulk')) return;

      let document_id = req.params.id ?? '';
      let diff: unknown;

      if (action === 'create') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const created = (capturedResponse as any)?.data;
        if (created && !Array.isArray(created)) {
          document_id = String(created._id ?? document_id);
          diff = {
            display_name: created.basic_info?.display_name,
            type: created.basic_info?.type,
            status: created.basic_info?.status,
            manufacturer: created.basic_info?.manufacturer,
            serial_number: created.basic_info?.serial_number,
          };
        }
      } else if (action === 'update') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const before = (req as any)._auditBefore;
        diff = before ? { before, after: req.body } : req.body;
      } else if (action === 'delete') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        diff = (req as any)._auditBefore ?? undefined;
      }

      if (!AppDataSource.isInitialized) return;
      const logRepo = AppDataSource.getRepository(AuditLog);
      logRepo.save(logRepo.create({
        user_id: user.id,
        username: user.username,
        action,
        entity_type: collection,
        document_id,
        diff,
      })).then(() => {
        auditFailureCount = 0;
      }).catch((err: unknown) => {
        auditFailureCount++;
        if (auditFailureCount >= AUDIT_FAILURE_THRESHOLD) {
          console.error(`[AuditLog] CRITICAL: ${auditFailureCount} consecutive audit write failures. Audit trail may be incomplete.`, err);
        } else {
          console.error('[AuditLog] Failed to write audit entry:', err);
        }
      });
    });

    next();
  };
};
