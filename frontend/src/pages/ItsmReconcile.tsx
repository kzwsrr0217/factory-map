/**
 * ItsmReconcile.tsx — READ-ONLY ITSM reconciliation (per-asset, on demand).
 *
 * ITSM is the single source of truth; this screen never writes to ITSM, and — by
 * design for the demo/pilot — never bulk-queries it. The asset list and the drift
 * summary come from the local DB. ITSM is contacted only when the user clicks
 * "Check" on a single asset. For each field difference the user then decides,
 * individually: accept the ITSM value into the app, ignore it, or (for records
 * gone from ITSM) unlink. Fixing the value in ITSM is done by the user in ITSM.
 */
import React, { useState, useCallback, useEffect } from 'react';
import {
  RefreshCw, ExternalLink, Check, EyeOff, Eye, AlertTriangle,
  CheckCircle2, XCircle, HelpCircle, Unlink, Search, PlusCircle,
} from 'lucide-react';
import Card from '../components/common/Card';
import Button from '../components/common/Button';
import Badge from '../components/common/Badge';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import {
  itsmService, ReconcileLinkedAsset, ReconcileSummary, ReconcileAssetResult, UnlinkedMmhAsset,
} from '../services/itsm.service';
import styles from '../styles/pages/ItsmReconcile.module.css';

const emptyValue = (v: string | null) => (v === null || v === undefined || v === '' ? '—' : v);

const statusBadge = (status: string | null): { variant: 'success' | 'warning' | 'error' | 'neutral'; label: string } => {
  switch (status) {
    case 'in_sync': return { variant: 'success', label: 'In sync' };
    case 'differences': return { variant: 'warning', label: 'Differences' };
    case 'missing': return { variant: 'error', label: 'Missing in ITSM' };
    case 'error': return { variant: 'error', label: 'Lookup error' };
    default: return { variant: 'neutral', label: 'Not checked' };
  }
};

const fmtDate = (s: string | null) => (s ? new Date(s).toLocaleString() : '—');

const ItsmReconcile: React.FC = () => {
  const { isOperator } = useAuth();
  const toast = useToast();
  const [linked, setLinked] = useState<ReconcileLinkedAsset[]>([]);
  const [summary, setSummary] = useState<ReconcileSummary | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [results, setResults] = useState<Record<string, ReconcileAssetResult>>({});
  const [checking, setChecking] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [unlinkedMmh, setUnlinkedMmh] = useState<UnlinkedMmhAsset[]>([]);
  const [loadingUnlinked, setLoadingUnlinked] = useState(true);

  // Separate load, independent of loadList: the underlying snapshot table may
  // not have been imported yet on some deployments, and that shouldn't block
  // the main per-asset reconcile list from loading.
  const loadUnlinkedMmh = useCallback(async () => {
    setLoadingUnlinked(true);
    try {
      setUnlinkedMmh(await itsmService.getUnlinkedMmh());
    } catch {
      setUnlinkedMmh([]);
    } finally {
      setLoadingUnlinked(false);
    }
  }, []);

  useEffect(() => { loadUnlinkedMmh(); }, [loadUnlinkedMmh]);

  const [creating, setCreating] = useState<Set<string>>(new Set());

  const loadList = useCallback(async () => {
    setLoadingList(true);
    try {
      const [l, s] = await Promise.all([itsmService.getLinked(), itsmService.getSummary()]);
      setLinked(l);
      setSummary(s);
    } catch {
      toast.error('Could not load the ITSM-linked assets.');
    } finally {
      setLoadingList(false);
    }
  }, [toast]);

  useEffect(() => { loadList(); }, [loadList]);

  const toggle = (setter: React.Dispatch<React.SetStateAction<Set<string>>>, key: string, on: boolean) =>
    setter((prev) => {
      const next = new Set(prev);
      if (on) next.add(key); else next.delete(key);
      return next;
    });

  const createFromMmh = useCallback(async (itsmGuids: string[]) => {
    const key = itsmGuids.join(',');
    toggle(setCreating, key, true);
    try {
      const { created, skipped } = await itsmService.createFromUnlinkedMmh(itsmGuids);
      setUnlinkedMmh((prev) => prev.filter((u) => !itsmGuids.includes(u.itsm_guid) || skipped.some((s) => s.itsm_guid === u.itsm_guid)));
      if (created.length > 0) toast.success(created.length === 1 ? 'Unplaced asset created — see Unplaced Assets to place it.' : `${created.length} unplaced assets created — see Unplaced Assets to place them.`);
      if (skipped.length > 0) toast.error(`${skipped.length} skipped: ${skipped.map((s) => s.error).join('; ')}`);
      await loadList();
    } catch {
      toast.error('Could not create assets from the ITSM snapshot.');
    } finally {
      toggle(setCreating, key, false);
    }
  }, [toast, loadList]);

  const refreshSummary = useCallback(async () => {
    try {
      const [l, s] = await Promise.all([itsmService.getLinked(), itsmService.getSummary()]);
      setLinked(l); setSummary(s);
    } catch { /* non-fatal */ }
  }, []);

  const checkAsset = useCallback(async (assetId: string) => {
    toggle(setChecking, assetId, true);
    try {
      const res = await itsmService.checkAsset(assetId);
      setResults((prev) => ({ ...prev, [assetId]: res }));
      await refreshSummary();
      if (res.error) toast.error(`ITSM lookup error: ${res.error}`);
    } catch {
      toast.error('ITSM check failed. Is the ITSM connection configured?');
    } finally {
      toggle(setChecking, assetId, false);
    }
  }, [refreshSummary, toast]);

  const accept = useCallback(async (assetId: string, fields: string[]) => {
    const key = `${assetId}:accept:${fields.join(',')}`;
    toggle(setBusy, key, true);
    try {
      const { applied } = await itsmService.acceptFields(assetId, fields);
      setResults((prev) => {
        const r = prev[assetId];
        if (!r) return prev;
        return { ...prev, [assetId]: { ...r, diffs: r.diffs.filter((d) => !applied.includes(d.field)) } };
      });
      await refreshSummary();
      toast.success(applied.length === 1 ? 'ITSM value written into the app.' : `${applied.length} ITSM values written into the app.`);
    } catch {
      toast.error('Could not accept the ITSM value.');
    } finally {
      toggle(setBusy, key, false);
    }
  }, [refreshSummary, toast]);

  const ignore = useCallback(async (r: ReconcileAssetResult, field: string, itsmValue: string | null) => {
    const key = `${r.asset_id}:ignore:${field}`;
    toggle(setBusy, key, true);
    try {
      await itsmService.ignore(r.asset_id, field, itsmValue);
      setResults((prev) => {
        const cur = prev[r.asset_id];
        if (!cur) return prev;
        const moved = cur.diffs.find((d) => d.field === field);
        return {
          ...prev,
          [r.asset_id]: {
            ...cur,
            diffs: cur.diffs.filter((d) => d.field !== field),
            ignored: moved ? [...cur.ignored, moved] : cur.ignored,
          },
        };
      });
      await refreshSummary();
    } catch {
      toast.error('Could not ignore this difference.');
    } finally {
      toggle(setBusy, key, false);
    }
  }, [refreshSummary, toast]);

  const unignore = useCallback(async (r: ReconcileAssetResult, field: string) => {
    const key = `${r.asset_id}:unignore:${field}`;
    toggle(setBusy, key, true);
    try {
      await itsmService.unignore(r.asset_id, field);
      setResults((prev) => {
        const cur = prev[r.asset_id];
        if (!cur) return prev;
        const moved = cur.ignored.find((d) => d.field === field);
        return {
          ...prev,
          [r.asset_id]: {
            ...cur,
            ignored: cur.ignored.filter((d) => d.field !== field),
            diffs: moved ? [...cur.diffs, moved] : cur.diffs,
          },
        };
      });
      await refreshSummary();
    } catch {
      toast.error('Could not un-ignore this difference.');
    } finally {
      toggle(setBusy, key, false);
    }
  }, [refreshSummary, toast]);

  const unlink = useCallback(async (assetId: string) => {
    const key = `${assetId}:unlink`;
    toggle(setBusy, key, true);
    try {
      await itsmService.unlink(assetId);
      setResults((prev) => { const n = { ...prev }; delete n[assetId]; return n; });
      setLinked((prev) => prev.filter((a) => a.asset_id !== assetId));
      await refreshSummary();
      toast.success('ITSM link removed from the asset.');
    } catch {
      toast.error('Could not unlink the asset.');
    } finally {
      toggle(setBusy, key, false);
    }
  }, [refreshSummary, toast]);

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>ITSM Reconcile</h1>
          <p className={styles.subtitle}>
            ITSM is the single source of truth (read-only). This list comes from the local database —
            ITSM is queried only when you check a single asset. Per field you can accept the ITSM value
            into the app, ignore it, or fix it directly in ITSM.
          </p>
        </div>
        <Button variant="outline" onClick={loadList} loading={loadingList} disabled={loadingList}>
          <RefreshCw size={16} /> Refresh list
        </Button>
      </div>

      {summary && (
        <div className={styles.stats}>
          <Card className={styles.statCard}><span className={styles.statValue}>{summary.total_linked}</span><span className={styles.statLabel}>Linked</span></Card>
          <Card className={styles.statCard}><span className={styles.statValue}><HelpCircle size={16} /> {summary.never_checked}</span><span className={styles.statLabel}>Not checked</span></Card>
          <Card className={`${styles.statCard} ${styles.statOk}`}><span className={styles.statValue}><CheckCircle2 size={16} /> {summary.in_sync}</span><span className={styles.statLabel}>In sync</span></Card>
          <Card className={`${styles.statCard} ${styles.statWarn}`}><span className={styles.statValue}><AlertTriangle size={16} /> {summary.differences}</span><span className={styles.statLabel}>Differences</span></Card>
          <Card className={`${styles.statCard} ${styles.statErr}`}><span className={styles.statValue}><XCircle size={16} /> {summary.missing + summary.error}</span><span className={styles.statLabel}>Missing / error</span></Card>
        </div>
      )}

      <Card className={styles.assetCard}>
        <div className={styles.assetHead}>
          <div className={styles.assetTitle}>
            <span className={styles.assetName}>MMH ITSM hardware not linked locally</span>
            <Badge variant={unlinkedMmh.length > 0 ? 'warning' : 'neutral'}>{unlinkedMmh.length}</Badge>
          </div>
          <div className={styles.assetActions}>
            {isOperator && unlinkedMmh.length > 0 && (
              <Button
                size="sm"
                variant="primary"
                onClick={() => createFromMmh(unlinkedMmh.map((u) => u.itsm_guid))}
                loading={creating.has(unlinkedMmh.map((u) => u.itsm_guid).join(','))}
              >
                <PlusCircle size={14} /> Create all as unplaced assets
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={loadUnlinkedMmh} loading={loadingUnlinked} disabled={loadingUnlinked}>
              <RefreshCw size={14} /> Refresh
            </Button>
          </div>
        </div>
        <p className={styles.note}>
          The reverse direction: ITSM hardware in the imported MMH snapshot with no matching local asset
          (hardware_asset_id). Built from the local DB and the last snapshot import only — no ITSM call.
          Creating an asset here makes it an unplaced, ITSM-linked record — ITSM has no floor-plan geometry,
          so it still needs to be dragged onto the map from the Unplaced Assets page.
        </p>
        {!loadingUnlinked && unlinkedMmh.length === 0 && (
          <p className={styles.note}>None found — either everything in the MMH snapshot is linked, or no snapshot has been imported yet.</p>
        )}
        {unlinkedMmh.length > 0 && (
          <div className={styles.tableWrap}>
            <table className={styles.diffTable}>
              <thead>
                <tr><th>ITSM ID</th><th>Display name</th><th>Catalog item</th><th>Status</th><th>Location</th><th className={styles.actionCol} /></tr>
              </thead>
              <tbody>
                {unlinkedMmh.map((u) => (
                  <tr key={u.itsm_guid}>
                    <td className={styles.hwid}>{u.itsm_id}</td>
                    <td>{u.display_name}</td>
                    <td>{emptyValue(u.catalog_item_name)}</td>
                    <td>{emptyValue(u.status)}</td>
                    <td>{emptyValue(u.location_name)}</td>
                    <td className={styles.actionCol}>
                      <div className={styles.rowActions}>
                        {u.itsm_url && (
                          <a className={styles.itsmLink} href={u.itsm_url} target="_blank" rel="noreferrer">
                            <ExternalLink size={14} /> Open in ITSM
                          </a>
                        )}
                        {isOperator && (
                          <button
                            className={styles.ignoreBtn}
                            onClick={() => createFromMmh([u.itsm_guid])}
                            disabled={creating.has(u.itsm_guid)}
                            title="Create as an unplaced local asset"
                          >
                            <PlusCircle size={14} /> Create
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {!loadingList && linked.length === 0 && (
        <Card className={styles.empty}><p>No ITSM-linked assets found.</p></Card>
      )}

      <div className={styles.results}>
        {linked.map((a) => {
          const badge = statusBadge(a.last_status);
          const r = results[a.asset_id];
          return (
            <Card key={a.asset_id} className={styles.assetCard}>
              <div className={styles.assetHead}>
                <div className={styles.assetTitle}>
                  <span className={styles.assetName}>{a.display_name}</span>
                  {a.hardware_asset_id && <span className={styles.hwid}>{a.hardware_asset_id}</span>}
                  <Badge variant={badge.variant}>{badge.label}</Badge>
                  {a.last_at && <span className={styles.checkedAt}>checked {fmtDate(a.last_at)}</span>}
                </div>
                <div className={styles.assetActions}>
                  {r?.itsm_url && (
                    <a className={styles.itsmLink} href={r.itsm_url} target="_blank" rel="noreferrer">
                      <ExternalLink size={14} /> Open in ITSM
                    </a>
                  )}
                  {isOperator && (
                    <Button size="sm" variant="primary" onClick={() => checkAsset(a.asset_id)} loading={checking.has(a.asset_id)}>
                      <Search size={14} /> {r ? 'Re-check' : 'Check ITSM'}
                    </Button>
                  )}
                </div>
              </div>

              {r && !r.error && !r.missing_in_itsm && r.diffs.length === 0 && r.ignored.length === 0 && (
                <p className={`${styles.note} ${styles.noteOk}`}><CheckCircle2 size={15} /> Matches ITSM — no differences.</p>
              )}

              {r?.missing_in_itsm && (
                <div className={styles.note}>
                  <XCircle size={15} /> Linked to ITSM id <code>{a.hardware_asset_id}</code> but no matching record exists in ITSM.
                  {isOperator && (
                    <Button size="sm" variant="outline" onClick={() => unlink(a.asset_id)} loading={busy.has(`${a.asset_id}:unlink`)}>
                      <Unlink size={14} /> Remove ITSM link
                    </Button>
                  )}
                </div>
              )}

              {r?.error && <p className={styles.note}><AlertTriangle size={15} /> {r.error}</p>}

              {r && r.diffs.length > 0 && (
                <div className={styles.tableWrap}>
                  <table className={styles.diffTable}>
                    <thead>
                      <tr><th>Field</th><th>App value</th><th>ITSM value (source of truth)</th><th className={styles.actionCol} /></tr>
                    </thead>
                    <tbody>
                      {r.diffs.map((d) => (
                        <tr key={d.field}>
                          <td className={styles.fieldCell}>{d.label}</td>
                          <td className={styles.localCell}>{emptyValue(d.local_value)}</td>
                          <td className={styles.itsmCell}>{emptyValue(d.itsm_value)}</td>
                          <td className={styles.actionCol}>
                            {isOperator && (
                              <div className={styles.rowActions}>
                                <Button size="sm" variant="success" onClick={() => accept(a.asset_id, [d.field])} loading={busy.has(`${a.asset_id}:accept:${d.field}`)} title="Write the ITSM value into the app">
                                  <Check size={14} /> Accept
                                </Button>
                                <button className={styles.ignoreBtn} onClick={() => ignore(r, d.field, d.itsm_value)} title="Ignore this difference (persisted)">
                                  <EyeOff size={14} /> Ignore
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {r && r.ignored.length > 0 && (
                <div className={styles.ignoredBlock}>
                  <span className={styles.ignoredLabel}>Ignored ({r.ignored.length}):</span>
                  {r.ignored.map((d) => (
                    <span key={d.field} className={styles.ignoredChip}>
                      {d.label}: {emptyValue(d.itsm_value)}
                      {isOperator && (
                        <button className={styles.unignoreBtn} onClick={() => unignore(r, d.field)} title="Compare this field again">
                          <Eye size={12} /> un-ignore
                        </button>
                      )}
                    </span>
                  ))}
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
};

export default ItsmReconcile;
