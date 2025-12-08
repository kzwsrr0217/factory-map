import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Card from '../components/common/Card';
import Button from '../components/common/Button';
import Badge from '../components/common/Badge';
import { hierarchyService, Building } from '../services/hierarchy.service';
import { assetService, Asset } from '../services/asset.service';
import styles from '../styles/pages/BuildingDetails.module.css';

const BuildingDetails: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [building, setBuilding] = useState<Building | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (id) {
      loadBuildingDetails(id);
    }
  }, [id]);

  const loadBuildingDetails = async (buildingId: string) => {
    try {
      setLoading(true);
      const [buildingData, allAssets] = await Promise.all([
        hierarchyService.getBuilding(buildingId),
        assetService.getAssets(),
      ]);

      setBuilding(buildingData);

      // Filter assets for this building
      const buildingAssets = allAssets.filter(
        (asset) => asset.hierarchy.building_id === buildingId
      );
      setAssets(buildingAssets);
    } catch (error) {
      console.error('Error loading building details:', error);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className={styles.loading}>
        <div className={styles.spinner}></div>
        <p>Loading building details...</p>
      </div>
    );
  }

  if (!building) {
    return (
      <Card padding="lg">
        <div className={styles.empty}>
          <h3>Building not found</h3>
          <Button variant="outline" onClick={() => navigate('/buildings')}>
            Back to Buildings
          </Button>
        </div>
      </Card>
    );
  }

  const itsmManagedCount = assets.filter((a) => a.itsm.is_managed).length;
  const assignedCount = assets.filter((a) => a.assigned_person).length;

  return (
    <div className={styles.buildingDetails}>
      {/* Header */}
      <div className={styles.header}>
        <Button variant="outline" onClick={() => navigate('/buildings')}>
          ← Back
        </Button>
      </div>

      {/* Building Info Card */}
      <Card padding="lg" className={styles.infoCard}>
        <div className={styles.buildingHeader}>
          <div className={styles.buildingIcon}>🏢</div>
          <div className={styles.buildingInfo}>
            <h1 className={styles.buildingName}>{building.name}</h1>
            {building.address && (
              <p className={styles.buildingAddress}>📍 {building.address}</p>
            )}
          </div>
          <div className={styles.buildingActions}>
            <Button variant="outline" onClick={() => alert('Edit - Coming soon!')}>
              Edit
            </Button>
            <Button variant="danger" onClick={() => alert('Delete - Coming soon!')}>
              Delete
            </Button>
          </div>
        </div>

        {/* Metadata */}
        {building.metadata && (
          <div className={styles.metadata}>
            {building.metadata.total_area && (
              <div className={styles.metadataItem}>
                <span className={styles.metadataLabel}>Total Area</span>
                <span className={styles.metadataValue}>
                  {building.metadata.total_area} m²
                </span>
              </div>
            )}
            {building.metadata.construction_year && (
              <div className={styles.metadataItem}>
                <span className={styles.metadataLabel}>Construction Year</span>
                <span className={styles.metadataValue}>
                  {building.metadata.construction_year}
                </span>
              </div>
            )}
          </div>
        )}
      </Card>

      {/* Stats Grid */}
      <div className={styles.statsGrid}>
        <Card padding="lg">
          <div className={styles.stat}>
            <div className={styles.statIcon}>📦</div>
            <div className={styles.statContent}>
              <p className={styles.statLabel}>Total Assets</p>
              <p className={styles.statValue}>{assets.length}</p>
            </div>
          </div>
        </Card>

        <Card padding="lg">
          <div className={styles.stat}>
            <div className={styles.statIcon}>✅</div>
            <div className={styles.statContent}>
              <p className={styles.statLabel}>ITSM Managed</p>
              <p className={styles.statValue}>{itsmManagedCount}</p>
            </div>
          </div>
        </Card>

        <Card padding="lg">
          <div className={styles.stat}>
            <div className={styles.statIcon}>👥</div>
            <div className={styles.statContent}>
              <p className={styles.statLabel}>Assigned</p>
              <p className={styles.statValue}>{assignedCount}</p>
            </div>
          </div>
        </Card>

        <Card padding="lg">
          <div className={styles.stat}>
            <div className={styles.statIcon}>📝</div>
            <div className={styles.statContent}>
              <p className={styles.statLabel}>Manual</p>
              <p className={styles.statValue}>{assets.length - itsmManagedCount}</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Assets List */}
      <Card padding="lg">
        <div className={styles.sectionHeader}>
          <h2>Assets in this Building</h2>
          <Button variant="primary" onClick={() => alert('Add asset - Coming soon!')}>
            + Add Asset
          </Button>
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
                  {asset.assigned_person && (
                    <p className={styles.assetPerson}>
                      👤 {asset.assigned_person.full_name}
                    </p>
                  )}
                </div>
                <div className={styles.assetBadge}>
                  <Badge variant={asset.itsm.is_managed ? 'success' : 'neutral'}>
                    {asset.itsm.is_managed ? 'ITSM' : 'Manual'}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className={styles.emptyAssets}>
            <p>No assets found in this building</p>
            <Button variant="primary" onClick={() => alert('Add asset - Coming soon!')}>
              + Add First Asset
            </Button>
          </div>
        )}
      </Card>

      {/* Placeholder for Floors */}
      <Card padding="lg">
        <div className={styles.sectionHeader}>
          <h2>Floors</h2>
          <Button variant="outline" onClick={() => alert('Add floor - Coming soon!')}>
            + Add Floor
          </Button>
        </div>
        <div className={styles.comingSoon}>
          <p>📐 Floor management coming soon...</p>
        </div>
      </Card>
    </div>
  );
};

export default BuildingDetails;