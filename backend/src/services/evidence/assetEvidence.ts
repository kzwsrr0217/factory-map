/**
 * assetEvidence.ts — what each source says about ONE device, side by side.
 *
 * The question this answers is the one you have while looking at a device: why does the app think
 * this, and who disagrees? Until the three landing tables existed it was unanswerable — the survey
 * file went back to somebody's Downloads folder and the ITSM export was replaced on every import.
 *
 * ── Why per asset and not a grid over the estate ────────────────────────────────
 * A three-column table of every device was the obvious idea and it does not survive contact with
 * the data:
 *
 *   - The sources do not have opinions on the same fields. Nexthink knows the OS and when the
 *     machine last reported, and nothing about who it is assigned to. ITSM knows the assignment and
 *     nothing about whether the machine is switched on. The overlap is a handful of fields, so most
 *     of a grid would be empty — and an empty cell reads as "missing" or "disagreement" when it
 *     means "this source has no opinion". That is worse than showing nothing.
 *   - The grain differs. Nexthink has one row per agent-carrying device, ITSM one per CI including
 *     monitors and phones, the survey one per observation — several can point at one device and 33
 *     point at none. "One row per asset" is not a shape all three fit.
 *   - Most cells would agree, and a screen that is 95% agreement gets skipped.
 *
 * The estate-wide version of "where do they disagree" is the task list, which names the action
 * rather than just the difference. This is the per-device counterpart.
 *
 * ── The two distinctions this file exists to preserve ───────────────────────────
 * 1. `has_opinion: false` is NOT `value: null`. A source that cannot know a field must render
 *    differently from one that knows it is empty, or the panel invents disagreements.
 * 2. The person row holds three different claims that look like one: ITSM's ASSIGNED owner, the
 *    survey's OBSERVED occupant, and Nexthink's heaviest LOGON. They routinely differ without
 *    anything being wrong — somebody moved desk, or a colleague signed in once. Each cell says
 *    which of the three it is; a single "person" row without that would be a machine for
 *    generating false alarms.
 */
import { In } from 'typeorm';
import { AppDataSource } from '../../config/database';
import { Asset } from '../../entities/Asset.entity';
import { Building } from '../../entities/Building.entity';
import { Floor } from '../../entities/Floor.entity';
import { WorkArea } from '../../entities/WorkArea.entity';
import { ItsmHardwareSnapshot } from '../../entities/ItsmHardwareSnapshot.entity';
import { NexthinkDeviceSnapshot } from '../../entities/NexthinkDeviceSnapshot.entity';
import { NexthinkLoginSnapshot } from '../../entities/NexthinkLoginSnapshot.entity';
import { SurveyObservation } from '../../entities/SurveyObservation.entity';
import { itsmStatusToLocal } from '../itsm/statusMapping';

export type EvidenceSource = 'map' | 'itsm' | 'nexthink' | 'survey';

export interface EvidenceCell {
  /** Null means this source has it empty; see has_opinion for "cannot know". */
  value: string | null;
  /**
   * False when the source structurally cannot know this field — Nexthink and who a device is
   * assigned to, for instance. Rendered as a dash rather than a blank, so it never looks like
   * a disagreement.
   */
  has_opinion: boolean;
  /** Shown where the same word means different things per source. See the file header. */
  qualifier?: string;
  /**
   * False when this cell's value is in a DIFFERENT VOCABULARY from the others, so a difference
   * carries no meaning. Nexthink's `hardware.type` is desktop/laptop/virtual with no monitor or
   * ipc bucket; ITSM's location is a site ("MMH Veszprém") and never a room; a Nexthink entity is
   * not a place at all.
   *
   * Separate from `has_opinion` because these cells DO have a value worth showing — they just must
   * not be compared. The first version of this file qualified them in prose and then compared them
   * anyway, which flagged three false disagreements on the very first device tried.
   *
   * A difference in MEANING is not the same thing: ITSM's assigned owner versus Nexthink's heaviest
   * logon are both people, in the same vocabulary, and their difference is exactly the signal the
   * person row exists for. Those stay comparable.
   */
  comparable?: boolean;
}

export interface EvidenceField {
  field: string;
  label: string;
  map: EvidenceCell;
  itsm: EvidenceCell;
  nexthink: EvidenceCell;
  survey: EvidenceCell;
  /** True when two or more sources that DO have an opinion, and a value, disagree. */
  disagrees: boolean;
}

export interface SourcePresence {
  present: boolean;
  /** When this source last said anything about this device. */
  as_of: Date | null;
  /** Why it has nothing, when it has nothing. */
  absent_reason?: string;
}

export interface AssetEvidence {
  asset_id: string;
  display_name: string;
  hardware_asset_id: string | null;
  sources: Record<Exclude<EvidenceSource, 'map'>, SourcePresence>;
  fields: EvidenceField[];
  /** Facts that are not field comparisons: who signed in, how often, when last seen. */
  activity: {
    last_seen: Date | null;
    entity: string | null;
    logons: Array<{ full_name: string | null; user_name: string; logins: number; account_kind: string }>;
  } | null;
  /** Survey values the import declined to apply because the record already held another. */
  suppressed_by_import: Array<{ field: string; app_value: string | null; survey_value: string | null }>;
}

const NO_OPINION: EvidenceCell = { value: null, has_opinion: false };
const cell = (value: string | null | undefined, qualifier?: string): EvidenceCell => ({
  value: value === undefined || value === '' ? null : value,
  has_opinion: true,
  ...(qualifier ? { qualifier } : {}),
});
/** Worth showing, wrong to compare. The qualifier is required: the reader has to know why. */
const shownNotCompared = (value: string | null | undefined, qualifier: string): EvidenceCell => ({
  ...cell(value, qualifier),
  comparable: false,
});

/**
 * Cell builders bound to whether that source has a row for this device AT ALL.
 *
 * Without this, a source with no row produced `has_opinion: true, value: null` for every field —
 * "I looked and it is empty" — when the truth is "there is nothing to look at". On a monitor, which
 * carries no Nexthink agent by definition, that rendered five fields as empty Nexthink opinions
 * instead of dashes. It is the same distinction the file header claims to protect, and it was
 * broken at the level below the one where it was being enforced.
 */
function cellsFor(present: boolean) {
  return {
    plain: (value: string | null | undefined, qualifier?: string): EvidenceCell =>
      (present ? cell(value, qualifier) : NO_OPINION),
    uncompared: (value: string | null | undefined, qualifier: string): EvidenceCell =>
      (present ? shownNotCompared(value, qualifier) : NO_OPINION),
  };
}

/** Accent- and case-insensitive, so a disagreement is never just spelling. */
function fold(value: string | null): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Disagreement means: of the cells that have an opinion AND a value, more than one distinct value.
 *
 * Cells with no opinion are ignored rather than counted as blank, and an empty value is ignored
 * rather than counted as a distinct answer — "ITSM has nobody assigned" is a gap, not a
 * contradiction of the survey having found somebody.
 */
export function disagrees(cells: EvidenceCell[]): boolean {
  const stated = cells
    .filter((c) => c.has_opinion && c.value && c.comparable !== false)
    .map((c) => fold(c.value));
  return new Set(stated).size > 1;
}

function field(
  name: string,
  label: string,
  cells: { map: EvidenceCell; itsm: EvidenceCell; nexthink: EvidenceCell; survey: EvidenceCell },
): EvidenceField {
  return {
    field: name,
    label,
    ...cells,
    disagrees: disagrees([cells.map, cells.itsm, cells.nexthink, cells.survey]),
  };
}

export async function buildAssetEvidence(assetId: string): Promise<AssetEvidence | null> {
  const asset = await AppDataSource.getRepository(Asset).findOne({ where: { id: assetId } });
  if (!asset) return null;

  const hwa = asset.hardware_asset_id?.trim() ?? null;

  // ── ITSM ────────────────────────────────────────────────────────────────────
  const itsmRow = hwa
    ? await AppDataSource.getRepository(ItsmHardwareSnapshot).findOne({ where: { itsm_id: hwa } })
    : null;

  // ── Nexthink: by HWA, then by display name, the same two steps as everywhere ──
  const deviceRepo = AppDataSource.getRepository(NexthinkDeviceSnapshot);
  const nxRow = (hwa ? await deviceRepo.findOne({ where: { device_name: hwa } }) : null)
    ?? await deviceRepo.findOne({ where: { device_name: asset.display_name } });
  const logons = nxRow
    ? await AppDataSource.getRepository(NexthinkLoginSnapshot)
      .find({ where: { device_name: nxRow.device_name }, order: { logins: 'DESC' } })
    : [];
  // Only a named person counts as the heaviest user: admin, machine and generic accounts are on
  // everything and would name the wrong human on every shop-floor device.
  const topPerson = logons.find((l) => l.account_kind === 'person' && l.full_name);

  // ── Survey: the most recent observation that resolved to this asset ──────────
  const surveyRow = await AppDataSource.getRepository(SurveyObservation).findOne({
    where: { resolved_asset_id: asset.id },
    order: { imported_at: 'DESC' },
  });

  // One builder per source, so "no row at all" cannot masquerade as "an empty value".
  const I = cellsFor(!!itsmRow);
  const N = cellsFor(!!nxRow);
  const S = cellsFor(!!surveyRow);

  // ── The map's own place, resolved to names ──────────────────────────────────
  const [building, floor, room] = await Promise.all([
    asset.building_id
      ? AppDataSource.getRepository(Building).findOne({ where: { id: asset.building_id } }) : null,
    asset.floor_id
      ? AppDataSource.getRepository(Floor).findOne({ where: { id: asset.floor_id } }) : null,
    asset.workarea_id
      ? AppDataSource.getRepository(WorkArea).findOne({ where: { id: asset.workarea_id } }) : null,
  ]);
  const mapPlace = [building?.name, floor?.name, room?.name].filter(Boolean).join(' / ') || null;
  const surveyPlace = surveyRow
    ? [surveyRow.epulet, surveyRow.emelet, surveyRow.helyszin, surveyRow.work_area]
      .filter(Boolean).join(' / ') || null
    : null;

  const fields: EvidenceField[] = [
    field('serial_number', 'Serial number', {
      map: cell(asset.serial_number),
      itsm: I.plain(itsmRow?.serial_number),
      // NOT the same identifier: the Nexthink export carries three different serials (BIOS,
      // chassis and a UUID-format one) and only the BIOS one resembles what Alemba holds. Given
      // its own row below rather than compared here, so a mismatch of two different things
      // cannot be reported as a disagreement.
      nexthink: NO_OPINION,
      survey: S.plain(surveyRow?.sorozatszam),
    }),
    field('bios_serial', 'BIOS serial (Nexthink only)', {
      map: NO_OPINION,
      itsm: NO_OPINION,
      nexthink: N.plain(nxRow?.bios_serial, 'as the BIOS reports it'),
      survey: NO_OPINION,
    }),
    field('model', 'Model', {
      map: cell(asset.model),
      itsm: I.plain(itsmRow?.model),
      nexthink: N.plain(nxRow?.model),
      survey: NO_OPINION,
    }),
    field('manufacturer', 'Manufacturer', {
      map: cell(asset.manufacturer),
      itsm: I.plain(itsmRow?.manufacturer),
      nexthink: N.plain(nxRow?.manufacturer),
      survey: NO_OPINION,
    }),
    field('asset_type', 'Type', {
      map: cell(asset.asset_type),
      itsm: I.plain(itsmRow?.asset_type),
      // Nexthink's hardware.type is desktop/laptop/virtual and has no ipc or monitor bucket, so
      // it is shown but qualified rather than compared as if it used the same vocabulary.
      nexthink: N.uncompared(nxRow?.hardware_type, 'Nexthink vocabulary: desktop / laptop / virtual'),
      survey: S.plain(surveyRow?.eszkoz_tipus, 'as the walker wrote it'),
    }),
    /**
     * The row that needs its qualifiers most. Three different claims that look like one, and they
     * differ routinely without anything being wrong.
     */
    field('person', 'Person', {
      map: cell(asset.person_full_name),
      itsm: I.plain(itsmRow?.assigned_person_name, 'assigned in Alemba'),
      nexthink: !nxRow
        ? NO_OPINION
        : topPerson
          ? cell(topPerson.full_name, `heaviest logon (${topPerson.logins}x)`)
          // The device reports, but only generic or admin accounts ever signed in. That is a
          // real, stated opinion — "nobody named uses this" — not an absence.
          : { value: null, has_opinion: true, qualifier: 'reports, but no named logon' },
      survey: S.plain(surveyRow?.szemely, 'seen at the device'),
    }),
    /**
     * Status goes through `itsmStatusToLocal`, not compared as raw text. Alemba says "Deployed"
     * where the app says "active" — the same fact in two vocabularies, and the repo already owns
     * the mapping (statusMapping.ts, used by the reconcile page). Comparing the raw strings marked
     * every linked asset as disagreeing, which is a false alarm on over a thousand devices.
     */
    field('status', 'Status', {
      map: cell(asset.status),
      itsm: itsmRow
        ? cell(itsmStatusToLocal(itsmRow.status), `Alemba says "${itsmRow.status ?? '(empty)'}"`)
        : NO_OPINION,
      nexthink: NO_OPINION,
      survey: NO_OPINION,
    }),
    field('os', 'Operating system', {
      map: cell([asset.os_type, asset.os_version].filter(Boolean).join(' ') || null),
      itsm: I.plain([itsmRow?.os_type, itsmRow?.os_version].filter(Boolean).join(' ') || null),
      nexthink: N.plain(nxRow?.os_name, 'what the machine reports'),
      survey: NO_OPINION,
    }),
    field('mac_address', 'MAC address', {
      map: cell(asset.mac_address),
      itsm: I.plain(itsmRow?.mac_address),
      nexthink: NO_OPINION,
      survey: NO_OPINION,
    }),
    field('place', 'Where it is', {
      map: cell(mapPlace),
      // ITSM's location is free text at site level ("MMH Veszprém"), not a room, so it is shown
      // qualified and never compared against a room name.
      itsm: I.uncompared(itsmRow?.location_name, 'site level only'),
      nexthink: N.uncompared(nxRow?.entity, 'Nexthink entity, not a place'),
      /**
       * Raw survey text, never compared against the map's resolved names. It cannot match: the
       * walker wrote "Werk 2 / 1 / Rotor" and the map holds "Werk 2 / First Floor / Rotor 1"
       * because the importer RESOLVED the former into the latter. Comparing them compares a value
       * against its own resolution and flags every surveyed device as disagreeing.
       */
      survey: S.uncompared(surveyPlace, 'as the walker wrote it, before place matching'),
    }),
  ];

  return {
    asset_id: asset.id,
    display_name: asset.display_name,
    hardware_asset_id: hwa,
    sources: {
      itsm: itsmRow
        ? { present: true, as_of: itsmRow.imported_at ?? null }
        : {
          present: false,
          as_of: null,
          absent_reason: hwa
            ? 'The loaded ITSM export does not contain this HWA.'
            : 'This asset has no HWA number, so there is nothing to look up in ITSM.',
        },
      nexthink: nxRow
        ? { present: true, as_of: nxRow.imported_at ?? null }
        : {
          present: false,
          as_of: null,
          /**
           * The one absence that is a finding rather than a gap — but only sometimes, which is
           * why it is phrased as two possibilities. Nexthink ages long-inactive devices out of
           * the export entirely, so absence can mean retired; it can equally mean the device
           * carries no agent, which is true of every monitor.
           */
          absent_reason: 'Not in the Nexthink export: either it carries no agent (monitors never do),'
            + ' or it has not reported for long enough to be aged out.',
        },
      survey: surveyRow
        ? { present: true, as_of: surveyRow.imported_at ?? null }
        : { present: false, as_of: null, absent_reason: 'The last survey round did not resolve any row to this device.' },
    },
    fields,
    activity: nxRow
      ? {
        last_seen: nxRow.last_seen,
        entity: nxRow.entity,
        logons: logons.map((l) => ({
          full_name: l.full_name,
          user_name: l.user_name,
          logins: l.logins,
          account_kind: l.account_kind,
        })),
      }
      : null,
    suppressed_by_import: surveyRow?.suppressed_fields ?? [],
  };
}

/** Bulk variant is deliberately absent — see the file header on why there is no estate-wide grid. */
export async function assetIdsWithEvidence(ids: string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await AppDataSource.getRepository(SurveyObservation)
    .find({ where: { resolved_asset_id: In(ids) }, select: { resolved_asset_id: true } });
  return new Set(rows.map((r) => r.resolved_asset_id!).filter(Boolean));
}
