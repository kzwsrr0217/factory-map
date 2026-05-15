/**
 * ReplaceAssetModal.tsx — Swap one asset's physical slot with another.
 *
 * "Replace" means the selected replacement asset inherits the current asset's
 * building, floor, and map coordinates. Calls
 * `assetService.replaceAsset(currentId, replacementId)` which performs the
 * coordinate transfer on the backend in a single PATCH.
 *
 * The replacement list is filtered to exclude the current asset and shows a
 * live search box for large inventories. The "Before → After" row previews
 * both asset names before confirming.
 */
import React, { useState, useEffect } from 'react';
import { ArrowRight } from 'lucide-react';
import Modal from '../common/Modal';
import Button from '../common/Button';
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
  const [allAssets, setAllAssets] = useState<Asset[]>([]);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setSearch('');
    setSelectedId('');
    assetService.getAssets()
      .then(assets => setAllAssets(assets.filter(a => a._id !== currentAsset._id)))
      .catch(() => toast.error('Failed to load assets'));
  }, [isOpen, currentAsset._id, toast]);

  const filtered = allAssets.filter(a => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      a.basic_info.display_name.toLowerCase().includes(q) ||
      (a.custom_fields?.object_id ?? '').toLowerCase().includes(q) ||
      (a.basic_info.asset_tag ?? '').toLowerCase().includes(q)
    );
  });

  const selectedAsset = allAssets.find(a => a._id === selectedId) ?? null;

  const handleConfirm = async () => {
    if (!selectedId) return;
    setSaving(true);
    try {
      await Promise.all([
        assetService.updateAsset(currentAsset._id, { successor_id: selectedId }),
        assetService.updateAsset(selectedId, { predecessor_id: currentAsset._id }),
      ]);
      toast.success(`${currentAsset.basic_info.display_name} linked — replaced by ${selectedAsset?.basic_info.display_name}`);
      onSuccess();
      onClose();
    } catch {
      toast.error('Failed to link assets');
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
          This will set the successor of <strong>{currentAsset.basic_info.display_name}</strong> and the predecessor of the new asset, linking them in the lifecycle chain.
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
            <div className={styles.empty}>No assets found</div>
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
