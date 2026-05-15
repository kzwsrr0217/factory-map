/**
 * alert.controller.ts — Alert configuration, history, and scheduled alerts endpoints.
 *
 * Routes (all require JWT):
 *   GET    /api/alerts/config           — fetch current AlertConfig
 *   PUT    /api/alerts/config           — update AlertConfig (admin only)
 *   GET    /api/alerts/logs             — paginated AlertLog (desc)
 *   POST   /api/alerts/test             — run checkAndSend() immediately (admin only)
 *   GET    /api/alerts/scheduled        — list all scheduled one-off alerts
 *   POST   /api/alerts/scheduled        — create a scheduled alert (operator+)
 *   DELETE /api/alerts/scheduled/:id    — remove a scheduled alert (operator+)
 *
 * Work-item targeted alerts are handled via asset.routes.ts:
 *   POST /api/assets/:assetId/work-items/:itemId/notify — send immediate alert for one task
 */
import { Request, Response } from 'express';
import { AppDataSource } from '../config/database';
import { AlertLog } from '../entities/AlertLog.entity';
import {
  getAlertConfig,
  saveAlertConfig,
  checkAndSend,
  notifyWorkItem,
  listScheduledAlerts,
  createScheduledAlert,
  deleteScheduledAlert,
} from '../services/alert/AlertService';
import type { AuthRequest } from '../middleware/auth.middleware';

export const getConfig = async (_req: Request, res: Response): Promise<void> => {
  try {
    const cfg = await getAlertConfig();
    res.json({ success: true, data: cfg });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Server error' });
  }
};

export const updateConfig = async (req: Request, res: Response): Promise<void> => {
  try {
    const cfg = await saveAlertConfig(req.body);
    res.json({ success: true, data: cfg });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Server error' });
  }
};

export const getLogs = async (req: Request, res: Response): Promise<void> => {
  try {
    const page = parseInt(String(req.query.page || '1'), 10);
    const limit = Math.min(parseInt(String(req.query.limit || '50'), 10), 200);
    const repo = AppDataSource.getRepository(AlertLog);
    const [logs, total] = await repo.findAndCount({
      order: { sent_at: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    res.json({
      success: true,
      data: logs,
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Server error' });
  }
};

export const testAlert = async (_req: Request, res: Response): Promise<void> => {
  try {
    const result = await checkAndSend();
    res.json({ success: true, data: result });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Server error' });
  }
};

export const notifyTask = async (req: Request, res: Response): Promise<void> => {
  try {
    const { assetId, itemId } = req.params;
    const result = await notifyWorkItem(assetId, itemId);
    res.json({ success: true, data: result });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Server error';
    const status = msg === 'Asset not found' || msg === 'Work item not found' ? 404 : 500;
    res.status(status).json({ success: false, error: msg });
  }
};

// ── Scheduled alerts ──────────────────────────────────────────────────────────

export const getScheduledAlerts = async (_req: Request, res: Response): Promise<void> => {
  try {
    const rows = await listScheduledAlerts();
    res.json({ success: true, data: rows });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Server error' });
  }
};

export const addScheduledAlert = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const { title, description, scheduled_for, channels, asset_filter } = req.body as {
      title: string;
      description?: string;
      scheduled_for: string;
      channels?: string;
      asset_filter?: string;
    };
    if (!title?.trim()) { res.status(400).json({ success: false, error: 'title is required' }); return; }
    if (!scheduled_for)  { res.status(400).json({ success: false, error: 'scheduled_for is required' }); return; }
    const row = await createScheduledAlert({
      title: title.trim(),
      description: description?.trim() || null,
      scheduled_for: new Date(scheduled_for),
      channels: channels ?? 'both',
      asset_filter: asset_filter?.trim() || null,
      created_by: req.user?.username ?? null,
    });
    res.status(201).json({ success: true, data: row });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Server error' });
  }
};

export const removeScheduledAlert = async (req: Request, res: Response): Promise<void> => {
  try {
    await deleteScheduledAlert(req.params.id);
    res.json({ success: true });
  } catch (err: unknown) {
    res.status(500).json({ success: false, error: err instanceof Error ? err.message : 'Server error' });
  }
};
