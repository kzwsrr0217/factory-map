import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { assetService, Asset } from '../../services/asset.service';

export const assetKeys = {
  all: ['assets'] as const,
  stats: ['assets', 'stats'] as const,
  byFloor: (floorId: string) => ['assets', 'floor', floorId] as const,
  byBuilding: (buildingId: string) => ['assets', 'building', buildingId] as const,
  unplaced: ['assets', 'unplaced'] as const,
  detail: (id: string) => ['assets', id] as const,
  history: (id: string) => ['assets', id, 'history'] as const,
};

export function useAssets() {
  return useQuery({
    queryKey: assetKeys.all,
    queryFn: () => assetService.getAssets(),
  });
}

/**
 * The survey backlog: devices not standing on any floor plan yet. Filtered by the
 * server — the Unplaced Assets page used to fetch every asset and keep the unplaced
 * ones, which today is 1054 rows out of 1057 but will not stay that way.
 */
export function useUnplacedAssets() {
  return useQuery({
    queryKey: ['assets', 'unplaced'] as const,
    queryFn: () => assetService.getUnplacedAssets(),
  });
}

/** One building's devices, filtered by the server rather than in the browser. */
export function useAssetsByBuilding(buildingId: string | undefined) {
  return useQuery({
    queryKey: ['assets', 'building', buildingId] as const,
    queryFn: () => assetService.getAssetsByBuilding(buildingId!),
    enabled: !!buildingId,
  });
}

/**
 * The Dashboard's numbers. Separate from useAssets on purpose: the list is capped
 * at 1000 rows and the counts must not be.
 */
export function useAssetStats() {
  return useQuery({
    queryKey: ['assets', 'stats'] as const,
    queryFn: assetService.getStats,
    staleTime: 60 * 1000,
  });
}

export function useOrphanedAssets() {
  return useQuery({
    queryKey: ['assets', 'orphaned'] as const,
    queryFn: assetService.getOrphanedAssets,
  });
}

export function useAssetsByFloor(floorId: string | undefined) {
  return useQuery({
    queryKey: assetKeys.byFloor(floorId!),
    queryFn: () => assetService.getAssetsByFloor(floorId!),
    enabled: !!floorId,
  });
}

export function useAsset(id: string | undefined) {
  return useQuery({
    queryKey: assetKeys.detail(id!),
    queryFn: () => assetService.getAsset(id!),
    enabled: !!id,
  });
}

export function useAssetHistory(id: string | undefined) {
  return useQuery({
    queryKey: assetKeys.history(id!),
    queryFn: () => assetService.getAssetHistory(id!),
    enabled: !!id,
  });
}

export function useCreateAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<Asset>) => assetService.createAsset(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: assetKeys.all }),
  });
}

export function useUpdateAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Asset> }) =>
      assetService.updateAsset(id, data),
    onSuccess: (_asset, { id }) => {
      qc.invalidateQueries({ queryKey: assetKeys.detail(id) });
      qc.invalidateQueries({ queryKey: assetKeys.all });
    },
  });
}

export function useDeleteAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => assetService.deleteAsset(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: assetKeys.all }),
  });
}
