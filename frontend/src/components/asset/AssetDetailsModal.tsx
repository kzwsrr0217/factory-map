/**
 * AssetDetailsModal.tsx — Read-only (and action) panel for a single asset.
 *
 * Opened from FloorMap, AssetDetails page, and asset lists. Displays all
 * asset data sections: Basic Info, Network, Operational, Lifecycle, Location,
 * Software, Work Items, Connections, and Location History.
 *
 * Key behaviours:
 *   Work items — loaded directly from `asset.work_items`; changes are saved
 *     via `assetService.updateWorkItems()` which patches the asset in-place.
 *   Location history — lazy-loaded on first expand via `getAssetHistory()`.
 *   ITSM sync — "Sync with ITSM" button calls `syncAsset()` and refreshes the
 *     current asset state; only shown when `itsm_source_id` is set.
 *   Accept snapshot — applies `itsm_snapshot` to overwrite local fields;
 *     clears the snapshot after acceptance.
 *   Replace asset — opens ReplaceAssetModal; swaps this asset's location and
 *     hierarchy bindings to a different asset record.
 *
 * Props:
 *   asset       — The asset to display; null when the modal is closed.
 *   isOpen      — Controls Modal visibility.
 *   onClose     — Called on backdrop click or explicit close.
 *   allAssets   — Full asset list, passed through to ConnectionManager for
 *                 peer selection.
 */
import React, { useState, useCallback, useEffect } from 'react';
import Modal from '../common/Modal';
import Button from '../common/Button';
import Badge from '../common/Badge';
import Card from '../common/Card';
import ConnectionManager from './ConnectionManager';
import AssetRelationships from './AssetRelationships';
import ReplaceAssetModal from './ReplaceAssetModal';
import { Asset, AssetHistoryEntry, assetService } from '../../services/asset.service';
import { useToast } from '../../contexts/ToastContext';
import styles from '../../styles/components/AssetDetailsModal.module.css';

interface AssetDetailsModalProps {
  asset: Asset | null;
  isOpen: boolean;
  onClose: () => void;
  allAssets?: Asset[];
}

const AssetDetailsModal: React.FC<AssetDetailsModalProps> = ({
  asset,
  isOpen,
  onClose,
  allAssets = [],
}) => {
  const [syncing, setSyncing] = useState(false);
  const [acceptingSnapshot, setAcceptingSnapshot] = useState(false);
  const [showConnectionManager, setShowConnectionManager] = useState(false);
  const [showRelationships, setShowRelationships] = useState(false);
  const [replaceOpen, setReplaceOpen] = useState(false);
  const [history, setHistory] = useState<AssetHistoryEntry[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [currentAsset, setCurrentAsset] = useState<Asset | null>(null);
  const [workItems, setWorkItems] = useState<NonNullable<Asset['work_items']>>([]);
  const [newItemDesc, setNewItemDesc] = useState('');
  const [newItemPriority, setNewItemPriority] = useState<'low' | 'medium' | 'high'>('medium');
  const [savingWorkItems, setSavingWorkItems] = useState(false);
  const toast = useToast();

  const loadHistory = useCallback(async () => {
    if (historyLoaded || !asset) return;
    setLoadingHistory(true);
    try {
      const entries = await assetService.getAssetHistory(asset._id);
      setHistory(entries);
      setHistoryLoaded(true);
    } catch {
      toast.error('Failed to load history');
    } finally {
      setLoadingHistory(false);
    }
  }, [asset, historyLoaded, toast]);

  useEffect(() => {
    if (asset) setWorkItems(asset.work_items ?? []);
  }, [asset]);

  if (!asset) return null;
  const displayAsset = (currentAsset ?? asset) as Asset;

  const saveWorkItems = async (items: NonNullable<Asset['work_items']>) => {
    setSavingWorkItems(true);
    try {
      await assetService.updateAsset(displayAsset._id, { work_items: items } as Partial<Asset>);
      setWorkItems(items);
    } catch {
      toast.error('Failed to save work items');
    } finally {
      setSavingWorkItems(false);
    }
  };

  const handleAddWorkItem = async () => {
    if (!newItemDesc.trim()) return;
    const item = { id: crypto.randomUUID(), description: newItemDesc.trim(), done: false, priority: newItemPriority, created_at: new Date().toISOString() };
    await saveWorkItems([...workItems, item]);
    setNewItemDesc('');
    setNewItemPriority('medium');
  };

  const handleToggleWorkItem = async (id: string) => {
    await saveWorkItems(workItems.map(i => i.id === id ? { ...i, done: !i.done } : i));
  };

  const handleDeleteWorkItem = async (id: string) => {
    await saveWorkItems(workItems.filter(i => i.id !== id));
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      await assetService.syncAsset(asset._id);
      toast.success('ITSM sync completed');
    } catch {
      toast.error('ITSM sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const handleAcceptSnapshot = async () => {
    setAcceptingSnapshot(true);
    try {
      const updated = await assetService.acceptItsmSnapshot(displayAsset._id);
      setCurrentAsset(updated);
      toast.success('ITSM data accepted — asset is now ITSM-managed');
    } catch {
      toast.error('Failed to accept ITSM snapshot');
    } finally {
      setAcceptingSnapshot(false);
    }
  };

  const snapshot = displayAsset.itsm_snapshot;
  const hasConflict =
    displayAsset.itsm?.source_of_truth === 'local' &&
    !!snapshot &&
    !!snapshot.display_name;

  type ConflictRow = { label: string; local: string | undefined; itsm: string | undefined };
  const conflictRows: ConflictRow[] = hasConflict
    ? ([
        { label: 'Display Name', local: displayAsset.basic_info.display_name, itsm: snapshot?.display_name },
        { label: 'Serial Number', local: displayAsset.basic_info.serial_number, itsm: snapshot?.serial_number },
        { label: 'Asset Tag', local: displayAsset.basic_info.asset_tag, itsm: snapshot?.asset_tag },
        { label: 'MAC Address', local: displayAsset.basic_info.mac_address, itsm: snapshot?.mac_address },
        { label: 'Status', local: displayAsset.basic_info.status, itsm: snapshot?.status },
        { label: 'Assigned Person', local: displayAsset.assigned_person?.full_name, itsm: snapshot?.person_name },
        { label: 'Organization', local: displayAsset.organization?.display_name, itsm: snapshot?.organization_name },
        { label: 'Catalog Item', local: displayAsset.catalog_item?.display_name, itsm: snapshot?.catalog_item_name },
      ] as ConflictRow[]).filter(r => r.local !== r.itsm && (r.local || r.itsm))
    : [];

  const footer = (
    <>
      {displayAsset.itsm.is_managed && (
        <Button variant="primary" onClick={handleSync} loading={syncing}>
          Sync from ITSM
        </Button>
      )}
      {hasConflict && (
        <Button variant="warning" onClick={handleAcceptSnapshot} loading={acceptingSnapshot}>
          Accept ITSM Data
        </Button>
      )}
      {!displayAsset.successor_id && (
        <Button variant="outline" onClick={() => setReplaceOpen(true)}>
          Replace Asset
        </Button>
      )}
      <Button variant="outline" onClick={onClose}>
        Close
      </Button>
    </>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={displayAsset.basic_info.display_name}
      width="lg"
      footer={footer}
    >
      <div className={styles.container}>
        {/* ITSM Status Banner */}
        {displayAsset.itsm.is_managed && (
          <Card padding="md" className={styles.itsmBanner}>
            <div className={styles.bannerContent}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <Badge variant="success">ITSM Managed</Badge>
                  <Badge variant={displayAsset.itsm.source_of_truth === 'itsm' ? 'info' : 'neutral'}>
                    Source: {displayAsset.itsm.source_of_truth ?? 'local'}
                  </Badge>
                  {hasConflict && <Badge variant="warning">ITSM Changes Pending</Badge>}
                </div>
                <p className={styles.bannerText}>
                  Hardware ID: {displayAsset.itsm.hardware_asset_id || '—'}
                  {displayAsset.itsm.itsm_guid && (
                    <span className={styles.itsmGuid}> · GUID: {displayAsset.itsm.itsm_guid}</span>
                  )}
                </p>
                {displayAsset.itsm.last_synced && (
                  <p className={styles.syncTime}>
                    Last synced: {new Date(displayAsset.itsm.last_synced).toLocaleString()}
                  </p>
                )}
              </div>
            </div>
          </Card>
        )}

        {/* Work Items */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h3 className={styles.sectionTitle}>
              Work Items
              {workItems.filter(i => !i.done).length > 0 && (
                <span style={{ marginLeft: 8 }}><Badge variant="warning">{workItems.filter(i => !i.done).length} open</Badge></span>
              )}
            </h3>
          </div>
          <Card padding="lg">
            {workItems.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                {workItems.map((item) => {
                  const priorityColor = item.priority === 'high' ? '#ef4444' : item.priority === 'medium' ? '#f59e0b' : '#9ca3af';
                  return (
                    <div key={item.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '8px 0', borderBottom: '1px solid var(--color-border)' }}>
                      <input
                        type="checkbox"
                        checked={item.done}
                        onChange={() => handleToggleWorkItem(item.id)}
                        disabled={savingWorkItems}
                        style={{ marginTop: 3, cursor: 'pointer', flexShrink: 0 }}
                      />
                      <div style={{ flex: 1 }}>
                        <span style={{ textDecoration: item.done ? 'line-through' : 'none', color: item.done ? 'var(--color-text-muted)' : 'inherit' }}>
                          {item.description}
                        </span>
                      </div>
                      <span style={{ fontSize: '0.7rem', fontWeight: 600, color: priorityColor, textTransform: 'uppercase', flexShrink: 0 }}>{item.priority}</span>
                      <button
                        onClick={() => handleDeleteWorkItem(item.id)}
                        disabled={savingWorkItems}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-muted)', fontSize: '0.875rem', padding: '0 4px', flexShrink: 0 }}
                        title="Remove"
                      >✕</button>
                    </div>
                  );
                })}
              </div>
            )}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="text"
                placeholder="Add a work item…"
                value={newItemDesc}
                onChange={(e) => setNewItemDesc(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAddWorkItem(); }}
                disabled={savingWorkItems}
                style={{ flex: 1, border: '1px solid var(--color-border)', borderRadius: 6, padding: '6px 10px', fontSize: '0.875rem', background: 'var(--color-surface)', color: 'var(--color-text)' }}
              />
              <select
                value={newItemPriority}
                onChange={(e) => setNewItemPriority(e.target.value as 'low' | 'medium' | 'high')}
                disabled={savingWorkItems}
                style={{ border: '1px solid var(--color-border)', borderRadius: 6, padding: '6px 8px', fontSize: '0.875rem', background: 'var(--color-surface)', color: 'var(--color-text)' }}
              >
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
              <Button variant="primary" size="sm" onClick={handleAddWorkItem} disabled={!newItemDesc.trim() || savingWorkItems} loading={savingWorkItems}>
                Add
              </Button>
            </div>
          </Card>
        </section>

        {/* Basic Information */}
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Basic Information</h3>
          <Card padding="lg">
            <div className={styles.grid}>
              <div className={styles.field}>
                <label>Display Name</label>
                <p>{displayAsset.basic_info.display_name}</p>
              </div>
              <div className={styles.field}>
                <label>Manufacturer</label>
                <p>{displayAsset.basic_info.manufacturer || '-'}</p>
              </div>
              <div className={styles.field}>
                <label>Model</label>
                <p>{displayAsset.basic_info.model || '-'}</p>
              </div>
              <div className={styles.field}>
                <label>Serial Number</label>
                <p>{displayAsset.basic_info.serial_number || '-'}</p>
              </div>
              <div className={styles.field}>
                <label>Asset Tag</label>
                <p>{displayAsset.basic_info.asset_tag || '-'}</p>
              </div>
              <div className={styles.field}>
                <label>Status</label>
                <p>{displayAsset.basic_info.status || '-'}</p>
              </div>
              <div className={styles.field}>
                <label>OS Type</label>
                <p>{displayAsset.basic_info.os_type || '-'}</p>
              </div>
              <div className={styles.field}>
                <label>OS Version</label>
                <p>{displayAsset.basic_info.os_version || '-'}</p>
              </div>
              {displayAsset.catalog_item?.display_name && (
                <div className={styles.field}>
                  <label>Catalog Item</label>
                  <p>{displayAsset.catalog_item.display_name}</p>
                </div>
              )}
              {displayAsset.custom_fields?.object_id && (
                <div className={styles.field}>
                  <label>Station / Object ID</label>
                  <p className={styles.monoValue}>{displayAsset.custom_fields.object_id}</p>
                </div>
              )}
              {displayAsset.custom_fields?.serial_object && (
                <div className={styles.field}>
                  <label>Serial Object</label>
                  <p className={styles.monoValue}>{displayAsset.custom_fields.serial_object}</p>
                </div>
              )}
            </div>
          </Card>
        </section>

        {/* Lifecycle — predecessor / successor */}
        {(displayAsset.predecessor_id || displayAsset.successor_id) && (() => {
          const predecessor = displayAsset.predecessor_id
            ? allAssets.find(a => a._id === displayAsset.predecessor_id)
            : null;
          const successor = displayAsset.successor_id
            ? allAssets.find(a => a._id === displayAsset.successor_id)
            : null;
          return (
            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Lifecycle</h3>
              <Card padding="lg">
                <div className={styles.grid}>
                  {displayAsset.predecessor_id && (
                    <div className={styles.field}>
                      <label>Replaces</label>
                      <p className={styles.lifecycleLink}>
                        ← {predecessor
                          ? `${predecessor.basic_info.display_name}${predecessor.custom_fields?.object_id ? ` (${predecessor.custom_fields.object_id})` : ''}`
                          : displayAsset.predecessor_id}
                      </p>
                    </div>
                  )}
                  {displayAsset.successor_id && (
                    <div className={styles.field}>
                      <label>Replaced by</label>
                      <p className={styles.lifecycleLink + ' ' + styles.lifecycleSuccessor}>
                        → {successor
                          ? `${successor.basic_info.display_name}${successor.custom_fields?.object_id ? ` (${successor.custom_fields.object_id})` : ''}`
                          : displayAsset.successor_id}
                      </p>
                    </div>
                  )}
                </div>
              </Card>
            </section>
          );
        })()}

        {/* Assigned Person */}
        {displayAsset.assigned_person && (
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Assigned Person</h3>
            <Card padding="lg">
              <div className={styles.personCard}>
                <div className={styles.personAvatar}>
                  {displayAsset.assigned_person.full_name.charAt(0)}
                </div>
                <div>
                  <p className={styles.personName}>{displayAsset.assigned_person.full_name}</p>
                  <p className={styles.personId}>ID: {displayAsset.assigned_person.person_id}</p>
                  {displayAsset.assigned_person.itsm_id && (
                    <p className={styles.personItsmId}>ITSM: {displayAsset.assigned_person.itsm_id}</p>
                  )}
                </div>
              </div>
            </Card>
          </section>
        )}

        {/* Organization */}
        {displayAsset.organization?.display_name && (
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Organization</h3>
            <Card padding="lg">
              <div className={styles.grid}>
                <div className={styles.field}>
                  <label>Name</label>
                  <p>{displayAsset.organization.display_name}</p>
                </div>
                {displayAsset.organization.itsm_id && (
                  <div className={styles.field}>
                    <label>ITSM ID</label>
                    <p className={styles.itsmGuid}>{displayAsset.organization.itsm_id}</p>
                  </div>
                )}
              </div>
            </Card>
          </section>
        )}

        {/* Location */}
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Location</h3>
          <Card padding="lg">
            <div className={styles.grid}>
              <div className={styles.field}>
                <label>Coordinates</label>
                <p>
                  X: {displayAsset.location.coordinates.x}, Y: {displayAsset.location.coordinates.y}
                </p>
              </div>
              <div className={styles.field}>
                <label>Description</label>
                <p>{displayAsset.location.description || '-'}</p>
              </div>
            </div>
          </Card>
        </section>

        {/* Operational */}
        {displayAsset.custom_fields && (
          displayAsset.custom_fields.remote_access_tool ||
          (displayAsset.custom_fields as any).remote_access_version ||
          displayAsset.custom_fields.backup_tool ||
          displayAsset.custom_fields.backup_status ||
          displayAsset.custom_fields.winupdate_date ||
          displayAsset.custom_fields.fortiedr_active != null
        ) && (
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Operational</h3>
            <Card padding="lg">
              <div className={styles.grid}>
                {displayAsset.custom_fields!.remote_access_tool && (
                  <div className={styles.field}>
                    <label>Remote Access</label>
                    <p>
                      {displayAsset.custom_fields!.remote_access_tool}
                      {(displayAsset.custom_fields as any).remote_access_version && (
                        <span style={{ marginLeft: 6, color: 'var(--color-text-muted)', fontSize: '0.8em' }}>
                          v{(displayAsset.custom_fields as any).remote_access_version}
                        </span>
                      )}
                    </p>
                  </div>
                )}
                {displayAsset.custom_fields!.backup_tool && (
                  <div className={styles.field}>
                    <label>Backup Tool</label>
                    <p>{displayAsset.custom_fields!.backup_tool}</p>
                  </div>
                )}
                {displayAsset.custom_fields!.backup_status && (
                  <div className={styles.field}>
                    <label>Backup Status</label>
                    <Badge variant={
                      displayAsset.custom_fields!.backup_status === 'active' ? 'success' :
                      displayAsset.custom_fields!.backup_status === 'error' ? 'error' :
                      displayAsset.custom_fields!.backup_status === 'inactive' ? 'warning' : 'neutral'
                    }>
                      {displayAsset.custom_fields!.backup_status}
                    </Badge>
                  </div>
                )}
                {displayAsset.custom_fields!.winupdate_date && (
                  <div className={styles.field}>
                    <label>Last Windows Update</label>
                    <p>{new Date(displayAsset.custom_fields!.winupdate_date as unknown as string).toLocaleDateString()}</p>
                  </div>
                )}
                {displayAsset.custom_fields!.fortiedr_active != null && (
                  <div className={styles.field}>
                    <label>FortiEDR</label>
                    <Badge variant={displayAsset.custom_fields!.fortiedr_active ? 'success' : 'error'}>
                      {displayAsset.custom_fields!.fortiedr_active ? 'Active' : 'Inactive'}
                    </Badge>
                  </div>
                )}
              </div>
            </Card>
          </section>
        )}

        {/* Connections */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h3 className={styles.sectionTitle}>Connections</h3>
            <div className={styles.sectionActions}>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowRelationships(true)}
              >
                View Relationships
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowConnectionManager(true)}
              >
                Manage Connections
              </Button>
            </div>
          </div>
          <Card padding="lg">
            {displayAsset.connections && displayAsset.connections.length > 0 ? (
              <div className={styles.connectionsList}>
                {displayAsset.connections.map((connection, index) => {
                  const peer = allAssets.find(a => a._id === connection.connected_asset_id);
                  const typeColor =
                    connection.connection_type === 'ethernet' || connection.connection_type === 'network' ? '#3b82f6' :
                    connection.connection_type === 'fiber' ? '#8b5cf6' :
                    connection.connection_type === 'power' ? '#ef4444' :
                    connection.connection_type === 'wifi' ? '#06b6d4' :
                    connection.connection_type === 'usb' ? '#f59e0b' :
                    connection.connection_type === 'serial' ? '#78716c' :
                    '#9ca3af';
                  return (
                    <div key={index} className={styles.connectionItem}>
                      <div className={styles.connectionTypeDot} style={{ background: typeColor }} />
                      <div className={styles.connectionInfo}>
                        <span className={styles.connectionType}>{connection.connection_type}</span>
                        {peer ? (
                          <span className={styles.connectionPeer}>→ {peer.basic_info.display_name}</span>
                        ) : (
                          <span className={styles.connectionPeer} style={{ opacity: 0.5 }}>→ {connection.connected_asset_id.slice(-6)}</span>
                        )}
                        {connection.label && (
                          <span className={styles.connectionLabel}>{connection.label}</span>
                        )}
                      </div>
                      <div className={styles.connectionMeta}>
                        <Badge variant={connection.strength === 'strong' ? 'success' : connection.strength === 'weak' ? 'warning' : 'neutral'}>
                          {connection.strength || 'normal'}
                        </Badge>
                        {connection.bidirectional && <Badge variant="info">↔</Badge>}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className={styles.noConnections}>No connections configured</p>
            )}
          </Card>
        </section>

        {/* Technical Specs */}
        {displayAsset.technical_specs && (displayAsset.technical_specs.cpu || displayAsset.technical_specs.ram || displayAsset.technical_specs.storage || displayAsset.technical_specs.gpu) && (
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Technical Specifications</h3>
            <Card padding="lg">
              <div className={styles.grid}>
                {displayAsset.technical_specs.cpu && (
                  <div className={styles.field}>
                    <label>CPU</label>
                    <p>{displayAsset.technical_specs.cpu}</p>
                  </div>
                )}
                {displayAsset.technical_specs.ram && (
                  <div className={styles.field}>
                    <label>RAM</label>
                    <p>{displayAsset.technical_specs.ram}</p>
                  </div>
                )}
                {displayAsset.technical_specs.storage && (
                  <div className={styles.field}>
                    <label>Storage</label>
                    <p>{displayAsset.technical_specs.storage}</p>
                  </div>
                )}
                {displayAsset.technical_specs.gpu && (
                  <div className={styles.field}>
                    <label>GPU</label>
                    <p>{displayAsset.technical_specs.gpu}</p>
                  </div>
                )}
              </div>
            </Card>
          </section>
        )}

        {/* Network */}
        {displayAsset.network && (displayAsset.network.ip_address || displayAsset.network.hostname || displayAsset.network.vlan || displayAsset.network.switch_port || displayAsset.network.dhcp_static) && (
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Network</h3>
            <Card padding="lg">
              <div className={styles.grid}>
                {displayAsset.network.ip_address && (
                  <div className={styles.field}>
                    <label>IP Address</label>
                    <p>
                      {displayAsset.network.ip_address}
                      {displayAsset.network.dhcp_static && (
                        <span style={{ marginLeft: 8 }}><Badge variant={displayAsset.network.dhcp_static === 'static' ? 'info' : 'neutral'}>{displayAsset.network.dhcp_static.toUpperCase()}</Badge></span>
                      )}
                    </p>
                  </div>
                )}
                {!displayAsset.network.ip_address && displayAsset.network.dhcp_static && (
                  <div className={styles.field}>
                    <label>IP Assignment</label>
                    <Badge variant={displayAsset.network.dhcp_static === 'static' ? 'info' : 'neutral'}>
                      {displayAsset.network.dhcp_static.toUpperCase()}
                    </Badge>
                  </div>
                )}
                {displayAsset.network.hostname && (
                  <div className={styles.field}>
                    <label>Hostname</label>
                    <p>{displayAsset.network.hostname}</p>
                  </div>
                )}
                {displayAsset.network.vlan && (
                  <div className={styles.field}>
                    <label>VLAN</label>
                    <p>{displayAsset.network.vlan}</p>
                  </div>
                )}
                {displayAsset.network.switch_port && (
                  <div className={styles.field}>
                    <label>Switch Port</label>
                    <p>{displayAsset.network.switch_port}</p>
                  </div>
                )}
                {displayAsset.basic_info.mac_address && (
                  <div className={styles.field}>
                    <label>MAC Address</label>
                    <p>{displayAsset.basic_info.mac_address}</p>
                  </div>
                )}
              </div>
            </Card>
          </section>
        )}

        {/* Custom Fields */}
        {displayAsset.custom_fields && (displayAsset.custom_fields.physical_condition || displayAsset.custom_fields.environment || displayAsset.custom_fields.notes || (displayAsset.custom_fields.tags && displayAsset.custom_fields.tags.length > 0)) && (
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Additional Info</h3>
            <Card padding="lg">
              <div className={styles.grid}>
                {displayAsset.custom_fields.physical_condition && (
                  <div className={styles.field}>
                    <label>Physical Condition</label>
                    <p>{displayAsset.custom_fields.physical_condition}</p>
                  </div>
                )}
                {displayAsset.custom_fields.environment && (
                  <div className={styles.field}>
                    <label>Environment</label>
                    <p>{displayAsset.custom_fields.environment}</p>
                  </div>
                )}
                {displayAsset.custom_fields.tags && displayAsset.custom_fields.tags.length > 0 && (
                  <div className={styles.field}>
                    <label>Tags</label>
                    <p>{displayAsset.custom_fields.tags.join(', ')}</p>
                  </div>
                )}
              </div>
              {displayAsset.custom_fields.notes && (
                <div className={styles.field} style={{ marginTop: 'var(--spacing-md)' }}>
                  <label>Notes</label>
                  <p>{displayAsset.custom_fields.notes}</p>
                </div>
              )}
            </Card>
          </section>
        )}

        {/* Maintenance */}
        {displayAsset.maintenance && (displayAsset.maintenance.last_date || displayAsset.maintenance.next_date) && (
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Maintenance</h3>
            <Card padding="lg">
              <div className={styles.grid}>
                {displayAsset.maintenance.last_date && (
                  <div className={styles.field}>
                    <label>Last Maintenance</label>
                    <p>{new Date(displayAsset.maintenance.last_date).toLocaleDateString()}</p>
                  </div>
                )}
                {displayAsset.maintenance.next_date && (() => {
                  const isOverdue = new Date(displayAsset.maintenance.next_date) < new Date();
                  return (
                    <div className={styles.field}>
                      <label>Next Due</label>
                      <p style={{ color: isOverdue ? '#ef4444' : undefined, fontWeight: isOverdue ? 600 : undefined }}>
                        {new Date(displayAsset.maintenance.next_date).toLocaleDateString()}
                        {isOverdue && ' Overdue'}
                      </p>
                    </div>
                  );
                })()}
                {displayAsset.maintenance.interval_days && (
                  <div className={styles.field}>
                    <label>Interval</label>
                    <p>Every {displayAsset.maintenance.interval_days} days</p>
                  </div>
                )}
                {displayAsset.maintenance.notes && (
                  <div className={styles.field} style={{ gridColumn: '1 / -1' }}>
                    <label>Notes</label>
                    <p>{displayAsset.maintenance.notes}</p>
                  </div>
                )}
              </div>
            </Card>
          </section>
        )}

        {/* Software Inventory */}
        {displayAsset.software && displayAsset.software.length > 0 && (
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Software ({displayAsset.software.length})</h3>
            <Card padding="lg">
              <div className={styles.softwareList}>
                {displayAsset.software.map((sw, i) => (
                  <div key={i} className={styles.softwareItem}>
                    <div className={styles.softwareName}>{sw.display_name}</div>
                    <div className={styles.softwareMeta}>
                      {sw.vendor && <span>{sw.vendor}</span>}
                      {sw.version && <span className={styles.softwareVersion}>v{sw.version}</span>}
                      <Badge variant={sw.source === 'itsm' ? 'info' : 'neutral'}>{sw.source}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </section>
        )}

        {/* ITSM Conflict Visualization */}
        {hasConflict && conflictRows.length > 0 && (
          <section className={styles.section}>
            <div className={styles.sectionHeader}>
              <h3 className={styles.sectionTitle}>ITSM Changes Pending</h3>
              <Badge variant="warning">{conflictRows.length} field{conflictRows.length !== 1 ? 's' : ''} differ</Badge>
            </div>
            <Card padding="lg" className={styles.conflictCard}>
              <p className={styles.conflictDescription}>
                ITSM has updated data for this asset. Review the differences below.
                Click <strong>Accept ITSM Data</strong> in the footer to apply all changes.
              </p>
              {snapshot?.synced_at && (
                <p className={styles.conflictSyncTime}>
                  Snapshot taken: {new Date(snapshot.synced_at).toLocaleString()}
                </p>
              )}
              <table className={styles.conflictTable}>
                <thead>
                  <tr>
                    <th>Field</th>
                    <th>Local (current)</th>
                    <th>ITSM (incoming)</th>
                  </tr>
                </thead>
                <tbody>
                  {conflictRows.map((row) => (
                    <tr key={row.label} className={row.local !== row.itsm ? styles.conflictRowChanged : ''}>
                      <td className={styles.conflictFieldLabel}>{row.label}</td>
                      <td className={styles.conflictValueLocal}>{row.local || <em className={styles.conflictEmpty}>—</em>}</td>
                      <td className={styles.conflictValueItsm}>{row.itsm || <em className={styles.conflictEmpty}>—</em>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </section>
        )}

        {/* ITSM Details */}
        {(displayAsset.itsm.is_managed || displayAsset.itsm.itsm_guid) && (
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>ITSM Integration</h3>
            <Card padding="lg">
              <div className={styles.grid}>
                <div className={styles.field}>
                  <label>Hardware Asset ID</label>
                  <p>{displayAsset.itsm.hardware_asset_id || '—'}</p>
                </div>
                <div className={styles.field}>
                  <label>Source of Truth</label>
                  <Badge variant={displayAsset.itsm.source_of_truth === 'itsm' ? 'info' : 'neutral'}>
                    {displayAsset.itsm.source_of_truth ?? 'local'}
                  </Badge>
                </div>
                <div className={styles.field}>
                  <label>Sync Status</label>
                  <Badge
                    variant={
                      displayAsset.itsm.sync_status === 'success'
                        ? 'success'
                        : displayAsset.itsm.sync_status === 'failed'
                        ? 'error'
                        : 'neutral'
                    }
                  >
                    {displayAsset.itsm.sync_status}
                  </Badge>
                </div>
                <div className={styles.field}>
                  <label>Last Synced</label>
                  <p>
                    {displayAsset.itsm.last_synced
                      ? new Date(displayAsset.itsm.last_synced).toLocaleString()
                      : 'Never'}
                  </p>
                </div>
                {displayAsset.itsm.itsm_modified_at && (
                  <div className={styles.field}>
                    <label>Modified in ITSM</label>
                    <p>{new Date(displayAsset.itsm.itsm_modified_at).toLocaleString()}</p>
                  </div>
                )}
                {displayAsset.itsm.asset_class && (
                  <div className={styles.field}>
                    <label>ITSM Class</label>
                    <p className={styles.itsmGuid}>{displayAsset.itsm.asset_class}</p>
                  </div>
                )}
                {displayAsset.itsm.itsm_guid && (
                  <div className={styles.field} style={{ gridColumn: '1 / -1' }}>
                    <label>ITSM GUID</label>
                    <p className={styles.itsmGuid}>{displayAsset.itsm.itsm_guid}</p>
                  </div>
                )}
              </div>
            </Card>
          </section>
        )}

        {/* Change History */}
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h3 className={styles.sectionTitle}>Change History</h3>
            {!historyLoaded && (
              <Button variant="outline" size="sm" onClick={loadHistory} loading={loadingHistory}>
                Load History
              </Button>
            )}
          </div>
          {historyLoaded && (
            <Card padding="lg">
              {history.length === 0 ? (
                <p className={styles.noConnections}>No history available</p>
              ) : (
                <div className={styles.historyList}>
                  {history.map((entry) => (
                    <div key={entry._id} className={styles.historyEntry}>
                      <div className={styles.historyMeta}>
                        <Badge variant={
                          entry.action === 'create' ? 'success' :
                          entry.action === 'delete' ? 'error' : 'info'
                        }>
                          {entry.action}
                        </Badge>
                        <span className={styles.historyTime}>
                          {new Date(entry.created_at).toLocaleString()}
                        </span>
                        {entry.changed_by && (
                          <span className={styles.historyUser}>{entry.changed_by}</span>
                        )}
                      </div>
                      {entry.changes && Object.keys(entry.changes).length > 0 && (
                        <div className={styles.historyChanges}>
                          {Object.entries(entry.changes).slice(0, 5).map(([field, change]) => (
                            <div key={field} className={styles.historyChange}>
                              <span className={styles.historyField}>{field}</span>
                              <span className={styles.historyOld}>{String(change.old ?? '—')}</span>
                              <span className={styles.historyArrow}>→</span>
                              <span className={styles.historyNew}>{String(change.new ?? '—')}</span>
                            </div>
                          ))}
                          {Object.keys(entry.changes).length > 5 && (
                            <p className={styles.historyMore}>+{Object.keys(entry.changes).length - 5} more fields</p>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}
        </section>
      </div>

      <ConnectionManager
        isOpen={showConnectionManager}
        onClose={() => setShowConnectionManager(false)}
        assetId={displayAsset._id}
        assetName={displayAsset.basic_info.display_name}
      />

      <AssetRelationships
        isOpen={showRelationships}
        onClose={() => setShowRelationships(false)}
        assetId={displayAsset._id}
        assetName={displayAsset.basic_info.display_name}
      />

      <ReplaceAssetModal
        isOpen={replaceOpen}
        onClose={() => setReplaceOpen(false)}
        onSuccess={() => {
          setReplaceOpen(false);
          setCurrentAsset(prev => prev ? { ...prev } : null);
        }}
        currentAsset={displayAsset}
      />
    </Modal>
  );
};

export default AssetDetailsModal;