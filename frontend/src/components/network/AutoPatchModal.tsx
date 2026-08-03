/**
 * AutoPatchModal.tsx — Patches a rack's sockets from their labels, in one pass.
 *
 * Socket labels are `R<rack>/<port>` and the numbers run continuously across the
 * rack's panels, so the label already says which panel port each socket lands
 * on. This turns what would be hundreds of individual lookups into one list to
 * check.
 *
 * The list is shown **before** anything is written, and every row can be
 * unticked. That is deliberate: the derivation rests on an assumption about how
 * the numbering maps onto panels, and if that assumption is ever wrong for some
 * rack, it should be caught by looking at the first screenful — not discovered
 * later by tracing a cable by hand. Sockets the derivation could not place are
 * listed separately with the reason, because each reason names a specific thing
 * someone can go and fix.
 */
import React, { useEffect, useMemo, useState } from 'react';
import Modal from '../common/Modal';
import Button from '../common/Button';
import {
  networkService,
  PatchSuggestion,
  PatchSuggestionResult,
  PatchDerivationFailure,
} from '../../services/network.service';
import { useToast } from '../../contexts/ToastContext';
import { getApiErrorMessage } from '../../utils/apiError';
import styles from '../../styles/components/AutoPatchModal.module.css';

interface AutoPatchModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  rackId: string;
  rackName: string;
}

const FAILURE_TEXT: Record<PatchDerivationFailure, string> = {
  'label-not-parseable': 'Label is not in R<rack>/<port> form — patch it by hand',
  'rack-name-mismatch': 'Belongs to a different rack',
  'panel-missing-u-position': 'This rack has a panel with no U position, so panel order is unknown',
  'port-beyond-last-panel': 'Port number is past this rack’s last panel port',
};

const AutoPatchModal: React.FC<AutoPatchModalProps> = ({ isOpen, onClose, onSuccess, rackId, rackName }) => {
  const toast = useToast();
  const [result, setResult] = useState<PatchSuggestionResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    setExcluded(new Set());
    networkService.getPatchSuggestions(rackId)
      .then(setResult)
      .catch((err) => toast.error(getApiErrorMessage(err, 'Failed to work out the patching')))
      .finally(() => setLoading(false));
    // toast is stable; re-running on it would refetch on every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, rackId]);

  // A suggestion whose target port is already taken is excluded by default:
  // applying it would fail the collision guard anyway.
  const selectable = useMemo(
    () => (result?.suggestions ?? []).filter((s) => !s.conflict),
    [result],
  );
  const conflicting = useMemo(
    () => (result?.suggestions ?? []).filter((s) => s.conflict),
    [result],
  );
  const selected = useMemo(
    () => selectable.filter((s) => !excluded.has(s.wall_port_id)),
    [selectable, excluded],
  );

  const toggle = (id: string) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleApply = async () => {
    if (selected.length === 0) return;
    setSaving(true);
    try {
      const res = await networkService.applyPatchSuggestions(
        selected.map((s) => ({
          wall_port_id: s.wall_port_id,
          patch_panel_id: s.patch_panel_id,
          patch_port: s.patch_port,
        })),
      );
      // Rejections are surfaced, not swallowed — "42 patched" when 5 silently
      // failed is the kind of report that gets trusted and shouldn't be.
      if (res.rejected.length > 0) {
        toast.error(`${res.applied.length} patched, ${res.rejected.length} rejected — ${res.rejected[0].reason}`);
      } else {
        toast.success(`${res.applied.length} socket(s) patched`);
      }
      onSuccess();
      onClose();
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to apply the patching'));
    } finally {
      setSaving(false);
    }
  };

  const row = (s: PatchSuggestion, disabled: boolean) => (
    <label key={s.wall_port_id} className={`${styles.row} ${disabled ? styles.rowDisabled : ''}`}>
      <input
        type="checkbox"
        checked={!disabled && !excluded.has(s.wall_port_id)}
        disabled={disabled}
        onChange={() => toggle(s.wall_port_id)}
      />
      <span className={styles.label}>{s.label}</span>
      <span className={styles.arrow}>→</span>
      <span className={styles.target}>{s.patch_panel_name} <span className={styles.port}>port {s.patch_port}</span></span>
      <span className={styles.room}>{s.workarea_name ?? '—'}</span>
      {s.conflict && <span className={styles.conflict}>taken by {s.conflict}</span>}
    </label>
  );

  const footer = (
    <>
      <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
      <Button variant="primary" onClick={handleApply} loading={saving} disabled={selected.length === 0}>
        Patch {selected.length} Socket{selected.length === 1 ? '' : 's'}
      </Button>
    </>
  );

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Patch ${rackName} from socket labels`} width="lg" footer={footer}>
      {loading && <p className={styles.status}>Working out where each socket lands…</p>}

      {!loading && result && (
        <>
          <p className={styles.intro}>
            Derived from the labels: <code>{rackName}/001</code> onwards, numbered
            continuously across this rack’s panels in U-position order. Check the
            first few rows before applying — nothing is written until you do.
          </p>

          {selectable.length === 0 && conflicting.length === 0 && (
            <p className={styles.status}>No unpatched sockets to place for this rack.</p>
          )}

          {selectable.length > 0 && (
            <div className={styles.list}>{selectable.map((s) => row(s, false))}</div>
          )}

          {conflicting.length > 0 && (
            <>
              <h4 className={styles.sectionTitle}>Target port already taken ({conflicting.length})</h4>
              <div className={styles.list}>{conflicting.map((s) => row(s, true))}</div>
            </>
          )}

          {result.problems.length > 0 && (
            <>
              <h4 className={styles.sectionTitle}>Could not be placed ({result.problems.length})</h4>
              <div className={styles.list}>
                {result.problems.map((p) => (
                  <div key={p.wall_port_id} className={`${styles.row} ${styles.rowDisabled}`}>
                    <span className={styles.label}>{p.label}</span>
                    <span className={styles.problem}>{FAILURE_TEXT[p.reason]}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}
    </Modal>
  );
};

export default AutoPatchModal;
