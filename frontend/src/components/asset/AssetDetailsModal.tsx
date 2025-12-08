import React, { useState } from 'react';
import Modal from '../common/Modal';
import Button from '../common/Button';
import Badge from '../common/Badge';
import Card from '../common/Card';
import { Asset } from '../../services/asset.service';
import styles from '../../styles/components/AssetDetailsModal.module.css';

interface AssetDetailsModalProps {
  asset: Asset | null;
  isOpen: boolean;
  onClose: () => void;
}

const AssetDetailsModal: React.FC<AssetDetailsModalProps> = ({
  asset,
  isOpen,
  onClose,
}) => {
  const [syncing, setSyncing] = useState(false);

  if (!asset) return null;

  const handleSync = async () => {
    setSyncing(true);
    // TODO: Implement ITSM sync
    setTimeout(() => {
      setSyncing(false);
      alert('ITSM sync would happen here!');
    }, 1500);
  };

  const footer = (
    <>
      {asset.itsm.is_managed && (
        <Button variant="primary" onClick={handleSync} loading={syncing}>
          Sync from ITSM
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
      title={asset.basic_info.display_name}
      width="lg"
      footer={footer}
    >
      <div className={styles.container}>
        {/* ITSM Status Banner */}
        {asset.itsm.is_managed && (
          <Card padding="md" className={styles.itsmBanner}>
            <div className={styles.bannerContent}>
              <div>
                <Badge variant="success">ITSM Managed</Badge>
                <p className={styles.bannerText}>
                  This asset is synchronized with ITSM (ID: {asset.itsm.hardware_id})
                </p>
                {asset.itsm.last_synced && (
                  <p className={styles.syncTime}>
                    Last synced: {new Date(asset.itsm.last_synced).toLocaleString()}
                  </p>
                )}
              </div>
            </div>
          </Card>
        )}

        {/* Basic Information */}
        <section className={styles.section}>
          <h3 className={styles.sectionTitle}>Basic Information</h3>
          <Card padding="lg">
            <div className={styles.grid}>
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
        </section>

        {/* Assigned Person */}
        {asset.assigned_person && (
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>Assigned Person</h3>
            <Card padding="lg">
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
                  X: {asset.location.coordinates.x}, Y: {asset.location.coordinates.y}
                </p>
              </div>
              <div className={styles.field}>
                <label>Description</label>
                <p>{asset.location.description || '-'}</p>
              </div>
            </div>
          </Card>
        </section>

        {/* ITSM Details (if managed) */}
        {asset.itsm.is_managed && (
          <section className={styles.section}>
            <h3 className={styles.sectionTitle}>ITSM Integration</h3>
            <Card padding="lg">
              <div className={styles.grid}>
                <div className={styles.field}>
                  <label>Hardware ID</label>
                  <p>{asset.itsm.hardware_id}</p>
                </div>
                <div className={styles.field}>
                  <label>Sync Status</label>
                  <Badge
                    variant={
                      asset.itsm.sync_status === 'success'
                        ? 'success'
                        : asset.itsm.sync_status === 'failed'
                        ? 'error'
                        : 'neutral'
                    }
                  >
                    {asset.itsm.sync_status}
                  </Badge>
                </div>
                <div className={styles.field}>
                  <label>Last Synced</label>
                  <p>
                    {asset.itsm.last_synced
                      ? new Date(asset.itsm.last_synced).toLocaleString()
                      : 'Never'}
                  </p>
                </div>
              </div>
            </Card>
          </section>
        )}
      </div>
    </Modal>
  );
};

export default AssetDetailsModal;