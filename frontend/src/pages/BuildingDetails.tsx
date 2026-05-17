/**
 * BuildingDetails.tsx — Detail page for a single building ("/buildings/:id").
 *
 * Shows building metadata (address, area, construction year, description) and
 * a list of its floors as cards. Each floor card shows floor number, asset
 * count, and a link to FloorDetails.
 *
 * Provides:
 *   Edit building    — BuildingFormModal pre-filled with current data.
 *   Delete building  — ConfirmDialog; backend rejects if floors exist.
 *   Add floor        — FloorFormModal with pre-set buildingId.
 *   Add asset        — AssetFormModal with pre-set buildingId for quick create.
 *   Quick stats      — total assets, placed/unplaced counts derived from
 *                      assets fetched for this building.
 */
import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Building2, Package, CheckCircle, Users, FileText, LayoutGrid, Monitor, MapPin, AlertTriangle } from 'lucide-react';
import Card from '../components/common/Card';
import Button from '../components/common/Button';
import Badge from '../components/common/Badge';
import Breadcrumb from '../components/common/Breadcrumb';
import ConfirmDialog from '../components/common/ConfirmDialog';
import BuildingFormModal from '../components/building/BuildingFormModal';
import AssetFormModal from '../components/asset/AssetFormModal';
import FloorFormModal from '../components/floor/FloorFormModal';
import { Floor } from '../services/floor.service';
import { useToast } from '../contexts/ToastContext';
import { useBuilding, useDeleteBuilding } from '../hooks/queries/useBuildings';
import { useFloors, useDeleteFloor } from '../hooks/queries/useFloors';
import { useAssets } from '../hooks/queries/useAssets';
import styles from '../styles/pages/BuildingDetails.module.css';

const BuildingDetails: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();

  const { data: building, isLoading: loadingBuilding, isError } = useBuilding(id);
  const { data: floors = [], refetch: refetchFloors } = useFloors(id);
  const { data: allAssets = [] } = useAssets();

  const assets = allAssets.filter(
    a => a.hierarchy.building_id === id && a.basic_info && a.itsm
  );

  const deleteBuilding = useDeleteBuilding();
  const deleteFloor = useDeleteFloor();

  const [formOpen, setFormOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [assetFormOpen, setAssetFormOpen] = useState(false);
  const [floorFormOpen, setFloorFormOpen] = useState(false);
  const [editingFloor, setEditingFloor] = useState<Floor | null>(null);
  const [deletingFloor, setDeletingFloor] = useState<Floor | null>(null);
  const [deleteFloorDialogOpen, setDeleteFloorDialogOpen] = useState(false);

  const handleDelete = () => {
    if (assets.length > 0) {
      toast.error(`Cannot delete building with ${assets.length} asset(s). Please remove or reassign assets first.`);
      return;
    }
    setDeleteDialogOpen(true);
  };

  const confirmDelete = () => {
    if (!building) return;
    deleteBuilding.mutate(building._id, {
      onSuccess: () => navigate('/buildings'),
      onError: () => toast.error('Failed to delete building. Please try again.'),
    });
  };

  const handleEditFloor = (floor: Floor, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingFloor(floor);
    setFloorFormOpen(true);
  };

  const handleDeleteFloor = (floor: Floor, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeletingFloor(floor);
    setDeleteFloorDialogOpen(true);
  };

  const confirmDeleteFloor = () => {
    if (!deletingFloor) return;
    deleteFloor.mutate(deletingFloor._id, {
      onSuccess: () => {
        refetchFloors();
        setDeleteFloorDialogOpen(false);
        setDeletingFloor(null);
      },
      onError: () => toast.error('Failed to delete floor. Please try again.'),
    });
  };

  if (loadingBuilding) {
    return (
      <div className={styles.loading}>
        <div className={styles.spinner}></div>
        <p>Loading building details...</p>
      </div>
    );
  }

  if (isError) {
    return (
      <Card padding="lg">
        <div className={styles.empty}>
          <AlertTriangle size={32} style={{ color: 'var(--color-danger)', marginBottom: 8 }} />
          <h3>Failed to load building details.</h3>
          <Button variant="outline" onClick={() => navigate('/buildings')}>Back to Buildings</Button>
        </div>
      </Card>
    );
  }

  if (!building) {
    return (
      <Card padding="lg">
        <div className={styles.empty}>
          <h3>Building not found</h3>
          <Button variant="outline" onClick={() => navigate('/buildings')}>Back to Buildings</Button>
        </div>
      </Card>
    );
  }

  const itsmManagedCount = assets.filter(a => a.itsm?.is_managed).length;
  const assignedCount = assets.filter(a => a.assigned_person).length;

  return (
    <div className={styles.buildingDetails}>
      <Breadcrumb items={[
        { label: 'Buildings', href: '/buildings' },
        { label: building.name },
      ]} />

      <div className={styles.header}>
        <Button variant="outline" onClick={() => navigate('/buildings')}>← Back</Button>
      </div>

      <Card padding="lg" className={styles.infoCard}>
        <div className={styles.buildingHeader}>
          <div className={styles.buildingIcon}><Building2 size={28} /></div>
          <div className={styles.buildingInfo}>
            <h1 className={styles.buildingName}>{building.name}</h1>
            {building.address && (
              <p className={styles.buildingAddress}><MapPin size={14} style={{ marginRight: 4, verticalAlign: 'middle' }} />{building.address}</p>
            )}
          </div>
          <div className={styles.buildingActions}>
            <Button variant="outline" onClick={() => setFormOpen(true)}>Edit</Button>
            <Button variant="danger" onClick={handleDelete} loading={deleteBuilding.isPending}>Delete</Button>
          </div>
        </div>

        {building.metadata && (
          <div className={styles.metadata}>
            {building.metadata.total_area && (
              <div className={styles.metadataItem}>
                <span className={styles.metadataLabel}>Total Area</span>
                <span className={styles.metadataValue}>{building.metadata.total_area} m²</span>
              </div>
            )}
            {building.metadata.construction_year && (
              <div className={styles.metadataItem}>
                <span className={styles.metadataLabel}>Construction Year</span>
                <span className={styles.metadataValue}>{building.metadata.construction_year}</span>
              </div>
            )}
            <div className={styles.metadataItem}>
              <span className={styles.metadataLabel}>Floors</span>
              <span className={styles.metadataValue}>{floors.length}</span>
            </div>
          </div>
        )}
      </Card>

      <div className={styles.statsGrid}>
        <Card padding="lg">
          <div className={styles.stat}>
            <div className={styles.statIcon}><Package size={22} /></div>
            <div className={styles.statContent}>
              <p className={styles.statLabel}>Total Assets</p>
              <p className={styles.statValue}>{assets.length}</p>
            </div>
          </div>
        </Card>
        <Card padding="lg">
          <div className={styles.stat}>
            <div className={styles.statIcon}><CheckCircle size={22} /></div>
            <div className={styles.statContent}>
              <p className={styles.statLabel}>ITSM Managed</p>
              <p className={styles.statValue}>{itsmManagedCount}</p>
            </div>
          </div>
        </Card>
        <Card padding="lg">
          <div className={styles.stat}>
            <div className={styles.statIcon}><Users size={22} /></div>
            <div className={styles.statContent}>
              <p className={styles.statLabel}>Assigned</p>
              <p className={styles.statValue}>{assignedCount}</p>
            </div>
          </div>
        </Card>
        <Card padding="lg">
          <div className={styles.stat}>
            <div className={styles.statIcon}><FileText size={22} /></div>
            <div className={styles.statContent}>
              <p className={styles.statLabel}>Manual</p>
              <p className={styles.statValue}>{assets.length - itsmManagedCount}</p>
            </div>
          </div>
        </Card>
      </div>

      <Card padding="lg">
        <div className={styles.sectionHeader}>
          <h2>Floors</h2>
          <Button variant="outline" onClick={() => { setEditingFloor(null); setFloorFormOpen(true); }}>+ Add Floor</Button>
        </div>
        {floors.length > 0 ? (
          <div className={styles.floorsList}>
            {floors.map(floor => (
              <div key={floor._id} className={styles.floorItem} onClick={() => navigate(`/floors/${floor._id}`)}>
                <div className={styles.floorIcon}><LayoutGrid size={20} /></div>
                <div className={styles.floorInfo}>
                  <h4 className={styles.floorName}>{floor.name}</h4>
                  <p className={styles.floorDetails}>
                    Level: {floor.floor_number}
                    {floor.metadata?.area && ` • ${floor.metadata.area} m²`}
                    {floor.metadata?.ceiling_height && ` • Height: ${floor.metadata.ceiling_height}m`}
                  </p>
                </div>
                <div className={styles.floorActions}>
                  <Button variant="outline" size="sm" onClick={e => handleEditFloor(floor, e)}>Edit</Button>
                  <Button variant="danger" size="sm" onClick={e => handleDeleteFloor(floor, e)}>Delete</Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className={styles.emptyFloors}>
            <p>No floors found in this building</p>
            <Button variant="outline" onClick={() => { setEditingFloor(null); setFloorFormOpen(true); }}>+ Add First Floor</Button>
          </div>
        )}
      </Card>

      <Card padding="lg">
        <div className={styles.sectionHeader}>
          <h2>Assets in this Building</h2>
          <Button variant="primary" onClick={() => setAssetFormOpen(true)}>+ Add Asset</Button>
        </div>
        {assets.length > 0 ? (
          <div className={styles.assetsList}>
            {assets.map(asset => (
              <div key={asset._id} className={styles.assetItem} onClick={() => navigate(`/assets/${asset._id}`)}>
                <div className={styles.assetIcon}><Monitor size={20} /></div>
                <div className={styles.assetInfo}>
                  <h4 className={styles.assetName}>{asset.basic_info?.display_name}</h4>
                  <p className={styles.assetDetails}>{asset.basic_info?.manufacturer} {asset.basic_info?.model}</p>
                  {asset.assigned_person && (
                    <p className={styles.assetPerson}>{asset.assigned_person.full_name}</p>
                  )}
                </div>
                <div className={styles.assetBadge}>
                  <Badge variant={asset.itsm?.is_managed ? 'success' : 'neutral'}>
                    {asset.itsm?.is_managed ? 'ITSM' : 'Manual'}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className={styles.emptyAssets}>
            <p>No assets found in this building</p>
            <Button variant="primary" onClick={() => setAssetFormOpen(true)}>+ Add First Asset</Button>
          </div>
        )}
      </Card>

      <BuildingFormModal
        isOpen={formOpen}
        onClose={() => setFormOpen(false)}
        onSuccess={() => setFormOpen(false)}
        building={building}
      />

      <ConfirmDialog
        isOpen={deleteDialogOpen}
        onClose={() => setDeleteDialogOpen(false)}
        onConfirm={confirmDelete}
        title="Delete Building"
        message={`Are you sure you want to delete "${building?.name}"? This action cannot be undone.`}
        confirmText="Delete"
        loading={deleteBuilding.isPending}
        variant="danger"
      />

      <AssetFormModal
        isOpen={assetFormOpen}
        onClose={() => setAssetFormOpen(false)}
        onSuccess={() => setAssetFormOpen(false)}
        defaultBuildingId={id}
      />

      <FloorFormModal
        isOpen={floorFormOpen}
        onClose={() => setFloorFormOpen(false)}
        onSuccess={() => { refetchFloors(); setFloorFormOpen(false); }}
        buildingId={id || ''}
        floor={editingFloor}
      />

      <ConfirmDialog
        isOpen={deleteFloorDialogOpen}
        onClose={() => setDeleteFloorDialogOpen(false)}
        onConfirm={confirmDeleteFloor}
        title="Delete Floor"
        message={`Are you sure you want to delete "${deletingFloor?.name}"? This action cannot be undone.`}
        confirmText="Delete"
        loading={deleteFloor.isPending}
        variant="danger"
      />
    </div>
  );
};

export default BuildingDetails;
