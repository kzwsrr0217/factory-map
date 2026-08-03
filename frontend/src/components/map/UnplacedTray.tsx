/**
 * UnplacedTray.tsx — Floor-map side tray for placing assets that have no map
 * position yet.
 *
 * Two pools feed it:
 *  - `unplacedAssets`: already assigned to THIS floor, listed outright.
 *  - `searchableUnplacedAssets`: assigned to no floor at all (e.g. bulk-created
 *    from the ITSM snapshot, which carries no floor-plan geometry). This pool
 *    runs to thousands of rows, so it's only surfaced via the search box and
 *    capped — placing one of these also assigns it to the current floor.
 *
 * Lives in its own component rather than inline in FloorMap because FloorMap
 * re-renders on every pan frame, wheel zoom and tooltip change; keeping the
 * search filtering here (behind useMemo, with the query as local state) means
 * a mousemove no longer re-filters a 1000+ row list.
 *
 * The query survives closing and reopening the tray: FloorMap unmounts this
 * component when the tray is collapsed, so the query is seeded from
 * `initialSearch` and reported back through `onSearchChange`. That callback
 * writes to a ref in FloorMap rather than state, so remembering the text costs
 * no re-render — which is the whole reason the search lives down here.
 */
import React, { useMemo, useState } from 'react';
import { Asset } from '../../services/asset.service';
import { getAssetIcon } from '../../utils/assetTypes';
import styles from '../../styles/components/FloorMap.module.css';

/** Max rows shown from the floor-less pool — it can be thousands. */
const GLOBAL_RESULT_LIMIT = 30;
const NAME_TRUNCATE_AT = 20;

interface UnplacedTrayProps {
  unplacedAssets: Asset[];
  searchableUnplacedAssets: Asset[];
  placingAssetId: string | null;
  /** Passed the asset to place, or null to cancel the current selection. */
  onSelect: (asset: Asset | null) => void;
  onClose: () => void;
  /** Query to start from — what was typed before the tray was last closed. */
  initialSearch?: string;
  /** Must not trigger a re-render in the parent; see the file header. */
  onSearchChange?: (query: string) => void;
}

/** Fields a tray search looks at, cheapest/most likely first. */
function assetFields(asset: Asset): string[] {
  return [
    asset.basic_info.display_name,
    asset.basic_info.serial_number,
    asset.custom_fields?.object_id,
    asset.itsm?.hardware_asset_id,
  ].filter((v): v is string => !!v).map((v) => v.toLowerCase());
}

/**
 * Whether an asset matches, with every whitespace-separated term having to appear
 * in at least one field.
 *
 * The fields are checked individually rather than joined into one string. Joining
 * them inserted a space that was never in the data, so a query could match across
 * a field boundary — "1 SN" hitting a device named "PC-1" with serial "SN-9"
 * purely because the join produced "pc-1 sn-9". Per-term-per-field also makes
 * multi-word searches behave: "pc 9" now finds that device, where a single
 * substring search could not.
 */
function matchesQuery(asset: Asset, terms: string[]): boolean {
  if (terms.length === 0) return true;
  const fields = assetFields(asset);
  return terms.every((term) => fields.some((field) => field.includes(term)));
}

/** Filters to at most `limit` matches, stopping as soon as it has enough. */
function findMatches(assets: Asset[], terms: string[], limit = Infinity): Asset[] {
  const matches: Asset[] = [];
  for (const asset of assets) {
    if (!matchesQuery(asset, terms)) continue;
    matches.push(asset);
    if (matches.length >= limit) break;
  }
  return matches;
}

const UnplacedTray: React.FC<UnplacedTrayProps> = ({
  unplacedAssets,
  searchableUnplacedAssets,
  placingAssetId,
  onSelect,
  onClose,
  initialSearch = '',
  onSearchChange,
}) => {
  const [search, setSearch] = useState(initialSearch);
  const query = search.trim().toLowerCase();
  const terms = useMemo(() => query.split(/\s+/).filter(Boolean), [query]);

  const handleSearchChange = (value: string) => {
    setSearch(value);
    onSearchChange?.(value);
  };

  const floorMatches = useMemo(
    () => findMatches(unplacedAssets, terms),
    [unplacedAssets, terms],
  );
  // Only searched, never listed wholesale — see the file header.
  const globalMatches = useMemo(
    () => (terms.length > 0 ? findMatches(searchableUnplacedAssets, terms, GLOBAL_RESULT_LIMIT) : []),
    [searchableUnplacedAssets, terms],
  );

  const renderItem = (asset: Asset) => {
    const isPlacing = placingAssetId === asset._id;
    const name = asset.basic_info.display_name;
    return (
      <button
        key={asset._id}
        className={`${styles.unplacedItem} ${isPlacing ? styles.unplacedItemPlacing : ''}`}
        onClick={() => onSelect(isPlacing ? null : asset)}
        title={isPlacing ? 'Click on the map to place this asset (Esc to cancel)' : 'Click to select for placement'}
      >
        <span className={styles.unplacedItemIcon}>{getAssetIcon(asset.basic_info.type)}</span>
        <span className={styles.unplacedItemInfo}>
          <span className={styles.unplacedItemName}>
            {name.length > NAME_TRUNCATE_AT ? `${name.slice(0, NAME_TRUNCATE_AT - 2)}…` : name}
          </span>
          {asset.custom_fields?.object_id && (
            <span className={styles.unplacedItemId}>{asset.custom_fields.object_id}</span>
          )}
        </span>
        {isPlacing && <span className={styles.unplacedItemPlacingBadge}>📍</span>}
      </button>
    );
  };

  return (
    <div className={styles.unplacedTray}>
      <div className={styles.unplacedTrayHeader}>
        📦 Unplaced ({query ? `${floorMatches.length}/${unplacedAssets.length}` : unplacedAssets.length})
        <button className={styles.popoverClose} onClick={onClose}>✕</button>
      </div>
      {searchableUnplacedAssets.length > 0 && (
        <input
          className={styles.unplacedTraySearch}
          value={search}
          onChange={(e) => handleSearchChange(e.target.value)}
          placeholder={`Search ${searchableUnplacedAssets.length} unassigned assets…`}
        />
      )}
      <div className={styles.unplacedTrayList}>
        {floorMatches.map(renderItem)}
        {globalMatches.length > 0 && (
          <div className={styles.unplacedTrayDivider}>
            Not on this floor yet — placing assigns them here
          </div>
        )}
        {globalMatches.map(renderItem)}
        {query && floorMatches.length === 0 && globalMatches.length === 0 && (
          <div className={styles.unplacedTrayDivider}>No matches</div>
        )}
      </div>
    </div>
  );
};

export default UnplacedTray;
