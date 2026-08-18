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

/**
 * Mirrors `NormalisationTaskKind` in the backend entity. Two declarations of one union is a
 * duplication that can drift — and did: adding four kinds server-side left this list short, and
 * only the KINDS table on the page failing to compile caught it. Keep them in step.
 */
export type NormalisationTaskKind =
  | 'link-to-itsm'
  | 'decide-match'
  | 'register-in-itsm'
  | 'identify-device'
  | 'label-device'
  | 'check-hwa'
  | 'verify-disposal'
  | 'resolve-field-differences'
  | 'create-in-map'
  | 'confirm-primary-user'
  | 'dispose-replaced-machine'
  | 'correct-in-itsm';

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

/**
 * One task with the device and the place it is about — what the printable walking sheet and
 * the CSV both need, and what the task rows themselves do not carry.
 */
export interface WorksheetRow {
  task_id: string;
  kind: NormalisationTaskKind;
  state: NormalisationTaskState;
  summary: string;
  evidence: string | null;
  assigned_to: string | null;
  itsm_id: string | null;
  age_days: number;
  machine_verifiable: boolean;
  asset_id: string | null;
  device: string | null;
  asset_type: string | null;
  serial_number: string | null;
  hardware_asset_id: string | null;
  person: string | null;
  building: string | null;
  floor: string | null;
  zone: string | null;
  room: string | null;
}

export interface Worksheet {
  rows: WorksheetRow[];
  total: number;
  /** The server capped the list. Shown, never swallowed. */
  truncated: boolean;
  /** Tasks whose device has no room — they cannot be walked to. */
  without_place: number;
  generated_at: string;
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

  /**
   * The whole filtered list with device and place, unpaged — for the walking sheet and the
   * CSV. Unpaged on purpose: a worksheet that stops at page one is how a floor gets skipped.
   */
  getWorksheet: async (query: { state?: NormalisationTaskState; kind?: NormalisationTaskKind; assigned_to?: string } = {}): Promise<Worksheet> => {
    const params = new URLSearchParams();
    if (query.state) params.set('state', query.state);
    if (query.kind) params.set('kind', query.kind);
    if (query.assigned_to) params.set('assigned_to', query.assigned_to);
    const response = await api.get(`/tasks/worksheet?${params.toString()}`);
    return {
      rows: (response.data.data ?? []) as WorksheetRow[],
      total: response.data.meta?.total ?? 0,
      truncated: !!response.data.meta?.truncated,
      without_place: response.data.meta?.without_place ?? 0,
      generated_at: response.data.meta?.generated_at ?? new Date().toISOString(),
    };
  },

  /** Re-derives the list. Run after importing a new ITSM export. */
  generate: async (): Promise<{ created: number; reopened: number; unchanged: number; closed: number; awaiting_human: number }> => {
    const response = await api.post('/tasks/generate', {});
    return response.data.data;
  },
};
