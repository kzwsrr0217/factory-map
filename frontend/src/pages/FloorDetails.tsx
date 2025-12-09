import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Card from '../components/common/Card';
import Button from '../components/common/Button';
import Badge from '../components/common/Badge';
import ConfirmDialog from '../components/common/ConfirmDialog';
import WorkAreaFormModal from '../components/workarea/WorkAreaFormModal';
import WorkAreaDetailsModal from '../components/workarea/WorkAreaDetailsModal';
import FloorFormModal from '../components/floor/FloorFormModal';
import FloorPlanUploadModal from '../components/floor/FloorPlanUploadModal';
import FloorMap from '../components/map/FloorMap';
import { floorService, Floor } from '../services/floor.service';
import { workareaService, WorkArea } from '../services/workarea.service';
import { assetService, Asset } from '../services/asset.service';
import { sectionService, Section } from '../services/section.service';
import { workstationService, Workstation } from '../services/workstation.service';
import styles from '../styles/pages/FloorDetails.module.css';

const FloorDetails: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [floor, setFloor] = useState<Floor | null>(null);
  const [workareas, setWorkareas] = useState<WorkArea[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [workstations, setWorkstations] = useState<Workstation[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  
  // Modal states
  const [floorFormOpen, setFloorFormOpen] = useState(false);
  const [deleteFloorDialogOpen, setDeleteFloorDialogOpen] = useState(false);
  const [workareaFormOpen, setWorkareaFormOpen] = useState(false);
  const [workareaDetailsOpen, setWorkareaDetailsOpen] = useState(false);
  const [selectedWorkarea, setSelectedWorkarea] = useState<WorkArea | null>(null);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [editingWorkarea, setEditingWorkarea] = useState<WorkArea | null>(null);
  const [deletingWorkarea, setDeletingWorkarea] = useState<WorkArea | null>(null);
  const [deleteWorkareaDialogOpen, setDeleteWorkareaDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Debounce timers
  const workareaUpdateTimer = useRef<NodeJS.Timeout | null>(null);
  const workareaResizeTimer = useRef<NodeJS.Timeout | null>(null);
  const assetUpdateTimer = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (id) {
      loadFloorDetails(id);
    }
  }, [id]);

  const loadFloorDetails = async (floorId: string) => {
    try {
      setLoading(true);
      const [floorData, workareasData, sectionsData, workstationsData, allAssets] = await Promise.all([
        floorService.getFloor(floorId),
        workareaService.getWorkAreas(floorId),
        sectionService.getSections(),
        workstationService.getWorkstations(),
        assetService.getAssets(),
      ]);

      setFloor(floorData);
      setWorkareas(workareasData);
      
      // Filter sections for this floor's workareas
      const workareaIds = workareasData.map(wa => wa._id);
      const floorSections = sectionsData.filter(s => workareaIds.includes(s.workarea_id));
      setSections(floorSections);

      // Filter workstations for this floor's sections
      const sectionIds = floorSections.map(s => s._id);
      const floorWorkstations = workstationsData.filter(ws => sectionIds.includes(ws.section_id));
      setWorkstations(floorWorkstations);

      // Filter assets for this floor
      const floorAssets = allAssets.filter(
        (asset) => asset.hierarchy.floor_id === floorId
      );
      setAssets(floorAssets);
    } catch (error) {
      console.error('Error loading floor details:', error);
    } finally {
      setLoading(false);
    }
  };

  // Floor handlers
  const handleEditFloor = () => {
    setFloorFormOpen(true);
  };

  const handleDeleteFloor = () => {
    if (workareas.length > 0) {
      alert(
        `Cannot delete floor with ${workareas.length} work area(s). Please remove work areas first.`
      );
      return;
    }
    if (assets.length > 0) {
      alert(
        `Cannot delete floor with ${assets.length} asset(s). Please remove or reassign assets first.`
      );
      return;
    }
    setDeleteFloorDialogOpen(true);
  };

  const confirmDeleteFloor = async () => {
    if (!floor) return;

    setDeleting(true);
    try {
      await floorService.deleteFloor(floor._id);
      navigate(`/buildings/${floor.building_id}`);
    } catch (error) {
      console.error('Error deleting floor:', error);
      alert('Failed to delete floor. Please try again.');
    } finally {
      setDeleting(false);
      setDeleteFloorDialogOpen(false);
    }
  };

  const handleFloorFormSuccess = () => {
    if (id) {
      loadFloorDetails(id);
    }
  };

  // WorkArea handlers
  const handleAddWorkArea = () => {
    setEditingWorkarea(null);
    setWorkareaFormOpen(true);
  };

  const handleEditWorkArea = (workarea: WorkArea, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingWorkarea(workarea);
    setWorkareaFormOpen(true);
  };

  const handleDeleteWorkArea = (workarea: WorkArea, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeletingWorkarea(workarea);
    setDeleteWorkareaDialogOpen(true);
  };

  const confirmDeleteWorkArea = async () => {
    if (!deletingWorkarea) return;

    setDeleting(true);
    try {
      await workareaService.deleteWorkArea(deletingWorkarea._id);
      if (id) {
        loadFloorDetails(id);
      }
    } catch (error) {
      console.error('Error deleting work area:', error);
      alert('Failed to delete work area. Please try again.');
    } finally {
      setDeleting(false);
      setDeleteWorkareaDialogOpen(false);
      setDeletingWorkarea(null);
    }
  };

  const handleWorkareaFormSuccess = () => {
    if (id) {
      loadFloorDetails(id);
    }
  };

  const handleUploadSuccess = () => {
    if (id) {
      loadFloorDetails(id);
    }
  };

  // Map handlers with debounce
  const handleWorkareaMove = useCallback((workareaId: string, x: number, y: number) => {
    setWorkareas((prev) =>
      prev.map((wa) =>
        wa._id === workareaId ? { ...wa, coordinates: { x, y } } : wa
      )
    );

    if (workareaUpdateTimer.current) {
      clearTimeout(workareaUpdateTimer.current);
    }

    workareaUpdateTimer.current = setTimeout(async () => {
      try {
        await workareaService.updateWorkArea(workareaId, {
          coordinates: { x, y },
        });
      } catch (error) {
        console.error('Error updating work area position:', error);
      }
    }, 500);
  }, []);

  const handleWorkareaResize = useCallback((workareaId: string, width: number, height: number) => {
    setWorkareas((prev) =>
      prev.map((wa) =>
        wa._id === workareaId
          ? { ...wa, dimensions: { width, height } }
          : wa
      )
    );

    if (workareaResizeTimer.current) {
      clearTimeout(workareaResizeTimer.current);
    }

    workareaResizeTimer.current = setTimeout(async () => {
      try {
        await workareaService.updateWorkArea(workareaId, {
          dimensions: { width, height },
        });
      } catch (error) {
        console.error('Error updating work area dimensions:', error);
      }
    }, 500);
  }, []);

  const handleAssetMove = useCallback((assetId: string, x: number, y: number) => {
    const asset = assets.find((a) => a._id === assetId);
    if (!asset) return;

    setAssets((prev) =>
      prev.map((a) =>
        a._id === assetId
          ? {
              ...a,
              location: {
                ...a.location,
                coordinates: { x, y },
              },
            }
          : a
      )
    );

    if (assetUpdateTimer.current) {
      clearTimeout(assetUpdateTimer.current);
    }

    assetUpdateTimer.current = setTimeout(async () => {
      try {
        await assetService.updateAsset(assetId, {
          location: {
            ...asset.location,
            coordinates: { x, y },
            icon_type: asset.location.icon_type || 'computer',
          },
        });
      } catch (error) {
        console.error('Error updating asset position:', error);
      }
    }, 500);
  }, [assets]);

  // Map click handlers
  const handleWorkareaClick = (workarea: WorkArea) => {
    setSelectedWorkarea(workarea);
    setWorkareaDetailsOpen(true);
  };

  const handleAssetClick = (asset: Asset) => {
    navigate(`/assets/${asset._id}`);
  };

  // Get assets in selected workarea
  const getAssetsInWorkarea = (workarea: WorkArea): Asset[] => {
    const waX = workarea.coordinates?.x || 0;
    const waY = workarea.coordinates?.y || 0;
    const waWidth = workarea.dimensions?.width || 150;
    const waHeight = workarea.dimensions?.height || 100;

    return assets.filter((asset) => {
      const x = asset.location.coordinates.x;
      const y = asset.location.coordinates.y;
      return x >= waX && x <= waX + waWidth && y >= waY && y <= waY + waHeight;
    });
  };

  // Get sections in workarea
  const getSectionsInWorkarea = (workarea: WorkArea): Section[] => {
    return sections.filter(s => s.workarea_id === workarea._id);
  };

  // Get workstations in workarea
  const getWorkstationsInWorkarea = (workarea: WorkArea): Workstation[] => {
    const workareaeSections = getSectionsInWorkarea(workarea);
    const sectionIds = workareaeSections.map(s => s._id);
    return workstations.filter(ws => sectionIds.includes(ws.section_id));
  };

  if (loading) {
    return (
      <div className={styles.loading}>
        <div className={styles.spinner}></div>
        <p>Loading floor details...</p>
      </div>
    );
  }

  if (!floor) {
    return (
      <Card padding="lg">
        <div className={styles.empty}>
          <h3>Floor not found</h3>
          <Button variant="outline" onClick={() => navigate(-1)}>
            Go Back
          </Button>
        </div>
      </Card>
    );
  }

  return (
    <div className={styles.floorDetails}>
      {/* Header */}
      <div className={styles.header}>
        <Button variant="outline" onClick={() => navigate(-1)}>
          ← Back
        </Button>
      </div>

      {/* Floor Info Card */}
      <Card padding="lg" className={styles.infoCard}>
        <div className={styles.floorHeader}>
          <div className={styles.floorIcon}>📐</div>
          <div className={styles.floorInfo}>
            <h1 className={styles.floorName}>{floor.name}</h1>
            <p className={styles.floorMeta}>Level: {floor.floor_number}</p>
          </div>
          <div className={styles.floorActions}>
            <Button variant="outline" onClick={handleEditFloor}>
              Edit
            </Button>
            <Button variant="danger" onClick={handleDeleteFloor} loading={deleting}>
              Delete
            </Button>
          </div>
        </div>

        {/* Metadata */}
        {floor.metadata && (
          <div className={styles.metadata}>
            {floor.metadata.area && (
              <div className={styles.metadataItem}>
                <span className={styles.metadataLabel}>Area</span>
                <span className={styles.metadataValue}>{floor.metadata.area} m²</span>
              </div>
            )}
            {floor.metadata.ceiling_height && (
              <div className={styles.metadataItem}>
                <span className={styles.metadataLabel}>Ceiling Height</span>
                <span className={styles.metadataValue}>
                  {floor.metadata.ceiling_height} m
                </span>
              </div>
            )}
            <div className={styles.metadataItem}>
              <span className={styles.metadataLabel}>Work Areas</span>
              <span className={styles.metadataValue}>{workareas.length}</span>
            </div>
            <div className={styles.metadataItem}>
              <span className={styles.metadataLabel}>Sections</span>
              <span className={styles.metadataValue}>{sections.length}</span>
            </div>
            <div className={styles.metadataItem}>
              <span className={styles.metadataLabel}>Workstations</span>
              <span className={styles.metadataValue}>{workstations.length}</span>
            </div>
            <div className={styles.metadataItem}>
              <span className={styles.metadataLabel}>Assets</span>
              <span className={styles.metadataValue}>{assets.length}</span>
            </div>
          </div>
        )}
      </Card>

      {/* Floor Plan Map */}
      <Card padding="lg">
        <div className={styles.sectionHeader}>
          <h2>Floor Plan</h2>
          <div className={styles.headerActions}>
            <Button variant="outline" onClick={() => setUploadModalOpen(true)}>
              📤 {floor.svg_background ? 'Change' : 'Upload'} Background
            </Button>
            <Button
              variant={editMode ? 'success' : 'outline'}
              onClick={() => setEditMode(!editMode)}
            >
              {editMode ? '✓ Done Editing' : '✏️ Edit Mode'}
            </Button>
          </div>
        </div>

        <FloorMap
          workareas={workareas}
          assets={assets}
          onWorkareaClick={handleWorkareaClick}
          onAssetClick={handleAssetClick}
          onWorkareaMove={handleWorkareaMove}
          onWorkareaResize={handleWorkareaResize}
          onAssetMove={handleAssetMove}
          editable={editMode}
          backgroundImage={floor.svg_background}
        />
      </Card>

      {/* Work Areas Section */}
      <Card padding="lg">
        <div className={styles.sectionHeader}>
          <h2>Work Areas</h2>
          <Button variant="primary" onClick={handleAddWorkArea}>
            + Add Work Area
          </Button>
        </div>

        {workareas.length > 0 ? (
          <div className={styles.workareasList}>
            {workareas.map((workarea) => {
              const assetsInArea = getAssetsInWorkarea(workarea);
              const sectionsInArea = getSectionsInWorkarea(workarea);
              const workstationsInArea = getWorkstationsInWorkarea(workarea);
              
              return (
                <div
                  key={workarea._id}
                  className={styles.workareaItem}
                  onClick={() => handleWorkareaClick(workarea)}
                >
                  <div className={styles.workareaIcon}>🏭</div>
                  <div className={styles.workareaInfo}>
                    <h4 className={styles.workareaName}>
                      {workarea.name}
                      {assetsInArea.length > 0 && (
                        <span style={{ marginLeft: '8px' }}>
                          <Badge variant="info">
                            {assetsInArea.length} asset{assetsInArea.length !== 1 ? 's' : ''}
                          </Badge>
                        </span>
                      )}
                    </h4>
                    <p className={styles.workareaDetails}>
                      {workarea.type && `Type: ${workarea.type}`}
                      {sectionsInArea.length > 0 && ` • ${sectionsInArea.length} sections`}
                      {workstationsInArea.length > 0 && ` • ${workstationsInArea.length} workstations`}
                    </p>
                  </div>
                  <div className={styles.workareaActions}>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={(e) => handleEditWorkArea(workarea, e)}
                    >
                      Edit
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      onClick={(e) => handleDeleteWorkArea(workarea, e)}
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className={styles.emptyWorkareas}>
            <p>No work areas found on this floor</p>
            <Button variant="primary" onClick={handleAddWorkArea}>
              + Add First Work Area
            </Button>
          </div>
        )}
      </Card>

      {/* Assets Section */}
      <Card padding="lg">
        <div className={styles.sectionHeader}>
          <h2>Assets on this Floor</h2>
        </div>

        {assets.length > 0 ? (
          <div className={styles.assetsList}>
            {assets.map((asset) => (
              <div
                key={asset._id}
                className={styles.assetItem}
                onClick={() => navigate(`/assets/${asset._id}`)}
              >
                <div className={styles.assetIcon}>💻</div>
                <div className={styles.assetInfo}>
                  <h4 className={styles.assetName}>{asset.basic_info.display_name}</h4>
                  <p className={styles.assetDetails}>
                    {asset.basic_info.manufacturer} {asset.basic_info.model}
                  </p>
                </div>
                <Badge variant={asset.itsm.is_managed ? 'success' : 'neutral'}>
                  {asset.itsm.is_managed ? 'ITSM' : 'Manual'}
                </Badge>
              </div>
            ))}
          </div>
        ) : (
          <div className={styles.emptyAssets}>
            <p>No assets found on this floor</p>
          </div>
        )}
      </Card>

      {/* Floor Form Modal */}
      <FloorFormModal
        isOpen={floorFormOpen}
        onClose={() => setFloorFormOpen(false)}
        onSuccess={handleFloorFormSuccess}
        buildingId={floor.building_id}
        floor={floor}
      />

      {/* Delete Floor Confirmation */}
      <ConfirmDialog
        isOpen={deleteFloorDialogOpen}
        onClose={() => setDeleteFloorDialogOpen(false)}
        onConfirm={confirmDeleteFloor}
        title="Delete Floor"
        message={`Are you sure you want to delete "${floor?.name}"? This action cannot be undone.`}
        confirmText="Delete"
        loading={deleting}
        variant="danger"
      />

      {/* WorkArea Form Modal */}
      <WorkAreaFormModal
        isOpen={workareaFormOpen}
        onClose={() => setWorkareaFormOpen(false)}
        onSuccess={handleWorkareaFormSuccess}
        floorId={id || ''}
        workarea={editingWorkarea}
      />

      {/* WorkArea Details Modal */}
      <WorkAreaDetailsModal
        isOpen={workareaDetailsOpen}
        onClose={() => setWorkareaDetailsOpen(false)}
        workarea={selectedWorkarea}
        assets={selectedWorkarea ? getAssetsInWorkarea(selectedWorkarea) : []}
        sections={selectedWorkarea ? getSectionsInWorkarea(selectedWorkarea) : []}
        workstations={selectedWorkarea ? getWorkstationsInWorkarea(selectedWorkarea) : []}
        onAssetClick={handleAssetClick}
        onRefresh={() => {
          if (id) loadFloorDetails(id);
        }}
      />

      {/* Floor Plan Upload Modal */}
      <FloorPlanUploadModal
        isOpen={uploadModalOpen}
        onClose={() => setUploadModalOpen(false)}
        onSuccess={handleUploadSuccess}
        floorId={id || ''}
      />

      {/* Delete WorkArea Confirmation */}
      <ConfirmDialog
        isOpen={deleteWorkareaDialogOpen}
        onClose={() => setDeleteWorkareaDialogOpen(false)}
        onConfirm={confirmDeleteWorkArea}
        title="Delete Work Area"
        message={`Are you sure you want to delete "${deletingWorkarea?.name}"? This action cannot be undone.`}
        confirmText="Delete"
        loading={deleting}
        variant="danger"
      />
    </div>
  );
};

export default FloorDetails;