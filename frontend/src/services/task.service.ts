/**
 * task.service.ts — The derived normalisation task list.
 *
 * The rows come from the generator (backend: services/itsm/taskGenerator.ts), so this
 * service only reads them and carries the four things a person may do to one: take it,
 * note something, close it, dismiss it with a reason.
 *
 * `machine_verifiable` comes from the server rather than being decided here, so the rule
 * about who may close a task lives in one place.
 */
import api from './api';

export type NormalisationTaskKind =
  | 'link-to-itsm'
  | 'decide-match'
  | 'register-in-itsm'
  | 'identify-device'
  | 'label-device'
  | 'check-hwa'
  | 'verify-disposal'
  | 'resolve-field-differences';

export type NormalisationTaskState = 'open' | 'done' | 'dismissed';

export interface NormalisationTask {
  _id: string;
  kind: NormalisationTaskKind;
  asset_id: string | null;
  itsm_id: string | null;
  summary: string;
  /** Why the generator raised it, as it was when last derived. */
  evidence: string | null;
  state: NormalisationTaskState;
  assigned_to: string | null;
  note: string | null;
  closed_by: string | null;
  closed_at: string | null;
  first_seen_at: string;
  last_seen_at: string;
  /** False only for `label-device`: nothing in any export records that a sticker went on. */
  machine_verifiable: boolean;
}

export interface TaskSummary {
  by_kind: Record<string, Partial<Record<NormalisationTaskState, number>>>;
  by_state: Record<NormalisationTaskState, number>;
  open_unassigned: number;
  /** True when nothing is outstanding — the definition of done for the inventory. */
  consistent: boolean;
}

export interface TaskQuery {
  state?: NormalisationTaskState;
  kind?: NormalisationTaskKind;
  /** A username, or `__unassigned__`. */
  assigned_to?: string;
  q?: string;
  page?: number;
  limit?: number;
}

export const taskService = {
  getTasks: async (query: TaskQuery = {}): Promise<{ tasks: NormalisationTask[]; total: number; totalPages: number }> => {
    const response = await api.get('/tasks', { params: query });
    return {
      tasks: response.data.data as NormalisationTask[],
      total: response.data.meta?.total ?? 0,
      totalPages: response.data.meta?.totalPages ?? 1,
    };
  },

  getSummary: async (): Promise<TaskSummary> => {
    const response = await api.get('/tasks/summary');
    return response.data.data as TaskSummary;
  },

  /**
   * Returns the updated task and, when the server has something to say about it, a note —
   * ticking a data-checked task warns that the next generation will reopen it if the
   * cause is still there.
   */
  updateTask: async (
    id: string,
    changes: { state?: NormalisationTaskState; assigned_to?: string | null; note?: string | null },
  ): Promise<{ task: NormalisationTask; note?: string }> => {
    const response = await api.patch(`/tasks/${id}`, changes);
    return { task: response.data.data as NormalisationTask, note: response.data.meta?.note };
  },

  /** Re-derives the list. Run after importing a new ITSM export. */
  generate: async (): Promise<{ created: number; reopened: number; unchanged: number; closed: number; awaiting_human: number }> => {
    const response = await api.post('/tasks/generate', {});
    return response.data.data;
  },
};
