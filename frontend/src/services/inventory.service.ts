/**
 * inventory.service.ts — Handing the app the physical survey, and the names it needs.
 *
 * The survey file is read in the browser and only its rows are posted (see
 * InventoryImport.tsx). It records who uses which device, so it is Confidential; not
 * putting it on the server's disk beats remembering to delete it.
 */
import api from './api';

/** The walk-around tool's own row shape, passed through untouched. */
export interface SurveyRow {
  terulet?: string;
  epulet?: string;
  emelet?: string;
  helyszin?: string;
  work_area?: string;
  szemely?: string;
  megjegyzes?: string;
  azonosito_mod?: string;
  hwa?: string;
  eszkoz_tipus?: string;
  sorozatszam?: string;
  id?: string;
}

export type CorrectionScope = 'building' | 'floor' | 'helyszin' | 'work_area' | 'persons';

export interface SurveyImportPlan {
  parsed: number;
  hwa_rows: number;
  other_rows: number;
  to_update: number;
  to_create: number;
  /** Placed on a floor but in no room — findable on the map, not inside a rectangle. */
  no_room: number;
  unmatched_place: Array<{
    building: string;
    floor: string;
    rows: number;
    /** False means the floor name was never looked up — do not offer to correct it. */
    building_matched: boolean;
    building_suggestion: string | null;
    floor_suggestion: string | null;
  }>;
  missing_work_areas: Array<{
    where: string;
    zone_name: string;
    room_name: string;
    /** As the survey spelled it — what a correction has to be keyed on. */
    raw_room_name: string;
    rows: number;
    suggestion: string | null;
  }>;
  unmatched_persons: Array<{
    name: string;
    rows: number;
    suggestion: string | null;
    /**
     * Where a stored correction already sends this name. Its presence means the fix was
     * saved and the corrected name is still not in the ITSM export — a different situation
     * from "not corrected yet", and it used to look identical.
     */
    corrected_to: string | null;
  }>;
  /**
   * Identifiers that resolved to nothing. `kind` separates "an HWA number we do not have"
   * from "a device name we have never seen" — different problems, different next step.
   */
  unmatched_hwa: Array<{ hwa: string; note: string; kind: 'number' | 'name' | 'none' }>;
  /**
   * How the identifier column resolved. `hwa_prefixed` counts the rows where somebody wrote
   * the number without its prefix, `device_name` the older devices found by the name on
   * their asset tag.
   */
  matched_by: {
    hwa: number;
    hwa_prefixed: number;
    device_name: number;
    serial: number;
    /** Recognised by the survey row it came from — the only key some devices have. */
    survey_row: number;
  };
  /** Rows whose serial was `...`, `N/A` or similar — read as no serial, and counted. */
  placeholder_serials: number;
  /** New assets with neither an HWA nor a serial — they come back as "read a number off it". */
  create_without_serial: number;
  /**
   * Monitors the comment column attaches to a machine. The survey tool has no parent/child
   * field, so "this screen belongs to HWA16775" was written in prose; the app has the
   * relationship, so it becomes a link.
   */
  parent_links: {
    would_link: number;
    already_linked: number;
    parent_unknown: Array<{ hwa: string; rows: number }>;
    sample: Array<{ device: string; parent: string }>;
  };
  /** The same device recorded twice, once per value with a row count. */
  duplicates: Array<{ value: string; kind: 'identifier' | 'serial'; rows: number }>;
  create_sample: Array<{ display: string; asset_type: string; serial: string | null }>;
  created_areas: { zones: number; work_areas: number; duplicate_names: string[] } | null;
  applied: boolean;
}

export interface SurveyImportInput {
  rows: SurveyRow[];
  /** Not-yet-saved fixes, for this preview only. */
  corrections?: Partial<Record<CorrectionScope, Record<string, string>>>;
  create_missing_workareas?: boolean;
  apply?: boolean;
}

export interface NameCorrection {
  _id: string;
  scope: CorrectionScope;
  from_value: string;
  to_value: string;
  note: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Where a normalisation round has got to. Counts and timestamps already stored, so the
 * page can be opened freely — nothing here is recomputed on read.
 */
export interface NormalisationStatus {
  itsm_export: { records: number; loaded_at: string | null };
  survey: {
    applied_at: string | null;
    assets_updated: number | null;
    assets_created: number | null;
  };
  app: { linked: number; local_only: number; placed: number; total: number };
  tasks: {
    open: number;
    done: number;
    dismissed: number;
    derived_at: string | null;
    consistent: boolean;
    /** The list was derived before the newest export or survey, so it is describing the past. */
    stale: boolean;
  };
}

export const inventoryService = {
  async getStatus(): Promise<NormalisationStatus> {
    const { data } = await api.get('/inventory/status');
    return data.data as NormalisationStatus;
  },

  async importSurvey(input: SurveyImportInput): Promise<SurveyImportPlan> {
    const { data } = await api.post('/inventory/survey/import', input);
    return data.data as SurveyImportPlan;
  },

  async getCorrections(): Promise<NameCorrection[]> {
    const { data } = await api.get('/inventory/corrections');
    return (data.data ?? []) as NameCorrection[];
  },

  /** Upsert: a repeat for the same name replaces it rather than adding a second rule. */
  async saveCorrection(input: {
    scope: CorrectionScope;
    from_value: string;
    to_value: string;
    note?: string;
  }): Promise<NameCorrection> {
    const { data } = await api.put('/inventory/corrections', input);
    return data.data as NameCorrection;
  },

  async deleteCorrection(id: string): Promise<void> {
    await api.delete(`/inventory/corrections/${id}`);
  },
};

export default inventoryService;
