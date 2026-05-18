import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { workareaService, WorkArea } from '../../services/workarea.service';

export const workareaKeys = {
  all: ['workareas'] as const,
  byFloor: (floorId: string) => ['workareas', 'floor', floorId] as const,
  detail: (id: string) => ['workareas', id] as const,
};

export function useWorkareas(floorId?: string) {
  return useQuery({
    queryKey: floorId ? workareaKeys.byFloor(floorId) : workareaKeys.all,
    queryFn: () => workareaService.getWorkAreas(floorId),
    staleTime: 2 * 60 * 1000,
  });
}

export function useCreateWorkarea() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<WorkArea>) => workareaService.createWorkArea(data),
    onSuccess: (_wa, vars) => {
      qc.invalidateQueries({ queryKey: workareaKeys.all });
      if (vars.floor_id) {
        qc.invalidateQueries({ queryKey: workareaKeys.byFloor(vars.floor_id) });
      }
    },
  });
}

export function useUpdateWorkarea() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<WorkArea> }) =>
      workareaService.updateWorkArea(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: workareaKeys.all }),
  });
}

export function useDeleteWorkarea() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => workareaService.deleteWorkArea(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: workareaKeys.all }),
  });
}
