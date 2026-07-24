/**
 * OrphanedAssets.tsx — List of assets whose IFS/CMDB master data no longer
 * resolves ("/orphaned"). See backend/src/entities/MasterAsset.entity.ts:
 * an asset's `master_ifs_id` is a soft join (no FK/cascade) — if the
 * referenced master_assets row disappears on a re-import (or was removed),
 * the asset itself is never deleted, it just stops resolving. This page
 * surfaces those cases so they can be reviewed instead of silently sitting
 * in the AssetDetailsModal's "Master data unavailable" section.
 *
 * Mirrors UnplacedAssets.tsx's grouped-by-building layout.
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, Monitor } from 'lucide-react';
import Card from '../components/common/Card';
import Button from '../components/common/Button';
import Badge from '../components/common/Badge';
import { Asset } from '../services/asset.service';
import { Building } from '../services/hierarchy.service';
import { getAssetIcon } from '../utils/assetTypes';
import { useOrphanedAssets } from '../hooks/queries/useAssets';
import { useBuildings } from '../hooks/queries/useBuildings';
import styles from '../styles/pages/UnplacedAssets.module.css';

interface GroupedEntry {
  building: Building | null;
  assets: Asset[];
}

const OrphanedAssets: React.FC = () => {
  const navigate = useNavigate();
  const { data: assets = [], isLoading: loadingAssets, refetch } = useOrphanedAssets();
  const { data: buildings = [], isLoading: loadingBuildings } = useBuildings();
  const loading = loadingAssets || loadingBuildings;

  const grouped: GroupedEntry[] = React.useMemo(() => {
    const map = new Map<string, Asset[]>();
    assets.forEach(asset => {
      const key = asset.hierarchy.building_id ?? '';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(asset);
    });
    return Array.from(map.entries()).map(([bid, groupAssets]) => ({
      building: buildings.find(b => b._id === bid) ?? null,
      assets: groupAssets,
    })).sort((a, b) => (a.building?.name ?? 'z').localeCompare(b.building?.name ?? 'z'));
  }, [assets, buildings]);

  if (loading) {
    return (
      <div className={styles.page}>
        <div className={styles.header}>
          <h1>Orphaned Assets</h1>
        </div>
        <div className={styles.loading}>Loading…</div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1>Orphaned Assets</h1>
          <p className={styles.subtitle}>
            {assets.length} asset{assets.length !== 1 ? 's' : ''} reference IFS/CMDB master data that no longer resolves
          </p>
        </div>
        <Button variant="outline" onClick={() => refetch()}>Refresh</Button>
      </div>

      {assets.length === 0 ? (
        <Card padding="lg">
          <div className={styles.empty}>
            <AlertTriangle size={40} style={{ color: 'var(--color-gray-300)', marginBottom: 12 }} />
            <h3>No orphaned assets</h3>
            <p>Every asset with a master_ifs_id resolves to a real master-data row.</p>
          </div>
        </Card>
      ) : (
        <div className={styles.groups}>
          {grouped.map(({ building, assets: groupAssets }) => (
            <Card key={building?._id ?? 'none'} padding="lg">
              <div className={styles.groupHeader}>
                <div>
                  <h2 className={styles.groupTitle}>{building?.name ?? 'No Building'}</h2>
                  <p className={styles.groupCount}>{groupAssets.length} orphaned</p>
                </div>
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
                      <span className={styles.assetObjectId}>IFS ID: {asset.master_ifs_id}</span>
                    </div>
                    <div className={styles.assetBadges}>
                      <Badge variant="error">orphaned</Badge>
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

export default OrphanedAssets;
