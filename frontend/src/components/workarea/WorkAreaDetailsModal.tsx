/**
 * WorkAreaDetailsModal.tsx — Drill-down panel for a single work area.
 *
 * Shows the work area's metadata (including its Zone) and the assets in it.
 *
 * **Sections and Workstations are retired levels.** The hierarchy is
 * Building > Floor > Zone > WorkArea; the two deeper levels caused more
 * confusion than they resolved (a Section has no geometry, so it could never be
 * drawn on the map at all) and nothing creates them any more. Their tabs appear
 * only while a work area still has such rows, and offer deletion only — so
 * existing data stays visible and can be cleaned up, and the UI becomes plain
 * 4-level on its own once it is gone.
 */
import React, { useState } from 'react';
import Modal from '../common/Modal';
import Button from '../common/Button';
import Badge from '../common/Badge';
import ConfirmDialog from '../common/ConfirmDialog';
import { WorkArea } from '../../services/workarea.service';
import { Asset } from '../../services/asset.service';
import { Section, sectionService } from '../../services/section.service';
import { Workstation, workstationService } from '../../services/workstation.service';
import { useToast } from '../../contexts/ToastContext';
import { getApiErrorMessage } from '../../utils/apiError';
import styles from '../../styles/components/WorkAreaDetailsModal.module.css';

interface WorkAreaDetailsModalProps {
  isOpen: boolean;
  onClose: () => void;
  workarea: WorkArea | null;
  assets: Asset[];
  sections: Section[];
  workstations: Workstation[];
  onAssetClick: (asset: Asset) => void;
  onRefresh: () => void;
}

const WorkAreaDetailsModal: React.FC<WorkAreaDetailsModalProps> = ({
  isOpen,
  onClose,
  workarea,
  assets,
  sections,
  workstations,
  onAssetClick,
  onRefresh,
}) => {
  const [activeTab, setActiveTab] = useState<'info' | 'sections' | 'workstations' | 'assets'>('info');
  
  // Legacy-level cleanup dialogs — deletion only, no create/edit.
  const [deletingSection, setDeletingSection] = useState<Section | null>(null);
  const [deleteSectionDialogOpen, setDeleteSectionDialogOpen] = useState(false);
  
  const [deletingWorkstation, setDeletingWorkstation] = useState<Workstation | null>(null);
  const [deleteWorkstationDialogOpen, setDeleteWorkstationDialogOpen] = useState(false);
  
  const [deleting, setDeleting] = useState(false);
  const toast = useToast();

  if (!workarea) return null;

  // Section handlers
  const handleDeleteSection = (section: Section, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeletingSection(section);
    setDeleteSectionDialogOpen(true);
  };

  const confirmDeleteSection = async () => {
    if (!deletingSection) return;

    setDeleting(true);
    try {
      await sectionService.deleteSection(deletingSection._id);
      onRefresh();
    } catch (err) {
      console.error('Error deleting section:', err);
      toast.error(getApiErrorMessage(err, 'Failed to delete section. Please try again.'));
    } finally {
      setDeleting(false);
      setDeleteSectionDialogOpen(false);
      setDeletingSection(null);
    }
  };

  // Workstation handlers
  const handleDeleteWorkstation = (workstation: Workstation, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeletingWorkstation(workstation);
    setDeleteWorkstationDialogOpen(true);
  };

  const confirmDeleteWorkstation = async () => {
    if (!deletingWorkstation) return;

    setDeleting(true);
    try {
      await workstationService.deleteWorkstation(deletingWorkstation._id);
      onRefresh();
    } catch (err) {
      console.error('Error deleting workstation:', err);
      toast.error(getApiErrorMessage(err, 'Failed to delete workstation. Please try again.'));
    } finally {
      setDeleting(false);
      setDeleteWorkstationDialogOpen(false);
      setDeletingWorkstation(null);
    }
  };

  const footer = (
    <Button variant="outline" onClick={onClose}>
      Close
    </Button>
  );

  return (
    <>
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title={`Work Area: ${workarea.name}`}
        width="xl"
        footer={footer}
      >
        <div className={styles.container}>
          {/* Tabs */}
          <div className={styles.tabs}>
            <button
              className={`${styles.tab} ${activeTab === 'info' ? styles.active : ''}`}
              onClick={() => setActiveTab('info')}
            >
              Information
            </button>
            {sections.length > 0 && (
              <button
                className={`${styles.tab} ${activeTab === 'sections' ? styles.active : ''}`}
                onClick={() => setActiveTab('sections')}
              >
                Sections ({sections.length})
              </button>
            )}
            {workstations.length > 0 && (
              <button
                className={`${styles.tab} ${activeTab === 'workstations' ? styles.active : ''}`}
                onClick={() => setActiveTab('workstations')}
              >
                Workstations ({workstations.length})
              </button>
            )}
            <button
              className={`${styles.tab} ${activeTab === 'assets' ? styles.active : ''}`}
              onClick={() => setActiveTab('assets')}
            >
              Assets ({assets.length})
            </button>
          </div>

          {/* Tab Content */}
          <div className={styles.tabContent}>
            {/* Info Tab */}
            {activeTab === 'info' && (
              <div className={styles.section}>
                <div className={styles.infoGrid}>
                  <div className={styles.infoItem}>
                    <span className={styles.label}>Name:</span>
                    <span className={styles.value}>{workarea.name}</span>
                  </div>
                  {workarea.zone?.name && (
                    <div className={styles.infoItem}>
                      <span className={styles.label}>Zone:</span>
                      <span className={styles.value}>{workarea.zone.name}</span>
                    </div>
                  )}
                  {workarea.production_line_code && (
                    <div className={styles.infoItem}>
                      <span className={styles.label}>Production Line:</span>
                      <span className={styles.value}>{workarea.production_line_code}</span>
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

                <div className={styles.stats}>
                  <div className={styles.statItem}>
                    <span className={styles.statValue}>{assets.length}</span>
                    <span className={styles.statLabel}>Assets</span>
                  </div>
                </div>
              </div>
            )}

            {/* Sections Tab — retired level, kept for cleanup only */}
            {activeTab === 'sections' && sections.length > 0 && (
              <div className={styles.section}>
                <div className={styles.sectionHeader}>
                  <h3>Sections in {workarea.name}</h3>
                </div>
                <p className={styles.legacyNote}>
                  Sections are a retired level — the hierarchy is Building &gt; Floor
                  &gt; Zone &gt; Work Area. These rows are left over and can be deleted.
                </p>

                <div className={styles.itemsList}>
                    {sections.map((section) => (
                      <div key={section._id} className={styles.item}>
                        <div className={styles.itemIcon}>🏭</div>
                        <div className={styles.itemInfo}>
                          <h4 className={styles.itemName}>{section.name}</h4>
                          <p className={styles.itemDetails}>
                            {section.shift_schedule && `Schedule: ${section.shift_schedule}`}
                            {section.capacity && ` • Capacity: ${section.capacity}`}
                          </p>
                        </div>
                        <div className={styles.itemActions}>
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={(e) => handleDeleteSection(section, e)}
                          >
                            Delete
                          </Button>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {/* Workstations Tab — retired level, kept for cleanup only */}
            {activeTab === 'workstations' && workstations.length > 0 && (
              <div className={styles.section}>
                <div className={styles.sectionHeader}>
                  <h3>Workstations in {workarea.name}</h3>
                </div>
                <p className={styles.legacyNote}>
                  Workstations are a retired level — assets sit directly in a work
                  area now. These rows are left over and can be deleted.
                </p>

                <div className={styles.itemsList}>
                    {workstations.map((workstation) => (
                      <div key={workstation._id} className={styles.item}>
                        <div className={styles.itemIcon}>🔧</div>
                        <div className={styles.itemInfo}>
                          <h4 className={styles.itemName}>{workstation.name}</h4>
                          <p className={styles.itemDetails}>
                            {workstation.type && `Type: ${workstation.type}`}
                            {workstation.status && ` • Status: ${workstation.status}`}
                          </p>
                        </div>
                        <Badge
                          variant={
                            workstation.status === 'active'
                              ? 'success'
                              : workstation.status === 'maintenance'
                              ? 'warning'
                              : 'neutral'
                          }
                        >
                          {workstation.status || 'active'}
                        </Badge>
                        <div className={styles.itemActions}>
                          <Button
                            variant="danger"
                            size="sm"
                            onClick={(e) => handleDeleteWorkstation(workstation, e)}
                          >
                            Delete
                          </Button>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {/* Assets Tab */}
            {activeTab === 'assets' && (
              <div className={styles.section}>
                <h3>Assets in {workarea.name}</h3>

                {assets.length > 0 ? (
                  <div className={styles.itemsList}>
                    {assets.map((asset) => (
                      <div
                        key={asset._id}
                        className={styles.item}
                        onClick={() => {
                          onClose();
                          onAssetClick(asset);
                        }}
                        style={{ cursor: 'pointer' }}
                      >
                        <div className={styles.itemIcon}>💻</div>
                        <div className={styles.itemInfo}>
                          <h4 className={styles.itemName}>{asset.basic_info.display_name}</h4>
                          <p className={styles.itemDetails}>
                            {asset.basic_info.manufacturer} {asset.basic_info.model}
                            {asset.basic_info.serial_number && ` • S/N: ${asset.basic_info.serial_number}`}
                          </p>
                          {asset.assigned_person && (
                            <p className={styles.itemPerson}>
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
                  <div className={styles.empty}>
                    <p>No assets in this work area</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </Modal>

      {/* Delete Section Confirmation */}
      <ConfirmDialog
        isOpen={deleteSectionDialogOpen}
        onClose={() => setDeleteSectionDialogOpen(false)}
        onConfirm={confirmDeleteSection}
        title="Delete Section"
        message={`Are you sure you want to delete "${deletingSection?.name}"? This action cannot be undone.`}
        confirmText="Delete"
        loading={deleting}
        variant="danger"
      />

      {/* Delete Workstation Confirmation */}
      <ConfirmDialog
        isOpen={deleteWorkstationDialogOpen}
        onClose={() => setDeleteWorkstationDialogOpen(false)}
        onConfirm={confirmDeleteWorkstation}
        title="Delete Workstation"
        message={`Are you sure you want to delete "${deletingWorkstation?.name}"? This action cannot be undone.`}
        confirmText="Delete"
        loading={deleting}
        variant="danger"
      />
    </>
  );
};

export default WorkAreaDetailsModal;