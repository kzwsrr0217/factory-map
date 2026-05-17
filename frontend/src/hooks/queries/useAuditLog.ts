import { useQuery } from '@tanstack/react-query';
import { auditService, AuditQuery } from '../../services/audit.service';

export const auditKeys = {
  entries: (query: AuditQuery) => ['audit', query] as const,
};

export function useAuditLog(query: AuditQuery = {}) {
  return useQuery({
    queryKey: auditKeys.entries(query),
    queryFn: () => auditService.getEntries(query),
  });
}
