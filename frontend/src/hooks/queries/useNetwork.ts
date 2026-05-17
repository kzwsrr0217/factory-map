import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  networkService,
  NetworkRoom, NetworkRack, PatchPanel, WallPort,
} from '../../services/network.service';

export const networkKeys = {
  rooms: (params?: { building_id?: string; floor_id?: string; type?: string }) =>
    ['network', 'rooms', params ?? {}] as const,
  room: (id: string) => ['network', 'rooms', id] as const,
  racks: (roomId?: string) => ['network', 'racks', roomId ?? 'all'] as const,
  panels: (rackId?: string) => ['network', 'panels', rackId ?? 'all'] as const,
  wallports: (params?: { floor_id?: string; patch_panel_id?: string }) =>
    ['network', 'wallports', params ?? {}] as const,
};

export function useNetworkRooms(params?: { building_id?: string; floor_id?: string; type?: string }) {
  return useQuery({
    queryKey: networkKeys.rooms(params),
    queryFn: () => networkService.getRooms(params),
  });
}

export function useNetworkRoom(id: string | undefined) {
  return useQuery({
    queryKey: networkKeys.room(id!),
    queryFn: () => networkService.getRoom(id!),
    enabled: !!id,
  });
}

export function useNetworkRacks(roomId?: string) {
  return useQuery({
    queryKey: networkKeys.racks(roomId),
    queryFn: () => networkService.getRacks(roomId),
  });
}

export function usePatchPanels(rackId?: string) {
  return useQuery({
    queryKey: networkKeys.panels(rackId),
    queryFn: () => networkService.getPatchPanels(rackId),
  });
}

export function useWallPorts(params?: { floor_id?: string; patch_panel_id?: string }) {
  return useQuery({
    queryKey: networkKeys.wallports(params),
    queryFn: () => networkService.getWallPorts(params),
  });
}

// ── Mutations ────────────────────────────────────────────────────────────────

export function useCreateRoom() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<NetworkRoom>) => networkService.createRoom(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['network', 'rooms'] }),
  });
}

export function useUpdateRoom() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<NetworkRoom> }) =>
      networkService.updateRoom(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['network', 'rooms'] }),
  });
}

export function useDeleteRoom() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => networkService.deleteRoom(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['network', 'rooms'] }),
  });
}

export function useCreateRack() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<NetworkRack>) => networkService.createRack(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['network', 'racks'] }),
  });
}

export function useUpdateRack() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<NetworkRack> }) =>
      networkService.updateRack(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['network', 'racks'] }),
  });
}

export function useDeleteRack() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => networkService.deleteRack(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['network', 'racks'] }),
  });
}

export function useCreatePatchPanel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<PatchPanel>) => networkService.createPatchPanel(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['network', 'panels'] }),
  });
}

export function useUpdatePatchPanel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<PatchPanel> }) =>
      networkService.updatePatchPanel(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['network', 'panels'] }),
  });
}

export function useDeletePatchPanel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => networkService.deletePatchPanel(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['network', 'panels'] }),
  });
}

export function useCreateWallPort() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Partial<WallPort>) => networkService.createWallPort(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['network', 'wallports'] }),
  });
}

export function useUpdateWallPort() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<WallPort> }) =>
      networkService.updateWallPort(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['network', 'wallports'] }),
  });
}

export function useDeleteWallPort() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => networkService.deleteWallPort(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['network', 'wallports'] }),
  });
}
