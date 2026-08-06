/**
 * surveyImport.ts — Turning the physical walk-around into placements, as a plan.
 *
 * The logic here was the body of `scripts/import-inventory-survey.ts`, which printed to a
 * console. That was fine while the survey was imported by whoever had a terminal on the
 * VM, and wrong as soon as the person doing the inventory is the person who should see
 * the result: the export, the survey and the app's own records are compared here, and the
 * output is the list of things that did not line up.
 *
 * So the planning half is a function that returns a plan, and the printing and the
 * writing are two separate consumers of it — the CLI and the upload endpoint. Both get
 * the same numbers, which is the point: a report you can only obtain one way is a report
 * nobody checks.
 *
 * ── What the survey says, and what the app does with it ────────────────────────
 * Per device found, the survey records which HWA it is (`azonosito_mod: "HWA"`) or, for
 * devices ITSM does not track at all, a type and serial (`azonosito_mod: "EGYEB"`), plus
 * where it sits and who uses it. Two outcomes:
 *
 *   - HWA rows UPDATE an existing asset with its real placement and person. A row whose
 *     HWA matches nothing is reported, never guessed at.
 *   - EGYEB rows CREATE a local-only asset (`source_of_truth: 'local'`). These are not in
 *     ITSM yet; someone registers them in Alemba by hand later — the app never writes to
 *     ITSM — and the normal reconcile flow takes over from there. Matched by serial on
 *     re-runs so a refined survey does not create duplicates.
 *
 * ── The names ──────────────────────────────────────────────────────────────────
 * Buildings and floors must already exist. Rooms normally do; the survey's `work_area` is
 * matched against WorkArea.name and `helyszin` against its Zone, case- and
 * diacritic-insensitively. What still does not match is a human problem — a nickname, an
 * abbreviation, a typo — and is reported with a suggestion rather than resolved by
 * guessing. The answer is stored in `name_corrections` (see NameCorrection.entity.ts).
 *
 * NOTHING IS WRITTEN unless `apply` is true. That is not a convenience: this planner is
 * also the validation tool, and the report is meant to be run until it is clean.
 */
import { AppDataSource } from '../../config/database';
import { Asset } from '../../entities/Asset.entity';
import { AssetConnection } from '../../entities/AssetConnection.entity';
import { Building } from '../../entities/Building.entity';
import { Floor } from '../../entities/Floor.entity';
import { WorkArea } from '../../entities/WorkArea.entity';
import { Zone } from '../../entities/Zone.entity';
import { ItsmHardwareSnapshot } from '../../entities/ItsmHardwareSnapshot.entity';
import { NameCorrection, NameCorrectionScope, NAME_CORRECTION_SCOPES } from '../../entities/NameCorrection.entity';
import { chunkForEntity } from '../../utils/mssqlBatch';
import { foldName } from '../itsm/inventoryMatch';

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

export interface SurveyFile {
  eszkozok?: SurveyRow[];
}

/** Folded-name -> replacement, per survey column. */
export type Corrections = Partial<Record<NameCorrectionScope, Record<string, string>>>;

// Device-type free text the survey tool can produce -> the app's asset_type buckets (see
// frontend/src/utils/assetTypes.ts ASSET_TYPE_MAP). Extend as more buildings surface new
// eszkoz_tipus values; unknown ones fall back to 'other' rather than being guessed at.
const DEVICE_TYPE_MAP: Record<string, string> = {
  nyomtato: 'printer', // "Nyomtató" after diacritic-folding
  monitor: 'monitor',
  laptop: 'laptop',
  notebook: 'laptop',
  szerver: 'server',
  server: 'server',
  telefon: 'phone',
  kamera: 'camera',
  switch: 'switch',
  router: 'router',
  // Added after reading the real survey rather than guessed at: these are the words the
  // walkers actually typed, and without them 15 devices landed on 'other'.
  szkenner: 'scanner',
  scanner: 'scanner',
  'asztalipc': 'workstation', // "Asztali PC" — fold() strips the space
  pc: 'workstation',
  dokkolo: 'dock',
  dokkolt: 'dock',
};

/**
 * A monitor model written where the type belongs.
 *
 * Where a device has no HWA number the walkers put what they could read off it in whichever
 * field was to hand, and for monitors that is often the type column: `U2421E`, `U2412Mb`,
 * `U2424HE`, `Lenovo ThinkVision`. Ten devices on the real survey, all monitors, all of which
 * ended up typed as "other" and so fell out of every monitor count.
 *
 * Recognised by shape — Dell's U/P four-digit families and the handful of vendor lines the
 * survey names — and the text is kept as the model, because that is what it is. Anything not
 * matching here still falls to 'other': a model this does not know is better left untyped
 * than typed wrongly.
 */
const MONITOR_MODEL = /^(?:dell\s*)?[up]\d{4}[a-z]*$|thinkvision|ultrasharp|viewsonic|proart/i;

/**
 * What the type column really held: a type, or a model that implies one.
 *
 * Returns the classified `asset_type` and, when the text was a model, that model — so the
 * survey's own words end up in the field meant for them instead of being used once for
 * classification and dropped.
 */
export function classifyFromTypeColumn(raw: string | undefined): { asset_type: string; model: string | null } {
  const text = (raw ?? '').trim();
  const mapped = DEVICE_TYPE_MAP[fold(text)];
  if (mapped) return { asset_type: mapped, model: null };
  if (MONITOR_MODEL.test(text)) return { asset_type: 'monitor', model: text };
  return { asset_type: 'other', model: text || null };
}

/**
 * Lowercase, diacritic-folded ("á" -> "a"), whitespace-stripped — handles the survey's
 * informal names ("rajnai agnes" vs "Rajnai Ágnes") and building-name spacing ("werk 1"
 * vs "Werk1") in one normalization.
 */
export function fold(s: string | undefined | null): string {
  const decomposed = (s ?? '').normalize('NFD');
  let stripped = '';
  for (const ch of decomposed) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x0300 && code <= 0x036f) continue; // combining diacritical marks
    stripped += ch;
  }
  return stripped.toLowerCase().replace(/\s+/g, '');
}

function correct(map: Record<string, string> | undefined, raw: string): string {
  if (!raw || !map) return raw;
  return map[fold(raw)] ?? raw;
}

export function classifyDeviceType(eszkozTipus: string | undefined): string {
  return classifyFromTypeColumn(eszkozTipus).asset_type;
}

// ── What the survey writes in its identifier column ───────────────────────────
//
// Measured on the real exports (735 devices): the `hwa` column holds THREE different
// kinds of value, and reading it as one was going to report 122 devices the app already
// has as unknown.
//
//   307 rows  a proper HWA number         "HWA26255"
//    95 rows  the same, prefix missing     "26255"
//    52 rows  a device name               "MMHIPC7402", "MMH_PRINTER_1039", "MMH LABEL 1008"
//
// HWA is the current convention; the names are what older devices carry — industrial PCs
// (`MMHIPC…`), printers (`MMH PRINTER …`), label printers (`MMH LABEL …`), workstations
// (`MMHWSBDE…`) — and all of them still have to resolve. In the app those names live in
// `asset_tag`, not in the display name: 30 of the 52 are found there and none at all in
// `display_name`. The same name is written with underscores, with spaces and run together
// in different rows, so the comparison has to ignore separators entirely.

/** A number, with or without the prefix. Three digits minimum, so "1" is not an HWA. */
const HWA_NUMBER = /^(?:hwa)?\s*(\d{3,})$/i;

/** What kind of thing the survey put in the identifier column. */
export type IdentifierKind = 'number' | 'name' | 'none';

export function identifierKind(raw: string | undefined): IdentifierKind {
  const value = (raw ?? '').trim();
  if (!value) return 'none';
  return HWA_NUMBER.test(value) ? 'number' : 'name';
}

/**
 * Key for comparing device names: case, accents, spaces, underscores and hyphens all
 * dropped, because `MMH_PRINTER_1039`, `MMH PRINTER 1039` and `MMHPRINTER1039` are one
 * device written three ways — all three spellings appear in the real exports.
 */
export function nameKey(value: string | null | undefined): string {
  return (value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[\s_-]+/g, '').toLowerCase();
}

/**
 * The keys worth trying for an identifier, in order of how much they claim.
 *
 * A bare number is offered both as written and with the prefix added: `26255` is what
 * somebody read off a label that says `HWA26255`.
 */
export function identifierKeys(raw: string): string[] {
  const value = raw.trim();
  const match = HWA_NUMBER.exec(value);
  if (!match) return [fold(value)];
  const digits = match[1];
  return [...new Set([fold(value), `hwa${digits}`])];
}

/**
 * An HWA number sitting in the survey's comment column.
 *
 * The walk-around tool has no field for "this monitor belongs to that machine" — the
 * inventory app it grew out of had no parent/child relationship at all — so the walkers wrote
 * the machine's HWA into the comment instead. On the real survey that is 62 rows: monitors
 * with their own serial, tagged with the PC they hang off, and 47 distinct machines because
 * some have two screens.
 *
 * The app does have that relationship, so the prose becomes a real `parent-child` link. It is
 * read only from rows that carry no identifier of their own — on a row that already names its
 * own device, a number in the comment means something else.
 */
const HWA_IN_COMMENT = /\bhwa\s*(\d{3,})\b/i;

export function parentHwaFromComment(comment: string | undefined): string | null {
  const m = HWA_IN_COMMENT.exec(comment ?? '');
  return m ? `HWA${m[1]}` : null;
}

/**
 * Serial numbers that are not serial numbers.
 *
 * The real survey carries 14 of these: `...`, `...2`, `N/A`, `N/A 2` … `N/A8`. They matter
 * because a device with no HWA is matched BY serial — so `N/A 2` and `N/A 3` would become
 * two assets that are really one unknown thing each, and two `...` rows would be merged
 * into one device that does not exist. Treated as "no serial given", and counted, so the
 * report can say how many devices still need a number read off them.
 */
const PLACEHOLDER_SERIAL = /^(?:\.+|-+|_+|\?+|x+|n\s*\/?\s*a)\s*\d*$/i;

export function usableSerial(raw: string | undefined): string | null {
  const value = (raw ?? '').trim();
  if (!value) return null;
  return PLACEHOLDER_SERIAL.test(value) ? null : value;
}

/**
 * Merges rows from several export files, last one winning on a repeated row id — a
 * re-export of the same tablet overwriting an earlier partial one.
 */
export function mergeSurveyRows(batches: SurveyRow[][]): SurveyRow[] {
  const byKey = new Map<string, SurveyRow>();
  for (const batch of batches) {
    for (const row of batch) byKey.set(row.id ?? JSON.stringify(row), row);
  }
  return [...byKey.values()];
}

/**
 * Reads the stored corrections and layers the caller's on top.
 *
 * The overrides exist for the preview: someone typing a fix in the browser wants to see
 * its effect before deciding to keep it. They are also how the CLI keeps honouring an
 * `inventory-corrections.json` that predates the table.
 */
export async function loadCorrections(overrides: Corrections = {}): Promise<Corrections> {
  const stored = await AppDataSource.getRepository(NameCorrection).find();
  const merged: Corrections = {};
  for (const scope of NAME_CORRECTION_SCOPES) merged[scope] = {};
  for (const row of stored) {
    const map = merged[row.scope];
    if (map) map[row.from_folded] = row.to_value;
  }
  for (const scope of NAME_CORRECTION_SCOPES) {
    const extra = overrides[scope];
    if (!extra) continue;
    // Keys may arrive raw ("Gorog Tomi") from a hand-written file; fold them so both
    // sources are keyed the same way.
    for (const [from, to] of Object.entries(extra)) merged[scope]![fold(from)] = to;
  }
  return merged;
}

// ── Suggestions ───────────────────────────────────────────────────────────────
//
// A list of 60 unmatched room names with nothing next to them is a transcription job. The
// name that did not match is usually a near-miss of one that exists, and proposing it
// turns the job into confirming. It is only ever a proposal: the suggestion is shown, and
// a person decides.

/** Edit distance, single-row. The strings here are names, so this stays cheap. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length || !b.length) return Math.max(a.length, b.length);
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = curr;
  }
  return prev[b.length];
}

/**
 * Similar enough to be worth proposing. 0.72 was chosen so that "recepcio" reaches
 * "Recepció" and "hr iroda" reaches "HR Iroda", while two genuinely different rooms do
 * not pair up. Being wrong here costs a rejected suggestion, not a wrong import.
 */
const SUGGESTION_THRESHOLD = 0.72;

/**
 * Two names that differ only in their digits are not spellings of one thing.
 *
 * `mmhgen0049` and `mmhgen0009` are one character apart, which edit distance calls a 0.9
 * match — and they are two different technical accounts. The same goes for `18. állomás` and
 * `19. állomás`, or any HWA-style number. Letters can be misspelled; a digit is a value.
 */
function differsOnlyInDigits(a: string, b: string): boolean {
  const skeleton = (v: string) => v.replace(/\d+/g, '#');
  return skeleton(a) === skeleton(b) && a !== b;
}

function bestSuggestion(target: string, candidates: string[]): string | null {
  const t = foldName(target);
  if (!t) return null;
  let best: string | null = null;
  let bestScore = 0;
  for (const candidate of candidates) {
    const c = foldName(candidate);
    if (!c) continue;
    if (differsOnlyInDigits(t, c)) continue;
    const score = 1 - editDistance(t, c) / Math.max(t.length, c.length);
    if (score > bestScore) { bestScore = score; best = candidate; }
  }
  return bestScore >= SUGGESTION_THRESHOLD ? best : null;
}

// ── Matching ──────────────────────────────────────────────────────────────────

interface PersonMatch {
  fullName: string | null;
  itsmId: string | null;
  personId: string | null;
  matched: boolean;
}

interface PersonIndexEntry {
  full_name: string;
  itsm_id: string | null;
  person_id: string | null;
}

/**
 * Person names known from the ITSM export, keyed so the two spellings meet.
 *
 * Keyed by `foldName`, not `fold`: the export writes "Móder, Hajnalka" and the survey
 * "moder hajnalka". Folding case and diacritics alone leaves the comma and the word
 * order, so the same person missed on both counts and every name landed in the
 * "unmatched" list. Same reason the matcher compares name parts as a set — see
 * itsm/inventoryMatch.ts.
 */
async function buildPersonIndex(): Promise<Map<string, PersonIndexEntry>> {
  const rows = await AppDataSource.getRepository(ItsmHardwareSnapshot).find();
  const map = new Map<string, PersonIndexEntry>();
  for (const r of rows) {
    if (!r.assigned_person_name) continue;
    const key = foldName(r.assigned_person_name);
    if (!map.has(key)) {
      map.set(key, { full_name: r.assigned_person_name, itsm_id: r.person_itsm_id, person_id: r.person_id });
    }
  }
  return map;
}

function matchPerson(index: Map<string, PersonIndexEntry>, szemely: string | undefined, corrections: Corrections): PersonMatch {
  const raw = (szemely ?? '').trim();
  if (!raw) return { fullName: null, itsmId: null, personId: null, matched: false };
  const corrected = correct(corrections.persons, raw);
  const hit = index.get(foldName(corrected));
  if (hit) return { fullName: hit.full_name, itsmId: hit.itsm_id, personId: hit.person_id, matched: true };
  // Kept as free text: a name the export does not know is still the best information
  // anyone has about who uses the device.
  return { fullName: corrected, itsmId: null, personId: null, matched: false };
}

/**
 * The place hierarchy, folded once.
 *
 * Every lookup used to scan the arrays and fold the stored names again for each survey
 * row. That reads fine and is quadratic: measured on synthetic full-site runs, 1200 rows
 * took 1.2 s to plan and 3000 took 5.7 s — nearly four times the work for two and a half
 * times the rows. `fold` does an NFD normalise plus a per-codepoint loop, so it is the last
 * thing that should run in an inner loop.
 *
 * Keys keep insertion order within each bucket, so "the first room of this name" still means
 * the same room it did before.
 */
interface PlaceIndex {
  buildingsByName: Map<string, Building>;
  floorsByNumber: Map<string, Floor>;
  floorsByName: Map<string, Floor>;
  /** All rooms sharing a folded name on a floor — same name in two zones is legitimate. */
  roomsByName: Map<string, WorkArea[]>;
  zonesByName: Map<string, Zone>;
}

function buildPlaceIndex(
  buildings: Building[], floors: Floor[], workAreas: WorkArea[], zones: Zone[],
): PlaceIndex {
  const index: PlaceIndex = {
    buildingsByName: new Map(),
    floorsByNumber: new Map(),
    floorsByName: new Map(),
    roomsByName: new Map(),
    zonesByName: new Map(),
  };
  // First wins throughout, which is what `find` did.
  for (const b of buildings) {
    const key = fold(b.name);
    if (!index.buildingsByName.has(key)) index.buildingsByName.set(key, b);
  }
  for (const f of floors) {
    const byNumber = `${f.building_id}|${f.floor_number}`;
    if (!index.floorsByNumber.has(byNumber)) index.floorsByNumber.set(byNumber, f);
    const byName = `${f.building_id}|${fold(f.name)}`;
    if (!index.floorsByName.has(byName)) index.floorsByName.set(byName, f);
  }
  for (const w of workAreas) {
    const key = `${w.floor_id}|${fold(w.name)}`;
    const list = index.roomsByName.get(key) ?? [];
    list.push(w);
    index.roomsByName.set(key, list);
  }
  for (const z of zones) index.zonesByName.set(`${z.floor_id}|${fold(z.name)}`, z);
  return index;
}

function matchBuilding(index: PlaceIndex, epulet: string | undefined, corrections: Corrections): Building | null {
  const corrected = correct(corrections.building, (epulet ?? '').trim());
  return index.buildingsByName.get(fold(corrected)) ?? null;
}

function matchFloor(index: PlaceIndex, buildingId: string, emelet: string | undefined, corrections: Corrections): Floor | null {
  const corrected = correct(corrections.floor, (emelet ?? '').trim());
  const num = Number(corrected);
  if (corrected !== '' && !Number.isNaN(num)) {
    // Number first: the survey writes a bare "0" where the app's floor name is descriptive
    // ("Ground Floor (Földszint)").
    const byNumber = index.floorsByNumber.get(`${buildingId}|${num}`);
    if (byNumber) return byNumber;
  }
  return index.floorsByName.get(`${buildingId}|${fold(corrected)}`) ?? null;
}

/**
 * Matches the survey's `work_area` (the room — "recepcio", "cummins rotor 1") against
 * WorkArea.name, optionally narrowed by `helyszin` (the zone) against the room's Zone.
 *
 * The survey's four levels map straight onto the app's: `epulet` = Building, `emelet` =
 * Floor, `helyszin` = Zone, `work_area` = WorkArea. Sections are not used, because a
 * Section has no width or height in the schema and so cannot be drawn on the floor map at
 * all — the rooms are what people actually draw.
 *
 * `helyszin` is a tiebreak rather than a filter: it separates same-named rooms in
 * different zones without rejecting a room whose zone has not been assigned yet.
 */
function matchWorkArea(
  index: PlaceIndex,
  floorId: string,
  helyszin: string | undefined,
  workAreaField: string | undefined,
  corrections: Corrections,
): WorkArea | null {
  const room = correct(corrections.work_area, (workAreaField ?? '').trim());
  if (!room) return null;
  const byName = index.roomsByName.get(`${floorId}|${fold(room)}`);
  if (!byName || byName.length === 0) return null;
  const zoneName = correct(corrections.helyszin, (helyszin ?? '').trim());
  if (byName.length === 1 || !zoneName) return byName[0];
  const zone = index.zonesByName.get(`${floorId}|${fold(zoneName)}`);
  return (zone ? byName.find((w) => w.zone_id === zone.id) : undefined) ?? byName[0];
}

// ── The plan ──────────────────────────────────────────────────────────────────

interface PlannedUpdate {
  assetId: string;
  display: string;
  fields: Partial<Asset>;
}
interface PlannedCreate {
  display: string;
  fields: Partial<Asset>;
}

/**
 * A room the survey refers to that does not exist on the map yet.
 *
 * Structured rather than the "zone / room" display string it used to be, because
 * `createMissingWorkAreas` needs the floor and the zone name to create it.
 */
export interface MissingWorkArea {
  floor_id: string;
  /** "Werk1 / Ground Floor", for the report. */
  where: string;
  /** Corrected `helyszin`; empty when the survey gave none. */
  zone_name: string;
  /** Corrected `work_area` — becomes WorkArea.name. */
  room_name: string;
  /** As the survey spelled it, which is what a correction has to be keyed on. */
  raw_room_name: string;
  /** How many survey rows point at it — worth fixing the big ones first. */
  rows: number;
}

interface InternalPlan {
  rows: number;
  hwaRows: number;
  otherRows: number;
  toUpdate: PlannedUpdate[];
  toCreate: PlannedCreate[];
  /**
   * Keyed by building+floor as written, with a row count and which of the two failed.
   *
   * Which side failed matters to whoever fixes it: a row under an unknown building has a
   * floor name that was never even looked up, and offering to correct it sends someone
   * renaming a floor that is perfectly fine.
   */
  unmatchedPlace: Map<string, {
    building: string;
    floor: string;
    rows: number;
    building_matched: boolean;
    /** Set when the building matched, so floor suggestions stay inside it. */
    building_id: string | null;
  }>;
  /** Keyed by floor + folded zone + folded room. */
  missingWorkAreas: Map<string, MissingWorkArea>;
  /**
   * Keyed by the name as the survey wrote it, with a row count and — when a stored correction
   * already points somewhere — where it points. A correction whose target is not in the
   * export leaves the row here, and without saying so it looks exactly like an unsaved fix.
   */
  unmatchedPerson: Map<string, { rows: number; correctedTo: string | null }>;
  unmatchedHwa: Array<{ hwa: string; note: string; kind: IdentifierKind }>;
  /** Rows that will land on a floor but in no room. */
  noRoom: number;
  /** How each matched row was found — the report says when a rule earned its keep. */
  matchedBy: Record<'hwa' | 'hwa-prefixed' | 'device-name' | 'serial' | 'survey-row', number>;
  /** Serial values that were not serial numbers at all. */
  placeholderSerials: number;
  /**
   * Devices that would be created with nothing to identify them.
   *
   * A survey row with no HWA and no serial means the number was not found or could not be
   * reached — a real outcome of walking a factory, and one that has to be picked up later.
   * Counted here so the import says how many are coming rather than leaving them to be
   * discovered in the task list.
   */
  createWithoutSerial: number;
  /** The same identifier or serial on more than one row. */
  duplicates: Map<string, { value: string; kind: 'identifier' | 'serial'; rows: number }>;
  /** Monitor -> machine links the comment column asks for. */
  parentLinks: Array<{ childSurveyRowId: string | null; childAssetId: string | null; parentAssetId: string; device: string; parent: string }>;
  /** Comments naming a machine the app does not have. */
  parentUnknown: Map<string, number>;
}

/** What a caller outside this module sees. Serialisable on purpose — it goes over HTTP. */
export interface SurveyImportPlan {
  parsed: number;
  hwa_rows: number;
  other_rows: number;
  to_update: number;
  to_create: number;
  /** Placed on a floor but in no room: findable on the map, not in a rectangle. */
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
    raw_room_name: string;
    rows: number;
    suggestion: string | null;
  }>;
  unmatched_persons: Array<{
    name: string;
    rows: number;
    suggestion: string | null;
    /**
     * Where a stored correction already sends this name, when that is not the name itself.
     * Its presence means "corrected, and the corrected name is still not in the export" —
     * either the target is misspelled, or that person has no device in the export at all.
     */
    corrected_to: string | null;
  }>;
  /**
   * Identifiers that resolved to nothing. `kind` separates "an HWA number we do not have"
   * from "a device name we have never seen" — different problems, different next step.
   */
  unmatched_hwa: Array<{ hwa: string; note: string; kind: IdentifierKind }>;
  /**
   * How the identifier column resolved, across every row — including rows that are skipped
   * for want of a building, since the two problems are independent. Worth reporting rather
   * than hiding: it is the evidence that the prefix and old-convention rules are earning
   * their keep, and if `hwa_prefixed` drops to zero on a later export, the survey tool has
   * started writing full numbers.
   */
  matched_by: {
    hwa: number;
    hwa_prefixed: number;
    device_name: number;
    serial: number;
    /** Recognised by the survey row it came from — the only key some devices have. */
    survey_row: number;
  };
  /** Rows whose serial was `...`, `N/A` or similar — counted, not silently dropped. */
  placeholder_serials: number;
  /**
   * Monitors the comment column attaches to a machine.
   *
   * The survey tool has no parent/child field, so "this screen belongs to HWA16775" was
   * written in prose. The app has the relationship, so the prose becomes a link.
   */
  parent_links: {
    would_link: number;
    already_linked: number;
    /** Comments naming a machine nothing has — reported, never invented. */
    parent_unknown: Array<{ hwa: string; rows: number }>;
    sample: Array<{ device: string; parent: string }>;
  };
  /**
   * How many of the new assets would have neither an HWA nor a serial. Those come back as
   * "read a number off it" tasks, which is the only honest thing to do with a device nobody
   * could get a number from.
   */
  create_without_serial: number;
  /**
   * The same device recorded twice. Small and real on the current survey (4 HWA numbers,
   * each pair in the same room), and the sort of thing that has to be seen before applying
   * rather than explained afterwards.
   */
  duplicates: Array<{ value: string; kind: 'identifier' | 'serial'; rows: number }>;
  /** A look at what would be created, since a create is the less reversible half. */
  create_sample: Array<{ display: string; asset_type: string; serial: string | null }>;
  created_areas: { zones: number; work_areas: number; duplicate_names: string[] } | null;
  applied: boolean;
}

async function planInternal(rows: SurveyRow[], corrections: Corrections): Promise<InternalPlan> {
  const index = buildPlaceIndex(
    await AppDataSource.getRepository(Building).find(),
    await AppDataSource.getRepository(Floor).find(),
    await AppDataSource.getRepository(WorkArea).find(),
    await AppDataSource.getRepository(Zone).find(),
  );
  const personIndex = await buildPersonIndex();
  const assetRepo = AppDataSource.getRepository(Asset);

  // Every asset, once, keyed three ways.
  //
  // The identifier column may hold an HWA number, the same number without its prefix, or an
  // older device name that lives in `asset_tag` — and a name is written with underscores,
  // with spaces or run together, so no `In(...)` lookup can find it. Reading the table once
  // and indexing it is both simpler and honest about the cost; the previous code already
  // fell back to loading every asset with an HWA the moment one value was missing, which on
  // a real survey is every time.
  const allAssets = await assetRepo.find();
  const existingByHwa = new Map<string, Asset>();
  const existingByTag = new Map<string, Asset>();
  const existingByName = new Map<string, Asset>();
  const existingBySerial = new Map<string, Asset>();
  const existingBySurveyRow = new Map<string, Asset>();
  for (const a of allAssets) {
    if (a.hardware_asset_id) existingByHwa.set(fold(a.hardware_asset_id), a);
    if (a.asset_tag) existingByTag.set(nameKey(a.asset_tag), a);
    if (a.display_name) existingByName.set(nameKey(a.display_name), a);
    if (a.serial_number) existingBySerial.set(fold(a.serial_number), a);
    if (a.survey_row_id) existingBySurveyRow.set(a.survey_row_id, a);
  }

  /**
   * The device a survey row names, and which rule found it.
   *
   * Order matters: an HWA number as written is the strongest claim, the same number with the
   * prefix supplied is next, and only then the old-convention name. `asset_tag` before
   * `display_name` because that is where the names actually are — measured, not assumed.
   */
  const resolveIdentifier = (raw: string): { asset: Asset; by: 'hwa' | 'hwa-prefixed' | 'device-name' } | null => {
    const keys = identifierKeys(raw);
    const asWritten = existingByHwa.get(keys[0]);
    if (asWritten) return { asset: asWritten, by: 'hwa' };
    for (const k of keys.slice(1)) {
      const prefixed = existingByHwa.get(k);
      if (prefixed) return { asset: prefixed, by: 'hwa-prefixed' };
    }
    if (identifierKind(raw) === 'name') {
      const key = nameKey(raw);
      const byTag = existingByTag.get(key) ?? existingByName.get(key);
      if (byTag) return { asset: byTag, by: 'device-name' };
    }
    return null;
  };

  const plan: InternalPlan = {
    rows: rows.length,
    hwaRows: 0,
    otherRows: 0,
    toUpdate: [],
    toCreate: [],
    unmatchedPlace: new Map(),
    missingWorkAreas: new Map(),
    unmatchedPerson: new Map(),
    unmatchedHwa: [],
    noRoom: 0,
    matchedBy: { hwa: 0, 'hwa-prefixed': 0, 'device-name': 0, serial: 0, 'survey-row': 0 },
    placeholderSerials: 0,
    createWithoutSerial: 0,
    parentLinks: [],
    parentUnknown: new Map(),
    duplicates: new Map(),
  };

  // Counted over the whole survey rather than per row, so a device entered twice is
  // reported once with a count instead of appearing as two separate findings.
  const seenIdentifier = new Map<string, string[]>();
  const seenSerial = new Map<string, string[]>();
  for (const row of rows) {
    const id = (row.hwa ?? '').trim();
    if (id) {
      const k = identifierKeys(id)[identifierKeys(id).length - 1];
      (seenIdentifier.get(k) ?? seenIdentifier.set(k, []).get(k)!).push(id);
    }
    const serial = usableSerial(row.sorozatszam);
    if (serial) {
      const k = fold(serial);
      (seenSerial.get(k) ?? seenSerial.set(k, []).get(k)!).push(serial);
    } else if ((row.sorozatszam ?? '').trim()) {
      // Counted here rather than where the row is used, so the number does not depend on
      // whether the row's building happens to exist yet.
      plan.placeholderSerials++;
    }
  }
  for (const [, values] of seenIdentifier) {
    if (values.length > 1) plan.duplicates.set(`identifier:${values[0]}`, { value: values[0], kind: 'identifier', rows: values.length });
  }
  for (const [, values] of seenSerial) {
    if (values.length > 1) plan.duplicates.set(`serial:${values[0]}`, { value: values[0], kind: 'serial', rows: values.length });
  }

  for (const row of rows) {
    const identifier = (row.hwa ?? '').trim();
    const mode = fold(row.azonosito_mod);
    // A CSV export of the survey has no `azonosito_mod` column at all. A row carrying an
    // identifier is then read as an HWA row: guessing "not in ITSM" instead would create a
    // fresh local asset for a device that is already there — 65 duplicates on the one
    // CSV-only export in hand. An explicit `EGYEB` still wins, because somebody said so.
    const isHwa = !!identifier && (mode === 'hwa' || mode === '');
    if (isHwa) plan.hwaRows++; else plan.otherRows++;

    // The identifier is resolved BEFORE the place, and reported whether or not the place
    // works out. They are independent problems, and doing it the other way round meant one
    // hid the other: on the real survey 612 of 735 rows have no building yet, so a run
    // reported six identifier problems out of the 33 that are actually there — and the
    // reader would have had to fix every building before finding out.
    const found = isHwa ? resolveIdentifier(identifier) : null;
    if (isHwa) {
      if (found) plan.matchedBy[found.by]++;
      else {
        plan.unmatchedHwa.push({
          hwa: identifier,
          note: (row.megjegyzes ?? '').trim(),
          kind: identifierKind(identifier),
        });
      }
    }

    const building = matchBuilding(index, row.epulet, corrections);
    const floor = building ? matchFloor(index, building.id, row.emelet, corrections) : null;
    if (!building || !floor) {
      const b = (row.epulet ?? '').trim();
      const f = (row.emelet ?? '').trim();
      const key = `${fold(b)}|${fold(f)}`;
      const seen = plan.unmatchedPlace.get(key);
      if (seen) seen.rows++;
      else plan.unmatchedPlace.set(key, {
        building: b,
        floor: f,
        rows: 1,
        building_matched: !!building,
        building_id: building?.id ?? null,
      });
      continue;
    }

    const workAreaField = (row.work_area ?? '').trim();
    const workArea = matchWorkArea(index, floor.id, row.helyszin, workAreaField, corrections);
    if (!workArea) plan.noRoom++;
    if (!workArea && workAreaField) {
      const roomName = correct(corrections.work_area, workAreaField);
      const zoneName = correct(corrections.helyszin, (row.helyszin ?? '').trim());
      // The corrected name is what gets created, so one correction fixes the room's name
      // instead of leaving a misspelled rectangle behind.
      const key = `${floor.id}|${fold(zoneName)}|${fold(roomName)}`;
      const seen = plan.missingWorkAreas.get(key);
      if (seen) seen.rows++;
      else plan.missingWorkAreas.set(key, {
        floor_id: floor.id,
        where: `${building.name} / ${floor.name}`,
        zone_name: zoneName,
        room_name: roomName,
        raw_room_name: workAreaField,
        rows: 1,
      });
    }

    const person = matchPerson(personIndex, row.szemely, corrections);
    if ((row.szemely ?? '').trim() && !person.matched) {
      const name = row.szemely!.trim();
      const seen = plan.unmatchedPerson.get(name);
      if (seen) seen.rows++;
      else {
        // `person.fullName` is the corrected value when a correction applied, otherwise the
        // raw name — so a difference is exactly "a correction is stored and still misses".
        const corrected = person.fullName && fold(person.fullName) !== fold(name)
          ? person.fullName : null;
        plan.unmatchedPerson.set(name, { rows: 1, correctedTo: corrected });
      }
    }

    /**
     * What the survey recorded — and only that.
     *
     * A blank column in the survey means "not written down", not "nobody" and not "nothing".
     * Writing the blanks through would erase what the ITSM export already knew: measured on
     * the real survey, 310 of the 455 identified rows carry no person, and 233 of those are
     * devices whose person came from ITSM. Clearing them would have destroyed 233 assignments
     * and then reported 233 fresh "differs from ITSM" tasks to put them back.
     *
     * The walkers were recording rooms, not asking who sits where, so silence there is
     * expected rather than a correction. Where a name IS given it wins — the survey is the
     * physical truth about who is at that desk now, and the difference against ITSM is a real
     * task rather than a mistake.
     */
    const placementFields: Partial<Asset> = {
      building_id: building.id,
      floor_id: floor.id,
      // Sections deliberately unused — see matchWorkArea. The room is the WorkArea, so
      // there is no finer level left for the survey to fill, and a leftover section would
      // contradict the placement this row is making.
      section_id: null,
    };
    // A room only when one was found. A row naming no room, or a room that does not exist
    // yet, leaves any existing placement alone rather than knocking the device back out to
    // the floor — the missing room is reported, and a re-run after creating it lands right.
    if (workArea) placementFields.workarea_id = workArea.id;
    if (person.fullName) {
      placementFields.person_full_name = person.fullName;
      placementFields.person_itsm_id = person.itsmId;
      placementFields.person_id = person.personId;
    }
    const area = (row.terulet ?? '').trim();
    if (area) placementFields.network_domain = area;
    const note = (row.megjegyzes ?? '').trim();
    if (note) placementFields.notes = note;

    if (isHwa) {
      // Already resolved and reported above; nothing to place if it found nothing.
      if (!found) continue;
      plan.toUpdate.push({ assetId: found.asset.id, display: found.asset.display_name, fields: placementFields });
      continue;
    }

    const fromType = classifyFromTypeColumn(row.eszkoz_tipus);
    const deviceType = fromType.asset_type;
    const serial = usableSerial(row.sorozatszam);
    /**
     * The survey row's own id, tried before the serial.
     *
     * A device with no HWA and no serial has nothing else to be recognised by, so every
     * import created another copy of it — 14 per run on the real survey. The walk-around
     * tool gives each entry a stable id, and that is the identity those rows do have.
     * Tried first even when there IS a serial: the id is the more specific claim, and a
     * serial that has since been corrected in the survey would otherwise look like a
     * different device.
     */
    const existing = (row.id ? existingBySurveyRow.get(row.id) : undefined)
      ?? (serial ? existingBySerial.get(fold(serial)) : undefined);
    if (existing) {
      if (row.id && existingBySurveyRow.has(row.id)) plan.matchedBy['survey-row']++;
      else plan.matchedBy.serial++;
    }

    /**
     * "This screen belongs to that machine", written in the comment because the survey tool
     * has nowhere else to put it. Resolved through the same rules as the identifier column,
     * so a comment saying `hwa16775` works as well as `HWA16775`.
     */
    const parentHwa = parentHwaFromComment(row.megjegyzes);
    const parent = parentHwa ? resolveIdentifier(parentHwa) : null;
    if (parentHwa && !parent) {
      plan.parentUnknown.set(parentHwa, (plan.parentUnknown.get(parentHwa) ?? 0) + 1);
    }
    if (existing) {
      // Never clobber a value that may since have come from ITSM (e.g. if this local
      // asset got linked to a real HWA between survey runs) — only fill these two if
      // still empty, matching backfillAssetsFromSnapshot's never-overwrite convention.
      // Placement, person and notes always apply.
      plan.toUpdate.push({
        assetId: existing.id,
        display: existing.display_name,
        fields: {
          ...placementFields,
          /**
           * The type is normally left alone — it may have come from ITSM since. But a
           * LOCAL asset's type came from this same survey in the first place, and if it
           * currently reads "other" then the importer misread the column: the walkers wrote
           * a model or a word it did not know. A better reading of the same source should
           * replace that rather than being politely declined; 25 devices on the real survey
           * were stuck as "other", ten of them monitors that fell out of every count.
           */
          ...(existing.asset_type && !(existing.source_of_truth === 'local'
              && existing.asset_type === 'other' && deviceType !== 'other')
            ? {}
            : { asset_type: deviceType }),
          ...(existing.serial_number ? {} : { serial_number: serial }),
          // The survey's own words for the model, kept where they belong rather than used
          // once for classification and dropped.
          ...(fromType.model && !existing.model ? { model: fromType.model } : {}),
          // Stamped on the way past, so a device first matched by serial is recognisable by
          // its row from then on — including after somebody corrects that serial.
          ...(row.id && !existing.survey_row_id ? { survey_row_id: row.id } : {}),
        },
      });
      if (parent && parent.asset.id !== existing.id) {
        plan.parentLinks.push({
          childSurveyRowId: row.id ?? null,
          childAssetId: existing.id,
          parentAssetId: parent.asset.id,
          device: existing.display_name,
          parent: parent.asset.display_name,
        });
      }
      continue;
    }

    if (!serial) plan.createWithoutSerial++;
    const displayName = (row.megjegyzes ?? '').trim() || row.eszkoz_tipus || serial || 'Survey device';
    if (parent) {
      // The child does not exist yet; it is looked up by its survey row after the save.
      plan.parentLinks.push({
        childSurveyRowId: row.id ?? null,
        childAssetId: null,
        parentAssetId: parent.asset.id,
        device: displayName,
        parent: parent.asset.display_name,
      });
    }
    plan.toCreate.push({
      display: displayName,
      fields: {
        ...placementFields,
        display_name: displayName,
        asset_type: deviceType,
        model: fromType.model,
        serial_number: serial,
        // Without this a device with no number is created again on every import.
        survey_row_id: row.id ?? null,
        source_of_truth: 'local',
        is_managed: false,
        sync_status: 'never',
      },
    });
  }

  return plan;
}

// ── Creating the rooms the survey knows about ─────────────────────────────────
//
// Worth doing rather than drawing all of them by hand: the survey already knows every
// room's name and its zone, and the importer matches rooms BY NAME — so hand-typing them
// is both the slow part and the part that introduces the mismatches this planner then
// reports. Created rooms get a name, a zone and a default-size rectangle; positioning them
// on the floor plan stays manual, because only a person knows where the room is.
//
// They are laid out in a grid BELOW everything already drawn on that floor, so a fresh
// batch never lands on top of rectangles someone has already positioned.

const NEW_AREA_W = 150;
const NEW_AREA_H = 100;
const NEW_AREA_GAP = 20;
/** Matches the map's canvas width (see FloorMap's viewBox). */
const CANVAS_W = 1000;

export interface CreatedHierarchy {
  zones: number;
  work_areas: number;
  /** Rooms whose name now collides with another room on the same floor. */
  duplicate_names: string[];
}

async function createMissingWorkAreas(missing: MissingWorkArea[]): Promise<CreatedHierarchy> {
  const zoneRepo = AppDataSource.getRepository(Zone);
  const waRepo = AppDataSource.getRepository(WorkArea);
  const result: CreatedHierarchy = { zones: 0, work_areas: 0, duplicate_names: [] };

  // Grouped by floor: the layout and the zone lookup are both per floor.
  const byFloor = new Map<string, MissingWorkArea[]>();
  for (const room of missing) {
    const list = byFloor.get(room.floor_id) ?? [];
    list.push(room);
    byFloor.set(room.floor_id, list);
  }

  for (const [floorId, missingRooms] of byFloor) {
    const existingZones = await zoneRepo.find({ where: { floor_id: floorId } });
    const zoneByFolded = new Map(existingZones.map((z) => [fold(z.name), z]));

    // Zones first, so the rooms can point at them.
    for (const room of missingRooms) {
      if (!room.zone_name) continue;
      const key = fold(room.zone_name);
      if (zoneByFolded.has(key)) continue;
      const zone = await zoneRepo.save(zoneRepo.create({
        floor_id: floorId,
        name: room.zone_name,
        color: null,           // the map picks one; an explicit colour is a human decision
        description: null,
      }));
      zoneByFolded.set(key, zone);
      result.zones++;
    }

    const existingAreas = await waRepo.find({ where: { floor_id: floorId } });
    const existingNames = new Set(existingAreas.map((a) => fold(a.name)));
    // Start below the lowest thing already drawn, so nothing is buried.
    const lowestDrawn = existingAreas.reduce(
      (low, a) => Math.max(low, (a.coord_y ?? 0) + (a.dim_height ?? NEW_AREA_H)),
      0,
    );
    const startY = lowestDrawn > 0 ? lowestDrawn + NEW_AREA_GAP * 2 : NEW_AREA_GAP;
    const cols = Math.max(1, Math.floor((CANVAS_W - NEW_AREA_GAP) / (NEW_AREA_W + NEW_AREA_GAP)));

    const rooms = [...missingRooms].sort((a, b) =>
      (a.zone_name || '').localeCompare(b.zone_name || '') || a.room_name.localeCompare(b.room_name));

    const toSave: WorkArea[] = [];
    rooms.forEach((room, i) => {
      // Two zones can legitimately contain a room of the same name; the importer
      // disambiguates by zone. Worth flagging though — two identically named rectangles
      // on one floor are confusing to look at.
      if (existingNames.has(fold(room.room_name))) result.duplicate_names.push(`${room.where}: ${room.room_name}`);
      existingNames.add(fold(room.room_name));

      const col = i % cols;
      const row = Math.floor(i / cols);
      toSave.push(waRepo.create({
        floor_id: floorId,
        name: room.room_name,
        zone_id: room.zone_name ? (zoneByFolded.get(fold(room.zone_name))?.id ?? null) : null,
        coord_x: NEW_AREA_GAP + col * (NEW_AREA_W + NEW_AREA_GAP),
        coord_y: startY + row * (NEW_AREA_H + NEW_AREA_GAP),
        dim_width: NEW_AREA_W,
        dim_height: NEW_AREA_H,
        production_line_code: null,
        metadata: null,
      }));
    });

    if (toSave.length > 0) {
      await waRepo.save(toSave, { chunk: chunkForEntity(WorkArea) });
      result.work_areas += toSave.length;
    }
  }

  return result;
}

// ── Entry point ───────────────────────────────────────────────────────────────

export interface SurveyImportInput {
  rows: SurveyRow[];
  /** Not-yet-saved fixes, layered over the stored corrections for this run only. */
  corrections?: Corrections;
  /** Create the rooms the survey refers to and the map lacks. Only with `apply`. */
  createMissingWorkAreas?: boolean;
  apply: boolean;
}

/** The created assets and the ids of the updated ones, for the caller's audit trail. */
export interface SurveyImportResult {
  plan: SurveyImportPlan;
  created: Asset[];
  updatedIds: string[];
}

export async function planSurveyImport(input: SurveyImportInput): Promise<SurveyImportResult> {
  const corrections = await loadCorrections(input.corrections ?? {});
  let internal = await planInternal(input.rows, corrections);

  let createdAreas: CreatedHierarchy | null = null;
  if (input.apply && input.createMissingWorkAreas && internal.missingWorkAreas.size > 0) {
    createdAreas = await createMissingWorkAreas([...internal.missingWorkAreas.values()]);
    // Re-plan against the rooms that now exist, so this run's assets land in them rather
    // than needing a second pass.
    internal = await planInternal(input.rows, corrections);
  }

  const created: Asset[] = [];
  const updatedIds: string[] = [];
  let linksMade = 0;
  let linkedAlready = 0;
  if (input.apply) {
    // One transaction, so a failure part-way cannot leave half the survey applied — the
    // operator would otherwise have no way to tell which rows landed.
    await AppDataSource.transaction(async (manager) => {
      const assetRepo = manager.getRepository(Asset);
      for (const u of internal.toUpdate) {
        await assetRepo.update(u.assetId, u.fields);
        updatedIds.push(u.assetId);
      }
      if (internal.toCreate.length > 0) {
        // Chunked for MSSQL's parameter cap — see utils/mssqlBatch.ts.
        const saved = await assetRepo.save(
          internal.toCreate.map((c) => assetRepo.create(c.fields)),
          { chunk: chunkForEntity(Asset) },
        );
        created.push(...saved);
      }

      /**
       * The monitor-to-machine links the comment column asked for.
       *
       * Inside the same transaction as the placements, because a link to a device that was
       * not created is worse than no link. One directed row, `bidirectional: false`: the
       * direction carries the meaning here — an outbound `parent-child` row names the
       * asset's PARENT (see AssetRelationships.tsx) — so a mirrored row would claim the
       * machine's parent is its own screen.
       */
      const connRepo = manager.getRepository(AssetConnection);
      const byRow = new Map(created.filter((a) => a.survey_row_id).map((a) => [a.survey_row_id!, a]));
      for (const link of internal.parentLinks) {
        const childId = link.childAssetId
          ?? (link.childSurveyRowId ? byRow.get(link.childSurveyRowId)?.id : undefined);
        if (!childId) continue;
        // Idempotent: a re-import must not add a second copy of the same relationship.
        const already = await connRepo.createQueryBuilder('c')
          .where('c.asset_id = :child', { child: childId })
          .andWhere('c.connected_asset_id = :parent', { parent: link.parentAssetId })
          .andWhere('c.connection_type = :t', { t: 'parent-child' })
          .getCount();
        if (already > 0) { linkedAlready++; continue; }
        await connRepo.save(connRepo.create({
          asset_id: childId,
          connected_asset_id: link.parentAssetId,
          connection_type: 'parent-child',
          description: 'From the physical survey: the comment named this machine',
          bidirectional: false,
        }));
        linksMade++;
      }
    });
  }

  // Suggestion candidates, gathered once. Only the unmatched need them.
  const buildingNames = (await AppDataSource.getRepository(Building).find()).map((b) => b.name);
  const allFloors = await AppDataSource.getRepository(Floor).find();
  const areasByFloor = new Map<string, string[]>();
  for (const area of await AppDataSource.getRepository(WorkArea).find()) {
    const list = areasByFloor.get(area.floor_id) ?? [];
    list.push(area.name);
    areasByFloor.set(area.floor_id, list);
  }
  const personNames = [...(await buildPersonIndex()).values()].map((p) => p.full_name);

  const plan: SurveyImportPlan = {
    parsed: internal.rows,
    hwa_rows: internal.hwaRows,
    other_rows: internal.otherRows,
    to_update: internal.toUpdate.length,
    to_create: internal.toCreate.length,
    no_room: internal.noRoom,
    unmatched_place: [...internal.unmatchedPlace.values()]
      .sort((a, b) => b.rows - a.rows)
      .map((u) => ({
        building: u.building,
        floor: u.floor,
        rows: u.rows,
        building_matched: u.building_matched,
        // Each side is only proposed when it is the side that failed.
        building_suggestion: u.building_matched ? null : bestSuggestion(u.building, buildingNames),
        floor_suggestion: u.building_matched
          // Inside the building that did match: a floor called "1" in another building is
          // not a candidate for this one.
          ? bestSuggestion(u.floor, allFloors.filter((f) => f.building_id === u.building_id).map((f) => f.name))
          : null,
      })),
    missing_work_areas: [...internal.missingWorkAreas.values()]
      .sort((a, b) => b.rows - a.rows)
      .map((m) => ({
        where: m.where,
        zone_name: m.zone_name,
        room_name: m.room_name,
        raw_room_name: m.raw_room_name,
        rows: m.rows,
        suggestion: bestSuggestion(m.room_name, areasByFloor.get(m.floor_id) ?? []),
      })),
    unmatched_persons: [...internal.unmatchedPerson.entries()]
      .sort((a, b) => b[1].rows - a[1].rows)
      .map(([name, { rows, correctedTo }]) => ({
        name,
        rows,
        // Suggest against whichever name is currently being looked up, so a stored
        // correction that is one letter out gets the right proposal.
        suggestion: bestSuggestion(correctedTo ?? name, personNames),
        corrected_to: correctedTo,
      })),
    unmatched_hwa: internal.unmatchedHwa,
    matched_by: {
      hwa: internal.matchedBy.hwa,
      hwa_prefixed: internal.matchedBy['hwa-prefixed'],
      device_name: internal.matchedBy['device-name'],
      serial: internal.matchedBy.serial,
      survey_row: internal.matchedBy['survey-row'],
    },
    placeholder_serials: internal.placeholderSerials,
    parent_links: {
      // Before an apply this is what WOULD be linked; after one, what was.
      would_link: input.apply ? linksMade : internal.parentLinks.length,
      already_linked: linkedAlready,
      parent_unknown: [...internal.parentUnknown.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([hwa, rows]) => ({ hwa, rows })),
      sample: internal.parentLinks.slice(0, 15).map((l) => ({ device: l.device, parent: l.parent })),
    },
    create_without_serial: internal.createWithoutSerial,
    duplicates: [...internal.duplicates.values()].sort((a, b) => b.rows - a.rows),
    create_sample: internal.toCreate.slice(0, 25).map((c) => ({
      display: c.display,
      asset_type: String(c.fields.asset_type ?? 'other'),
      serial: c.fields.serial_number ?? null,
    })),
    created_areas: createdAreas,
    applied: input.apply,
  };

  return { plan, created, updatedIds };
}
