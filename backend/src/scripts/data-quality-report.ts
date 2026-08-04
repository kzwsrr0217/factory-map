/**
 * data-quality-report.ts — What is wrong with the asset data itself.
 *
 * The third report, and deliberately separate from the other two: they each answer
 * a different question, get run by different people, and share no inputs.
 *
 *   reconcile-report.ts     "does our data match ITSM?"
 *   network-gaps-report.ts  "how far along is the cabling survey?"
 *   this one                "is the asset data internally sound?"
 *
 * Its sections are the mistakes a bulk import makes, which is why it exists now:
 * the same device surveyed twice under two serials, an HWA typed in twice, rows
 * with nothing to identify them by. None of these are visible one asset at a time
 * — they are only findable by comparing rows against each other.
 *
 * Fully read-only. Nothing here writes, and nothing talks to ITSM.
 *
 * Usage:
 *   npm run report:quality
 *   npm run report:quality -- --csv=/tmp/data-quality.csv
 */
import 'reflect-metadata';
import * as fs from 'fs';
import { AppDataSource } from '../config/database';
import { Asset } from '../entities/Asset.entity';
import { Building } from '../entities/Building.entity';
import { Floor } from '../entities/Floor.entity';
import { WorkArea } from '../entities/WorkArea.entity';

/**
 * Asset types that should carry a serial number. Monitors and phones often ship
 * without one recorded, and listing them would bury the cases worth chasing.
 */
const SERIAL_EXPECTED = new Set(['workstation', 'server', 'laptop', 'ipc', 'plc', 'printer', 'terminal']);

function csvEscape(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

interface Row {
  section: string;
  item: string;
  where: string;
  detail: string;
}

function printSection(title: string, rows: Row[], emptyText: string, limit = 20): void {
  console.log(`\n${title}: ${rows.length}`);
  if (rows.length === 0) {
    console.log(`   ${emptyText}`);
    return;
  }
  for (const r of rows.slice(0, limit)) {
    console.log(`   - ${r.item}${r.where ? `  [${r.where}]` : ''}${r.detail ? `  ${r.detail}` : ''}`);
  }
  // Never truncate quietly: a capped list that looks complete makes the remainder
  // nobody's problem.
  if (rows.length > limit) {
    console.log(`   … and ${rows.length - limit} more (use --csv for all of them)`);
  }
}

/** Case- and whitespace-insensitive key, so "abc123" and " ABC123 " collide. */
function fold(v: string): string {
  return v.trim().toLowerCase();
}

/**
 * Statuses that mean the asset is gone. Everything else counts as live —
 * including "inactive", which is a device sitting in a cupboard, not a device
 * that stopped existing.
 */
const RETIRED_STATUSES = new Set(['decommissioned', 'retired']);
const isRetired = (a: Asset): boolean => RETIRED_STATUSES.has((a.status ?? '').toLowerCase());

/**
 * What a group of assets sharing an identifier actually is. The three cases want
 * three different responses, and a flat "N duplicates" list gets them confused —
 * which is dangerous in one specific direction: several of the collisions in real
 * data are docking stations whose "serial" is a Dell PPID, i.e. a model-level code
 * identical across every unit. Merging those would delete a real device, and docks
 * are what hold the wall socket in the connection model.
 */
type DuplicateKind = 'all-live' | 'redeployment' | 'all-retired';

function classify(group: Asset[]): DuplicateKind {
  const live = group.filter((a) => !isRetired(a));
  if (live.length === group.length) return 'all-live';
  if (live.length === 0) return 'all-retired';
  return 'redeployment';
}

/**
 * Whether a shared "serial" looks like a model-level part number rather than a
 * per-unit one.
 *
 * The specific trap in this data: Dell accessories carry a PPID like
 * `CN-05FDDV-12966-81C-3C80-A05`, identical across every unit of the model, and it
 * ends up in the serial field. Two docks sharing one are two real devices, and
 * merging them would delete one — docks are what hold the wall socket in the
 * connection model, so it matters beyond the asset list.
 *
 * Detected by shape, the only honest signal available here: a Dell service tag is
 * seven alphanumerics, a PPID is far longer and hyphenated. It says "looks like",
 * and the report prints each member's own fields so a person can judge.
 *
 * An earlier version of this check claimed "probably separate devices, do not
 * merge" whenever the members had distinct asset tags. That was circular: in this
 * data the asset tag is derived from each record's own HWA, so it differs for every
 * pair by construction and proved nothing — it fired on all six serial collisions,
 * including the workstation redeployments where merging is exactly the right call.
 */
const UNIT_SERIAL_MAX = 12;

function looksLikeModelCode(sharedValue: string): boolean {
  return sharedValue.length > UNIT_SERIAL_MAX && sharedValue.includes('-');
}

/**
 * A MAC reduced to bare uppercase hex, so `18:03:73:DE:BE:1D`,
 * `18-03-73-DE-BE-1D` and `180373DEBE1D` all compare equal.
 *
 * This matters well beyond tidiness. The plan for filling in switch ports after the
 * replacement is to join the switches' MAC address tables against `Asset.mac_address`
 * (docs/CONNECTIONS_WORKFLOW.md, phase C) — the single highest-value automation in
 * the whole connection story. A naive join would silently miss every asset stored
 * in a different separator style, and "silently missed" is the failure mode that
 * matters: those sockets would look un-surveyed rather than unmatched.
 */
function normaliseMac(mac: string): string {
  return mac.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
}

/** A MAC is canonical if it is 12 hex digits in colon-separated pairs. */
function isCanonicalMac(mac: string): boolean {
  return /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(mac.trim().toUpperCase());
}

/** The members' own identifying fields, so the reader can tell them apart. */
function memberDetail(a: Asset): string {
  return [
    a.asset_type ? `type ${a.asset_type}` : null,
    a.mac_address ? `MAC ${a.mac_address}` : null,
    a.catalog_display_name || null,
  ].filter(Boolean).join(', ');
}

const KIND_HEADINGS: Record<DuplicateKind, string> = {
  'all-live': 'all live — decide which record is the real one',
  redeployment: 'one live, the rest retired — looks like a redeployment; link them old → new',
  'all-retired': 'retired only — history, no action needed',
};

/** Prints a duplicate section split by what each group actually is. */
function printDuplicates(title: string, groups: Array<{ value: string; group: Asset[]; kind: DuplicateKind; note: string | null }>, emptyText: string): void {
  console.log(`\n${title}: ${groups.length}`);
  if (groups.length === 0) {
    console.log(`   ${emptyText}`);
    return;
  }
  for (const kind of ['all-live', 'redeployment', 'all-retired'] as DuplicateKind[]) {
    const of = groups.filter((g) => g.kind === kind);
    if (of.length === 0) continue;
    console.log(`   ${KIND_HEADINGS[kind]} (${of.length}):`);
    for (const g of of) {
      console.log(`     - ${g.value}`);
      for (const a of g.group) {
        const detail = memberDetail(a);
        console.log(`         ${a.display_name} (${a.status ?? 'no status'})${detail ? ` — ${detail}` : ''}`);
      }
      if (g.note) console.log(`         ⓘ ${g.note}`);
    }
  }
}

async function main(): Promise<void> {
  const csvArg = process.argv.find((a) => a.startsWith('--csv='));
  const csvPath = csvArg ? csvArg.slice('--csv='.length) : null;

  await AppDataSource.initialize();
  try {
    const assets = await AppDataSource.getRepository(Asset).find();
    const buildings = await AppDataSource.getRepository(Building).find();
    const floors = await AppDataSource.getRepository(Floor).find();
    const areas = await AppDataSource.getRepository(WorkArea).find();

    const buildingById = new Map(buildings.map((b) => [b.id, b]));
    const floorById = new Map(floors.map((f) => [f.id, f]));
    const areaById = new Map(areas.map((a) => [a.id, a]));

    // Superseded rows are the historical half of a replacement: their duplicate
    // serial IS the point, and flagging them would drown the real findings.
    const live = assets.filter((a) => !a.successor_id);

    const placeOf = (a: Asset): string => {
      const floor = a.floor_id ? floorById.get(a.floor_id) : undefined;
      const building = a.building_id ? buildingById.get(a.building_id) : undefined;
      const area = a.workarea_id ? areaById.get(a.workarea_id) : undefined;
      return [building?.name, floor?.name, area?.name].filter(Boolean).join(' / ') || 'not placed';
    };

    const rows: Row[] = [];
    const add = (section: string, item: string, where: string, detail: string): Row => {
      const row = { section, item, where, detail };
      rows.push(row);
      return row;
    };

    /** Groups live assets by a folded field value, keeping only the collisions. */
    const collisionsBy = (field: 'serial_number' | 'hardware_asset_id' | 'asset_tag'): Map<string, Asset[]> => {
      const byValue = new Map<string, Asset[]>();
      for (const a of live) {
        const raw = a[field];
        if (!raw || !fold(raw)) continue;
        const key = fold(raw);
        byValue.set(key, [...(byValue.get(key) ?? []), a]);
      }
      return new Map([...byValue].filter(([, group]) => group.length > 1));
    };

    /** Builds the classified groups for one field, and records them as CSV rows. */
    const duplicatesOf = (field: 'serial_number' | 'hardware_asset_id' | 'asset_tag', section: string) => {
      return [...collisionsBy(field)].map(([value, group]) => {
        const kind = classify(group);
        const note = looksLikeModelCode(value)
          ? 'the shared value looks like a model-level part number (e.g. a Dell PPID), not a unit serial'
          : null;
        add(section, value, kind,
          group.map((a) => `${a.display_name} (${a.status ?? 'no status'})`).join('; ')
          + (note ? ` — ${note}` : ''));
        return { value, group, kind, note };
      });
    };

    const dupSerial = duplicatesOf('serial_number', 'duplicate-serial');
    const dupHwa = duplicatesOf('hardware_asset_id', 'duplicate-hardware-asset-id');
    const dupTag = duplicatesOf('asset_tag', 'duplicate-asset-tag');

    // MACs are grouped on the normalised value, so two records of the same machine
    // stored with different separators collide as they should.
    const byMac = new Map<string, Asset[]>();
    for (const a of live) {
      if (!a.mac_address || !normaliseMac(a.mac_address)) continue;
      const key = normaliseMac(a.mac_address);
      byMac.set(key, [...(byMac.get(key) ?? []), a]);
    }
    const dupMac = [...byMac].filter(([, g]) => g.length > 1).map(([value, group]) => {
      const kind = classify(group);
      add('duplicate-mac', value, kind,
        group.map((a) => `${a.display_name} (${a.status ?? 'no status'})`).join('; '));
      return { value, group, kind, note: null as string | null };
    });

    // Two different problems, so two lists. A malformed MAC is a typo to correct;
    // a differently separated one is only a problem for whoever joins on it.
    const malformedMac: Row[] = [];
    const differentlySeparatedMac: Row[] = [];
    for (const a of live) {
      if (!a.mac_address?.trim()) continue;
      const hex = normaliseMac(a.mac_address);
      if (hex.length !== 12) {
        malformedMac.push(add('mac-malformed', a.display_name, placeOf(a),
          `stored as "${a.mac_address}" — ${hex.length} hex digits, not 12`
          + (/[^0-9a-fA-F:.\- ]/.test(a.mac_address) ? ' (contains a non-hex character — likely O for 0 or I for 1)' : '')));
      } else if (!isCanonicalMac(a.mac_address)) {
        differentlySeparatedMac.push(add('mac-not-canonical', a.display_name, placeOf(a),
          `stored as "${a.mac_address}"`));
      }
    }

    // A row with no serial, no HWA and no asset tag cannot be matched against
    // anything — not a re-import, not an ITSM record, not a device in someone's
    // hand. It is the one gap that makes every later reconcile impossible.
    const unidentifiable: Row[] = [];
    const missingSerial: Row[] = [];
    const noType: Row[] = [];
    const orphanRefs: Row[] = [];

    for (const a of live) {
      const hasSerial = !!a.serial_number?.trim();
      const hasHwa = !!a.hardware_asset_id?.trim();
      const hasTag = !!a.asset_tag?.trim();
      if (!hasSerial && !hasHwa && !hasTag) {
        unidentifiable.push(add('no-identifier', a.display_name, placeOf(a), a.asset_type ?? ''));
      } else if (!hasSerial && SERIAL_EXPECTED.has((a.asset_type ?? '').toLowerCase())) {
        missingSerial.push(add('missing-serial', a.display_name, placeOf(a), a.asset_type ?? ''));
      }

      if (!a.asset_type?.trim()) {
        noType.push(add('no-type', a.display_name, placeOf(a),
          'type drives the map icon, the reports and the wired-device checks'));
      }

      // Hierarchy columns are plain ids with no FK, so they can outlive what they
      // point at — a deleted floor leaves assets referencing nothing.
      if (a.building_id && !buildingById.has(a.building_id)) {
        orphanRefs.push(add('dangling-reference', a.display_name, '', `building_id ${a.building_id} does not exist`));
      }
      if (a.floor_id && !floorById.has(a.floor_id)) {
        orphanRefs.push(add('dangling-reference', a.display_name, '', `floor_id ${a.floor_id} does not exist`));
      }
      if (a.workarea_id && !areaById.has(a.workarea_id)) {
        orphanRefs.push(add('dangling-reference', a.display_name, '', `workarea_id ${a.workarea_id} does not exist`));
      }
    }

    // An asset in a work area that sits on a different floor than the asset does.
    // The API rejects this now, but rows predating that check can still carry it.
    const hierarchyMismatch: Row[] = [];
    for (const a of live) {
      if (!a.workarea_id || !a.floor_id) continue;
      const area = areaById.get(a.workarea_id);
      if (area && area.floor_id !== a.floor_id) {
        hierarchyMismatch.push(add('hierarchy-mismatch', a.display_name, placeOf(a),
          `work area is on another floor (${floorById.get(area.floor_id)?.name ?? area.floor_id})`));
      }
    }

    console.log('═══ Asset data quality ═══');
    console.log(`\n${live.length} live asset(s) checked (${assets.length - live.length} superseded row(s) skipped).`);

    printDuplicates('1. Same serial number on several assets', dupSerial,
      'None — every serial number is unique.');
    printDuplicates('2. Same hardware asset id on several assets', dupHwa,
      'None — every HWA is unique.');
    printDuplicates('3. Same asset tag on several assets', dupTag,
      'None — every asset tag is unique.');
    printSection('4. Nothing to identify the asset by', unidentifiable,
      'None — every asset has a serial, an HWA or an asset tag.');
    printSection('5. No serial where the type implies one', missingSerial,
      'None — every device that should have a serial has one.');
    printSection('6. No asset type', noType,
      'None — every asset has a type.');
    printSection('7. References something that no longer exists', orphanRefs,
      'None — every building/floor/work area reference resolves.');
    printSection('8. Work area is on a different floor than the asset', hierarchyMismatch,
      'None — every asset agrees with its work area about the floor.');
    printDuplicates('9. Same MAC address on several assets (after normalising)', dupMac,
      'None — every MAC belongs to one asset.');
    printSection('10. Malformed MAC address', malformedMac,
      'None — every MAC has 12 hex digits.');
    printSection('11. MAC address not in colon-separated form', differentlySeparatedMac,
      'None — every MAC is stored canonically.');

    console.log('\nNotes:');
    console.log(' - Monitors, phones and cameras are excluded from section 5 — they routinely');
    console.log('   arrive with no serial recorded, and listing them hides the rest.');
    console.log(' - A shared "serial" is not always a duplicate device: Dell accessories');
    console.log('   carry a PPID identical across every unit of the model, and it ends up in');
    console.log('   the serial field. Those are marked with an i. Each member has its type,');
    console.log('   MAC and catalogue item are listed so you can tell two real devices from');
    console.log('   one recorded twice — the report does not decide that for you.');
    console.log(' - Section 11 is not cosmetic: the plan for filling in switch ports is to');
    console.log('   join the switches\' MAC tables against these values, and a differently');
    console.log('   separated MAC would be missed silently, leaving those sockets looking');
    console.log('   un-surveyed rather than unmatched. See docs/CONNECTIONS_WORKFLOW.md.');

    if (csvPath) {
      // `where` holds the classification for the duplicate sections and the
      // location for the rest — named generically because it is one column.
      const lines = ['section,item,where,detail'];
      for (const r of rows) lines.push([r.section, r.item, r.where, r.detail].map(csvEscape).join(','));
      fs.writeFileSync(csvPath, lines.join('\n'), 'utf8');
      console.log(`\n📄 ${rows.length} row(s) written to ${csvPath}`);
    }
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error('Report failed:', err);
  process.exit(1);
});
