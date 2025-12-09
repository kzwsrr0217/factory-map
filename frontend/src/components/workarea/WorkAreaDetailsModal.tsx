import React from 'react';
import Modal from '../common/Modal';
import Button from '../common/Button';
import Badge from '../common/Badge';
import { WorkArea } from '../../services/workarea.service';
import { Asset } from '../../services/asset.service';
import styles from '../../styles/components/WorkAreaDetailsModal.module.css';

interface WorkAreaDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  workarea: WorkArea | null;
  assets: Asset[];
  onAssetClick: (asset: Asset) => void;
}

const WorkAreaDetailsModal: React.FC<WorkAreaDetailsModalProps> = ({
  isOpen,
  onClose,
  workarea,
  assets,
  onAssetClick,
}) => {
  if (!workarea) return null;

  const footer = (
    <Button variant="outline" onClick={onClose}>
      Close
    </Button>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Work Area: ${workarea.name}`}
      width="lg"
      footer={footer}
    >
      <div className={styles.container}>
        {/* Work Area Info */}
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>📋 Information</h3>
          <div className={styles.infoGrid}>
            <div className={styles.infoItem}>
              <span className={styles.label}>Name:</span>
              <span className={styles.value}>{workarea.name}</span>
            </div>
            {workarea.type && (
              <div className={styles.infoItem}>
                <span className={styles.label}>Type:</span>
                <span className={styles.value}>{workarea.type}</span>
              </div>
            )}
            {workarea.metadata?.supervisor && (
              <div className={styles.infoItem}>
                <span className={styles.label}>Supervisor:</span>
                <span className={styles.value}>{workarea.metadata.supervisor}</span>
              </div>
            )}
            {workarea.metadata?.capacity && (
              <div className={styles.infoItem}>
                <span className={styles.label}>Capacity:</span>
                <span className={styles.value}>{workarea.metadata.capacity} people</span>
              </div>
            )}
            <div className={styles.infoItem}>
              <span className={styles.label}>Dimensions:</span>
              <span className={styles.value}>
                {workarea.dimensions?.width || 150} × {workarea.dimensions?.height || 100} px
              </span>
            </div>
            <div className={styles.infoItem}>
              <span className={styles.label}>Position:</span>
              <span className={styles.value}>
                X: {workarea.coordinates?.x || 0}, Y: {workarea.coordinates?.y || 0}
              </span>
            </div>
          </div>
        </div>

        {/* Assets in this Work Area */}
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>
            💻 Assets in this Work Area ({assets.length})
          </h3>

          {assets.length > 0 ? (
            <div className={styles.assetsList}>
              {assets.map((asset) => (
                <div
                  key={asset._id}
                  className={styles.assetItem}
                  onClick={() => {
                    onClose();
                    onAssetClick(asset);
                  }}
                >
                  <div className={styles.assetIcon}>💻</div>
                  <div className={styles.assetInfo}>
                    <h4 className={styles.assetName}>{asset.basic_info.display_name}</h4>
                    <p className={styles.assetDetails}>
                      {asset.basic_info.manufacturer} {asset.basic_info.model}
                      {asset.basic_info.serial_number && ` • S/N: ${asset.basic_info.serial_number}`}
                    </p>
                    {asset.assigned_person && (
                      <p className={styles.assetPerson}>
                        👤 {asset.assigned_person.full_name}
                      </p>
                    )}
                  </div>
                  <Badge variant={asset.itsm.is_managed ? 'success' : 'neutral'}>
                    {asset.itsm.is_managed ? 'ITSM' : 'Manual'}
                  </Badge>
                </div>
              ))}
            </div>
          ) : (
            <div className={styles.emptyAssets}>
              <p>No assets in this work area</p>
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
};

export default WorkAreaDetailsModal;