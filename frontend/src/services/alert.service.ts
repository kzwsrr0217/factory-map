/**
 * alert.service.ts — API client for alert configuration, history, and scheduled alerts.
 *
 * Wraps:
 *   GET/PUT /api/alerts/config          — global AlertConfig
 *   GET     /api/alerts/logs            — paginated AlertLog history
 *   POST    /api/alerts/test            — trigger immediate maintenance check
 *   GET/POST/DELETE /api/alerts/scheduled — one-off ScheduledAlert CRUD
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

export interface ScheduledAlert {
  id: string;
  title: string;
  description: string | null;
  scheduled_for: string;
  channels: 'email' | 'teams' | 'both';
  asset_filter: string | null;
  sent: boolean;
  sent_at: string | null;
  created_by: string | null;
  created_at: string;
}

export interface CreateScheduledAlertDto {
  title: string;
  description?: string;
  scheduled_for: string;
  channels?: 'email' | 'teams' | 'both';
  asset_filter?: string;
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

  async getScheduledAlerts(): Promise<ScheduledAlert[]> {
    const res = await api.get<{ success: boolean; data: ScheduledAlert[] }>('/alerts/scheduled');
    return res.data.data;
  },

  async createScheduledAlert(dto: CreateScheduledAlertDto): Promise<ScheduledAlert> {
    const res = await api.post<{ success: boolean; data: ScheduledAlert }>('/alerts/scheduled', dto);
    return res.data.data;
  },

  async deleteScheduledAlert(id: string): Promise<void> {
    await api.delete(`/alerts/scheduled/${id}`);
  },
};
