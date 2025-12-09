import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Card from '../components/common/Card';
import Button from '../components/common/Button';
import Badge from '../components/common/Badge';
import { assetService, Asset } from '../services/asset.service';
import styles from '../styles/pages/AssetDetails.module.css';
import AssetFormModal from '../components/asset/AssetFormModal';

const AssetDetails: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [asset, setAsset] = useState<Asset | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [deleting, setDeleting] = useState(false);  // ← ÚJ
  const [formOpen, setFormOpen] = useState(false);

  useEffect(() => {
    if (id) {
      loadAssetDetails(id);
    }
  }, [id]);

  const loadAssetDetails = async (assetId: string) => {
    try {
      setLoading(true);
      const data = await assetService.getAsset(assetId);
      setAsset(data);
    } catch (error) {
      console.error('Error loading asset details:', error);
    } finally {
      setLoading(false);
    }
  };
  // ← ÚJ: Handle edit
  const handleEdit = () => {
    setFormOpen(true);
  };

  const handleFormSuccess = () => {
    if (id) {
      loadAssetDetails(id);
    }
  };

  // ← ÚJ: Handle delete
  const handleDelete = async () => {
    if (!asset) return;

    const confirmed = window.confirm(
      `Are you sure you want to delete "${asset.basic_info.display_name}"? This action cannot be undone.`
    );

    if (!confirmed) return;

    setDeleting(true);
    try {
      await assetService.deleteAsset(asset._id);
      navigate('/assets');
    } catch (error) {
      console.error('Error deleting asset:', error);
      alert('Failed to delete asset. Please try again.');
    } finally {
      setDeleting(false);
    }
  };

  const handleSync = async () => {
    if (!asset) return;

    setSyncing(true);
    try {
      // TODO: Implement actual sync API call
      await new Promise((resolve) => setTimeout(resolve, 1500));
      alert('ITSM sync completed!');
      if (id) {
        loadAssetDetails(id);
      }
    } catch (error) {
      console.error('Error syncing asset:', error);
      alert('Sync failed!');
    } finally {
      setSyncing(false);
    }
  };

  if (loading) {
    return (
      <div className={styles.loading}>
        <div className={styles.spinner}></div>
        <p>Loading asset details...</p>
      </div>
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
      {/* Header */}
      <div className={styles.header}>
        <Button variant="outline" onClick={() => navigate(-1)}>
          ← Back
        </Button>
        <div className={styles.headerActions}>
          {asset.itsm.is_managed && (
            <Button variant="primary" onClick={handleSync} loading={syncing}>
              🔄 Sync from ITSM
            </Button>
          )}
          <Button variant="outline" onClick={handleEdit}>
            Edit
          </Button>
          <Button variant="danger" onClick={handleDelete} loading={deleting}>
            Delete
          </Button>
        </div>
      </div>

      {/* Asset Header Card */}
      <Card padding="lg" className={styles.headerCard}>
        <div className={styles.assetHeader}>
          <div className={styles.assetIcon}>💻</div>
          <div className={styles.assetInfo}>
            <h1 className={styles.assetName}>{asset.basic_info.display_name}</h1>
            <div className={styles.assetMeta}>
              {asset.basic_info.manufacturer && (
                <span>{asset.basic_info.manufacturer}</span>
              )}
              {asset.basic_info.model && <span>• {asset.basic_info.model}</span>}
              {asset.basic_info.serial_number && (
                <span>• SN: {asset.basic_info.serial_number}</span>
              )}
            </div>
          </div>
          <Badge variant={asset.itsm.is_managed ? 'success' : 'neutral'} size="md">
            {asset.itsm.is_managed ? 'ITSM Managed' : 'Manual'}
          </Badge>
        </div>

        {/* ITSM Banner */}
        {asset.itsm.is_managed && (
          <div className={styles.itsmBanner}>
            <div className={styles.bannerIcon}>✅</div>
            <div className={styles.bannerContent}>
              <p className={styles.bannerTitle}>ITSM Synchronized Asset</p>
              <p className={styles.bannerText}>
                Hardware ID: {asset.itsm.hardware_id}
              </p>
              {asset.itsm.last_synced && (
                <p className={styles.bannerTime}>
                  Last synced: {new Date(asset.itsm.last_synced).toLocaleString()}
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
                <p>{asset.basic_info.display_name}</p>
              </div>
              <div className={styles.field}>
                <label>Manufacturer</label>
                <p>{asset.basic_info.manufacturer || '-'}</p>
              </div>
              <div className={styles.field}>
                <label>Model</label>
                <p>{asset.basic_info.model || '-'}</p>
              </div>
              <div className={styles.field}>
                <label>Serial Number</label>
                <p>{asset.basic_info.serial_number || '-'}</p>
              </div>
              <div className={styles.field}>
                <label>Asset Tag</label>
                <p>{asset.basic_info.asset_tag || '-'}</p>
              </div>
              <div className={styles.field}>
                <label>Status</label>
                <p>{asset.basic_info.status || '-'}</p>
              </div>
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
          {(asset.basic_info.os_type || asset.basic_info.os_version) && (
            <Card padding="lg">
              <h3 className={styles.sectionTitle}>Operating System</h3>
              <div className={styles.fieldsList}>
                <div className={styles.field}>
                  <label>OS Type</label>
                  <p>{asset.basic_info.os_type || '-'}</p>
                </div>
                <div className={styles.field}>
                  <label>OS Version</label>
                  <p>{asset.basic_info.os_version || '-'}</p>
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
                </div>
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
                {asset.basic_info.mac_address && (
                  <div className={styles.field}>
                    <label>MAC Address</label>
                    <p>{asset.basic_info.mac_address}</p>
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
        </div>
      </div>
    </div>
    
  );
};

export default AssetDetails;