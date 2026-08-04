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

    const dupSerial: Row[] = [];
    for (const [value, group] of collisionsBy('serial_number')) {
      dupSerial.push(add('duplicate-serial', value, '',
        `${group.length} assets: ${group.map((a) => a.display_name).join(', ')}`));
    }

    const dupHwa: Row[] = [];
    for (const [value, group] of collisionsBy('hardware_asset_id')) {
      dupHwa.push(add('duplicate-hardware-asset-id', value, '',
        `${group.length} assets: ${group.map((a) => a.display_name).join(', ')}`));
    }

    const dupTag: Row[] = [];
    for (const [value, group] of collisionsBy('asset_tag')) {
      dupTag.push(add('duplicate-asset-tag', value, '',
        `${group.length} assets: ${group.map((a) => a.display_name).join(', ')}`));
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

    printSection('1. Same serial number on several assets', dupSerial,
      'None — every serial number is unique.');
    printSection('2. Same hardware asset id on several assets', dupHwa,
      'None — every HWA is unique.');
    printSection('3. Same asset tag on several assets', dupTag,
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

    console.log('\nNote: monitors, phones and cameras are excluded from section 5 — they');
    console.log('routinely arrive with no serial recorded, and listing them hides the rest.');

    if (csvPath) {
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
