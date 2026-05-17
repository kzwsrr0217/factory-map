import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { alertService, AlertConfig, CreateScheduledAlertDto } from '../../services/alert.service';

export const alertKeys = {
  config: ['alerts', 'config'] as const,
  logs: (page: number) => ['alerts', 'logs', page] as const,
  scheduled: ['alerts', 'scheduled'] as const,
};

export function useAlertConfig() {
  return useQuery({
    queryKey: alertKeys.config,
    queryFn: alertService.getConfig,
  });
}

export function useAlertLogs(page = 1) {
  return useQuery({
    queryKey: alertKeys.logs(page),
    queryFn: () => alertService.getLogs(page),
  });
}

export function useScheduledAlerts() {
  return useQuery({
    queryKey: alertKeys.scheduled,
    queryFn: alertService.getScheduledAlerts,
  });
}

export function useSaveAlertConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: Partial<AlertConfig>) => alertService.saveConfig(dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: alertKeys.config }),
  });
}

export function useTestAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: alertService.testNow,
    onSuccess: () => qc.invalidateQueries({ queryKey: alertKeys.logs(1) }),
  });
}

export function useCreateScheduledAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (dto: CreateScheduledAlertDto) => alertService.createScheduledAlert(dto),
    onSuccess: () => qc.invalidateQueries({ queryKey: alertKeys.scheduled }),
  });
}

export function useDeleteScheduledAlert() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => alertService.deleteScheduledAlert(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: alertKeys.scheduled }),
  });
}
