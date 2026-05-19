/**
 * AuditLog.tsx — Audit trail viewer ("/audit").
 *
 * Displays the append-only audit log of all create/update/delete operations
 * and auth events. Supports server-side filtering by:
 *   action      — create | update | delete | login | logout | login_failed |
 *                 lock | password_change | password_reset | role_change
 *   entity_type — asset | building | floor | workarea | section | workstation
 *   actor       — username substring filter
 *   date range  — from / to ISO date strings
 *
 * Features:
 *   Pagination   — page/limit driven by AuditQuery; total is shown in the header.
 *   JSON diff    — expandable "before/after" diff shown for update actions.
 *   CSV export   — downloads the full filtered log (up to server limit).
 *   Action icons — each AuditAction maps to a Lucide icon in ACTION_ICON.
 */
import React, { useState } from 'react';
import {
  Download, AlertTriangle, RefreshCw, LogIn, LogOut, Lock, KeyRound,
  Plus, Pencil, Trash2, ShieldAlert, ClipboardList, SearchX,
} from 'lucide-react';
import { AuditEntry, AuditAction, AuditQuery } from '../services/audit.service';
import { useAuditLog } from '../hooks/queries/useAuditLog';
import styles from '../styles/pages/AuditLog.module.css';

const ACTION_ICON: Record<AuditAction, React.ReactNode> = {
  create:           <Plus size={16} />,
  update:           <Pencil size={16} />,
  delete:           <Trash2 size={16} />,
  login:            <LogIn size={16} />,
  logout:           <LogOut size={16} />,
  login_failed:     <AlertTriangle size={16} />,
  account_locked:   <Lock size={16} />,
  password_changed: <KeyRound size={16} />,
};

const ACTION_LABEL: Record<AuditAction, string> = {
  create: 'created',
  update: 'updated',
  delete: 'deleted',
  login: 'logged in',
  logout: 'logged out',
  login_failed: 'failed login attempt',
  account_locked: 'account locked',
  password_changed: 'changed password',
};

const ALL_ACTIONS: AuditAction[] = [
  'create', 'update', 'delete',
  'login', 'logout', 'login_failed',
  'account_locked', 'password_changed',
];

const PAGE_SIZE = 50;

const EntrySkeleton: React.FC = () => (
  <li className={styles.entry}>
    <div className={`${styles.entryIconSkeleton} ${styles.skeleton}`} />
    <div className={styles.entryContent}>
      <div className={`${styles.skeletonLine} ${styles.skeleton}`} style={{ width: '55%' }} />
      <div className={`${styles.skeletonLine} ${styles.skeleton}`} style={{ width: '35%', marginTop: 6 }} />
    </div>
  </li>
);

const formatVal = (v: unknown): string => {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
};

const AuditLog: React.FC = () => {
  const [page, setPage] = useState(1);
  const [expandedEntries, setExpandedEntries] = useState<Set<string>>(new Set());
  const toggleExpand = (id: string) =>
    setExpandedEntries(prev => { const s = new Set(prev); s.has(id) ? s.delete(id) : s.add(id); return s; });

  const [draftUsername, setDraftUsername] = useState('');
  const [draftAction, setDraftAction] = useState<AuditAction | ''>('');
  const [draftEntity, setDraftEntity] = useState('');
  const [draftFrom, setDraftFrom] = useState('');
  const [draftTo, setDraftTo] = useState('');

  const [query, setQuery] = useState<AuditQuery>({ limit: PAGE_SIZE, offset: 0 });

  const { data, isLoading: loading, isError, refetch } = useAuditLog(query);
  const entries: AuditEntry[] = data?.data ?? [];
  const total = data?.total ?? 0;
  const fetchError = isError ? 'Could not load audit log.' : null;

  const handleApply = () => {
    const newQuery: AuditQuery = {
      limit: PAGE_SIZE,
      offset: 0,
      username: draftUsername || undefined,
      action: (draftAction as AuditAction) || undefined,
      entity_type: draftEntity || undefined,
      from: draftFrom || undefined,
      to: draftTo || undefined,
    };
    setPage(1);
    setQuery(newQuery);
  };

  const handleClear = () => {
    setDraftUsername('');
    setDraftAction('');
    setDraftEntity('');
    setDraftFrom('');
    setDraftTo('');
    setPage(1);
    setQuery({ limit: PAGE_SIZE, offset: 0 });
  };

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    setQuery((q) => ({ ...q, offset: (newPage - 1) * PAGE_SIZE }));
  };

  const handleExportCSV = () => {
    const rows = [
      ['Timestamp', 'Username', 'Action', 'Entity Type', 'Document ID', 'IP Address'],
      ...entries.map((e) => [
        new Date(e.timestamp).toISOString(),
        e.username,
        e.action,
        e.entity_type,
        e.document_id,
        e.ip_address ?? '',
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const hasActiveFilters = !!(draftUsername || draftAction || draftEntity || draftFrom || draftTo);

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Audit Log</h1>
        <button
          className={styles.exportBtn}
          onClick={handleExportCSV}
          disabled={entries.length === 0}
        >
          <Download size={14} style={{ marginRight: 6 }} />
          Export CSV
        </button>
      </div>

      {/* Filter Panel */}
      <div className={styles.filterPanel}>
        <div className={styles.filterField}>
          <label className={styles.filterLabel}>Username</label>
          <input
            className={styles.filterInput}
            type="text"
            placeholder="Any user"
            value={draftUsername}
            onChange={(e) => setDraftUsername(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleApply()}
          />
        </div>

        <div className={styles.filterField}>
          <label className={styles.filterLabel}>Action</label>
          <select
            className={styles.filterSelect}
            value={draftAction}
            onChange={(e) => setDraftAction(e.target.value as AuditAction | '')}
          >
            <option value="">All actions</option>
            {ALL_ACTIONS.map((a) => (
              <option key={a} value={a}>{a}</option>
            ))}
          </select>
        </div>

        <div className={styles.filterField}>
          <label className={styles.filterLabel}>Entity type</label>
          <input
            className={styles.filterInput}
            type="text"
            placeholder="e.g. asset, user"
            value={draftEntity}
            onChange={(e) => setDraftEntity(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleApply()}
          />
        </div>

        <div className={styles.filterField}>
          {/* alignment spacer */}
        </div>

        <div className={`${styles.filterField} ${styles.filterRow2}`}>
          <div className={styles.filterField}>
            <label className={styles.filterLabel}>From</label>
            <input
              className={styles.filterInput}
              type="datetime-local"
              value={draftFrom}
              onChange={(e) => setDraftFrom(e.target.value)}
            />
          </div>
          <div className={styles.filterField}>
            <label className={styles.filterLabel}>To</label>
            <input
              className={styles.filterInput}
              type="datetime-local"
              value={draftTo}
              onChange={(e) => setDraftTo(e.target.value)}
            />
          </div>
          <div className={styles.filterActions}>
            <button className={styles.applyBtn} onClick={handleApply}>Apply</button>
            <button className={styles.clearBtn} onClick={handleClear}>Clear</button>
          </div>
        </div>
      </div>

      {/* Error state */}
      {!loading && fetchError && (
        <div className={styles.errorState}>
          <AlertTriangle size={18} />
          <span>{fetchError}</span>
          <button className={styles.retryBtn} onClick={() => refetch()}>
            <RefreshCw size={13} style={{ marginRight: 4 }} />
            Retry
          </button>
        </div>
      )}

      {/* Pagination info */}
      {!loading && !fetchError && total > 0 && (
        <div className={styles.paginationRow}>
          <span>{total} total entries · Page {page} of {totalPages}</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className={styles.pageBtn} onClick={() => handlePageChange(page - 1)} disabled={page <= 1}>← Prev</button>
            <button className={styles.pageBtn} onClick={() => handlePageChange(page + 1)} disabled={page >= totalPages}>Next →</button>
          </div>
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <ul className={styles.timeline}>
          {[1, 2, 3, 4, 5, 6].map((i) => <EntrySkeleton key={i} />)}
        </ul>
      )}

      {/* Empty state */}
      {!loading && !fetchError && entries.length === 0 && (
        <div className={styles.emptyState}>
          {hasActiveFilters ? (
            <SearchX size={40} className={styles.emptyIcon} />
          ) : (
            <ClipboardList size={40} className={styles.emptyIcon} />
          )}
          <p>{hasActiveFilters ? 'No entries match your filters.' : 'No audit entries yet.'}</p>
          {hasActiveFilters && (
            <button className={styles.clearBtn} onClick={handleClear} style={{ marginTop: 8 }}>
              Clear filters
            </button>
          )}
        </div>
      )}

      {/* Timeline */}
      {!loading && !fetchError && entries.length > 0 && (
        <ul className={styles.timeline}>
          {entries.map((entry) => (
            <li key={entry._id} className={styles.entry}>
              <span
                className={styles.entryIcon}
                aria-hidden="true"
                data-action={entry.action}
              >
                {ACTION_ICON[entry.action] ?? <ShieldAlert size={16} />}
              </span>
              <div className={styles.entryContent}>
                {(() => {
                  const entryChanges = entry.diff ?? entry.changes;
                  const changeCount = entryChanges ? Object.keys(entryChanges).length : 0;
                  return (
                    <>
                      <p className={styles.entryTitle}>
                        <strong>{entry.username}</strong>{' '}
                        {ACTION_LABEL[entry.action] ?? entry.action}
                        {entry.entity_type !== 'auth' && (
                          <>{' '}<em>{entry.entity_type}</em>{' '}<code title={entry.document_id}>{entry.document_id.slice(0, 12)}…</code></>
                        )}
                        {entry.action === 'update' && changeCount > 0 && (
                          <button
                            onClick={() => toggleExpand(entry._id)}
                            style={{ marginLeft: 8, fontSize: '0.7rem', padding: '1px 6px', borderRadius: 4, border: '1px solid var(--color-border)', background: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)' }}
                          >
                            {expandedEntries.has(entry._id) ? 'hide changes' : `${changeCount} field${changeCount !== 1 ? 's' : ''} changed`}
                          </button>
                        )}
                      </p>
                      <p className={styles.entryMeta}>
                        <span>{new Date(entry.timestamp).toLocaleString()}</span>
                        {entry.ip_address && (
                          <span className={styles.entryIp}>IP: {entry.ip_address}</span>
                        )}
                      </p>
                      {entry.action === 'update' && expandedEntries.has(entry._id) && entryChanges && (
                        <table style={{ marginTop: 8, fontSize: '0.75rem', borderCollapse: 'collapse', width: '100%' }}>
                          <thead>
                            <tr>
                              <th style={{ textAlign: 'left', padding: '2px 8px', color: 'var(--color-text-secondary)', fontWeight: 600, borderBottom: '1px solid var(--color-border)', width: '25%' }}>Field</th>
                              <th style={{ textAlign: 'left', padding: '2px 8px', color: 'var(--color-danger, #ef4444)', fontWeight: 600, borderBottom: '1px solid var(--color-border)', width: '37.5%' }}>Before</th>
                              <th style={{ textAlign: 'left', padding: '2px 8px', color: 'var(--color-success, #10b981)', fontWeight: 600, borderBottom: '1px solid var(--color-border)', width: '37.5%' }}>After</th>
                            </tr>
                          </thead>
                          <tbody>
                            {Object.entries(entryChanges).map(([field, diff]) => (
                              <tr key={field}>
                                <td style={{ padding: '3px 8px', fontFamily: 'monospace', color: 'var(--color-text-secondary)' }}>{field}</td>
                                <td style={{ padding: '3px 8px', fontFamily: 'monospace', color: 'var(--color-danger, #ef4444)', wordBreak: 'break-all' }}>{formatVal(diff.old)}</td>
                                <td style={{ padding: '3px 8px', fontFamily: 'monospace', color: 'var(--color-success, #10b981)', wordBreak: 'break-all' }}>{formatVal(diff.new)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </>
                  );
                })()}
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Bottom pagination */}
      {!loading && !fetchError && totalPages > 1 && (
        <div className={styles.paginationRow} style={{ marginTop: 'var(--spacing-lg)', marginBottom: 0 }}>
          <span>Page {page} of {totalPages}</span>
          <div style={{ display: 'flex', gap: 6 }}>
            <button className={styles.pageBtn} onClick={() => handlePageChange(page - 1)} disabled={page <= 1}>← Prev</button>
            <button className={styles.pageBtn} onClick={() => handlePageChange(page + 1)} disabled={page >= totalPages}>Next →</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default AuditLog;
