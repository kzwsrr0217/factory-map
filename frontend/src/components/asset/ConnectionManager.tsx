/**
 * ConnectionManager.tsx — Modal panel for managing an asset's connections.
 *
 * Shows all existing connections for one asset and allows adding or removing
 * them. Connections are directional by default; the `bidirectional` flag
 * causes the backend to also create the reverse link.
 *
 * Connection fields:
 *   connected_asset_id — target asset UUID (found by typing; see useAssetSearch).
 *   connection_type    — one of CONNECTION_TYPES (network, power, USB, etc.).
 *   strength           — weak / normal / strong (STRENGTH_LEVELS).
 *   bidirectional      — if true the backend creates both A→B and B→A.
 *   label / description — free-text annotations.
 *   patch_panel_*      — optional structured patch panel info stored as JSON
 *                        (`patch_panel_name`, `patch_panel_port`,
 *                         `switch_name`, `switch_port`).
 *
 * Remove uses a ConfirmDialog to prevent accidental deletions.
 */
import React, { useState, useEffect, useMemo } from 'react';
import Modal from '../common/Modal';
import Button from '../common/Button';
import ConfirmDialog from '../common/ConfirmDialog';
import { assetService, Asset } from '../../services/asset.service';
import { useAssetSearch } from '../../hooks/useAssetSearch';
import { useToast } from '../../contexts/ToastContext';
import { getApiErrorMessage } from '../../utils/apiError';
import styles from '../../styles/components/ConnectionManager.module.css';

type AssetConnection = NonNullable<Asset['connections']>[0];

interface ConnectionManagerProps {
  isOpen: boolean;
  onClose: () => void;
  assetId: string;
  assetName: string;
}

interface ConnectionFormData {
  connected_asset_id: string;
  connection_type: string;
  description: string;
  label: string;
  bidirectional: boolean;
  strength: string;
  patch_panel_name: string;
  patch_panel_port: string;
  switch_name: string;
  switch_port: string;
}

const CONNECTION_TYPES = [
  { value: 'network', label: 'Network' },
  { value: 'power', label: 'Power' },
  { value: 'usb', label: 'USB' },
  { value: 'serial', label: 'Serial' },
  { value: 'parallel', label: 'Parallel' },
  { value: 'bluetooth', label: 'Bluetooth' },
  { value: 'wifi', label: 'WiFi' },
  { value: 'ethernet', label: 'Ethernet' },
  { value: 'fiber', label: 'Fiber Optic' },
  { value: 'dependency', label: 'Dependency' },
  { value: 'parent-child', label: 'Parent-Child' },
  { value: 'peer', label: 'Peer' },
  { value: 'other', label: 'Other' },
];

const STRENGTH_LEVELS = [
  { value: 'weak', label: 'Weak' },
  { value: 'normal', label: 'Normal' },
  { value: 'strong', label: 'Strong' },
];

const ConnectionManager: React.FC<ConnectionManagerProps> = ({
  isOpen,
  onClose,
  assetId,
  assetName,
}) => {
  const [connections, setConnections] = useState<AssetConnection[]>([]);
  /**
   * Names for the assets on the far end of the existing connections, keyed by id.
   * Fetched by id — this used to come from a download of every asset in the
   * database, which is a lot of JSON to render a handful of names.
   */
  const [peerNames, setPeerNames] = useState<Record<string, string>>({});
  /** What the user is typing to find the asset to connect to. */
  const [peerQuery, setPeerQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingConnection, setEditingConnection] = useState<AssetConnection | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const toast = useToast();
  const [formData, setFormData] = useState<ConnectionFormData>({
    connected_asset_id: '',
    connection_type: 'network',
    description: '',
    label: '',
    bidirectional: true,
    strength: 'normal',
    patch_panel_name: '',
    patch_panel_port: '',
    switch_name: '',
    switch_port: '',
  });

  useEffect(() => {
    if (isOpen) loadConnections();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, assetId]);

  const loadConnections = async () => {
    try {
      setLoading(true);
      const asset = await assetService.getAsset(assetId);
      const rows = asset.connections || [];
      setConnections(rows);
      // Just the far ends referenced here, by id.
      const peerIds = [...new Set(rows.map((c) => c.connected_asset_id))];
      if (peerIds.length > 0) {
        const peers = await assetService.getAssetsByIds(peerIds);
        setPeerNames(Object.fromEntries(peers.map((p) => [p._id, p.basic_info.display_name])));
      } else {
        setPeerNames({});
      }
    } catch (error) {
      console.error('Error loading connections:', error);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Candidates for a new connection: whatever the typed query matches, minus this
   * asset itself.
   *
   * Deliberately does NOT exclude assets already connected to — a pair can have
   * several distinct connections (e.g. two physical cables), so already being
   * connected must not remove a peer from the list.
   */
  const peerSearch = useAssetSearch(peerQuery);
  const peerCandidates = useMemo(
    () => peerSearch.results.filter((a) => a._id !== assetId),
    [peerSearch.results, assetId],
  );

  const buildPatchPanel = (fd: ConnectionFormData) => {
    const pp = { panel_name: fd.patch_panel_name || undefined, panel_port: fd.patch_panel_port || undefined, switch_name: fd.switch_name || undefined, switch_port: fd.switch_port || undefined };
    return Object.values(pp).some(Boolean) ? pp : null;
  };

  const handleAddConnection = async () => {
    try {
      setLoading(true);
      await assetService.addConnection(assetId, { ...formData, patch_panel: buildPatchPanel(formData) });
      await loadConnections();
      setShowAddForm(false);
      resetForm();
    } catch (err) {
      console.error('Error adding connection:', err);
      toast.error(getApiErrorMessage(err, 'Failed to add connection'));
    } finally {
      setLoading(false);
    }
  };

  const handleEditConnection = async () => {
    if (!editingConnection) return;

    try {
      setLoading(true);
      await assetService.updateConnection(assetId, editingConnection.id, { ...formData, patch_panel: buildPatchPanel(formData) });
      await loadConnections();
      setEditingConnection(null);
      resetForm();
      toast.success('Connection updated');
    } catch (err) {
      console.error('Error updating connection:', err);
      toast.error(getApiErrorMessage(err, 'Failed to update connection'));
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteConnection = (connectionId: string) => {
    setDeleteTargetId(connectionId);
  };

  const confirmDeleteConnection = async () => {
    if (!deleteTargetId) return;
    try {
      setLoading(true);
      await assetService.removeConnection(assetId, deleteTargetId);
      await loadConnections();
      toast.success('Connection removed');
    } catch (err) {
      console.error('Error deleting connection:', err);
      toast.error('Failed to remove connection');
    } finally {
      setLoading(false);
      setDeleteTargetId(null);
    }
  };

  const startEdit = (connection: AssetConnection) => {
    setEditingConnection(connection);
    setFormData({
      connected_asset_id: connection.connected_asset_id,
      connection_type: connection.connection_type,
      description: connection.description || '',
      label: connection.label || '',
      bidirectional: connection.bidirectional ?? true,
      strength: connection.strength || 'normal',
      patch_panel_name: connection.patch_panel?.panel_name || '',
      patch_panel_port: connection.patch_panel?.panel_port || '',
      switch_name: connection.patch_panel?.switch_name || '',
      switch_port: connection.patch_panel?.switch_port || '',
    });
  };

  const resetForm = () => {
    setFormData({
      connected_asset_id: '',
      connection_type: 'network',
      description: '',
      label: '',
      bidirectional: true,
      strength: 'normal',
      patch_panel_name: '',
      patch_panel_port: '',
      switch_name: '',
      switch_port: '',
    });
  };

  const getConnectedAssetName = (peerId: string) => peerNames[peerId] ?? 'Unknown Asset';

  return (
    <>
    <Modal isOpen={isOpen} onClose={onClose} title={`Manage Connections - ${assetName}`}>
      <div className={styles.container}>
        <div className={styles.header}>
          <h3>Current Connections</h3>
          <Button
            onClick={() => setShowAddForm(true)}
            variant="primary"
            size="sm"
          >
            Add Connection
          </Button>
        </div>

        {loading && <div className={styles.loading}>Loading...</div>}

        <div className={styles.connectionsList}>
          {connections.length === 0 ? (
            <p className={styles.empty}>No connections found.</p>
          ) : (
            connections.map((connection) => (
              <div key={connection.id} className={styles.connectionItem}>
                <div className={styles.connectionInfo}>
                  <div className={styles.connectionHeader}>
                    <span className={styles.assetName}>
                      {getConnectedAssetName(connection.connected_asset_id)}
                    </span>
                    <span className={`${styles.connectionType} ${styles[connection.connection_type]}`}>
                      {CONNECTION_TYPES.find(t => t.value === connection.connection_type)?.label}
                    </span>
                  </div>
                  {connection.label && (
                    <div className={styles.connectionLabel}>{connection.label}</div>
                  )}
                  {connection.description && (
                    <div className={styles.connectionDescription}>{connection.description}</div>
                  )}
                  <div className={styles.connectionMeta}>
                    <span>Strength: {connection.strength}</span>
                    <span>{connection.bidirectional ? 'Bidirectional' : 'Unidirectional'}</span>
                    {connection.patch_panel && (connection.patch_panel.panel_name || connection.patch_panel.switch_name) && (
                      <span style={{ fontSize: '0.78rem', color: 'var(--color-text-muted)' }}>
                        PP: {[connection.patch_panel.panel_name, connection.patch_panel.panel_port].filter(Boolean).join('/')}
                        {connection.patch_panel.switch_name && ` → SW: ${[connection.patch_panel.switch_name, connection.patch_panel.switch_port].filter(Boolean).join('/')}`}
                      </span>
                    )}
                  </div>
                </div>
                <div className={styles.connectionActions}>
                  <Button
                    onClick={() => startEdit(connection)}
                    variant="secondary"
                    size="sm"
                  >
                    Edit
                  </Button>
                  <Button
                    onClick={() => handleDeleteConnection(connection.id)}
                    variant="danger"
                    size="sm"
                  >
                    Delete
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>

        {(showAddForm || editingConnection) && (
          <div className={styles.formContainer}>
            <h4>{editingConnection ? 'Edit Connection' : 'Add New Connection'}</h4>
            <form className={styles.connectionForm}>
              {!editingConnection && (
                <div className={styles.formGroup}>
                  <label>Connected Asset:</label>
                  {/* Typed, not a dropdown of the whole estate: at 1057 devices — and
                      far more after the survey — a select is both a big download and
                      unusable to scroll. */}
                  <input
                    type="text"
                    value={peerQuery}
                    onChange={(e) => { setPeerQuery(e.target.value); setFormData({ ...formData, connected_asset_id: '' }); }}
                    placeholder="Type a name, serial or IP to find the device…"
                    aria-label="Find the device to connect to"
                  />
                  <select
                    value={formData.connected_asset_id}
                    onChange={(e) => setFormData({ ...formData, connected_asset_id: e.target.value })}
                    required
                    disabled={peerCandidates.length === 0}
                  >
                    <option value="">
                      {!peerSearch.active
                        ? 'Type at least two characters…'
                        : peerSearch.loading
                          ? 'Searching…'
                          : peerCandidates.length === 0
                            ? 'No device matches'
                            : `Select one of ${peerCandidates.length} matches…`}
                    </option>
                    {peerCandidates.map(asset => (
                      <option key={asset._id} value={asset._id}>
                        {asset.basic_info.display_name}
                        {asset.basic_info.serial_number ? ` — ${asset.basic_info.serial_number}` : ''}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className={styles.formGroup}>
                <label>Connection Type:</label>
                <select
                  value={formData.connection_type}
                  onChange={(e) => setFormData({ ...formData, connection_type: e.target.value })}
                >
                  {CONNECTION_TYPES.map(type => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className={styles.formGroup}>
                <label>Label (optional):</label>
                <input
                  type="text"
                  value={formData.label}
                  onChange={(e) => setFormData({ ...formData, label: e.target.value })}
                  placeholder="e.g., Primary Network, Backup Power"
                />
              </div>

              <div className={styles.formGroup}>
                <label>Description (optional):</label>
                <textarea
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Additional details about this connection"
                  rows={3}
                />
              </div>

              <div className={styles.formRow}>
                <div className={styles.formGroup}>
                  <label>Strength:</label>
                  <select
                    value={formData.strength}
                    onChange={(e) => setFormData({ ...formData, strength: e.target.value })}
                  >
                    {STRENGTH_LEVELS.map(level => (
                      <option key={level.value} value={level.value}>
                        {level.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div className={styles.formGroup}>
                  <label>
                    <input
                      type="checkbox"
                      checked={formData.bidirectional}
                      onChange={(e) => setFormData({ ...formData, bidirectional: e.target.checked })}
                    />
                    Bidirectional
                  </label>
                </div>
              </div>

              <div className={styles.formGroup} style={{ marginTop: 8 }}>
                <label style={{ fontWeight: 600, display: 'block', marginBottom: 6 }}>Patch Panel (optional)</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <div>
                    <label style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>Panel name</label>
                    <input
                      type="text"
                      value={formData.patch_panel_name}
                      onChange={(e) => setFormData({ ...formData, patch_panel_name: e.target.value })}
                      placeholder="e.g., PP-A12"
                      style={{ width: '100%', border: '1px solid var(--color-border)', borderRadius: 4, padding: '4px 8px', background: 'var(--color-surface)', color: 'var(--color-text)' }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>Panel port</label>
                    <input
                      type="text"
                      value={formData.patch_panel_port}
                      onChange={(e) => setFormData({ ...formData, patch_panel_port: e.target.value })}
                      placeholder="e.g., 14"
                      style={{ width: '100%', border: '1px solid var(--color-border)', borderRadius: 4, padding: '4px 8px', background: 'var(--color-surface)', color: 'var(--color-text)' }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>Switch name</label>
                    <input
                      type="text"
                      value={formData.switch_name}
                      onChange={(e) => setFormData({ ...formData, switch_name: e.target.value })}
                      placeholder="e.g., SW-FLOOR2-01"
                      style={{ width: '100%', border: '1px solid var(--color-border)', borderRadius: 4, padding: '4px 8px', background: 'var(--color-surface)', color: 'var(--color-text)' }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>Switch port</label>
                    <input
                      type="text"
                      value={formData.switch_port}
                      onChange={(e) => setFormData({ ...formData, switch_port: e.target.value })}
                      placeholder="e.g., Gi0/1"
                      style={{ width: '100%', border: '1px solid var(--color-border)', borderRadius: 4, padding: '4px 8px', background: 'var(--color-surface)', color: 'var(--color-text)' }}
                    />
                  </div>
                </div>
              </div>

              <div className={styles.formActions}>
                <Button
                  onClick={editingConnection ? handleEditConnection : handleAddConnection}
                  variant="primary"
                  disabled={loading || (!editingConnection && !formData.connected_asset_id)}
                >
                  {editingConnection ? 'Update' : 'Add'} Connection
                </Button>
                <Button
                  onClick={() => {
                    setShowAddForm(false);
                    setEditingConnection(null);
                    resetForm();
                  }}
                  variant="secondary"
                >
                  Cancel
                </Button>
              </div>
            </form>
          </div>
        )}
      </div>
    </Modal>
    <ConfirmDialog
      isOpen={deleteTargetId !== null}
      onClose={() => setDeleteTargetId(null)}
      onConfirm={confirmDeleteConnection}
      title="Delete Connection"
      message="Are you sure you want to delete this connection?"
      confirmText="Delete"
      loading={loading}
    />
    </>
  );
};

export default ConnectionManager;