import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { assetService, Asset } from '../../services/asset.service';

export const assetKeys = {
  all: ['assets'] as const,
  byFloor: (floorId: string) => ['assets', 'floor', floorId] as const,
  detail: (id: string) => ['assets', id] as const,
  history: (id: string) => ['assets', id, 'history'] as const,
};

export function useAssets() {
  return useQuery({
    queryKey: assetKeys.all,
    queryFn: assetService.getAssets,
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
