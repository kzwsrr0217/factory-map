/**
 * import-inventory-survey.ts — Imports the physical device inventory survey
 * (the "IT_Eszkoz_Nyilvantarto" walk-around tool) into factorymap.
 *
 * The survey records, per device found: which HWA (ITSM Hardware Asset) it
 * is (`azonosito_mod: "HWA"`) or, for devices ITSM doesn't track at all yet
 * — e.g. monitors — its type/serial number instead (`azonosito_mod:
 * "EGYEB"`, Hungarian for "other"), plus where it physically sits
 * (building/floor/`helyszín`/`work area` — a 4-level hierarchy matching
 * factorymap's Building > Floor > Zone > WorkArea exactly, with the tool's
 * `work_area` (the room) = WorkArea and `helyszín` = that room's Zone —
 * Sections are not used, see matchWorkArea) and
 * who uses it (`személy`, free text, not necessarily matching a real name).
 *
 * Two outcomes per row:
 *  - `HWA` rows update an EXISTING asset (already linked via the ITSM
 *    snapshot pipeline) with its real-world placement + assigned person.
 *    A row whose `hwa` doesn't match any known asset is reported, not
 *    guessed at — it likely still needs the unlinked-MMH bulk-create step,
 *    or has a typo.
 *  - `EGYEB` rows CREATE a new **local-only** asset (`source_of_truth:
 *    'local'`) — these aren't in ITSM at all yet. Someone will register them
 *    in Alemba by hand later (factorymap never writes to ITSM); at that
 *    point a human links the real HWA via the existing "search ITSM record"
 *    UI on the asset edit form, and the normal reconcile flow takes over.
 *    Matched against an existing local asset by serial number on re-runs,
 *    so re-importing a refined survey doesn't create duplicates.
 *
 * DRY RUN BY DEFAULT — this doubles as a validation tool. Building/Floor
 * always need to already exist. WorkAreas normally do too — the script matches
 * by name (case/diacritic-insensitive) and reports what didn't match, so
 * typos/nicknames can be fixed via an optional `inventory-corrections.json` in
 * the same directory. With `--create-missing-workareas` it will instead create
 * the rooms it couldn't find (and their zones) with default-size rectangles,
 * then re-plan so this run's assets land in them; positioning those rectangles
 * on the floor plan stays manual, since only a person knows where a room is.
 * The corrections file:
 *   { "persons": { "gorog tomi": "Görög Tamás" },
 *     "helyszin": { "hr": "HR" },
 *     "work_area": { "hr iroda": "HR Iroda" } }
 * Re-run (still dry-run) until the report is clean, then add `--apply`.
 *
 * Person matching is best-effort against names already known from the ITSM
 * snapshot (`itsm_hardware_snapshot.assigned_person_name`) — the survey's
 * names are informal/no-diacritics and won't all match; unmatched ones are
 * still stored as free-text `person_full_name`, correctable by hand later,
 * same "approximation, not authoritative" tradeoff as the ITSM person-ID
 * enrichment.
 *
 * Usage (reads every *.json survey export in the directory, merging by the
 * tool's own row `id` if the same entry appears in more than one file):
 *   npx ts-node src/scripts/import-inventory-survey.ts /path/to/export/dir            (dry run)
 *   npx ts-node src/scripts/import-inventory-survey.ts /path/to/export/dir --apply    (commit)
 */
import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { AppDataSource } from '../config/database';
import { Asset } from '../entities/Asset.entity';
import { Building } from '../entities/Building.entity';
import { Floor } from '../entities/Floor.entity';
import { WorkArea } from '../entities/WorkArea.entity';
import { Zone } from '../entities/Zone.entity';
import { ItsmHardwareSnapshot } from '../entities/ItsmHardwareSnapshot.entity';
import { chunkForEntity, findByIn } from '../utils/mssqlBatch';

interface SurveyRow {
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

interface SurveyFile {
  eszkozok?: SurveyRow[];
}

interface Corrections {
  building?: Record<string, string>;
  floor?: Record<string, string>;
  helyszin?: Record<string, string>;
  work_area?: Record<string, string>;
  persons?: Record<string, string>;
}

const CORRECTIONS_FILE = 'inventory-corrections.json';

// Device-type free text the survey tool can produce -> the app's asset_type
// buckets (see frontend/src/utils/assetTypes.ts ASSET_TYPE_MAP). Extend as
// more buildings surface new eszkoz_tipus values; unknown ones fall back to
// 'other' rather than being guessed at.
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

// Lowercase, diacritic-folded ("á" -> "a"), whitespace-stripped — handles the
// survey's informal/no-diacritics names ("rajnai agnes" vs "Rajnai Ágnes")
// and building-name spacing ("werk 1" vs "Werk1") in one normalization.
function fold(s: string | undefined | null): string {
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

function loadCorrections(dir: string): Corrections {
  const full = path.join(dir, CORRECTIONS_FILE);
  if (!fs.existsSync(full)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(full, 'utf8').replace(/^﻿/, ''));
    return parsed && typeof parsed === 'object' ? (parsed as Corrections) : {};
  } catch {
    console.warn(`⚠️  ${CORRECTIONS_FILE} is not valid JSON — ignoring it.`);
    return {};
  }
}

function readSurveyRows(dir: string): SurveyRow[] {
  const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.json') && f !== CORRECTIONS_FILE);
  const byKey = new Map<string, SurveyRow>();
  for (const file of files) {
    let parsed: SurveyFile;
    try {
      parsed = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8').replace(/^﻿/, ''));
    } catch {
      console.warn(`⚠️  ${file}: not valid JSON, skipping.`);
      continue;
    }
    if (!Array.isArray(parsed.eszkozok)) continue;
    for (const row of parsed.eszkozok) {
      // Last file read wins on a duplicate row id (a re-export overwriting an earlier one).
      byKey.set(row.id ?? JSON.stringify(row), row);
    }
  }
  return [...byKey.values()];
}

function classifyDeviceType(eszkozTipus: string | undefined): string {
  return DEVICE_TYPE_MAP[fold(eszkozTipus)] ?? 'other';
}

interface PersonMatch {
  fullName: string | null;
  itsmId: string | null;
  personId: string | null;
  matched: boolean;
}

async function buildPersonIndex(): Promise<Map<string, { full_name: string; itsm_id: string | null; person_id: string | null }>> {
  const rows = await AppDataSource.getRepository(ItsmHardwareSnapshot).find();
  const map = new Map<string, { full_name: string; itsm_id: string | null; person_id: string | null }>();
  for (const r of rows) {
    if (!r.assigned_person_name) continue;
    const key = fold(r.assigned_person_name);
    if (!map.has(key)) map.set(key, { full_name: r.assigned_person_name, itsm_id: r.person_itsm_id, person_id: r.person_id });
  }
  return map;
}

function matchPerson(index: Map<string, { full_name: string; itsm_id: string | null; person_id: string | null }>, szemely: string | undefined, corrections: Corrections): PersonMatch {
  const raw = (szemely ?? '').trim();
  if (!raw) return { fullName: null, itsmId: null, personId: null, matched: false };
  const corrected = correct(corrections.persons, raw);
  const hit = index.get(fold(corrected));
  if (hit) return { fullName: hit.full_name, itsmId: hit.itsm_id, personId: hit.person_id, matched: true };
  return { fullName: corrected, itsmId: null, personId: null, matched: false };
}

function matchBuilding(buildings: Building[], epulet: string | undefined, corrections: Corrections): Building | null {
  const corrected = correct(corrections.building, (epulet ?? '').trim());
  return buildings.find((b) => fold(b.name) === fold(corrected)) ?? null;
}

function matchFloor(floors: Floor[], buildingId: string, emelet: string | undefined, corrections: Corrections): Floor | null {
  const corrected = correct(corrections.floor, (emelet ?? '').trim());
  const inBuilding = floors.filter((f) => f.building_id === buildingId);
  const num = Number(corrected);
  if (corrected !== '' && !Number.isNaN(num)) {
    const byNumber = inBuilding.find((f) => f.floor_number === num);
    if (byNumber) return byNumber;
  }
  return inBuilding.find((f) => fold(f.name) === fold(corrected)) ?? null;
}

/**
 * Zones keyed by `floorId + '|' + foldedName`, so the survey's `helyszin`
 * resolves to a real Zone row without a per-row query.
 */
function indexZones(zones: Zone[]): Map<string, Zone> {
  const index = new Map<string, Zone>();
  for (const zone of zones) index.set(`${zone.floor_id}|${fold(zone.name)}`, zone);
  return index;
}

/**
 * Matches the survey's `work_area` (the fine-grained room — "recepcio",
 * "hr iroda", "cummins rotor 1") against WorkArea.name, optionally narrowed by
 * the survey's `helyszin` (the zone — "hr", "cummins") against the room's Zone.
 *
 * The survey's 4 levels map straight onto the app's:
 * `epulet` = Building, `emelet` = Floor, `helyszin` = **Zone**,
 * `work_area` = **WorkArea** (the room). Sections aren't used, because a Section
 * has no width/height in the schema and so can't be drawn on the floor map at
 * all — the rooms are what people actually draw.
 *
 * `helyszin` is used as a tiebreak rather than a hard filter: it disambiguates
 * same-named rooms in different zones without rejecting a room whose zone
 * simply hasn't been assigned on the map yet.
 */
function matchWorkArea(
  workAreas: WorkArea[],
  zoneIndex: Map<string, Zone>,
  floorId: string,
  helyszin: string | undefined,
  workAreaField: string | undefined,
  corrections: Corrections,
): WorkArea | null {
  const room = correct(corrections.work_area, (workAreaField ?? '').trim());
  if (!room) return null;
  const zoneName = correct(corrections.helyszin, (helyszin ?? '').trim());
  // Folded once, not per candidate — fold() does an NFD normalise plus a
  // per-codepoint loop, and this runs for every survey row.
  const foldedRoom = fold(room);
  const byName = workAreas.filter((w) => w.floor_id === floorId && fold(w.name) === foldedRoom);
  if (byName.length === 0) return null;
  if (byName.length === 1 || !zoneName) return byName[0];
  const zone = zoneIndex.get(`${floorId}|${fold(zoneName)}`);
  return (zone ? byName.find((w) => w.zone_id === zone.id) : undefined) ?? byName[0];
}

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
 * A room the survey refers to that doesn't exist on the map yet.
 *
 * Kept as structured fields rather than the "zone / room" display string it used
 * to be, because --create-missing-workareas needs the floor and the zone name to
 * actually create it. The display string is derived for the report instead.
 */
interface MissingWorkArea {
  floor_id: string;
  /** "Werk1 / Ground Floor", for the report only. */
  where: string;
  /** Corrected `helyszin`; empty when the survey didn't give one. */
  zone_name: string;
  /** Corrected `work_area` — becomes WorkArea.name. */
  room_name: string;
}

interface ImportPlan {
  toUpdate: PlannedUpdate[];
  toCreate: PlannedCreate[];
  unmatchedBuildingOrFloor: SurveyRow[];
  /** Keyed by floor + folded zone + folded room, so each room is reported once. */
  missingWorkAreas: Map<string, MissingWorkArea>;
  unmatchedPerson: Set<string>;
  unmatchedHwa: SurveyRow[];
}

async function planImport(rows: SurveyRow[], corrections: Corrections): Promise<ImportPlan> {
  const buildings = await AppDataSource.getRepository(Building).find();
  const floors = await AppDataSource.getRepository(Floor).find();
  const workAreas = await AppDataSource.getRepository(WorkArea).find();
  const zoneIndex = indexZones(await AppDataSource.getRepository(Zone).find());
  const personIndex = await buildPersonIndex();
  const assetRepo = AppDataSource.getRepository(Asset);

  const hwaValues = rows.filter((r) => fold(r.azonosito_mod) === 'hwa' && r.hwa).map((r) => r.hwa!.trim());
  const existingByHwa = new Map<string, Asset>();
  if (hwaValues.length > 0) {
    // hardware_asset_id casing may not match the survey's own casing exactly
    // (e.g. "hwa26255" vs "HWA26255") — fetch broadly and fold-key it rather
    // than relying on In() doing a case-sensitive exact match.
    const candidates = await findByIn(assetRepo, 'hardware_asset_id', [...new Set(hwaValues)]);
    const stillMissing = hwaValues.filter((v) => !candidates.some((a) => fold(a.hardware_asset_id) === fold(v)));
    const extra = stillMissing.length > 0
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

  const plan: ImportPlan = {
    toUpdate: [],
    toCreate: [],
    unmatchedBuildingOrFloor: [],
    missingWorkAreas: new Map(),
    unmatchedPerson: new Set(),
    unmatchedHwa: [],
  };

  for (const row of rows) {
    const building = matchBuilding(buildings, row.epulet, corrections);
    const floor = building ? matchFloor(floors, building.id, row.emelet, corrections) : null;
    if (!building || !floor) { plan.unmatchedBuildingOrFloor.push(row); continue; }

    const workAreaField = (row.work_area ?? '').trim();
    const workArea = matchWorkArea(workAreas, zoneIndex, floor.id, row.helyszin, workAreaField, corrections);
    if (!workArea && workAreaField) {
      const roomName = correct(corrections.work_area, workAreaField);
      const zoneName = correct(corrections.helyszin, (row.helyszin ?? '').trim());
      // Corrected names are what gets created, so that a corrections entry fixes
      // the room's name once instead of leaving a misspelled rectangle behind.
      plan.missingWorkAreas.set(`${floor.id}|${fold(zoneName)}|${fold(roomName)}`, {
        floor_id: floor.id,
        where: `${building.name} / ${floor.name}`,
        zone_name: zoneName,
        room_name: roomName,
      });
    }

    const person = matchPerson(personIndex, row.szemely, corrections);
    if ((row.szemely ?? '').trim() && !person.matched) plan.unmatchedPerson.add(row.szemely!.trim());

    const placementFields: Partial<Asset> = {
      building_id: building.id,
      floor_id: floor.id,
      workarea_id: workArea?.id ?? null,
      // Sections deliberately unused — see matchWorkArea's note. The room is
      // the WorkArea, so there's no finer level left for the survey to fill.
      section_id: null,
      person_full_name: person.fullName,
      person_itsm_id: person.itsmId,
      person_id: person.personId,
      network_domain: (row.terulet ?? '').trim() || null,
      notes: (row.megjegyzes ?? '').trim() || null,
    };

    const isHwa = fold(row.azonosito_mod) === 'hwa' && !!(row.hwa ?? '').trim();
    if (isHwa) {
      const existing = existingByHwa.get(fold(row.hwa!.trim()));
      if (!existing) { plan.unmatchedHwa.push(row); continue; }
      plan.toUpdate.push({ assetId: existing.id, display: existing.display_name, fields: placementFields });
      continue;
    }

    const deviceType = classifyDeviceType(row.eszkoz_tipus);
    const serial = (row.sorozatszam ?? '').trim() || null;
    const existing = serial ? existingBySerial.get(fold(serial)) : undefined;
    if (existing) {
      // Never clobber a value that might since have come from ITSM (e.g. if
      // this local asset got linked to a real HWA between survey runs) —
      // only fill these two if still empty, matching backfillAssetsFromSnapshot's
      // never-overwrite convention. Placement/person/notes always apply.
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

function printReport(plan: ImportPlan): void {
  console.log(`Matched for update (existing ITSM-linked/local assets): ${plan.toUpdate.length}`);
  console.log(`Matched for creation (new local-only assets, not yet in ITSM): ${plan.toCreate.length}`);

  if (plan.unmatchedBuildingOrFloor.length > 0) {
    const uniq = new Set(plan.unmatchedBuildingOrFloor.map((r) => `${r.epulet ?? '(blank)'} / floor "${r.emelet ?? '(blank)'}"`));
    console.log(`\n⚠️  ${plan.unmatchedBuildingOrFloor.length} row(s) had no matching Building/Floor — add a "building"/"floor" correction, or check the building/floor exist:`);
    for (const u of uniq) console.log(`   - ${u}`);
  }
  if (plan.missingWorkAreas.size > 0) {
    console.log(`\n⚠️  ${plan.missingWorkAreas.size} room(s) referenced by the survey don't exist on the map yet:`);
    for (const m of plan.missingWorkAreas.values()) {
      console.log(`   - ${m.where}: ${m.zone_name || '(no zone)'} / ${m.room_name}`);
    }
    console.log('   Either draw them (name = the room, Zone = the helyszín), fix the names via');
    console.log(`   ${CORRECTIONS_FILE}, or pass --create-missing-workareas to have them created.`);
  }
  if (plan.unmatchedPerson.size > 0) {
    console.log(`\n⚠️  ${plan.unmatchedPerson.size} distinct person name(s) didn't match anyone known from ITSM — add a "persons" correction if it's a typo/nickname, otherwise it's kept as free text:`);
    for (const u of plan.unmatchedPerson) console.log(`   - "${u}"`);
  }
  if (plan.unmatchedHwa.length > 0) {
    console.log(`\n⚠️  ${plan.unmatchedHwa.length} row(s) had an HWA number with no matching asset — likely still needs the unlinked-MMH bulk-create step, or has a typo:`);
    for (const r of plan.unmatchedHwa) console.log(`   - ${r.hwa} (${(r.megjegyzes ?? '').trim() || 'no note'})`);
  }
}

async function applyPlan(plan: ImportPlan): Promise<void> {
  // One transaction so a failure part-way can't leave half the survey applied —
  // the operator would otherwise have no way to tell which rows landed.
  await AppDataSource.transaction(async (manager) => {
    const assetRepo = manager.getRepository(Asset);
    for (const u of plan.toUpdate) {
      await assetRepo.update(u.assetId, u.fields);
    }
    if (plan.toCreate.length > 0) {
      // Chunked for MSSQL's parameter cap — see utils/mssqlBatch.ts.
      await assetRepo.save(
        plan.toCreate.map((c) => assetRepo.create(c.fields)),
        { chunk: chunkForEntity(Asset) },
      );
    }
  });
  console.log(`\n✅ Applied: ${plan.toUpdate.length} asset(s) updated, ${plan.toCreate.length} new local asset(s) created.`);
}

/**
 * Creates the rooms (and their zones) that the survey refers to but the map
 * doesn't have yet.
 *
 * Why this is worth doing rather than drawing all of them by hand: the survey
 * already knows every room's name and which zone it belongs to, and the importer
 * matches rooms *by name* — so hand-typing them is both the slow part and the
 * part that introduces the mismatches this script then reports. Created rooms get
 * a name, a zone and a default-size rectangle; positioning them on the floor plan
 * is still manual, because only a person knows where the room actually is.
 *
 * They are laid out in a grid **below everything already drawn on that floor**, so
 * a fresh batch never lands on top of rectangles someone has already positioned.
 */
const NEW_AREA_W = 150;
const NEW_AREA_H = 100;
const NEW_AREA_GAP = 20;
/** Matches the map's canvas width (see FloorMap's viewBox). */
const CANVAS_W = 1000;

interface CreatedHierarchy {
  zones: number;
  workAreas: number;
  /** Rooms whose name now collides with another room on the same floor. */
  duplicateNames: string[];
}

async function createMissingWorkAreas(plan: ImportPlan): Promise<CreatedHierarchy> {
  const zoneRepo = AppDataSource.getRepository(Zone);
  const waRepo = AppDataSource.getRepository(WorkArea);
  const result: CreatedHierarchy = { zones: 0, workAreas: 0, duplicateNames: [] };

  // Group by floor: the layout and the zone lookup are both per floor.
  const byFloor = new Map<string, MissingWorkArea[]>();
  for (const missing of plan.missingWorkAreas.values()) {
    const list = byFloor.get(missing.floor_id) ?? [];
    list.push(missing);
    byFloor.set(missing.floor_id, list);
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
      // disambiguates by zone. Worth flagging though - two identically named
      // rectangles on one floor are confusing to look at.
      if (existingNames.has(fold(room.room_name))) result.duplicateNames.push(`${room.where}: ${room.room_name}`);
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
      result.workAreas += toSave.length;
    }
  }

  return result;
}

function resolveDir(): string {
  const arg = process.argv[2];
  if (!arg) {
    console.error('✖ Usage: import-inventory-survey.ts <export-directory> [--create-missing-workareas] [--apply]');
    process.exit(1);
  }
  return path.resolve(arg);
}

async function main(): Promise<void> {
  const dir = resolveDir();
  const apply = process.argv.includes('--apply');
  const createMissing = process.argv.includes('--create-missing-workareas');
  if (!fs.existsSync(dir)) { console.error(`✖ Directory not found: ${dir}`); process.exit(1); }

  const corrections = loadCorrections(dir);
  const rows = readSurveyRows(dir);
  console.log(`📋 ${apply ? 'Importing' : 'Validating (dry-run)'} inventory survey from: ${dir}`);
  console.log(`  ${rows.length} survey entries found across the export file(s).\n`);

  await AppDataSource.initialize();
  try {
    let plan = await planImport(rows, corrections);
    printReport(plan);

    if (!apply) {
      if (createMissing && plan.missingWorkAreas.size > 0) {
        console.log(`\nℹ️  --create-missing-workareas would create ${plan.missingWorkAreas.size} room(s) and their zones, listed above.`);
      }
      console.log(`\nℹ️  Dry run only — nothing was written. Fix what's flagged above (via ${CORRECTIONS_FILE} in the same directory, by drawing the missing WorkAreas on the map, or by passing --create-missing-workareas), re-run to confirm it's clean, then pass --apply to commit.`);
      return;
    }

    if (createMissing && plan.missingWorkAreas.size > 0) {
      const created = await createMissingWorkAreas(plan);
      console.log(`\n🏗️  Created ${created.workAreas} work area(s) and ${created.zones} zone(s).`);
      console.log('   They have default-size rectangles stacked below whatever was already');
      console.log('   drawn on each floor — drag and resize them into place on the Map View.');
      if (created.duplicateNames.length > 0) {
        console.log(`   ⚠️  ${created.duplicateNames.length} share a name with another room on the same floor:`);
        for (const d of created.duplicateNames) console.log(`      - ${d}`);
      }
      // Re-plan against the rooms that now exist, so this run's assets land in
      // them instead of needing a second pass.
      plan = await planImport(rows, corrections);
      if (plan.missingWorkAreas.size > 0) {
        console.log(`   ⚠️  ${plan.missingWorkAreas.size} room(s) still unmatched after creation — see above.`);
      }
    }

    await applyPlan(plan);
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error('✖ Import failed:', err);
  process.exit(1);
});
