/**
 * AssetDetails.tsx — Full-page asset detail view ("/assets/:id").
 *
 * A standalone page (as opposed to the AssetDetailsModal overlay) for deep
 * linking to a specific asset. Renders all asset sections on the page without
 * a modal wrapper, and adds:
 *
 *   QR Code generation — encodes a structured text payload (see buildQrPayload)
 *     containing key asset fields AND the full asset URL. Scanning the code on
 *     any device shows the data immediately and provides a tappable deep-link.
 *     The "Download QR" button saves a PNG; the QR is also embedded in the
 *     printable label produced by "Print Label".
 *
 *   QR URL resolution — the URL embedded in the QR uses, in order of priority:
 *     1. REACT_APP_PUBLIC_BASE_URL env var (set this in production to your
 *        public hostname so QR codes work from any device on any network).
 *     2. window.location.origin as fallback (correct when the app is accessed
 *        via a routable IP/hostname from a phone on the same network).
 *
 *   ITSM sync button — appears when `itsm_source_id` is set; calls
 *     `assetService.syncAsset()` and refreshes the page data.
 *
 *   Edit button — opens AssetFormModal in edit mode.
 *
 *   Breadcrumb — Building > Floor > Asset for hierarchy context.
 */
import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import QRCode from 'qrcode';
import { RefreshCw, QrCode, Tag, AlertTriangle } from 'lucide-react';
import Card from '../components/common/Card';
import Button from '../components/common/Button';
import Badge from '../components/common/Badge';
import Breadcrumb from '../components/common/Breadcrumb';
import ConfirmDialog from '../components/common/ConfirmDialog';
import { assetService, Asset } from '../services/asset.service';
import { hierarchyService, Building } from '../services/hierarchy.service';
import { floorService, Floor } from '../services/floor.service';
import { useToast } from '../contexts/ToastContext';
import styles from '../styles/pages/AssetDetails.module.css';
import AssetFormModal from '../components/asset/AssetFormModal';

const CONN_TYPE_OPTIONS = [
  'ethernet','fiber','network','power','usb','serial','bluetooth','wifi','dependency','peer','other',
];

const AssetDetails: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [asset, setAsset] = useState<Asset | null>(null);
  const [building, setBuilding] = useState<Building | null>(null);
  const [floor, setFloor] = useState<Floor | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const toast = useToast();

  // Connections management
  const [allAssets, setAllAssets] = useState<{ _id: string; label: string }[]>([]);
  const [connSearch,     setConnSearch]     = useState('');
  const [connType,       setConnType]       = useState('ethernet');
  const [connSourcePort, setConnSourcePort] = useState('');
  const [connTargetPort, setConnTargetPort] = useState('');
  const [connLabel,      setConnLabel]      = useState('');
  const [connBidi,       setConnBidi]       = useState(true);
  const [addingConn,     setAddingConn]     = useState(false);
  const [showAddConn,    setShowAddConn]    = useState(false);

  const loadAssetDetails = useCallback(async (assetId: string) => {
    try {
      setLoading(true);
      const data = await assetService.getAsset(assetId);
      setAsset(data);
      const dataUrl = await QRCode.toDataURL(buildQrPayload(data, assetId), {
        width: 220,
        margin: 1,
        errorCorrectionLevel: 'M',
      });
      setQrDataUrl(dataUrl);

      // Load breadcrumb hierarchy non-blocking
      const bId = data.hierarchy?.building_id;
      const fId = data.hierarchy?.floor_id;
      if (bId) {
        hierarchyService.getBuilding(bId).then(setBuilding).catch(() => {});
      }
      if (fId) {
        floorService.getFloor(fId).then(setFloor).catch(() => {});
      }
    } catch (err) {
      console.error('Error loading asset details:', err);
      setError('Failed to load asset details. Please try again.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (id) loadAssetDetails(id);
  }, [id, loadAssetDetails]);

  useEffect(() => {
    assetService.getAssets().then(all => {
      setAllAssets(all.map(a => ({ _id: a._id!, label: a.basic_info?.display_name ?? a._id! })));
    }).catch(() => {});
  }, []);

  /** Build the structured text payload encoded into the QR code.
   *
   * Format (each field only included when non-empty):
   *   FACTORY MAP ASSET
   *   Name: …
   *   S/N: …
   *   Tag: …
   *   Model: …
   *   Status: …
   *   URL: …
   *
   * URL priority: REACT_APP_PUBLIC_BASE_URL env var → window.location.origin.
   * Set REACT_APP_PUBLIC_BASE_URL in .env for production deployments so the
   * link in the QR resolves correctly from any network, not just localhost.
   */
  const buildQrPayload = (a: Asset, assetId: string): string => {
    const base = process.env.REACT_APP_PUBLIC_BASE_URL?.replace(/\/$/, '') ?? window.location.origin;
    const url = `${base}/assets/${assetId}`;
    const lines: string[] = ['FACTORY MAP ASSET'];
    if (a.basic_info?.display_name)  lines.push(`Name: ${a.basic_info.display_name}`);
    if (a.basic_info?.serial_number) lines.push(`S/N: ${a.basic_info.serial_number}`);
    if (a.basic_info?.asset_tag)     lines.push(`Tag: ${a.basic_info.asset_tag}`);
    const model = [a.basic_info?.manufacturer, a.basic_info?.model].filter(Boolean).join(' ');
    if (model)                        lines.push(`Model: ${model}`);
    if (a.basic_info?.status)         lines.push(`Status: ${a.basic_info.status}`);
    if (a.network?.ip_address)        lines.push(`IP: ${a.network.ip_address}`);
    if (a.assigned_person?.full_name) lines.push(`Owner: ${a.assigned_person.full_name}`);
    lines.push(`URL: ${url}`);
    return lines.join('\n');
  };
  const handleEdit = () => {
    setFormOpen(true);
  };

  const handleFormSuccess = () => {
    if (id) {
      loadAssetDetails(id);
    }
  };

  const handleAddConnection = async () => {
    if (!asset || !id) return;
    const matched = allAssets.find(a => a.label === connSearch || a._id === connSearch);
    if (!matched) { toast.error('Select an asset from the list first'); return; }
    setAddingConn(true);
    try {
      const updated = await assetService.addConnection(id, {
        connected_asset_id: matched._id,
        connection_type:    connType,
        label:              connLabel || undefined,
        bidirectional:      connBidi,
        source_port:        connSourcePort.trim() || null,
        target_port:        connTargetPort.trim() || null,
      });
      setAsset(updated);
      setConnSearch(''); setConnLabel(''); setConnSourcePort(''); setConnTargetPort('');
      setShowAddConn(false);
      toast.success('Connection added');
    } catch {
      toast.error('Failed to add connection');
    } finally {
      setAddingConn(false);
    }
  };

  const handleRemoveConnection = async (connectedAssetId: string) => {
    if (!id) return;
    try {
      const updated = await assetService.removeConnection(id, connectedAssetId);
      setAsset(updated);
      toast.success('Connection removed');
    } catch {
      toast.error('Failed to remove connection');
    }
  };

  const handleDelete = async () => {
    if (!asset) return;
    setDeleting(true);
    try {
      await assetService.deleteAsset(asset._id);
      toast.success('Asset deleted');
      navigate('/');
    } catch {
      toast.error('Failed to delete asset');
    } finally {
      setDeleting(false);
      setConfirmOpen(false);
    }
  };

  const handlePrintLabel = () => {
    if (!asset) return;
    const printWindow = window.open('', '_blank', 'width=440,height=360');
    if (!printWindow) return;
    const statusColor =
      asset.basic_info?.status === 'active' ? '#10b981' :
      asset.basic_info?.status === 'maintenance' ? '#f59e0b' :
      asset.basic_info?.status === 'inactive' || asset.basic_info?.status === 'retired' ? '#ef4444' :
      '#6b7280';
    const scriptClose = '</script>';
    const qrImg = qrDataUrl
      ? `<img src="${qrDataUrl}" alt="QR" style="width:80px;height:80px;flex-shrink:0" />`
      : '';
    printWindow.document.write(
      '<!DOCTYPE html><html><head><title>Asset Label</title>' +
      '<style>' +
      'body{margin:0;display:flex;justify-content:center;align-items:center;min-height:100vh;font-family:Arial,sans-serif;background:#f9fafb}' +
      '.label{width:380px;border:2px solid #374151;border-radius:8px;padding:16px;background:#fff}' +
      '.header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px}' +
      '.header-text{flex:1;margin-right:12px}' +
      '.name{font-size:16px;font-weight:bold;color:#111827;margin-bottom:6px}' +
      '.row{display:flex;justify-content:space-between;font-size:11px;margin-bottom:4px;color:#374151}' +
      '.row label{color:#6b7280}' +
      '.status{display:inline-block;padding:2px 8px;border-radius:999px;font-size:10px;font-weight:bold;color:#fff;margin-bottom:8px}' +
      '@media print{body{background:#fff}.label{border:2px solid #000;box-shadow:none}}' +
      '</style></head><body><div class="label">' +
      '<div class="header"><div class="header-text">' +
      '<div class="name">' + (asset.basic_info?.display_name ?? '') + '</div>' +
      '<span class="status" style="background:' + statusColor + '">' + (asset.basic_info?.status || 'unknown') + '</span>' +
      '</div>' + qrImg + '</div>' +
      (asset.basic_info?.asset_tag ? '<div class="row"><label>Asset Tag</label><span>' + asset.basic_info?.asset_tag + '</span></div>' : '') +
      (asset.basic_info?.serial_number ? '<div class="row"><label>Serial No.</label><span>' + asset.basic_info?.serial_number + '</span></div>' : '') +
      (asset.basic_info?.manufacturer || asset.basic_info?.model ? '<div class="row"><label>Model</label><span>' + [asset.basic_info?.manufacturer, asset.basic_info?.model].filter(Boolean).join(' ') + '</span></div>' : '') +
      (asset.network?.ip_address ? '<div class="row"><label>IP Address</label><span>' + asset.network.ip_address + '</span></div>' : '') +
      (asset.assigned_person ? '<div class="row"><label>Assigned To</label><span>' + asset.assigned_person.full_name + '</span></div>' : '') +
      '</div><script>window.onload=()=>{window.print();window.close()}' + scriptClose + '</body></html>'
    );
    printWindow.document.close();
  };

  const handleSync = async () => {
    if (!asset) return;
    setSyncing(true);
    try {
      await assetService.syncAsset(asset._id);
      toast.success('ITSM sync completed');
      if (id) loadAssetDetails(id);
    } catch {
      toast.error('ITSM sync failed');
    } finally {
      setSyncing(false);
    }
  };

  const handleDownloadQR = () => {
    if (!qrDataUrl || !asset) return;
    const a = document.createElement('a');
    a.href = qrDataUrl;
    a.download = `qr-${asset.basic_info?.display_name ?? asset._id}.png`;
    a.click();
    toast.success('QR code downloaded');
  };

  if (loading) {
    return (
      <div className={styles.loading}>
        <div className={styles.spinner}></div>
        <p>Loading asset details...</p>
      </div>
    );
  }

  if (error) {
    return (
      <Card padding="lg">
        <div className={styles.empty}>
          <AlertTriangle size={32} style={{ color: 'var(--color-danger)', marginBottom: 8 }} />
          <h3>{error}</h3>
          <Button variant="outline" onClick={() => id && loadAssetDetails(id)}>
            Retry
          </Button>
        </div>
      </Card>
    );
  }

  if (!asset) {
    return (
      <Card padding="lg">
        <div className={styles.empty}>
          <h3>Asset not found</h3>
          <Button variant="outline" onClick={() => navigate(-1)}>
            Go Back
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <div className={styles.assetDetails}>
      <Breadcrumb items={[
        { label: 'Dashboard', href: '/' },
        ...(building ? [{ label: building.name, href: `/buildings/${building._id}` }] : []),
        ...(floor    ? [{ label: floor.name,     href: `/floors/${floor._id}` }]     : []),
        { label: asset.basic_info?.display_name ?? 'Asset' },
      ]} />

      {/* Header */}
      <div className={styles.header}>
        <Button variant="outline" onClick={() => navigate(-1)}>
          ← Back
        </Button>
        <div className={styles.headerActions}>
          {asset.itsm?.is_managed && (
            <Button variant="primary" onClick={handleSync} loading={syncing}>
              <RefreshCw size={15} style={{ marginRight: 6 }} />
              Sync from ITSM
            </Button>
          )}
          {qrDataUrl && (
            <Button variant="outline" onClick={handleDownloadQR}>
              <QrCode size={15} style={{ marginRight: 6 }} />
              QR Code
            </Button>
          )}
          <Button variant="outline" onClick={handlePrintLabel}>
            <Tag size={15} style={{ marginRight: 6 }} />
            Print Label
          </Button>
          <Button variant="outline" onClick={handleEdit}>
            Edit
          </Button>
          <Button variant="danger" onClick={() => setConfirmOpen(true)}>
            Delete
          </Button>
        </div>
      </div>

      <ConfirmDialog
        isOpen={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={handleDelete}
        title="Delete Asset"
        message={`Are you sure you want to delete "${asset.basic_info?.display_name}"? This action cannot be undone.`}
        confirmText="Delete"
        loading={deleting}
      />

      {/* Asset Header Card */}
      <Card padding="lg" className={styles.headerCard}>
        <div className={styles.assetHeader}>
          <div className={styles.assetIcon} aria-hidden="true">💻</div>
          <div className={styles.assetInfo}>
            <h1 className={styles.assetName}>{asset.basic_info?.display_name}</h1>
            <div className={styles.assetMeta}>
              {asset.basic_info?.manufacturer && (
                <span>{asset.basic_info?.manufacturer}</span>
              )}
              {asset.basic_info?.model && <span>• {asset.basic_info?.model}</span>}
              {asset.basic_info?.serial_number && (
                <span>• SN: {asset.basic_info?.serial_number}</span>
              )}
            </div>
          </div>
          <Badge variant={asset.itsm?.is_managed ? 'success' : 'neutral'} size="md">
            {asset.itsm?.is_managed ? 'ITSM Managed' : 'Manual'}
          </Badge>
          {qrDataUrl && (
            <img
              src={qrDataUrl}
              alt="QR Code"
              title="Scan to open asset page"
              style={{ width: 64, height: 64, borderRadius: 4, flexShrink: 0 }}
            />
          )}
        </div>

        {/* ITSM Banner */}
        {asset.itsm?.is_managed && (
          <div className={styles.itsmBanner}>
            <div className={styles.bannerIcon}>✅</div>
            <div className={styles.bannerContent}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '4px' }}>
                <p className={styles.bannerTitle} style={{ margin: 0 }}>ITSM Synchronized Asset</p>
                <Badge variant={asset.itsm?.source_of_truth === 'itsm' ? 'info' : 'neutral'} size="sm">
                  Source: {asset.itsm?.source_of_truth ?? 'local'}
                </Badge>
              </div>
              <p className={styles.bannerText}>
                Hardware ID: {asset.itsm?.hardware_asset_id || '—'}
              </p>
              {asset.itsm?.last_synced && (
                <p className={styles.bannerTime}>
                  Last synced: {new Date(asset.itsm?.last_synced).toLocaleString()}
                </p>
              )}
            </div>
          </div>
        )}
      </Card>

      <div className={styles.contentGrid}>
        {/* Left Column */}
        <div className={styles.leftColumn}>
          {/* Basic Information */}
          <Card padding="lg">
            <h3 className={styles.sectionTitle}>Basic Information</h3>
            <div className={styles.fieldsList}>
              <div className={styles.field}>
                <label>Display Name</label>
                <p>{asset.basic_info?.display_name}</p>
              </div>
              <div className={styles.field}>
                <label>Manufacturer</label>
                <p>{asset.basic_info?.manufacturer || '-'}</p>
              </div>
              <div className={styles.field}>
                <label>Model</label>
                <p>{asset.basic_info?.model || '-'}</p>
              </div>
              <div className={styles.field}>
                <label>Serial Number</label>
                <p>{asset.basic_info?.serial_number || '-'}</p>
              </div>
              <div className={styles.field}>
                <label>Asset Tag</label>
                <p>{asset.basic_info?.asset_tag || '-'}</p>
              </div>
              <div className={styles.field}>
                <label>Status</label>
                <p>{asset.basic_info?.status || '-'}</p>
              </div>
              {asset.catalog_item?.display_name && (
                <div className={styles.field}>
                  <label>Catalog Item</label>
                  <p>{asset.catalog_item.display_name}</p>
                </div>
              )}
            </div>
          </Card>

          {/* Technical Specs */}
          {asset.technical_specs && (
            <Card padding="lg">
              <h3 className={styles.sectionTitle}>Technical Specifications</h3>
              <div className={styles.fieldsList}>
                {asset.technical_specs.cpu && (
                  <div className={styles.field}>
                    <label>CPU</label>
                    <p>{asset.technical_specs.cpu}</p>
                  </div>
                )}
                {asset.technical_specs.ram && (
                  <div className={styles.field}>
                    <label>RAM</label>
                    <p>{asset.technical_specs.ram}</p>
                  </div>
                )}
                {asset.technical_specs.storage && (
                  <div className={styles.field}>
                    <label>Storage</label>
                    <p>{asset.technical_specs.storage}</p>
                  </div>
                )}
                {asset.technical_specs.gpu && (
                  <div className={styles.field}>
                    <label>GPU</label>
                    <p>{asset.technical_specs.gpu}</p>
                  </div>
                )}
              </div>
            </Card>
          )}

          {/* Operating System */}
          {(asset.basic_info?.os_type || asset.basic_info?.os_version) && (
            <Card padding="lg">
              <h3 className={styles.sectionTitle}>Operating System</h3>
              <div className={styles.fieldsList}>
                <div className={styles.field}>
                  <label>OS Type</label>
                  <p>{asset.basic_info?.os_type || '-'}</p>
                </div>
                <div className={styles.field}>
                  <label>OS Version</label>
                  <p>{asset.basic_info?.os_version || '-'}</p>
                </div>
              </div>
            </Card>
          )}
        </div>

        {/* Right Column */}
        <div className={styles.rightColumn}>
          {/* Assigned Person */}
          {asset.assigned_person && (
            <Card padding="lg">
              <h3 className={styles.sectionTitle}>Assigned Person</h3>
              <div className={styles.personCard}>
                <div className={styles.personAvatar}>
                  {asset.assigned_person.full_name.charAt(0)}
                </div>
                <div>
                  <p className={styles.personName}>{asset.assigned_person.full_name}</p>
                  <p className={styles.personId}>ID: {asset.assigned_person.person_id}</p>
                  {asset.assigned_person.itsm_id && (
                    <p className={styles.personId} style={{ fontFamily: 'monospace', fontSize: '11px', opacity: 0.7 }}>
                      ITSM: {asset.assigned_person.itsm_id}
                    </p>
                  )}
                </div>
              </div>
            </Card>
          )}

          {/* Organization */}
          {asset.organization?.display_name && (
            <Card padding="lg">
              <h3 className={styles.sectionTitle}>Organization</h3>
              <div className={styles.fieldsList}>
                <div className={styles.field}>
                  <label>Name</label>
                  <p>{asset.organization.display_name}</p>
                </div>
                {asset.organization.itsm_id && (
                  <div className={styles.field}>
                    <label>ITSM ID</label>
                    <p style={{ fontFamily: 'monospace', fontSize: '12px', wordBreak: 'break-all' }}>
                      {asset.organization.itsm_id}
                    </p>
                  </div>
                )}
              </div>
            </Card>
          )}

          {/* Network Information */}
          {asset.network && (
            <Card padding="lg">
              <h3 className={styles.sectionTitle}>Network Information</h3>
              <div className={styles.fieldsList}>
                {asset.network.ip_address && (
                  <div className={styles.field}>
                    <label>IP Address</label>
                    <p>{asset.network.ip_address}</p>
                  </div>
                )}
                {asset.network.hostname && (
                  <div className={styles.field}>
                    <label>Hostname</label>
                    <p>{asset.network.hostname}</p>
                  </div>
                )}
                {asset.network.vlan && (
                  <div className={styles.field}>
                    <label>VLAN</label>
                    <p>{asset.network.vlan}</p>
                  </div>
                )}
                {asset.network.switch_port && (
                  <div className={styles.field}>
                    <label>Switch Port</label>
                    <p>{asset.network.switch_port}</p>
                  </div>
                )}
                {asset.basic_info?.mac_address && (
                  <div className={styles.field}>
                    <label>MAC Address</label>
                    <p>{asset.basic_info?.mac_address}</p>
                  </div>
                )}
              </div>
            </Card>
          )}

          {/* Location */}
          <Card padding="lg">
            <h3 className={styles.sectionTitle}>Location</h3>
            <div className={styles.fieldsList}>
              <div className={styles.field}>
                <label>Coordinates</label>
                <p>
                  X: {asset.location.coordinates.x}, Y: {asset.location.coordinates.y}
                </p>
              </div>
              {asset.location.rotation !== undefined && (
                <div className={styles.field}>
                  <label>Rotation</label>
                  <p>{asset.location.rotation}°</p>
                </div>
              )}
              {asset.location.description && (
                <div className={styles.field}>
                  <label>Description</label>
                  <p>{asset.location.description}</p>
                </div>
              )}
            </div>
          </Card>
{/* Asset Form Modal */}
<AssetFormModal
  isOpen={formOpen}
  onClose={() => setFormOpen(false)}
  onSuccess={handleFormSuccess}
  asset={asset}
/>
          {/* Maintenance */}
          {asset.maintenance && (asset.maintenance.last_date || asset.maintenance.next_date) && (
            <Card padding="lg">
              <h3 className={styles.sectionTitle}>Maintenance</h3>
              <div className={styles.fieldsList}>
                {asset.maintenance.last_date && (
                  <div className={styles.field}>
                    <label>Last Maintenance</label>
                    <p>{new Date(asset.maintenance.last_date).toLocaleDateString()}</p>
                  </div>
                )}
                {asset.maintenance.next_date && (
                  <div className={styles.field}>
                    <label>Next Due</label>
                    <p style={{ color: new Date(asset.maintenance.next_date) < new Date() ? '#ef4444' : undefined }}>
                      {new Date(asset.maintenance.next_date).toLocaleDateString()}
                      {new Date(asset.maintenance.next_date) < new Date() && ' ⚠️ OVERDUE'}
                    </p>
                  </div>
                )}
                {asset.maintenance.interval_days && (
                  <div className={styles.field}>
                    <label>Interval</label>
                    <p>Every {asset.maintenance.interval_days} days</p>
                  </div>
                )}
                {asset.maintenance.notes && (
                  <div className={styles.field}>
                    <label>Notes</label>
                    <p>{asset.maintenance.notes}</p>
                  </div>
                )}
              </div>
            </Card>
          )}

          {/* Software */}
          {asset.software && asset.software.length > 0 && (
            <Card padding="lg">
              <h3 className={styles.sectionTitle}>Installed Software</h3>
              <div className={styles.softwareList}>
                {asset.software.map((sw, index) => (
                  <div key={index} className={styles.softwareItem}>
                    <div>
                      <p className={styles.softwareName}>{sw.display_name}</p>
                      {sw.version && (
                        <p className={styles.softwareVersion}>v{sw.version}</p>
                      )}
                    </div>
                    <Badge variant={sw.source === 'itsm' ? 'info' : 'neutral'} size="sm">
                      {sw.source}
                    </Badge>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Connections */}
          <Card padding="lg">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
              <h3 className={styles.sectionTitle} style={{ margin: 0 }}>Connections</h3>
              <Button variant="secondary" onClick={() => setShowAddConn(v => !v)}>
                {showAddConn ? 'Cancel' : '+ Add Connection'}
              </Button>
            </div>

            {showAddConn && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1rem', padding: '0.75rem', background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', minWidth: '130px' }}>
                    <label style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>Type</label>
                    <select
                      style={{ height: '36px', padding: '0 8px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-bg-primary)', color: 'var(--color-text-primary)', fontSize: '0.875rem' }}
                      value={connType} onChange={e => setConnType(e.target.value)}
                    >
                      {CONN_TYPE_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: 1, minWidth: '180px' }}>
                    <label style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>Connected asset</label>
                    <datalist id="detail-asset-list">
                      {allAssets.filter(a => a._id !== id).map(a => <option key={a._id} value={a.label} />)}
                    </datalist>
                    <input
                      list="detail-asset-list"
                      style={{ height: '36px', padding: '0 8px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-bg-primary)', color: 'var(--color-text-primary)', fontSize: '0.875rem' }}
                      value={connSearch} onChange={e => setConnSearch(e.target.value)}
                      placeholder="Search asset…"
                    />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', width: '120px' }}>
                    <label style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>My port</label>
                    <input
                      style={{ height: '36px', padding: '0 8px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-bg-primary)', color: 'var(--color-text-primary)', fontSize: '0.875rem' }}
                      value={connSourcePort} onChange={e => setConnSourcePort(e.target.value)}
                      placeholder="e.g. Gi0/1"
                    />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', width: '120px' }}>
                    <label style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>Their port</label>
                    <input
                      style={{ height: '36px', padding: '0 8px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-bg-primary)', color: 'var(--color-text-primary)', fontSize: '0.875rem' }}
                      value={connTargetPort} onChange={e => setConnTargetPort(e.target.value)}
                      placeholder="e.g. eth0"
                    />
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', width: '120px' }}>
                    <label style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>Label</label>
                    <input
                      style={{ height: '36px', padding: '0 8px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-md)', background: 'var(--color-bg-primary)', color: 'var(--color-text-primary)', fontSize: '0.875rem' }}
                      value={connLabel} onChange={e => setConnLabel(e.target.value)}
                      placeholder="optional"
                    />
                  </div>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.875rem', color: 'var(--color-text-secondary)', height: '36px', alignSelf: 'flex-end' }}>
                    <input type="checkbox" checked={connBidi} onChange={e => setConnBidi(e.target.checked)} />
                    ↔ bidirectional
                  </label>
                  <Button variant="primary" onClick={handleAddConnection} disabled={addingConn || !connSearch.trim()} style={{ alignSelf: 'flex-end' }}>
                    {addingConn ? 'Adding…' : 'Add'}
                  </Button>
                </div>
              </div>
            )}

            {(!asset.connections || asset.connections.length === 0) ? (
              <p style={{ fontSize: '0.875rem', color: 'var(--color-text-secondary)', fontStyle: 'italic', margin: 0 }}>No connections yet.</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--color-text-secondary)', fontWeight: 600, fontSize: '0.75rem', textTransform: 'uppercase' }}>Type</th>
                    <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--color-text-secondary)', fontWeight: 600, fontSize: '0.75rem', textTransform: 'uppercase' }}>Connected Asset</th>
                    <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--color-text-secondary)', fontWeight: 600, fontSize: '0.75rem', textTransform: 'uppercase' }}>My Port</th>
                    <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--color-text-secondary)', fontWeight: 600, fontSize: '0.75rem', textTransform: 'uppercase' }}>Their Port</th>
                    <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--color-text-secondary)', fontWeight: 600, fontSize: '0.75rem', textTransform: 'uppercase' }}>Label</th>
                    <th style={{ width: '40px' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {asset.connections.map(c => {
                    const name = allAssets.find(a => a._id === c.connected_asset_id)?.label ?? c.connected_asset_id;
                    return (
                      <tr key={c.connected_asset_id} style={{ borderBottom: '1px solid var(--color-gray-100)' }}>
                        <td style={{ padding: '6px 8px' }}>
                          <span style={{ fontSize: '0.7rem', fontWeight: 600, textTransform: 'uppercase', padding: '1px 6px', borderRadius: '4px', background: 'var(--color-primary)', color: '#fff' }}>{c.connection_type}</span>
                        </td>
                        <td style={{ padding: '6px 8px', color: 'var(--color-text-primary)' }}>{name}</td>
                        <td style={{ padding: '6px 8px', color: 'var(--color-text-secondary)', fontFamily: 'monospace', fontSize: '0.8rem' }}>{(c as any).source_port ?? '—'}</td>
                        <td style={{ padding: '6px 8px', color: 'var(--color-text-secondary)', fontFamily: 'monospace', fontSize: '0.8rem' }}>{(c as any).target_port ?? '—'}</td>
                        <td style={{ padding: '6px 8px', color: 'var(--color-text-secondary)' }}>{c.label ?? '—'}</td>
                        <td style={{ padding: '6px 4px', textAlign: 'right' }}>
                          <button
                            onClick={() => handleRemoveConnection(c.connected_asset_id)}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-secondary)', fontSize: '0.8rem', padding: '2px 4px' }}
                            title="Remove connection"
                          >✕</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Card>

          {/* ITSM Integration */}
          {(asset.itsm?.is_managed || asset.itsm?.itsm_guid) && (
            <Card padding="lg">
              <h3 className={styles.sectionTitle}>ITSM Integration</h3>
              <div className={styles.fieldsList}>
                <div className={styles.field}>
                  <label>Hardware Asset ID</label>
                  <p>{asset.itsm?.hardware_asset_id || '—'}</p>
                </div>
                <div className={styles.field}>
                  <label>Source of Truth</label>
                  <Badge variant={asset.itsm?.source_of_truth === 'itsm' ? 'info' : 'neutral'} size="sm">
                    {asset.itsm?.source_of_truth ?? 'local'}
                  </Badge>
                </div>
                <div className={styles.field}>
                  <label>Sync Status</label>
                  <Badge
                    variant={asset.itsm?.sync_status === 'success' ? 'success' : asset.itsm?.sync_status === 'failed' ? 'error' : 'neutral'}
                    size="sm"
                  >
                    {asset.itsm?.sync_status}
                  </Badge>
                </div>
                {asset.itsm?.itsm_modified_at && (
                  <div className={styles.field}>
                    <label>Modified in ITSM</label>
                    <p>{new Date(asset.itsm.itsm_modified_at).toLocaleString()}</p>
                  </div>
                )}
                {asset.itsm?.asset_class && (
                  <div className={styles.field}>
                    <label>ITSM Class</label>
                    <p style={{ fontFamily: 'monospace', fontSize: '12px', wordBreak: 'break-all' }}>{asset.itsm.asset_class}</p>
                  </div>
                )}
                {asset.itsm?.itsm_guid && (
                  <div className={styles.field}>
                    <label>ITSM GUID</label>
                    <p style={{ fontFamily: 'monospace', fontSize: '12px', wordBreak: 'break-all' }}>{asset.itsm.itsm_guid}</p>
                  </div>
                )}
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
    
  );
};

export default AssetDetails;