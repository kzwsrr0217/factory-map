/**
 * Buildings.tsx — Buildings list page ("/buildings").
 *
 * Displays all buildings as cards with address, area, year, and floor count.
 * Provides create, edit, and delete actions via BuildingFormModal and
 * ConfirmDialog. Delete is guarded: buildings that contain floors cannot be
 * removed without first removing all floors (enforced by the backend).
 *
 * Uses an inline BuildingSkeleton (3 animated placeholder cards) while loading
 * to avoid layout shift. Navigates to BuildingDetails on card click.
 */
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, MapPin, SquareStack, Calendar, AlertTriangle, RefreshCw } from 'lucide-react';
import Card from '../components/common/Card';
import Button from '../components/common/Button';
import BuildingFormModal from '../components/building/BuildingFormModal';
import { hierarchyService, Building } from '../services/hierarchy.service';
import styles from '../styles/pages/Buildings.module.css';

const BuildingSkeleton: React.FC = () => (
  <Card padding="lg">
    <div className={styles.buildingCard}>
      <div className={`${styles.skeletonIcon} ${styles.skeleton}`} />
      <div className={styles.buildingInfo}>
        <div className={`${styles.skeletonTitle} ${styles.skeleton}`} />
        <div className={`${styles.skeletonLine} ${styles.skeleton}`} />
        <div className={`${styles.skeletonLineShort} ${styles.skeleton}`} />
      </div>
    </div>
  </Card>
);

const Buildings: React.FC = () => {
  const navigate = useNavigate();
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingBuilding, setEditingBuilding] = useState<Building | null>(null);

  useEffect(() => {
    loadBuildings();
  }, []);

  const loadBuildings = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await hierarchyService.getBuildings();
      setBuildings(data);
    } catch (err) {
      console.error('Error loading buildings:', err);
      setError('Failed to load buildings. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleAddClick = () => {
    setEditingBuilding(null);
    setFormOpen(true);
  };

  const handleFormSuccess = () => {
    loadBuildings();
  };

  return (
    <div className={styles.buildings}>
      <div className={styles.header}>
        <div>
          <h1>Buildings</h1>
          <p className={styles.subtitle}>Manage your factory buildings and locations</p>
        </div>
        <Button variant="primary" onClick={handleAddClick} disabled={loading}>
          + Add Building
        </Button>
      </div>

      {error && (
        <div className={styles.errorState}>
          <AlertTriangle size={20} />
          <span>{error}</span>
          <Button variant="outline" size="sm" onClick={loadBuildings}>
            <RefreshCw size={14} style={{ marginRight: 4 }} />
            Retry
          </Button>
        </div>
      )}

      {loading ? (
        <div className={styles.grid}>
          {[1, 2, 3, 4].map((i) => (
            <BuildingSkeleton key={i} />
          ))}
        </div>
      ) : !error && buildings.length === 0 ? (
        <Card padding="lg">
          <div className={styles.empty}>
            <Building2 size={56} className={styles.emptyIcon} />
            <h3>No buildings yet</h3>
            <p>Get started by adding your first factory building</p>
            <Button variant="primary" onClick={handleAddClick}>
              + Add First Building
            </Button>
          </div>
        </Card>
      ) : (
        <div className={styles.grid}>
          {buildings.map((building) => (
            <Card
              key={building._id}
              padding="lg"
              hoverable
              onClick={() => navigate(`/buildings/${building._id}`)}
            >
              <div className={styles.buildingCard}>
                <div className={styles.buildingIcon}>
                  <Building2 size={40} />
                </div>
                <div className={styles.buildingInfo}>
                  <h3 className={styles.buildingName}>{building.name}</h3>
                  {building.address && (
                    <p className={styles.buildingAddress}>
                      <MapPin size={13} style={{ marginRight: 4, flexShrink: 0 }} />
                      {building.address}
                    </p>
                  )}
                  {building.metadata?.total_area && (
                    <p className={styles.buildingMeta}>
                      <SquareStack size={13} style={{ marginRight: 4, flexShrink: 0 }} />
                      {building.metadata.total_area} m²
                    </p>
                  )}
                  {building.metadata?.construction_year && (
                    <p className={styles.buildingMeta}>
                      <Calendar size={13} style={{ marginRight: 4, flexShrink: 0 }} />
                      Built in {building.metadata.construction_year}
                    </p>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <BuildingFormModal
        isOpen={formOpen}
        onClose={() => setFormOpen(false)}
        onSuccess={handleFormSuccess}
        building={editingBuilding}
      />
    </div>
  );
};

export default Buildings;
