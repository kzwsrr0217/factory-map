import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { zoneService, Zone } from '../../services/zone.service';
import { workareaKeys } from './useWorkareas';

export const zoneKeys = {
  all: ['zones'] as const,
  byFloor: (floorId: string) => ['zones', 'floor', floorId] as const,
};

export function useZones(floorId?: string) {
  return useQuery({
    queryKey: floorId ? zoneKeys.byFloor(floorId) : zoneKeys.all,
    queryFn: () => zoneService.getZones(floorId),
    staleTime: 2 * 60 * 1000,
  });
}

export function useCreateZone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { floor_id: string; name: string; color?: string | null }) => zoneService.createZone(data),
    onSuccess: (_z, vars) => {
      qc.invalidateQueries({ queryKey: zoneKeys.all });
      qc.invalidateQueries({ queryKey: zoneKeys.byFloor(vars.floor_id) });
    },
  });
}

export function useUpdateZone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Pick<Zone, 'name' | 'color' | 'description'>> }) =>
      zoneService.updateZone(id, data),
    // Work areas carry a denormalised copy of the zone's name/colour for the
    // map, so renaming or recolouring a zone invalidates them too.
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: zoneKeys.all });
      qc.invalidateQueries({ queryKey: workareaKeys.all });
    },
  });
}

export function useDeleteZone() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => zoneService.deleteZone(id),
    // Deleting a zone ungroups its rooms, so their zone_id changed.
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: zoneKeys.all });
      qc.invalidateQueries({ queryKey: workareaKeys.all });
    },
  });
}
