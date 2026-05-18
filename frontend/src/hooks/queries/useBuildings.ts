import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { hierarchyService, Building } from '../../services/hierarchy.service';

export const buildingKeys = {
  all: ['buildings'] as const,
  detail: (id: string) => ['buildings', id] as const,
};

const STALE_5MIN = 5 * 60 * 1000;

export function useBuildings() {
  return useQuery({
    queryKey: buildingKeys.all,
    queryFn: hierarchyService.getBuildings,
    staleTime: STALE_5MIN,
  });
}

export function useBuilding(id: string | undefined) {
  return useQuery({
    queryKey: buildingKeys.detail(id!),
    queryFn: () => hierarchyService.getBuilding(id!),
    enabled: !!id,
    staleTime: STALE_5MIN,
  });
}

export function useCreateBuilding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<Building>) => hierarchyService.createBuilding(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: buildingKeys.all }),
  });
}

export function useUpdateBuilding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Building> }) =>
      hierarchyService.updateBuilding(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: buildingKeys.all }),
  });
}

export function useDeleteBuilding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => hierarchyService.deleteBuilding(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: buildingKeys.all }),
  });
}
