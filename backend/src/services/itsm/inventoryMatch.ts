/**
 * inventoryMatch.ts — Which ITSM record is this surveyed device?
 *
 * The physical inventory produces devices with an HWA sticker (already answered: the
 * number is the link) and devices without one. The second kind is either hardware ITSM
 * already knows that was never labelled, or hardware that was never registered. Both
 * mistakes are expensive: a wrong link attaches someone else's room, person and history
 * to a machine, and a missed link creates a duplicate ITSM record for hardware already
 * there.
 *
 * This module therefore produces evidence and a verdict, never a link. Deciding is a
 * person's job for everything except the `confident` case, and even that is a
 * suggestion — see match-report.ts and the task list built on it.
 *
 * ── Why "the serial matches" is not enough ──────────────────────────────────────
 * Measured on the real export rather than assumed:
 *   - Dell accessories carry a PPID identical across every unit of a model, and it
 *     lands in the serial field. A serial on several ITSM rows identifies a model.
 *   - A dock passes its MAC to the laptop docked in it, so one MAC can legitimately
 *     belong to two records.
 *   - Survey serials contain hand-typed placeholders ("...", "...2").
 * A key that is not unique on the ITSM side is DEMOTED here rather than trusted. That
 * is the whole difference between this and a join on serial.
 *
 * ── Which fields are worth anything, measured on the export ─────────────────────
 * Counted over the real 1057 rows rather than assumed from the column list:
 *   display_name 1057, asset_type 1057, manufacturer 1055, catalog_item_name 1055,
 *   serial_number 932 (920 of them unique), asset_tag 892, mac_address 745,
 *   assigned_person_name 742, model 0, os_type 0.
 * Three consequences:
 *   - `model` is empty on every row; the model lives in `catalog_item_name`, so that
 *     is what corroborates.
 *   - `asset_tag` and `display_name` both hold the HWA number itself, so neither can
 *     help the case this exists for — a device with no sticker has no tag either.
 *   - what a surveyed device realistically brings is a serial, a type and a person's
 *     name, so those are the fields the verdicts have to work from.
 *
 * Kept apart from the script that prints it so the same verdicts can drive the task
 * list, and so the rules can be tested without a database.
 */
import { normalizeSerial, isUsableSerial } from './ReconcileService';

/** The fields a match can be made on, from either side. */
export interface MatchableRecord {
  serial_number?: string | null;
  mac_address?: string | null;
  asset_tag?: string | null;
  display_name?: string | null;
  model?: string | null;
  /** Where the model actually is in this export — see the file header. */
  catalog_name?: string | null;
  manufacturer?: string | null;
  asset_type?: string | null;
  /** `person_full_name` locally, `assigned_person_name` in the snapshot. */
  person_name?: string | null;
}

/** An ITSM snapshot row, reduced to what matching needs. */
export interface SnapshotCandidateRow extends MatchableRecord {
  itsm_id: string;
}

export type MatchVerdict = 'confident' | 'ambiguous' | 'weak-only' | 'no-evidence';

export interface MatchCandidate {
  row: SnapshotCandidateRow;
  /** Keys that matched and are unique on the ITSM side. */
  strong: string[];
  /** Keys that matched but identify a model or a shared component, not a device. */
  demoted: string[];
  /** Fields that agree without identifying anything on their own. */
  corroborating: string[];
  /**
   * Fields filled on both sides that disagree. A serial matching while ITSM calls the
   * device a monitor and the surveyor wrote laptop is far more likely a mistyped serial
   * than a match, so a conflict blocks the confident verdict however strong the key.
   */
  conflicts: string[];
}

export interface MatchResult {
  verdict: MatchVerdict;
  /** Why, in the words of the person who has to act on it. */
  reason: string;
  candidates: MatchCandidate[];
}

/** Bare uppercase hex, so every separator style compares equal (see normalise-macs.ts). */
export function macKey(mac: string | null | undefined): string {
  return (mac ?? '').replace(/[^0-9a-fA-F]/g, '').toUpperCase();
}

/** A MAC is only a key if it is a whole one. */
export function isUsableMac(mac: string | null | undefined): boolean {
  return macKey(mac).length === 12;
}

function fold(v: string | null | undefined): string {
  return (v ?? '').trim().toLowerCase();
}

/**
 * Name compare that survives how the two sides actually write names.
 *
 * The export writes "Móder, Hajnalka" — surname, comma, forename. The survey writes
 * "moder hajnalka", informally and without diacritics. A comparison that only folded
 * case and accents called those two a CONFLICT, which then blocked the confident
 * verdict for what is plainly the same person; on the real export that would have
 * turned most good matches into "ask a person". Found by running the report against
 * the real data rather than by reasoning about it.
 *
 * So: strip diacritics and punctuation, then compare the set of name parts regardless
 * of order. Two different people with each other's names swapped would collide, which
 * is rare and harmless here — a name only ever corroborates, it is never an identity.
 */
export function foldName(v: string | null | undefined): string {
  return fold(v)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/).filter(Boolean).sort().join(' ');
}

export interface SnapshotIndex {
  bySerial: Map<string, SnapshotCandidateRow[]>;
  byMac: Map<string, SnapshotCandidateRow[]>;
  byTag: Map<string, SnapshotCandidateRow[]>;
  byName: Map<string, SnapshotCandidateRow[]>;
  byItsmId: Map<string, SnapshotCandidateRow>;
}

/**
 * Indexes the export by every matchable key, keeping ALL rows per key rather than the
 * first — the count is what lets a shared key be demoted instead of trusted.
 */
export function buildSnapshotIndex(rows: SnapshotCandidateRow[]): SnapshotIndex {
  const index: SnapshotIndex = {
    bySerial: new Map(), byMac: new Map(), byTag: new Map(), byName: new Map(), byItsmId: new Map(),
  };
  const push = (map: Map<string, SnapshotCandidateRow[]>, key: string, row: SnapshotCandidateRow) => {
    if (!key) return;
    map.set(key, [...(map.get(key) ?? []), row]);
  };
  for (const row of rows) {
    index.byItsmId.set(row.itsm_id.toUpperCase(), row);
    if (isUsableSerial(row.serial_number)) push(index.bySerial, normalizeSerial(row.serial_number), row);
    if (isUsableMac(row.mac_address)) push(index.byMac, macKey(row.mac_address), row);
    push(index.byTag, fold(row.asset_tag), row);
    push(index.byName, fold(row.display_name), row);
  }
  return index;
}

/** Evidence for one surveyed device against the whole export. */
export function matchRecord(device: MatchableRecord, index: SnapshotIndex): MatchResult {
  const byId = new Map<string, MatchCandidate>();
  const candidate = (row: SnapshotCandidateRow): MatchCandidate => {
    const existing = byId.get(row.itsm_id);
    if (existing) return existing;
    const fresh: MatchCandidate = { row, strong: [], demoted: [], corroborating: [], conflicts: [] };
    byId.set(row.itsm_id, fresh);
    return fresh;
  };

  const consider = (
    map: Map<string, SnapshotCandidateRow[]>,
    key: string,
    label: string,
    strong: boolean,
  ) => {
    if (!key) return;
    const rows = map.get(key) ?? [];
    for (const row of rows) {
      const c = candidate(row);
      if (!strong) c.corroborating.push(label);
      else if (rows.length > 1) c.demoted.push(`${label} on ${rows.length} ITSM rows`);
      else c.strong.push(label);
    }
  };

  if (isUsableSerial(device.serial_number)) {
    consider(index.bySerial, normalizeSerial(device.serial_number), 'serial', true);
  }
  if (isUsableMac(device.mac_address)) {
    consider(index.byMac, macKey(device.mac_address), 'MAC', true);
  }
  consider(index.byTag, fold(device.asset_tag), 'asset tag', true);
  // A name is not an identity — plenty of records share one — so it corroborates only.
  consider(index.byName, fold(device.display_name), 'name', false);

  /**
   * Descriptive fields never introduce a candidate — half the estate shares a model —
   * but on a candidate a key already found, agreement strengthens it and disagreement
   * counts against it. Only fields filled on BOTH sides are judged: a blank says
   * nothing either way, and treating it as disagreement would flag most of the export.
   */
  for (const c of byId.values()) {
    // Per-candidate, since the values differ per row.
    const pair = (label: string, a: string | null | undefined, b: string | null | undefined, name = false) => {
      const left = name ? foldName(a) : fold(a);
      const right = name ? foldName(b) : fold(b);
      if (!left || !right) return;
      if (left === right) c.corroborating.push(label);
      else c.conflicts.push(`${label} (${a} vs ${b})`);
    };
    pair('type', device.asset_type, c.row.asset_type);
    pair('manufacturer', device.manufacturer, c.row.manufacturer);
    pair('person', device.person_name, c.row.person_name, true);
    // The model, wherever each side keeps it.
    pair('model', device.model ?? device.catalog_name, c.row.model ?? c.row.catalog_name);
  }

  const candidates = [...byId.values()];
  const hasKeyOfItsOwn = isUsableSerial(device.serial_number)
    || isUsableMac(device.mac_address)
    || !!fold(device.asset_tag);

  if (candidates.length === 0) {
    return {
      verdict: 'no-evidence',
      reason: hasKeyOfItsOwn
        ? 'has a serial, MAC or tag that no ITSM record carries — looks genuinely absent from ITSM'
        : 'nothing recorded to match on (no serial, no MAC, no tag), so this cannot be checked either way and registering it risks a duplicate',
      candidates,
    };
  }

  const demoted = candidates.filter((c) => c.demoted.length > 0);
  if (demoted.length > 0) {
    return {
      verdict: 'ambiguous',
      reason: `matched on a key that is not unique in ITSM (${demoted[0].demoted.join('; ')}) — that identifies a model or a shared component, not a device`,
      candidates,
    };
  }

  if (candidates.length > 1) {
    return { verdict: 'ambiguous', reason: `${candidates.length} ITSM records match`, candidates };
  }

  const only = candidates[0];
  // A conflict outranks the key. "The serial matches, but ITSM calls it a monitor and
  // you wrote laptop" is far more likely a mistyped serial than a match, and it is
  // exactly the case a person needs to see rather than have decided for them.
  if (only.strong.length > 0 && only.conflicts.length > 0) {
    return {
      verdict: 'ambiguous',
      reason: `matched on ${only.strong.join('+')}, but ${only.conflicts.join(' and ')} disagree — likelier a data error than a match`,
      candidates,
    };
  }
  if (only.strong.length > 0 && only.corroborating.length > 0) {
    return {
      verdict: 'confident',
      reason: `one ITSM record, matched on ${only.strong.join('+')} and corroborated by ${[...new Set(only.corroborating)].join('+')}`,
      candidates,
    };
  }
  if (only.strong.length > 0) {
    return {
      verdict: 'ambiguous',
      reason: `matched on ${only.strong.join('+')} but nothing else agrees — worth a look before linking`,
      candidates,
    };
  }
  return {
    verdict: 'weak-only',
    reason: `only ${[...new Set(only.corroborating)].join('+')} agree, which is not an identity`,
    candidates,
  };
}

/** One line describing a candidate and why it is one. */
export function describeCandidate(c: MatchCandidate): string {
  const parts = [
    c.strong.length ? `strong: ${c.strong.join('+')}` : null,
    c.demoted.length ? `not unique in ITSM: ${c.demoted.join('+')}` : null,
    c.corroborating.length ? `also agrees: ${[...new Set(c.corroborating)].join('+')}` : null,
    c.conflicts.length ? `DISAGREES: ${c.conflicts.join('; ')}` : null,
  ].filter(Boolean);
  return `${c.row.itsm_id} (${c.row.display_name ?? 'no name'}) — ${parts.join('; ') || 'no evidence'}`;
}
