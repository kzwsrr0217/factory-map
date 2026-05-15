/**
 * AddConnectionModal.tsx — Form to create a connection between two placed assets.
 *
 * Opened by FloorDetails when the user selects two assets in wire-mode.
 * Calls assetService.addConnection() on confirm.
 */
import React, { useState } from 'react';
import Modal from '../common/Modal';
import Button from '../common/Button';
import { assetService, Asset } from '../../services/asset.service';
import { useToast } from '../../contexts/ToastContext';
import styles from '../../styles/components/AddConnectionModal.module.css';

interface AddConnectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  fromAsset: Asset | null;
  toAsset: Asset | null;
}

const CONNECTION_TYPES = [
  { value: 'ethernet',     label: 'Ethernet',      color: '#3b82f6' },
  { value: 'fiber',        label: 'Fiber',          color: '#8b5cf6' },
  { value: 'wifi',         label: 'Wi-Fi',          color: '#06b6d4' },
  { value: 'power',        label: 'Power',          color: '#ef4444' },
  { value: 'usb',          label: 'USB',            color: '#f59e0b' },
  { value: 'serial',       label: 'Serial',         color: '#78716c' },
  { value: 'bluetooth',    label: 'Bluetooth',      color: '#6366f1' },
  { value: 'dependency',   label: 'Dependency',     color: '#f97316' },
  { value: 'peer',         label: 'Peer',           color: '#14b8a6' },
  { value: 'parent-child', label: 'Parent / Child', color: '#84cc16' },
  { value: 'other',        label: 'Other',          color: '#9ca3af' },
] as const;

const STRENGTHS = [
  { value: 'weak',   label: 'Weak',   width: '1px' },
  { value: 'normal', label: 'Normal', width: '2px' },
  { value: 'strong', label: 'Strong', width: '3px' },
] as const;

const AddConnectionModal: React.FC<AddConnectionModalProps> = ({
  isOpen, onClose, onSuccess, fromAsset, toAsset,
}) => {
  const toast = useToast();
  const [connectionType, setConnectionType] = useState<string>('ethernet');
  const [label, setLabel]               = useState('');
  const [description, setDescription]   = useState('');
  const [strength, setStrength]         = useState<'weak' | 'normal' | 'strong'>('normal');
  const [bidirectional, setBidirectional] = useState(true);
  const [saving, setSaving]             = useState(false);

  const selectedType = CONNECTION_TYPES.find(t => t.value === connectionType)!;

  const handleSave = async () => {
    if (!fromAsset || !toAsset) return;
    setSaving(true);
    try {
      await assetService.addConnection(fromAsset._id, {
        connected_asset_id: toAsset._id,
        connection_type: connectionType,
        label: label.trim() || undefined,
        description: description.trim() || undefined,
        strength,
        bidirectional,
      });
      toast.success('Connection added');
      onSuccess();
      handleClose();
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Failed to add connection');
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    setConnectionType('ethernet');
    setLabel('');
    setDescription('');
    setStrength('normal');
    setBidirectional(true);
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Add Connection"
      width="sm"
      footer={
        <>
          <Button variant="outline" onClick={handleClose} disabled={saving}>Cancel</Button>
          <Button variant="primary" onClick={handleSave} loading={saving} disabled={!fromAsset || !toAsset}>
            Add Connection
          </Button>
        </>
      }
    >
      <div className={styles.container}>
        {/* Assets */}
        <div className={styles.assetPair}>
          <div className={styles.assetChip}>
            <span className={styles.assetDot} style={{ background: '#6b7280' }} />
            {fromAsset?.basic_info?.display_name ?? '—'}
          </div>
          <div
            className={styles.connector}
            style={{ borderColor: selectedType.color }}
            aria-hidden
          >
            {bidirectional ? '⟷' : '→'}
          </div>
          <div className={styles.assetChip}>
            <span className={styles.assetDot} style={{ background: '#6b7280' }} />
            {toAsset?.basic_info?.display_name ?? '—'}
          </div>
        </div>

        {/* Connection type */}
        <div className={styles.field}>
          <label className={styles.label}>Connection type</label>
          <div className={styles.typeGrid}>
            {CONNECTION_TYPES.map(t => (
              <button
                key={t.value}
                type="button"
                className={`${styles.typeBtn} ${connectionType === t.value ? styles.typeBtnActive : ''}`}
                style={connectionType === t.value ? { borderColor: t.color, background: t.color + '18' } : {}}
                onClick={() => setConnectionType(t.value)}
              >
                <span className={styles.typeDot} style={{ background: t.color }} />
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Strength */}
        <div className={styles.field}>
          <label className={styles.label}>Line weight</label>
          <div className={styles.strengthRow}>
            {STRENGTHS.map(s => (
              <label key={s.value} className={styles.strengthOption}>
                <input
                  type="radio"
                  name="strength"
                  value={s.value}
                  checked={strength === s.value}
                  onChange={() => setStrength(s.value)}
                />
                <span
                  className={styles.strengthLine}
                  style={{ height: s.width, background: selectedType.color }}
                />
                {s.label}
              </label>
            ))}
          </div>
        </div>

        {/* Bidirectional */}
        <label className={styles.checkRow}>
          <input
            type="checkbox"
            checked={bidirectional}
            onChange={e => setBidirectional(e.target.checked)}
          />
          <span>Bidirectional</span>
          <span className={styles.checkHint}>(solid line if checked, dashed if one-way)</span>
        </label>

        {/* Label */}
        <div className={styles.field}>
          <label className={styles.label}>Label <span className={styles.optional}>(optional)</span></label>
          <input
            className={styles.input}
            type="text"
            placeholder="e.g. uplink, patch-A3"
            value={label}
            onChange={e => setLabel(e.target.value)}
            maxLength={200}
          />
        </div>

        {/* Description */}
        <div className={styles.field}>
          <label className={styles.label}>Description <span className={styles.optional}>(optional)</span></label>
          <textarea
            className={styles.textarea}
            placeholder="Additional notes about this connection"
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={2}
            maxLength={500}
          />
        </div>
      </div>
    </Modal>
  );
};

export default AddConnectionModal;
