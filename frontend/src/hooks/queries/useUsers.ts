import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api from '../../services/api';

export interface UserRecord {
  _id: string;
  username: string;
  email?: string;
  role: 'admin' | 'operator' | 'viewer';
  active: boolean;
  last_login?: string | null;
  failed_login_attempts?: number;
  locked_until?: string | null;
  password_changed_at?: string | null;
}

export const userKeys = {
  all: ['users'] as const,
};

async function fetchUsers(): Promise<UserRecord[]> {
  const res = await api.get<{ data: UserRecord[] } | UserRecord[]>('/users');
  const body = res.data as { data?: UserRecord[] };
  return body.data ?? (res.data as UserRecord[]);
}

export function useUsers(enabled = true) {
  return useQuery({
    queryKey: userKeys.all,
    queryFn: fetchUsers,
    enabled,
  });
}

export function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { username: string; email?: string; password: string; role: string }) =>
      api.post('/users', data).then(r => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: userKeys.all }),
  });
}

export function useUpdateUserRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, role }: { id: string; role: string }) =>
      api.patch(`/users/${id}/role`, { role }).then(r => r.data.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: userKeys.all }),
  });
}

export function useDeactivateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.patch(`/users/${id}/deactivate`).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: userKeys.all }),
  });
}

export function useActivateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.patch(`/users/${id}/activate`).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: userKeys.all }),
  });
}

export function useResetUserPassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, password }: { id: string; password: string }) =>
      api.post(`/users/${id}/reset-password`, { password }).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: userKeys.all }),
  });
}
