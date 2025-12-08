import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Card from '../components/common/Card';
import Button from '../components/common/Button';
import BuildingFormModal from '../components/building/BuildingFormModal';
import { hierarchyService, Building } from '../services/hierarchy.service';
import styles from '../styles/pages/Buildings.module.css';

const Buildings: React.FC = () => {
  const navigate = useNavigate();
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);  // ← ÚJ
  const [editingBuilding, setEditingBuilding] = useState<Building | null>(null);  // ← ÚJ

  useEffect(() => {
    loadBuildings();
  }, []);

  const loadBuildings = async () => {
    try {
      setLoading(true);
      const data = await hierarchyService.getBuildings();
      setBuildings(data);
    } catch (error) {
      console.error('Error loading buildings:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAddClick = () => {  // ← ÚJ
    setEditingBuilding(null);
    setFormOpen(true);
  };

  const handleFormSuccess = () => {  // ← ÚJ
    loadBuildings();
  };

  if (loading) {
    return (
      <div className={styles.loading}>
        <div className={styles.spinner}></div>
        <p>Loading buildings...</p>
      </div>
    );
  }

  return (
    <div className={styles.buildings}>
      <div className={styles.header}>
        <div>
          <h1>Buildings</h1>
          <p className={styles.subtitle}>Manage your factory buildings and locations</p>
        </div>
        <Button variant="primary" onClick={handleAddClick}>
          + Add Building
        </Button>
      </div>

      <div className={styles.grid}>
        {buildings.map((building) => (
          <Card
            key={building._id}
            padding="lg"
            hoverable
            onClick={() => navigate(`/buildings/${building._id}`)}
          >
            <div className={styles.buildingCard}>
              <div className={styles.buildingIcon}>🏢</div>
              <div className={styles.buildingInfo}>
                <h3 className={styles.buildingName}>{building.name}</h3>
                {building.address && (
                  <p className={styles.buildingAddress}>📍 {building.address}</p>
                )}
                {building.metadata?.total_area && (
                  <p className={styles.buildingMeta}>
                    📐 {building.metadata.total_area} m²
                  </p>
                )}
                {building.metadata?.construction_year && (
                  <p className={styles.buildingMeta}>
                    🏗️ Built in {building.metadata.construction_year}
                  </p>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>

      {buildings.length === 0 && (
        <Card padding="lg">
          <div className={styles.empty}>
            <div className={styles.emptyIcon}>🏢</div>
            <h3>No buildings found</h3>
            <p>Get started by adding your first building</p>
            <Button variant="primary" onClick={handleAddClick}>
              + Add Building
            </Button>
          </div>
        </Card>
      )}

      {/* Building Form Modal */}
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