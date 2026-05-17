import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { floorService, Floor } from '../../services/floor.service';

export const floorKeys = {
  all: ['floors'] as const,
  byBuilding: (buildingId: string) => ['floors', 'building', buildingId] as const,
  detail: (id: string) => ['floors', id] as const,
};

export function useFloors(buildingId?: string) {
  return useQuery({
    queryKey: buildingId ? floorKeys.byBuilding(buildingId) : floorKeys.all,
    queryFn: () => floorService.getFloors(buildingId),
  });
}

export function useFloor(id: string | undefined) {
  return useQuery({
    queryKey: floorKeys.detail(id!),
    queryFn: () => floorService.getFloor(id!),
    enabled: !!id,
  });
}

export function useCreateFloor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<Floor>) => floorService.createFloor(data),
    onSuccess: (_floor, vars) => {
      qc.invalidateQueries({ queryKey: floorKeys.all });
      if (vars.building_id) {
        qc.invalidateQueries({ queryKey: floorKeys.byBuilding(vars.building_id) });
      }
    },
  });
}

export function useUpdateFloor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Floor> }) =>
      floorService.updateFloor(id, data),
    onSuccess: (_floor, { id }) => {
      qc.invalidateQueries({ queryKey: floorKeys.detail(id) });
      qc.invalidateQueries({ queryKey: floorKeys.all });
    },
  });
}

export function useDeleteFloor() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => floorService.deleteFloor(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: floorKeys.all }),
  });
}
