/**
 * network-gaps-report.ts — What is still missing from the socket survey.
 *
 * Separate from reconcile-report.ts on purpose: that one answers "does our data
 * match ITSM", this one answers "how far along is the cabling survey". They share
 * no inputs and would be run by different people at different times.
 *
 * Its job is to make progress measurable. Each section is a to-do list that
 * shrinks as the survey proceeds, and each names something specific that a person
 * can go and do — see docs/CONNECTIONS_WORKFLOW.md.
 *
 *   1. Sockets not patched to a panel        → go to the rack, patch them
 *   2. Sockets patched but with no switch    → record the switch port
 *   3. Panel ports with no socket            → either unused, or a missing socket
 *   4. Label disagrees with the panel's rack → a patching mistake
 *   5. Wired devices with no socket          → record which socket they're in
 *
 * Fully read-only: no writes, no ITSM calls of any kind.
 *
 * Usage:
 *   npm run report:network
 *   npm run report:network -- --csv=/tmp/network-gaps.csv
 */
import 'reflect-metadata';
import * as fs from 'fs';
import { AppDataSource } from '../config/database';
import { WallPort } from '../entities/WallPort.entity';
import { PatchPanel } from '../entities/PatchPanel.entity';
import { NetworkRack } from '../entities/NetworkRack.entity';
import { WorkArea } from '../entities/WorkArea.entity';
import { Floor } from '../entities/Floor.entity';
import { Building } from '../entities/Building.entity';
import { Asset } from '../entities/Asset.entity';
import { parseWallPortLabel } from '../utils/wallPortLabel';

/**
 * Asset types expected to sit on a wire. Laptops are absent deliberately: a
 * docked laptop reaches the network through its dock, and the dock is what holds
 * the socket (docs/CONNECTIONS_WORKFLOW.md). Monitors, phones and cameras are
 * absent for the same kind of reason — listing them would bury the real gaps
 * under hundreds of rows nobody will action.
 */
const WIRED_TYPES = new Set(['workstation', 'server', 'printer', 'ipc', 'plc', 'terminal', 'scanner']);

function csvEscape(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

interface ReportRow {
  section: string;
  item: string;
  where: string;
  detail: string;
}

function printSection(title: string, rows: ReportRow[], emptyText: string, limit = 25): void {
  console.log(`\n${title}: ${rows.length}`);
  if (rows.length === 0) {
    console.log(`   ${emptyText}`);
    return;
  }
  for (const row of rows.slice(0, limit)) {
    console.log(`   - ${row.item}${row.where ? `  [${row.where}]` : ''}${row.detail ? `  ${row.detail}` : ''}`);
  }
  // Never truncate silently: a capped list that looks complete is worse than no
  // list, because the remainder stops being anybody's problem.
  if (rows.length > limit) {
    console.log(`   … and ${rows.length - limit} more (use --csv to get all of them)`);
  }
}

async function main(): Promise<void> {
  const csvArg = process.argv.find((a) => a.startsWith('--csv='));
  const csvPath = csvArg ? csvArg.slice('--csv='.length) : null;

  await AppDataSource.initialize();
  try {
    const ports = await AppDataSource.getRepository(WallPort).find();
    const panels = await AppDataSource.getRepository(PatchPanel).find({ relations: ['rack'] });
    const racks = await AppDataSource.getRepository(NetworkRack).find();
    const areas = await AppDataSource.getRepository(WorkArea).find();
    const floors = await AppDataSource.getRepository(Floor).find();
    const buildings = await AppDataSource.getRepository(Building).find();
    const assets = await AppDataSource.getRepository(Asset).find();

    const panelById = new Map(panels.map((p) => [p.id, p]));
    const rackById = new Map(racks.map((r) => [r.id, r]));
    const areaById = new Map(areas.map((a) => [a.id, a]));
    const floorById = new Map(floors.map((f) => [f.id, f]));
    const buildingById = new Map(buildings.map((b) => [b.id, b]));

    const placeOf = (floorId: string | null, workareaId: string | null): string => {
      const floor = floorId ? floorById.get(floorId) : undefined;
      const building = floor ? buildingById.get(floor.building_id) : undefined;
      const area = workareaId ? areaById.get(workareaId) : undefined;
      return [building?.name, floor?.name, area?.name ?? 'no room'].filter(Boolean).join(' / ');
    };

    const rows: ReportRow[] = [];
    const add = (section: string, item: string, where: string, detail: string) => {
      rows.push({ section, item, where, detail });
      return rows[rows.length - 1];
    };

    // 1 & 2 — how far each socket got along the chain.
    const unpatched: ReportRow[] = [];
    const noSwitch: ReportRow[] = [];
    const rackMismatch: ReportRow[] = [];
    for (const port of ports) {
      const place = placeOf(port.floor_id, port.workarea_id);
      if (!port.patch_panel_id || port.patch_port == null) {
        unpatched.push(add('unpatched-socket', port.label, place, ''));
        continue;
      }
      if (!port.switch_asset_id || !port.switch_port) {
        const panel = panelById.get(port.patch_panel_id);
        noSwitch.push(add('socket-without-switch', port.label, place, `→ ${panel?.name ?? '?'} port ${port.patch_port}`));
      }

      // 4 — the label names a rack; the panel sits in one. They must agree.
      const parsed = parseWallPortLabel(port.label);
      const panel = panelById.get(port.patch_panel_id);
      const rack = panel ? rackById.get(panel.rack_id) : undefined;
      if (parsed && rack && parsed.rackName.toLowerCase() !== rack.name.trim().toLowerCase()) {
        rackMismatch.push(add(
          'label-rack-mismatch', port.label, place,
          `label says rack ${parsed.rackName}, patched into ${rack.name} (${panel?.name} port ${port.patch_port})`,
        ));
      }
    }

    // 3 — the same gap from the panel's side.
    const usedPorts = new Set(
      ports.filter((p) => p.patch_panel_id && p.patch_port != null).map((p) => `${p.patch_panel_id}|${p.patch_port}`),
    );
    const emptyPanelPorts: ReportRow[] = [];
    for (const panel of panels) {
      const free: number[] = [];
      for (let n = 1; n <= panel.port_count; n++) {
        if (!usedPorts.has(`${panel.id}|${n}`)) free.push(n);
      }
      if (free.length === 0) continue;
      const rack = rackById.get(panel.rack_id);
      emptyPanelPorts.push(add(
        'panel-port-without-socket',
        `${panel.name} (${free.length}/${panel.port_count} free)`,
        rack?.name ?? '',
        `ports ${summariseRanges(free)}`,
      ));
    }

    // 5 — devices that should be on a wire but have no socket recorded.
    const wiredWithoutSocket: ReportRow[] = [];
    // Wired devices not yet placed on a floor. Counted, not listed: a socket is
    // picked from a floor's sockets, so there is nothing actionable here until
    // the device is placed — but dropping them silently would understate how
    // much work is left, so the count is printed.
    let wiredNotPlaced = 0;
    for (const asset of assets) {
      if (asset.successor_id) continue;                 // replaced; its successor is the live one
      if (asset.status === 'retired') continue;
      if (asset.rack_id) continue;                      // rack-mounted: no faceplate involved
      if (asset.wall_port_id) continue;
      if (!WIRED_TYPES.has((asset.asset_type ?? '').toLowerCase())) continue;
      if (!asset.floor_id) { wiredNotPlaced++; continue; }
      wiredWithoutSocket.push(add(
        'wired-device-without-socket',
        asset.display_name,
        placeOf(asset.floor_id, asset.workarea_id),
        asset.asset_type ?? '',
      ));
    }

    console.log('═══ Network cabling survey — what is still missing ═══');
    console.log(`\nSockets recorded: ${ports.length} · patch panels: ${panels.length} · racks: ${racks.length}`);

    printSection('1. Sockets not patched to a panel', unpatched,
      'None — every recorded socket is wired to a panel port.');
    printSection('2. Sockets patched but with no switch port', noSwitch,
      'None — every patched socket has a switch port recorded.');
    printSection('3. Panel ports with no socket', emptyPanelPorts,
      'None — every panel port has a socket.');
    printSection('4. Socket label disagrees with the panel’s rack', rackMismatch,
      'None — every label matches the rack it is patched into.');
    printSection('5. Wired devices on a floor with no socket', wiredWithoutSocket,
      'None — every placed wired device has a socket recorded.');
    if (wiredNotPlaced > 0) {
      console.log(`   (plus ${wiredNotPlaced} wired device(s) not yet placed on a floor — place them first)`);
    }

    console.log('\nNote: laptops, monitors, phones and cameras are excluded from section 5 —');
    console.log('a docked laptop reaches the network through its dock, and the dock holds the socket.');

    if (csvPath) {
      const lines = ['section,item,where,detail'];
      for (const row of rows) {
        lines.push([row.section, row.item, row.where, row.detail].map(csvEscape).join(','));
      }
      fs.writeFileSync(csvPath, lines.join('\n'), 'utf8');
      console.log(`\n📄 ${rows.length} row(s) written to ${csvPath}`);
    }
  } finally {
    await AppDataSource.destroy();
  }
}

/** [1,2,3,7,9,10] → "1-3, 7, 9-10" — a 48-port panel's free list otherwise fills the screen. */
function summariseRanges(numbers: number[]): string {
  const parts: string[] = [];
  let start = numbers[0];
  let prev = numbers[0];
  for (const n of numbers.slice(1)) {
    if (n === prev + 1) { prev = n; continue; }
    parts.push(start === prev ? `${start}` : `${start}-${prev}`);
    start = n;
    prev = n;
  }
  parts.push(start === prev ? `${start}` : `${start}-${prev}`);
  return parts.join(', ');
}

main().catch((err) => {
  console.error('Report failed:', err);
  process.exit(1);
});
