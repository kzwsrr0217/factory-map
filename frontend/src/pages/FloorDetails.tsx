import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Card from '../components/common/Card';
import Button from '../components/common/Button';
import Badge from '../components/common/Badge';
import { floorService, Floor } from '../services/floor.service';
import { workareaService, WorkArea } from '../services/workarea.service';
import { assetService, Asset } from '../services/asset.service';
import styles from '../styles/pages/FloorDetails.module.css';

const FloorDetails: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [floor, setFloor] = useState<Floor | null>(null);
  const [workareas, setWorkareas] = useState<WorkArea[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (id) {
      loadFloorDetails(id);
    }
  }, [id]);

  const loadFloorDetails = async (floorId: string) => {
    try {
      setLoading(true);
      const [floorData, workareasData, allAssets] = await Promise.all([
        floorService.getFloor(floorId),
        workareaService.getWorkAreas(floorId),
        assetService.getAssets(),
      ]);

      setFloor(floorData);
      setWorkareas(workareasData);

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
            <Button variant="outline" onClick={() => alert('Edit - Coming soon!')}>
              Edit
            </Button>
            <Button variant="danger" onClick={() => alert('Delete - Coming soon!')}>
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
              <span className={styles.metadataLabel}>Assets</span>
              <span className={styles.metadataValue}>{assets.length}</span>
            </div>
          </div>
        )}
      </Card>

      {/* Floor Plan Placeholder */}
      <Card padding="lg">
        <div className={styles.sectionHeader}>
          <h2>Floor Plan</h2>
          <Button variant="outline" onClick={() => alert('Upload map - Coming soon!')}>
            📤 Upload Map
          </Button>
        </div>
        <div className={styles.mapPlaceholder}>
          <div className={styles.mapIcon}>🗺️</div>
          <p>Floor plan visualization coming soon</p>
          <p className={styles.mapHint}>
            Interactive SVG map with asset positions will be displayed here
          </p>
        </div>
      </Card>

      {/* Work Areas Section */}
      <Card padding="lg">
        <div className={styles.sectionHeader}>
          <h2>Work Areas</h2>
          <Button variant="primary" onClick={() => alert('Add work area - Coming soon!')}>
            + Add Work Area
          </Button>
        </div>

        {workareas.length > 0 ? (
          <div className={styles.workareasList}>
            {workareas.map((workarea) => (
              <div
                key={workarea._id}
                className={styles.workareaItem}
                onClick={() => alert(`Work area: ${workarea.name}`)}
              >
                <div className={styles.workareaIcon}>🏭</div>
                <div className={styles.workareaInfo}>
                  <h4 className={styles.workareaName}>{workarea.name}</h4>
                  {workarea.type && (
                    <p className={styles.workareaDetails}>Type: {workarea.type}</p>
                  )}
                  {workarea.metadata?.capacity && (
                    <p className={styles.workareaDetails}>
                      Capacity: {workarea.metadata.capacity} people
                    </p>
                  )}
                </div>
                <Badge variant="info">
                  {/* Count sections/workstations later */}
                  View Details
                </Badge>
              </div>
            ))}
          </div>
        ) : (
          <div className={styles.emptyWorkareas}>
            <p>No work areas found on this floor</p>
            <Button
              variant="primary"
              onClick={() => alert('Add work area - Coming soon!')}
            >
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
    </div>
  );
};

export default FloorDetails;