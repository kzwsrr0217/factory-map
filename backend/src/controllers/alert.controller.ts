/**
 * alert.controller.ts — Alert configuration and history endpoints.
 *
 * Routes (all require JWT):
 *   GET  /api/alerts/config  — fetch current AlertConfig
 *   PUT  /api/alerts/config  — update AlertConfig (admin only)
 *   GET  /api/alerts/logs    — paginated AlertLog (desc)
 *   POST /api/alerts/test    — run checkAndSend() immediately (admin only)
 */
import { Request, Response } from 'express';
import { AppDataSource } from '../config/database';
import { AlertLog } from '../entities/AlertLog.entity';
import {
  getAlertConfig,
  saveAlertConfig,
  checkAndSend,
} from '../services/alert/AlertService';

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
