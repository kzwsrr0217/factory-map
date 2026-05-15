/**
 * useHierarchy.ts — React hook that loads buildings and floors in parallel.
 *
 * Fetches both lists in a single `Promise.all` call to minimise latency. The
 * optional `buildingId` filter restricts floors to those belonging to a specific
 * building. When `buildingId` changes, the hook re-fetches automatically.
 *
 * The `reload()` function triggers a manual re-fetch, useful after creating or
 * deleting a building or floor.
 */
import { useState, useEffect, useCallback } from 'react';
import { hierarchyService, Building } from '../services/hierarchy.service';
import { floorService, Floor } from '../services/floor.service';

interface UseHierarchyOptions {
  buildingId?: string;
}

interface UseHierarchyResult {
  buildings: Building[];
  floors: Floor[];
  loading: boolean;
  error: string | null;
  reload: () => void;
}

export const useHierarchy = (options: UseHierarchyOptions = {}): UseHierarchyResult => {
  const { buildingId } = options;
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [floors, setFloors] = useState<Floor[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const promises: [Promise<Building[]>, Promise<Floor[]>] = [
      hierarchyService.getBuildings(),
      floorService.getFloors(buildingId),
    ];

    Promise.all(promises)
      .then(([b, f]) => {
        if (!cancelled) {
          setBuildings(b);
          setFloors(f);
        }
      })
      .catch((err) => { if (!cancelled) setError(err?.message ?? 'Failed to load hierarchy'); })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [buildingId, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  return { buildings, floors, loading, error, reload };
};
