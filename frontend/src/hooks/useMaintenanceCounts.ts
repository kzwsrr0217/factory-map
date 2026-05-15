import { useState, useEffect, useCallback } from 'react';
import api from '../services/api';

interface MaintenanceCounts {
  overdue: number;
  due_soon: number;
}

const POLL_INTERVAL = 5 * 60 * 1000; // 5 minutes

export function useMaintenanceCounts(): MaintenanceCounts {
  const [counts, setCounts] = useState<MaintenanceCounts>({ overdue: 0, due_soon: 0 });

  const fetch = useCallback(async () => {
    try {
      const res = await api.get<{ success: boolean; data: MaintenanceCounts }>('/assets/maintenance-counts');
      if (res.data.success) setCounts(res.data.data);
    } catch {
      // silently ignore — badge is non-critical
    }
  }, []);

  useEffect(() => {
    fetch();
    const id = setInterval(fetch, POLL_INTERVAL);
    return () => clearInterval(id);
  }, [fetch]);

  return counts;
}
