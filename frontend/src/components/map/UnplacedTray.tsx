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
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Asset } from '../../services/asset.service';
import { getAssetIcon } from '../../utils/assetTypes';
import styles from '../../styles/components/FloorMap.module.css';

/** Max rows shown from the floor-less pool — it can be thousands. */
const GLOBAL_RESULT_LIMIT = 30;
/** Remembered across sessions; "off" is the only value that disables auto-advance. */
const KEEP_PLACING_KEY = 'map-keep-placing';
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
  /**
   * Called the first time someone searches, so the page can load the floor-less
   * pool then rather than on every visit to a floor. That pool is the whole
   * unplaced estate and is never listed — only searched.
   */
  onSearch?: () => void;
  /**
   * The device the map just placed. With "keep placing" on, the tray answers by
   * arming the next one in the list it is showing — see the effect below.
   */
  justPlacedId?: string | null;
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
  onSearch,
  justPlacedId = null,
}) => {
  const [search, setSearch] = useState(initialSearch);
  /**
   * Whether placing a device should arm the next one. On by default and remembered,
   * because the survey means placing a thousand devices: a trip back to the tray
   * between each is the single most repeated action of the next few weeks. The
   * placing banner always names what is armed, and Esc stops.
   */
  const [keepPlacing, setKeepPlacing] = useState(
    () => localStorage.getItem(KEEP_PLACING_KEY) !== 'off',
  );
  /** Placed since this tray was opened — the only progress signal the flow has. */
  const [placedCount, setPlacedCount] = useState(0);
  const query = search.trim().toLowerCase();
  const terms = useMemo(() => query.split(/\s+/).filter(Boolean), [query]);

  const handleSearchChange = (value: string) => {
    setSearch(value);
    onSearchChange?.(value);
    if (value.trim() !== '') onSearch?.();
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

  /**
   * Arm the next device after one is placed.
   *
   * "Next" is the one after the placed device in the list as displayed — floor
   * matches first, then the cross-floor search results — so it follows whatever
   * order and filter the person is working through. The placed device may still be
   * in the props for one render (the page updates its own state right after), so it
   * is excluded explicitly rather than waited for.
   */
  // Seeded with whatever is already set, so reopening the tray after a placement
  // doesn't read a stale id as a fresh one and arm a device nobody asked for.
  const advancedFor = useRef<string | null>(justPlacedId);
  useEffect(() => {
    if (!justPlacedId || advancedFor.current === justPlacedId) return;
    advancedFor.current = justPlacedId;
    setPlacedCount((n) => n + 1);
    if (!keepPlacing) return;

    const visible = [...floorMatches, ...globalMatches];
    const placedAt = visible.findIndex((a) => a._id === justPlacedId);
    const next = visible.slice(placedAt + 1).find((a) => a._id !== justPlacedId)
      // Wrapped: after the last one, carry on from the top with whatever is left
      // rather than stopping in the middle of a room.
      ?? visible.find((a) => a._id !== justPlacedId);
    if (next) onSelect(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [justPlacedId]);

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
        {placedCount > 0 && (
          <span className={styles.unplacedTrayPlaced}>{placedCount} placed</span>
        )}
        <button className={styles.popoverClose} onClick={onClose}>✕</button>
      </div>
      <label className={styles.unplacedTrayKeep}>
        <input
          type="checkbox"
          checked={keepPlacing}
          onChange={(e) => {
            setKeepPlacing(e.target.checked);
            localStorage.setItem(KEEP_PLACING_KEY, e.target.checked ? 'on' : 'off');
          }}
        />
        <span>Keep placing — arm the next device automatically</span>
      </label>
      {/* Always rendered. It used to appear only when the searchable pool was
          non-empty, which deadlocked once that pool became lazy: the pool loads on
          first search, and the box you search in only existed if the pool was
          already loaded. */}
      <input
        className={styles.unplacedTraySearch}
        value={search}
        onChange={(e) => handleSearchChange(e.target.value)}
        placeholder={searchableUnplacedAssets.length > 0
          ? `Search ${searchableUnplacedAssets.length} unassigned assets…`
          : 'Search assets with no floor yet…'}
      />
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
