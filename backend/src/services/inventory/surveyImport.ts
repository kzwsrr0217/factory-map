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
import { Building } from '../../entities/Building.entity';
import { Floor } from '../../entities/Floor.entity';
import { WorkArea } from '../../entities/WorkArea.entity';
import { Zone } from '../../entities/Zone.entity';
import { ItsmHardwareSnapshot } from '../../entities/ItsmHardwareSnapshot.entity';
import { NameCorrection, NameCorrectionScope, NAME_CORRECTION_SCOPES } from '../../entities/NameCorrection.entity';
import { chunkForEntity, findByIn } from '../../utils/mssqlBatch';
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
};

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
  return DEVICE_TYPE_MAP[fold(eszkozTipus)] ?? 'other';
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

function bestSuggestion(target: string, candidates: string[]): string | null {
  const t = foldName(target);
  if (!t) return null;
  let best: string | null = null;
  let bestScore = 0;
  for (const candidate of candidates) {
    const c = foldName(candidate);
    if (!c) continue;
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
  unmatchedPerson: Map<string, number>;
  unmatchedHwa: Array<{ hwa: string; note: string }>;
  /** Rows that will land on a floor but in no room. */
  noRoom: number;
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
  unmatched_persons: Array<{ name: string; rows: number; suggestion: string | null }>;
  unmatched_hwa: Array<{ hwa: string; note: string }>;
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

  const hwaValues = rows.filter((r) => fold(r.azonosito_mod) === 'hwa' && r.hwa).map((r) => r.hwa!.trim());
  const existingByHwa = new Map<string, Asset>();
  if (hwaValues.length > 0) {
    // hardware_asset_id casing may not match the survey's ("hwa26255" vs "HWA26255") —
    // fetch broadly and fold-key it rather than relying on In() matching exactly.
    const candidates = await findByIn(assetRepo, 'hardware_asset_id', [...new Set(hwaValues)]);
    // Folded once into a set. Asking `candidates.some(...)` per value was O(rows × rows)
    // with an NFD normalise inside, which is where a 3000-row survey spent most of its time.
    const foundFolded = new Set(candidates.map((a) => fold(a.hardware_asset_id)));
    const anyMissing = hwaValues.some((v) => !foundFolded.has(fold(v)));
    const extra = anyMissing
      ? await assetRepo.createQueryBuilder('a').where('a.hardware_asset_id IS NOT NULL').getMany()
      : [];
    for (const a of [...candidates, ...extra]) {
      if (a.hardware_asset_id) existingByHwa.set(fold(a.hardware_asset_id), a);
    }
  }

  const serialValues = rows.filter((r) => fold(r.azonosito_mod) !== 'hwa' && r.sorozatszam).map((r) => r.sorozatszam!.trim());
  const existingBySerial = new Map<string, Asset>();
  if (serialValues.length > 0) {
    const existing = await findByIn(assetRepo, 'serial_number', [...new Set(serialValues)]);
    for (const a of existing) if (a.serial_number) existingBySerial.set(fold(a.serial_number), a);
  }

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
  };

  for (const row of rows) {
    const isHwa = fold(row.azonosito_mod) === 'hwa' && !!(row.hwa ?? '').trim();
    if (isHwa) plan.hwaRows++; else plan.otherRows++;

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
      plan.unmatchedPerson.set(name, (plan.unmatchedPerson.get(name) ?? 0) + 1);
    }

    const placementFields: Partial<Asset> = {
      building_id: building.id,
      floor_id: floor.id,
      workarea_id: workArea?.id ?? null,
      // Sections deliberately unused — see matchWorkArea. The room is the WorkArea, so
      // there is no finer level left for the survey to fill.
      section_id: null,
      person_full_name: person.fullName,
      person_itsm_id: person.itsmId,
      person_id: person.personId,
      network_domain: (row.terulet ?? '').trim() || null,
      notes: (row.megjegyzes ?? '').trim() || null,
    };

    if (isHwa) {
      const existing = existingByHwa.get(fold(row.hwa!.trim()));
      if (!existing) {
        plan.unmatchedHwa.push({ hwa: row.hwa!.trim(), note: (row.megjegyzes ?? '').trim() });
        continue;
      }
      plan.toUpdate.push({ assetId: existing.id, display: existing.display_name, fields: placementFields });
      continue;
    }

    const deviceType = classifyDeviceType(row.eszkoz_tipus);
    const serial = (row.sorozatszam ?? '').trim() || null;
    const existing = serial ? existingBySerial.get(fold(serial)) : undefined;
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
          ...(existing.asset_type ? {} : { asset_type: deviceType }),
          ...(existing.serial_number ? {} : { serial_number: serial }),
        },
      });
      continue;
    }

    const displayName = (row.megjegyzes ?? '').trim() || row.eszkoz_tipus || serial || 'Survey device';
    plan.toCreate.push({
      display: displayName,
      fields: {
        ...placementFields,
        display_name: displayName,
        asset_type: deviceType,
        serial_number: serial,
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
      .sort((a, b) => b[1] - a[1])
      .map(([name, rows]) => ({ name, rows, suggestion: bestSuggestion(name, personNames) })),
    unmatched_hwa: internal.unmatchedHwa,
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
