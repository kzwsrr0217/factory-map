/**
 * ReplaceAssetModal.tsx — Swap one asset's physical slot with another.
 *
 * "Replace" means the selected replacement asset inherits the current
 * asset's building, floor, work area/section/workstation, rack position,
 * map coordinates, wall-port assignment, AND every connection (both
 * directions) — the old asset is cleared out of its physical slot (unplaced)
 * and linked as the replacement's predecessor for lifecycle history. All of
 * this happens atomically via `assetService.replaceAsset(currentId,
 * replacementId)` — see asset.controller.ts replaceAsset.
 *
 * The replacement list is filtered to exclude the current asset and shows a
 * live search box for large inventories. The "Before → After" row previews
 * both asset names before confirming.
 */
import React, { useState, useEffect, useMemo } from 'react';
import { ArrowRight } from 'lucide-react';
import Modal from '../common/Modal';
import Button from '../common/Button';
import { useAssetSearch } from '../../hooks/useAssetSearch';
import { assetService, Asset } from '../../services/asset.service';
import { getAssetIcon } from '../../utils/assetTypes';
import { useToast } from '../../contexts/ToastContext';
import styles from '../../styles/components/ReplaceAssetModal.module.css';

interface ReplaceAssetModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  currentAsset: Asset;
}

const ReplaceAssetModal: React.FC<ReplaceAssetModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  currentAsset,
}) => {
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setSearch('');
    setSelectedId('');
  }, [isOpen]);

  /**
   * Candidates come from the server's own search rather than a download of every
   * asset filtered in the browser: the replacement is one specific device whose name
   * or tag the person already has in hand.
   */
  const { results, loading: searching, active } = useAssetSearch(search);
  const filtered = useMemo(
    () => results.filter(a => a._id !== currentAsset._id),
    [results, currentAsset._id],
  );

  const selectedAsset = filtered.find(a => a._id === selectedId) ?? null;

  const handleConfirm = async () => {
    if (!selectedId) return;
    setSaving(true);
    try {
      await assetService.replaceAsset(currentAsset._id, selectedId);
      toast.success(`${selectedAsset?.basic_info.display_name} now stands in for ${currentAsset.basic_info.display_name} — position, wiring, and connections transferred`);
      onSuccess();
      onClose();
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Failed to replace asset');
    } finally {
      setSaving(false);
    }
  };

  const footer = (
    <>
      <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
      <Button variant="primary" onClick={handleConfirm} loading={saving} disabled={!selectedId}>
        Confirm Replacement
      </Button>
    </>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Replace Asset"
      width="md"
      footer={footer}
    >
      <div className={styles.body}>
        <div className={styles.chainPreview}>
          <div className={styles.chainAsset}>
            <span className={styles.chainIcon}>{getAssetIcon(currentAsset.basic_info.type)}</span>
            <div>
              <div className={styles.chainName}>{currentAsset.basic_info.display_name}</div>
              <div className={styles.chainSub}>being replaced</div>
            </div>
          </div>

          <ArrowRight size={20} className={styles.chainArrow} />

          <div className={`${styles.chainAsset} ${selectedAsset ? styles.chainSelected : styles.chainEmpty}`}>
            {selectedAsset ? (
              <>
                <span className={styles.chainIcon}>{getAssetIcon(selectedAsset.basic_info.type)}</span>
                <div>
                  <div className={styles.chainName}>{selectedAsset.basic_info.display_name}</div>
                  <div className={styles.chainSub}>new asset</div>
                </div>
              </>
            ) : (
              <div className={styles.chainEmptyText}>Select replacement below</div>
            )}
          </div>
        </div>

        <p className={styles.hint}>
          The new asset takes over <strong>{currentAsset.basic_info.display_name}</strong>'s map position, work area, wall-port assignment, and every network connection. <strong>{currentAsset.basic_info.display_name}</strong> is removed from its physical slot and kept only as replacement history.
        </p>

        <input
          className={styles.search}
          type="text"
          placeholder="Search by name, object ID or asset tag…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          autoFocus
        />

        <div className={styles.list}>
          {filtered.length === 0 && (
            <div className={styles.empty}>
              {!active
                ? 'Type at least two characters to find the replacement.'
                : searching
                  ? 'Searching…'
                  : `No asset matches “${search.trim()}”.`}
            </div>
          )}
          {filtered.map(a => (
            <div
              key={a._id}
              className={`${styles.row} ${a._id === selectedId ? styles.rowSelected : ''}`}
              onClick={() => setSelectedId(a._id === selectedId ? '' : a._id)}
            >
              <span className={styles.rowIcon}>{getAssetIcon(a.basic_info.type)}</span>
              <div className={styles.rowInfo}>
                <span className={styles.rowName}>{a.basic_info.display_name}</span>
                <span className={styles.rowSub}>
                  {a.custom_fields?.object_id && <code>{a.custom_fields.object_id}</code>}
                  {a.basic_info.manufacturer && ` ${a.basic_info.manufacturer} ${a.basic_info.model ?? ''}`}
                </span>
              </div>
              <div className={styles.rowStatus}>
                <span className={`${styles.dot} ${a.basic_info.status === 'active' ? styles.dotActive : styles.dotOther}`} />
                {a.basic_info.status}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
};

export default ReplaceAssetModal;
