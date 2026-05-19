/**
 * audit.service.ts — API calls for the audit log.
 *
 * `getEntries(query)`: Fetches audit log entries with optional filters:
 *  - `username`: partial match on the acting user's username
 *  - `action`: exact match (create / update / delete / login / etc.)
 *  - `entity_type`: "asset", "user", "auth", etc.
 *  - `document_id`: the UUID of the affected entity (used for per-asset history)
 *  - `from` / `to`: ISO 8601 date strings for time range filtering
 *  - `limit` / `offset`: pagination (default limit: 200, max: 1000)
 *
 * The response always normalises missing `data` / `total` / `limit` / `offset`
 * fields to safe defaults, so callers can destructure without null checks.
 */
import api from './api';

export type AuditAction =
  | 'create' | 'update' | 'delete'
  | 'login' | 'logout' | 'login_failed'
  | 'account_locked' | 'password_changed';

export interface AuditEntry {
  _id: string;
  user_id: string;
  username: string;
  action: AuditAction;
  entity_type: string;
  document_id: string;
  diff?: Record<string, { old: unknown; new: unknown }>;
  changes?: Record<string, { old: unknown; new: unknown }>; // alias for diff
  ip_address?: string;
  user_agent?: string;
  timestamp: string;
}

export interface AuditQuery {
  username?: string;
  action?: AuditAction | '';
  entity_type?: string;
  document_id?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export interface AuditResponse {
  data: AuditEntry[];
  total: number;
  limit: number;
  offset: number;
}

export const auditService = {
  getEntries: async (query: AuditQuery = {}): Promise<AuditResponse> => {
    const params: Record<string, string | number> = {};
    if (query.username) params.username = query.username;
    if (query.action) params.action = query.action;
    if (query.entity_type) params.entity_type = query.entity_type;
    if (query.document_id) params.document_id = query.document_id;
    if (query.from) params.from = query.from;
    if (query.to) params.to = query.to;
    if (query.limit) params.limit = query.limit;
    if (query.offset !== undefined) params.offset = query.offset;
    const res = await api.get('/audit', { params });
    return {
      data: res.data.data ?? [],
      total: res.data.total ?? 0,
      limit: res.data.limit ?? 200,
      offset: res.data.offset ?? 0,
    };
  },
};
