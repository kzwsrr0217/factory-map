/**
 * alert.service.ts — API client for alert configuration and notification history.
 *
 * Wraps GET/PUT /api/alerts/config, GET /api/alerts/logs, and POST /api/alerts/test.
 */
import api from './api';

export interface AlertConfig {
  id: string;
  email_enabled: boolean;
  email_recipients: string[] | null;
  teams_enabled: boolean;
  teams_webhook_url: string | null;
  days_before_alert: number;
  alert_on_maintenance: boolean;
  alert_on_overdue: boolean;
  created_at: string;
  updated_at: string;
}

export interface AlertLog {
  id: string;
  sent_at: string;
  channel: string;
  asset_id: string | null;
  subject: string;
  body_snippet: string;
  success: boolean;
  error_message: string | null;
}

export interface AlertTestResult {
  checked: number;
  upcoming: number;
  overdue: number;
  emailSent: boolean;
  teamsSent: boolean;
  errors: string[];
}

export const alertService = {
  async getConfig(): Promise<AlertConfig> {
    const res = await api.get<{ success: boolean; data: AlertConfig }>('/alerts/config');
    return res.data.data;
  },

  async saveConfig(dto: Partial<AlertConfig>): Promise<AlertConfig> {
    const res = await api.put<{ success: boolean; data: AlertConfig }>('/alerts/config', dto);
    return res.data.data;
  },

  async getLogs(page = 1, limit = 50): Promise<{ logs: AlertLog[]; total: number }> {
    const res = await api.get<{
      success: boolean;
      data: AlertLog[];
      meta: { total: number };
    }>('/alerts/logs', { params: { page, limit } });
    return { logs: res.data.data, total: res.data.meta.total };
  },

  async testNow(): Promise<AlertTestResult> {
    const res = await api.post<{ success: boolean; data: AlertTestResult }>('/alerts/test');
    return res.data.data;
  },
};
