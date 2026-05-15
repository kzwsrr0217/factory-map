/**
 * useAssets.ts — React hook for loading assets with optional floor filtering.
 *
 * Fetches assets on mount and whenever `floorId` or the internal `tick` counter
 * changes. The `reload()` function increments `tick` to trigger a re-fetch without
 * changing the filter — useful after creating, updating, or deleting an asset.
 *
 * Cancellation: sets a `cancelled` flag before unmounting to prevent stale state
 * updates if the component unmounts while a fetch is in-flight.
 *
 * @param options.floorId — If provided, fetches only assets on that floor;
 *   otherwise fetches all assets.
 */
import { useState, useEffect, useCallback } from 'react';
import { assetService, Asset } from '../services/asset.service';

interface UseAssetsOptions {
  floorId?: string;
}

interface UseAssetsResult {
  assets: Asset[];
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export const useAssets = (options: UseAssetsOptions = {}): UseAssetsResult => {
  const { floorId } = options;
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const fetch = floorId
      ? assetService.getAssetsByFloor(floorId)
      : assetService.getAssets();

    fetch
      .then((data) => { if (!cancelled) setAssets(data); })
      .catch((err) => { if (!cancelled) setError(err?.message ?? 'Failed to load assets'); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [floorId, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  return { assets, loading, error, reload };
};
