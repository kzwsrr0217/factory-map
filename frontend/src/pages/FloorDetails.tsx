/**
 * FloorDetails.tsx — Interactive floor page ("/floors/:id").
 *
 * The primary page for floor-level asset management. Composes:
 *   FloorMap        — the SVG canvas showing work areas and placed assets.
 *   Asset panel     — right-side list of all assets on this floor (placed and
 *                     unplaced), with filter/search and inline actions.
 *   Work area tools — create/rename/delete work areas directly on the canvas.
 *   Asset placement — click a canvas cell in deploy mode to open AssetFormModal
 *                     pre-populated with the clicked grid coordinates.
 *   CSV import      — CsvImportModal bulk-creates assets on this floor.
 *   Floor plan      — FloorPlanUploadModal replaces the background SVG/image.
 *
 * Coordinate persistence: after each drag-end, `onAssetMove` or
 * `onWorkareaMove` calls the respective service PATCH, then reloads the data.
 * Connection wiring mode is toggled from the toolbar and uses
 * FloorMap's `connectionMode` + `selectedAssetsForConnection` props.
 */
import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { LayoutGrid, Monitor, Factory, Upload, Pencil, Check, AlertTriangle, FileSpreadsheet, Cable, X, Undo2, Redo2 } from 'lucide-react';
import CsvImportModal from '../components/asset/CsvImportModal';
import AddConnectionModal from '../components/asset/AddConnectionModal';
import Card from '../components/common/Card';
import Button from '../components/common/Button';
import Badge from '../components/common/Badge';
import Breadcrumb from '../components/common/Breadcrumb';
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
import { useToast } from '../contexts/ToastContext';
import { useDebouncedCallback } from '../hooks/useDebouncedCallback';
import { useUndoRedo } from '../hooks/useUndoRedo';
import { findContainingWorkareaId } from '../utils/workareaGeometry';
import { getApiErrorMessage } from '../utils/apiError';
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
  const [error, setError] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);
  const undoRedo = useUndoRedo();
  const [wireMode, setWireMode] = useState(false);
  const [selectedForConnection, setSelectedForConnection] = useState<string[]>([]);
  const [addConnectionOpen, setAddConnectionOpen] = useState(false);
  const toast = useToast();
  
  // Modal states
  const [floorFormOpen, setFloorFormOpen] = useState(false);
  const [deleteFloorDialogOpen, setDeleteFloorDialogOpen] = useState(false);
  const [workareaFormOpen, setWorkareaFormOpen] = useState(false);
  const [workareaDetailsOpen, setWorkareaDetailsOpen] = useState(false);
  const [selectedWorkarea, setSelectedWorkarea] = useState<WorkArea | null>(null);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [csvImportOpen, setCsvImportOpen] = useState(false);
  const [editingWorkarea, setEditingWorkarea] = useState<WorkArea | null>(null);
  const [deletingWorkarea, setDeletingWorkarea] = useState<WorkArea | null>(null);
  const [deleteWorkareaDialogOpen, setDeleteWorkareaDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (id) {
      loadFloorDetails(id);
    }
  }, [id]);

  // Undo/redo for edit-mode drag actions (move/resize) — see useUndoRedo and
  // the applyXMove/handleXMove pairs below. Only active in edit mode so
  // Ctrl+Z doesn't fight with e.g. text-field undo elsewhere on the page.
  useEffect(() => {
    if (!editMode) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'z') return;
      e.preventDefault();
      if (e.shiftKey) undoRedo.redo(); else undoRedo.undo();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [editMode, undoRedo]);

  // The undo stack references specific workarea/asset/workstation ids on the
  // currently-loaded floor — stale once the floor changes.
  useEffect(() => {
    undoRedo.clear();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const loadFloorDetails = async (floorId: string) => {
    try {
      setLoading(true);
      const [floorData, workareasData, sectionsData, workstationsData, allAssets] = await Promise.all([
        floorService.getFloor(floorId),
        workareaService.getWorkAreas(floorId),
        sectionService.getSections(),
        workstationService.getWorkstations(),
        assetService.getAssets({ include_master: true }),
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
    } catch (err) {
      console.error('Error loading floor details:', err);
      setError('Failed to load floor details. Please try again.');
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
      toast.error(`Cannot delete floor with ${workareas.length} work area(s). Please remove work areas first.`);
      return;
    }
    if (assets.length > 0) {
      toast.error(`Cannot delete floor with ${assets.length} asset(s). Please remove or reassign assets first.`);
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
    } catch (err) {
      console.error('Error deleting floor:', err);
      toast.error(getApiErrorMessage(err, 'Failed to delete floor. Please try again.'));
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
    } catch (err) {
      console.error('Error deleting work area:', err);
      toast.error(getApiErrorMessage(err, 'Failed to delete work area. Please try again.'));
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

  const handlePlaceUnplacedAsset = useCallback(async (assetId: string, x: number, y: number) => {
    const asset = assets.find(a => a._id === assetId);
    if (!asset) return;

    const snappedWorkarea = workareas.find(wa => {
      const waX = wa.coordinates?.x ?? 0;
      const waY = wa.coordinates?.y ?? 0;
      const waW = wa.dimensions?.width ?? 150;
      const waH = wa.dimensions?.height ?? 100;
      return x >= waX && x <= waX + waW && y >= waY && y <= waY + waH;
    }) ?? null;

    setAssets(prev => prev.map(a =>
      a._id === assetId
        ? {
            ...a,
            location: { ...a.location, coordinates: { x, y } },
            hierarchy: {
              ...a.hierarchy,
              workarea_id: snappedWorkarea ? snappedWorkarea._id : a.hierarchy.workarea_id,
            },
          }
        : a
    ));
    try {
      await assetService.updateAsset(assetId, {
        location: { ...asset.location, coordinates: { x, y }, icon_type: asset.location.icon_type || 'computer' },
        hierarchy: {
          ...asset.hierarchy,
          workarea_id: snappedWorkarea ? snappedWorkarea._id : asset.hierarchy.workarea_id,
        },
      });
      const suffix = snappedWorkarea ? ` → ${snappedWorkarea.name}` : '';
      toast.success(`${asset.basic_info.display_name} placed on map${suffix}`);
    } catch (error) {
      console.error('Error placing asset:', error);
      toast.error('Failed to place asset.');
      if (id) loadFloorDetails(id);
    }
  }, [assets, workareas, id, toast]);

  // Map handlers with debounce — each updates local state immediately (so
  // dragging feels instant), then persists only the last position/size via
  // useDebouncedCallback once the user stops dragging (see that hook for why
  // this is shared instead of each handler managing its own timer ref).
  const persistWorkareaMove = useDebouncedCallback(async (workareaId: string, x: number, y: number) => {
    try {
      await workareaService.updateWorkArea(workareaId, { coordinates: { x, y } });
    } catch (error) {
      console.error('Error updating work area position:', error);
    }
  });
  const applyWorkareaMove = useCallback((workareaId: string, x: number, y: number) => {
    setWorkareas((prev) =>
      prev.map((wa) =>
        wa._id === workareaId ? { ...wa, coordinates: { x, y } } : wa
      )
    );
    persistWorkareaMove(workareaId, x, y);
  }, [persistWorkareaMove]);
  const handleWorkareaMove = useCallback((workareaId: string, x: number, y: number) => {
    const prev = workareas.find((wa) => wa._id === workareaId);
    applyWorkareaMove(workareaId, x, y);
    if (prev) {
      undoRedo.push({
        undo: () => applyWorkareaMove(workareaId, prev.coordinates?.x ?? 0, prev.coordinates?.y ?? 0),
        redo: () => applyWorkareaMove(workareaId, x, y),
      });
    }
  }, [workareas, applyWorkareaMove, undoRedo]);

  const persistWorkstationMove = useDebouncedCallback(async (workstationId: string, x: number, y: number) => {
    try {
      await workstationService.updateWorkstation(workstationId, { coordinates: { x, y } });
    } catch (error) {
      console.error('Error updating workstation position:', error);
    }
  });
  const applyWorkstationMove = useCallback((workstationId: string, x: number, y: number) => {
    setWorkstations((prev) =>
      prev.map((ws) => (ws._id === workstationId ? { ...ws, coordinates: { x, y } } : ws))
    );
    persistWorkstationMove(workstationId, x, y);
  }, [persistWorkstationMove]);
  const handleWorkstationMove = useCallback((workstationId: string, x: number, y: number) => {
    const prev = workstations.find((ws) => ws._id === workstationId);
    applyWorkstationMove(workstationId, x, y);
    if (prev) {
      const prevCoords = prev.coordinates ?? { x: 0, y: 0 };
      undoRedo.push({
        undo: () => applyWorkstationMove(workstationId, prevCoords.x, prevCoords.y),
        redo: () => applyWorkstationMove(workstationId, x, y),
      });
    }
  }, [workstations, applyWorkstationMove, undoRedo]);

  const persistWorkareaResize = useDebouncedCallback(async (workareaId: string, width: number, height: number) => {
    try {
      await workareaService.updateWorkArea(workareaId, { dimensions: { width, height } });
    } catch (error) {
      console.error('Error updating work area dimensions:', error);
    }
  });
  const applyWorkareaResize = useCallback((workareaId: string, width: number, height: number) => {
    setWorkareas((prev) =>
      prev.map((wa) =>
        wa._id === workareaId
          ? { ...wa, dimensions: { width, height } }
          : wa
      )
    );
    persistWorkareaResize(workareaId, width, height);
  }, [persistWorkareaResize]);
  const handleWorkareaResize = useCallback((workareaId: string, width: number, height: number) => {
    const prev = workareas.find((wa) => wa._id === workareaId);
    applyWorkareaResize(workareaId, width, height);
    if (prev) {
      undoRedo.push({
        undo: () => applyWorkareaResize(workareaId, prev.dimensions?.width ?? 0, prev.dimensions?.height ?? 0),
        redo: () => applyWorkareaResize(workareaId, width, height),
      });
    }
  }, [workareas, applyWorkareaResize, undoRedo]);

  const persistAssetMove = useDebouncedCallback(async (assetId: string, x: number, y: number, iconType: string, hierarchy: Asset['hierarchy']) => {
    try {
      await assetService.updateAsset(assetId, {
        location: { coordinates: { x, y }, icon_type: iconType },
        hierarchy,
      });
    } catch (error) {
      console.error('Error updating asset position:', error);
    }
  });
  const applyAssetMove = useCallback((assetId: string, x: number, y: number) => {
    const asset = assets.find((a) => a._id === assetId);
    if (!asset) return;
    // Recompute which work area (if any) the asset's new position falls
    // inside — otherwise workarea_id would silently keep pointing at
    // wherever it used to be, regardless of where it visually is now.
    const workareaId = findContainingWorkareaId(x, y, workareas);
    const hierarchy = { ...asset.hierarchy, workarea_id: workareaId };

    setAssets((prev) =>
      prev.map((a) =>
        a._id === assetId
          ? {
              ...a,
              hierarchy,
              location: {
                ...a.location,
                coordinates: { x, y },
              },
            }
          : a
      )
    );
    persistAssetMove(assetId, x, y, asset.location.icon_type || 'computer', hierarchy);
  }, [assets, workareas, persistAssetMove]);
  const handleAssetMove = useCallback((assetId: string, x: number, y: number) => {
    const prev = assets.find((a) => a._id === assetId);
    applyAssetMove(assetId, x, y);
    if (prev) {
      const prevCoords = prev.location.coordinates;
      undoRedo.push({
        undo: () => applyAssetMove(assetId, prevCoords.x, prevCoords.y),
        redo: () => applyAssetMove(assetId, x, y),
      });
    }
  }, [assets, applyAssetMove, undoRedo]);

  // Map click handlers
  const handleWorkareaClick = (workarea: WorkArea) => {
    setSelectedWorkarea(workarea);
    setWorkareaDetailsOpen(true);
  };

  const handleAssetClick = (asset: Asset) => {
    navigate(`/assets/${asset._id}`);
  };

  const handleAssetSelectForConnection = (assetId: string) => {
    setSelectedForConnection(prev => {
      // Deselect if already chosen
      if (prev.includes(assetId)) return prev.filter(id => id !== assetId);
      const next = [...prev, assetId];
      if (next.length === 2) {
        // Open modal after state update
        setTimeout(() => setAddConnectionOpen(true), 0);
      }
      return next;
    });
  };

  const handleExitWireMode = () => {
    setWireMode(false);
    setSelectedForConnection([]);
    setAddConnectionOpen(false);
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

  if (error) {
    return (
      <Card padding="lg">
        <div className={styles.empty}>
          <AlertTriangle size={32} style={{ color: 'var(--color-danger)', marginBottom: 8 }} />
          <h3>{error}</h3>
          <Button variant="outline" onClick={() => id && loadFloorDetails(id)}>
            Retry
          </Button>
        </div>
      </Card>
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

  const placedAssets = assets.filter(a => a.is_placed);
  const unplacedAssets = assets.filter(a => !a.is_placed);

  return (
    <div className={styles.floorDetails}>
      <Breadcrumb items={[
        { label: 'Buildings', href: '/buildings' },
        { label: 'Building', href: `/buildings/${floor.building_id}` },
        { label: floor.name },
      ]} />

      {/* Header */}
      <div className={styles.header}>
        <Button variant="outline" onClick={() => navigate(-1)}>
          ← Back
        </Button>
      </div>

      {/* Floor Info Card */}
      <Card padding="lg" className={styles.infoCard}>
        <div className={styles.floorHeader}>
          <div className={styles.floorIcon}><LayoutGrid size={28} /></div>
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
            <Button variant="outline" onClick={() => setCsvImportOpen(true)}>
              <FileSpreadsheet size={15} style={{ marginRight: 6 }} />
              Import CSV
            </Button>
            <Button variant="outline" onClick={() => setUploadModalOpen(true)}>
              <Upload size={15} style={{ marginRight: 6 }} />
              {floor.svg_background || floor.svg_ref ? 'Change' : 'Upload'} Background
            </Button>
            <Button
              variant={wireMode ? 'warning' : 'outline'}
              onClick={() => {
                if (wireMode) { handleExitWireMode(); }
                else { setWireMode(true); setEditMode(false); }
              }}
            >
              {wireMode
                ? <><X size={15} style={{ marginRight: 6 }} />Exit Wire Mode{selectedForConnection.length > 0 ? ` (${selectedForConnection.length}/2)` : ''}</>
                : <><Cable size={15} style={{ marginRight: 6 }} />Wire Mode</>
              }
            </Button>
            <Button
              variant={editMode ? 'success' : 'outline'}
              onClick={() => setEditMode(!editMode)}
            >
              {editMode
                ? <><Check size={15} style={{ marginRight: 6 }} />Done Editing</>
                : <><Pencil size={15} style={{ marginRight: 6 }} />Edit Mode</>
              }
            </Button>
            {editMode && (
              <>
                <Button variant="outline" onClick={undoRedo.undo} disabled={!undoRedo.canUndo} title="Undo (Ctrl+Z)">
                  <Undo2 size={15} style={{ marginRight: 6 }} />Undo
                </Button>
                <Button variant="outline" onClick={undoRedo.redo} disabled={!undoRedo.canRedo} title="Redo (Ctrl+Shift+Z)">
                  <Redo2 size={15} style={{ marginRight: 6 }} />Redo
                </Button>
              </>
            )}
          </div>
        </div>

        {!floor.svg_background && !floor.svg_ref && workareas.length === 0 && (
          <div className={styles.floorPlanEmpty}>
            <Upload size={36} style={{ color: 'var(--color-text-secondary)', marginBottom: 12 }} />
            <h3>No floor plan yet</h3>
            <p>Upload an SVG or image to visualise this floor. You can still add work areas without a background.</p>
            <Button variant="primary" onClick={() => setUploadModalOpen(true)}>
              <Upload size={15} style={{ marginRight: 6 }} />Upload Floor Plan
            </Button>
          </div>
        )}

        <FloorMap
          workareas={workareas}
          assets={placedAssets}
          onWorkareaClick={handleWorkareaClick}
          onAssetClick={handleAssetClick}
          onWorkareaMove={handleWorkareaMove}
          onWorkareaResize={handleWorkareaResize}
          onAssetMove={handleAssetMove}
          editable={editMode}
          backgroundImage={floor.svg_background}
          floorId={floor._id}
          floorSvgRef={floor.svg_ref}
          workstations={workstations}
          onWorkstationMove={editMode ? handleWorkstationMove : undefined}
          unplacedAssets={unplacedAssets}
          onPlaceUnplaced={handlePlaceUnplacedAsset}
          connectionMode={wireMode}
          selectedAssetsForConnection={selectedForConnection}
          onAssetSelectForConnection={handleAssetSelectForConnection}
          floorName={floor.name}
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
                  <div className={styles.workareaIcon}><Factory size={20} /></div>
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
                <div className={styles.assetIcon}><Monitor size={20} /></div>
                <div className={styles.assetInfo}>
                  <h4 className={styles.assetName}>{asset.basic_info?.display_name}</h4>
                  <p className={styles.assetDetails}>
                    {asset.basic_info?.manufacturer} {asset.basic_info?.model}
                  </p>
                </div>
                <Badge variant={asset.itsm?.is_managed ? 'success' : 'neutral'}>
                  {asset.itsm?.is_managed ? 'ITSM' : 'Manual'}
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

      {/* CSV Import Modal */}
      <CsvImportModal
        isOpen={csvImportOpen}
        onClose={() => setCsvImportOpen(false)}
        onSuccess={() => { setCsvImportOpen(false); if (id) loadFloorDetails(id); }}
        defaultFloorId={id || ''}
        defaultBuildingId={floor.building_id}
      />

      <AddConnectionModal
        isOpen={addConnectionOpen}
        onClose={() => { setAddConnectionOpen(false); setSelectedForConnection([]); }}
        onSuccess={() => { setAddConnectionOpen(false); setSelectedForConnection([]); if (id) loadFloorDetails(id); }}
        fromAsset={assets.find(a => a._id === selectedForConnection[0]) ?? null}
        toAsset={assets.find(a => a._id === selectedForConnection[1]) ?? null}
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