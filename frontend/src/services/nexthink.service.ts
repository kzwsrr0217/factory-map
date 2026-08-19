/**
 * nexthink.service.ts — the third source, from the browser.
 *
 * Everything here has a command-line equivalent that stays: a scheduled run has no browser. What
 * this adds is that a Nexthink round no longer requires the one person who has a terminal.
 *
 * The CSV **text** is posted and parsed on the server, deliberately. The file is read in the browser
 * so it never lands on disk anywhere, but the column names belong next to the parser that consumes
 * them — the same split the ITSM snapshot import uses.
 */
import api from './api';

export interface NexthinkImportPlan {
  applied: boolean;
  devices: {
    parsed: number;
    malformed: number;
    skipped: number;
    unparseable_dates: number;
    by_entity: Record<string, { total: number; windows_11: number }>;
    quiet_30d: number;
  };
  logins: {
    parsed: number;
    malformed: number;
    skipped: number;
    by_account_kind: Record<string, number>;
    devices_with_logins: number;
    near_ties: number;
  };
  join: {
    matched: number;
    unknown_to_map: string[];
    never_seen_by_nexthink: number;
    visible_type_assets: number;
  };
  /** Device names the previous import had and this one does not. Null with no earlier run. */
  gone_since_last_import: { device_names: string[]; previous_run_at: string } | null;
}

export interface UnknownDevice {
  device_name: string;
  entity: string | null;
  hardware_type: string | null;
  hardware: string;
  os_name: string | null;
  bios_serial: string | null;
  first_seen: string | null;
  last_seen: string | null;
  itsm: { catalog_item_name: string | null; status: string | null; person: string | null; location: string | null } | null;
  /** The device is newer than the loaded ITSM export, so its absence there proves nothing. */
  newer_than_itsm_export: boolean;
  top_person: string | null;
  person_rooms: string[];
}

export interface QuietDevice {
  device_name: string;
  days_quiet: number;
  entity: string | null;
  os_name: string | null;
  last_seen: string | null;
  map_state: 'live' | 'replaced' | 'absent';
  person: string | null;
  room: string | null;
}

export interface PersonMismatch {
  device_name: string;
  asset_id: string;
  asset_display_name: string;
  asset_person: string | null;
  nexthink: {
    full_name: string;
    user_name: string;
    logins: number;
    runner_up: { full_name: string | null; logins: number } | null;
  } | null;
}

export interface NexthinkOverview {
  loaded: boolean;
  imported_at: string | null;
  taken_at: string | null;
  device_count: number;
  login_count: number;
  by_entity: Array<{ entity: string; total: number; windows_11: number }>;
  never_seen: { count: number; of_visible_type: number };
  unknown_to_map: UnknownDevice[];
  quiet: {
    freshest: string | null;
    buckets: Array<{ label: string; count: number }>;
    quiet: QuietDevice[];
    holiday_season: boolean;
  };
  person_mismatches: PersonMismatch[];
  disappeared_since_last_import: { device_names: string[]; previous_run_at: string } | null;
}

/** Reads a file as text, tolerating the BOM the exports carry. */
export function readText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? '').replace(/^﻿/, ''));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.readAsText(file);
  });
}

export const nexthinkService = {
  getOverview: async (): Promise<NexthinkOverview> => {
    const res = await api.get('/nexthink/overview');
    return res.data.data;
  },

  /**
   * `apply` defaults to false. The import replaces two tables wholesale, so the dry run is the
   * thing to look at first — it is the only place the join against the map is measured before
   * anything is overwritten.
   */
  import: async (
    input: { devicesCsv?: string; loginsCsv?: string; apply?: boolean },
  ): Promise<NexthinkImportPlan> => {
    const res = await api.post('/nexthink/import', input);
    return res.data.data;
  },
};
