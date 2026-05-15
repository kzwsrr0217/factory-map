/**
 * UnplacedAssets.tsx — List of assets not yet placed on any floor map ("/unplaced").
 *
 * Fetches all assets where `map_coordinates` is null and groups them by
 * building (unknown building if `building_id` is not set). Provides a "Place
 * on Map" button per asset that navigates to the asset's floor in FloorDetails
 * with deploy mode enabled so the user can click the canvas to place it.
 *
 * Assets without a floor assignment are listed under a dedicated "No Floor
 * Assigned" group, reminding the operator to edit the asset's location first.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MapPin, Monitor } from 'lucide-react';
import Card from '../components/common/Card';
import Button from '../components/common/Button';
import Badge from '../components/common/Badge';
import { assetService, Asset } from '../services/asset.service';
import { hierarchyService, Building } from '../services/hierarchy.service';
import { floorService, Floor } from '../services/floor.service';
import { getAssetIcon } from '../utils/assetTypes';
import { useToast } from '../contexts/ToastContext';
import styles from '../styles/pages/UnplacedAssets.module.css';

interface GroupedEntry {
  building: Building | null;
  floor: Floor | null;
  assets: Asset[];
}

const UnplacedAssets: React.FC = () => {
  const navigate = useNavigate();
  const toast = useToast();
  const [assets, setAssets] = useState<Asset[]>([]);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [floors, setFloors] = useState<Floor[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [allAssets, allBuildings, allFloors] = await Promise.all([
        assetService.getAssets(),
        hierarchyService.getBuildings(),
        floorService.getFloors(),
      ]);
      setAssets(allAssets.filter(a => !a.is_placed));
      setBuildings(allBuildings);
      setFloors(allFloors);
    } catch {
      toast.error('Failed to load unplaced assets');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const grouped: GroupedEntry[] = React.useMemo(() => {
    const map = new Map<string, Asset[]>();

    assets.forEach(asset => {
      const key = `${asset.hierarchy.building_id ?? ''}::${asset.hierarchy.floor_id ?? ''}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(asset);
    });

    return Array.from(map.entries()).map(([key, groupAssets]) => {
      const [bid, fid] = key.split('::');
      return {
        building: buildings.find(b => b._id === bid) ?? null,
        floor: floors.find(f => f._id === fid) ?? null,
        assets: groupAssets,
      };
    }).sort((a, b) => {
      const aName = `${a.building?.name ?? 'z'}${a.floor?.name ?? 'z'}`;
      const bName = `${b.building?.name ?? 'z'}${b.floor?.name ?? 'z'}`;
      return aName.localeCompare(bName);
    });
  }, [assets, buildings, floors]);

  if (loading) {
    return (
      <div className={styles.page}>
        <div className={styles.header}>
          <h1>Unplaced Assets</h1>
        </div>
        <div className={styles.loading}>Loading…</div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1>Unplaced Assets</h1>
          <p className={styles.subtitle}>
            {assets.length} asset{assets.length !== 1 ? 's' : ''} without map coordinates — open the floor map to place them
          </p>
        </div>
        <Button variant="outline" onClick={loadData}>Refresh</Button>
      </div>

      {assets.length === 0 ? (
        <Card padding="lg">
          <div className={styles.empty}>
            <MapPin size={40} style={{ color: 'var(--color-gray-300)', marginBottom: 12 }} />
            <h3>All assets are placed</h3>
            <p>Every asset has map coordinates. Great job!</p>
          </div>
        </Card>
      ) : (
        <div className={styles.groups}>
          {grouped.map(({ building, floor, assets: groupAssets }) => (
            <Card key={`${building?._id}-${floor?._id}`} padding="lg">
              <div className={styles.groupHeader}>
                <div>
                  <h2 className={styles.groupTitle}>
                    {building?.name ?? 'No Building'}
                    {floor && <span className={styles.groupFloor}> — {floor.name}</span>}
                  </h2>
                  <p className={styles.groupCount}>{groupAssets.length} unplaced</p>
                </div>
                {floor && (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => navigate(`/floors/${floor._id}`)}
                  >
                    <MapPin size={13} style={{ marginRight: 5 }} />
                    Open Floor Map
                  </Button>
                )}
              </div>

              <div className={styles.assetList}>
                {groupAssets.map(asset => (
                  <div
                    key={asset._id}
                    className={styles.assetRow}
                    onClick={() => navigate(`/assets/${asset._id}`)}
                  >
                    <span className={styles.assetIcon}>{getAssetIcon(asset.basic_info.type)}</span>
                    <div className={styles.assetInfo}>
                      <span className={styles.assetName}>{asset.basic_info.display_name}</span>
                      {asset.custom_fields?.object_id && (
                        <span className={styles.assetObjectId}>{asset.custom_fields.object_id}</span>
                      )}
                      {asset.basic_info.manufacturer && (
                        <span className={styles.assetMeta}>
                          {asset.basic_info.manufacturer} {asset.basic_info.model}
                        </span>
                      )}
                    </div>
                    <div className={styles.assetBadges}>
                      {asset.itsm?.is_managed && <Badge variant="info">ITSM</Badge>}
                      <Badge variant={
                        asset.basic_info.status === 'active' ? 'success' :
                        asset.basic_info.status === 'maintenance' ? 'warning' :
                        asset.basic_info.status === 'retired' ? 'neutral' : 'neutral'
                      }>
                        {asset.basic_info.status || 'unknown'}
                      </Badge>
                    </div>
                    <Monitor size={14} className={styles.assetArrow} />
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default UnplacedAssets;
