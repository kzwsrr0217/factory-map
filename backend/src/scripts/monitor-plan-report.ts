/**
 * monitor-plan-report.ts — Which desk has which screens, and what to swap.
 *
 * The docks built into the older monitors are failing. The plan is one laptop, one docking
 * monitor and one plain monitor per desk, with the two panels the same height — so what is
 * needed is not another count of monitors but a per-desk answer: what is standing there
 * now, whether the two screens match, and what would fix it.
 *
 * Read-only: it opens the database, reads, prints, and writes nothing. Sizes and aspect
 * ratios come from services/inventory/monitorSpecs.ts, which is a table rather than a
 * guess — a model it does not know is reported as unknown instead of being assumed.
 *
 * Usage:
 *   npx ts-node src/scripts/monitor-plan-report.ts
 *   npx ts-node src/scripts/monitor-plan-report.ts --csv=/tmp/monitors.csv
 */
import 'reflect-metadata';
import * as fs from 'fs';
import { AppDataSource } from '../config/database';
import { Asset } from '../entities/Asset.entity';
import { AssetConnection } from '../entities/AssetConnection.entity';
import { Building } from '../entities/Building.entity';
import { Floor } from '../entities/Floor.entity';
import { WorkArea } from '../entities/WorkArea.entity';
import { Zone } from '../entities/Zone.entity';
import {
  MonitorSpec,
  heightMm,
  resolveMonitorSpec,
  sizeLabel,
  widthMm,
} from '../services/inventory/monitorSpecs';

/** Asset types that sit on a desk and drive a screen. */
const MACHINE_TYPES = new Set(['laptop', 'workstation', 'desktop', 'pc']);

/**
 * What one screen is, once its model has been resolved. `spec` is null when the model is
 * not recorded or not known — kept as a row rather than dropped, because "we do not know
 * what is on this desk" is the finding that has to reach a person.
 */
interface MonitorRow {
  asset: Asset;
  spec: MonitorSpec | null;
  /** The text the model was read from, so an unknown can be looked up by hand. */
  evidence: string;
}

/** A desk: one machine and the screens attached to it. */
interface Desk {
  where: string;
  room: string;
  machine: Asset | null;
  person: string;
  monitors: MonitorRow[];
}

function csvEscape(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function describe(m: MonitorRow): string {
  if (!m.spec) return `unknown (${m.evidence || 'nothing recorded'})`;
  return `${m.spec.model} ${sizeLabel(m.spec)}${m.spec.dock ? ' [dock]' : ''}`;
}

/**
 * What to do with this desk. Only the first four verdicts are actionable; `unknown` means
 * the data has to be filled in before the desk can be judged at all.
 */
type Verdict =
  | 'ok'
  | 'height-mismatch'
  | 'dock-only'
  | 'spare-dock'
  | 'needs-dock-monitor'
  | 'no-monitor'
  | 'unknown';

function judge(monitors: MonitorRow[]): { verdict: Verdict; note: string } {
  if (monitors.length === 0) return { verdict: 'no-monitor', note: 'No screen recorded on this desk' };
  if (monitors.some((m) => !m.spec)) {
    return { verdict: 'unknown', note: 'At least one screen has no model recorded — read it off the device' };
  }
  const specs = monitors.map((m) => m.spec!);
  const docks = specs.filter((s) => s.dock);
  const plains = specs.filter((s) => !s.dock);

  // Checked before anything else, because a second docking monitor on one desk is a dock
  // that somebody else needs — the whole reason for the redistribution.
  if (docks.length > 1) {
    return {
      verdict: 'spare-dock',
      note: `${docks.length} docking monitors on one desk (${docks.map((s) => s.model).join(', ')}) — ` +
        `free ${docks.length - 1} and put a plain ${sizeLabel(docks[0])} in its place`,
    };
  }
  if (docks.length === 0) {
    return {
      verdict: 'needs-dock-monitor',
      note: `Runs off a separate dock. Sizes here: ${[...new Set(specs.map(sizeLabel))].join(', ')}`,
    };
  }
  if (plains.length === 0) {
    return {
      verdict: 'dock-only',
      note: `Add a plain ${sizeLabel(docks[0])} beside the ${docks[0].model}`,
    };
  }
  const target = sizeLabel(docks[0]);
  const mismatched = plains.filter((s) => sizeLabel(s) !== target);
  if (mismatched.length > 0) {
    return {
      verdict: 'height-mismatch',
      note: `${mismatched.map((s) => `${s.model} (${sizeLabel(s)}, ${heightMm(s.inches, s.aspect)} mm)`).join(', ')} next to a ${target} (${heightMm(docks[0].inches, docks[0].aspect)} mm) — swap for a ${target}`,
    };
  }
  return { verdict: 'ok', note: `${target} throughout` };
}

async function main(): Promise<void> {
  const csvArg = process.argv.find((a) => a.startsWith('--csv='));
  const csvPath = csvArg ? csvArg.slice('--csv='.length) : null;

  await AppDataSource.initialize();
  try {
    const assets = (await AppDataSource.getRepository(Asset).find()).filter((a) => !a.successor_id);
    const areas = await AppDataSource.getRepository(WorkArea).find();
    const floors = await AppDataSource.getRepository(Floor).find();
    const buildings = await AppDataSource.getRepository(Building).find();
    const zones = await AppDataSource.getRepository(Zone).find();
    const connections = await AppDataSource.getRepository(AssetConnection).find({
      where: { connection_type: 'parent-child' },
    });

    const areaById = new Map(areas.map((a) => [a.id, a]));
    const floorById = new Map(floors.map((f) => [f.id, f]));
    const buildingById = new Map(buildings.map((b) => [b.id, b]));
    const zoneById = new Map(zones.map((z) => [z.id, z]));

    /** "Werk 1 / Ground floor / Zone" — everything above the room. */
    const whereOf = (asset: Asset): string => {
      const area = asset.workarea_id ? areaById.get(asset.workarea_id) : undefined;
      const floor = floorById.get(area?.floor_id ?? asset.floor_id ?? '');
      const building = buildingById.get(asset.building_id ?? '');
      const zone = area?.zone_id ? zoneById.get(area.zone_id) : undefined;
      return [building?.name, floor?.name, zone?.name].filter(Boolean).join(' / ') || '(unplaced)';
    };
    const roomOf = (asset: Asset): string =>
      (asset.workarea_id ? areaById.get(asset.workarea_id)?.name : undefined) ?? '(no room)';

    const monitors: MonitorRow[] = assets
      .filter((a) => a.asset_type === 'monitor')
      .map((asset) => {
        // In the order of how specific the source is: the survey's own model column, then
        // ITSM's catalogue name, then the two places a comment ends up.
        const evidence = [asset.model, asset.catalog_display_name, asset.display_name, asset.notes]
          .map((t) => (t ?? '').trim())
          .filter(Boolean);
        return {
          asset,
          spec: resolveMonitorSpec(...evidence),
          // All of them, not just the first: an unknown has to show every text that was
          // searched, or the list looks as though a source had not been looked at.
          evidence: [...new Set(evidence)].join(' | '),
        };
      });

    // ── The counts, by what a redistribution actually turns on ──
    console.log(`\n=== ${monitors.length} monitor(s) ===\n`);
    const groups = new Map<string, { dock: number; plain: number; height: number; width: number }>();
    let unknown = 0;
    for (const m of monitors) {
      if (!m.spec) { unknown++; continue; }
      const key = sizeLabel(m.spec);
      const g = groups.get(key) ?? {
        dock: 0, plain: 0,
        height: heightMm(m.spec.inches, m.spec.aspect),
        width: widthMm(m.spec.inches, m.spec.aspect),
      };
      if (m.spec.dock) g.dock++; else g.plain++;
      groups.set(key, g);
    }
    console.log('  size / aspect      docking   plain   panel (mm)');
    for (const [key, g] of [...groups.entries()].sort((a, b) => (b[1].dock + b[1].plain) - (a[1].dock + a[1].plain))) {
      console.log(`  ${key.padEnd(18)} ${String(g.dock).padStart(7)} ${String(g.plain).padStart(7)}   ${g.width}×${g.height}`);
    }
    console.log(`  ${'model not known'.padEnd(18)} ${String(unknown).padStart(15)}`);

    console.log('\n  Pairing (a dock needs a plain of the same size and aspect):');
    for (const [key, g] of [...groups.entries()].sort()) {
      if (g.dock === 0) continue;
      const spare = g.plain - g.dock;
      console.log(
        `   - ${key}: ${g.dock} docking, ${g.plain} plain → ` +
        (spare >= 0 ? `all pairable, ${spare} plain spare` : `${-spare} short`),
      );
    }

    // Models the table does not know, named so somebody can look them up once.
    const unknownTexts = new Map<string, number>();
    for (const m of monitors) {
      if (m.spec) continue;
      const key = m.evidence || '(nothing recorded)';
      unknownTexts.set(key, (unknownTexts.get(key) ?? 0) + 1);
    }
    if (unknownTexts.size > 0) {
      console.log('\n  Not in the spec table — resolution unknown, so these are in no count above:');
      for (const [text, count] of [...unknownTexts.entries()].sort((a, b) => b[1] - a[1])) {
        console.log(`   - ${String(count).padStart(3)} × ${text}`);
      }
    }

    // ── The desks ──
    //
    // Two things can say which desk a screen is on, and only two:
    //  - an outbound parent-child row, which is what the survey's "belongs to HWA…"
    //    comments became (see surveyImport.ts), or
    //  - the person the screen is assigned to, matched to the machine of the same person
    //    in the same room.
    //
    // A screen with neither is NOT put on a desk. Grouping the leftovers by room was the
    // obvious thing to do and it is wrong: one room holds 37 of them, and calling that a
    // desk produces a verdict about a desk that does not exist. They get their own list
    // below instead, which is an honest "we do not know what stands where in here".
    const parentOf = new Map<string, string>();
    for (const c of connections) parentOf.set(c.asset_id, c.connected_asset_id);
    const assetById = new Map(assets.map((a) => [a.id, a]));

    const desks = new Map<string, Desk>();
    const unattributed: MonitorRow[] = [];
    const deskKey = (where: string, room: string, machine: Asset | null, person: string): string =>
      machine ? `m:${machine.id}` : `p:${where}|${room}|${person}`;

    for (const machine of assets.filter((a) => MACHINE_TYPES.has(a.asset_type ?? ''))) {
      const where = whereOf(machine);
      const room = roomOf(machine);
      const person = machine.person_full_name ?? '';
      desks.set(deskKey(where, room, machine, person), { where, room, machine, person, monitors: [] });
    }

    for (const m of monitors) {
      const parentId = parentOf.get(m.asset.id);
      const parent = parentId ? assetById.get(parentId) : undefined;
      if (parent) {
        const key = deskKey(whereOf(parent), roomOf(parent), parent, parent.person_full_name ?? '');
        const desk = desks.get(key);
        if (desk) { desk.monitors.push(m); continue; }
      }
      const person = m.asset.person_full_name ?? '';
      if (!person) { unattributed.push(m); continue; }
      const where = whereOf(m.asset);
      const room = roomOf(m.asset);
      const byPerson = [...desks.values()].find(
        (d) => d.machine && d.where === where && d.room === room && d.person === person,
      );
      if (byPerson) { byPerson.monitors.push(m); continue; }
      // The person is named but has no machine here — still a desk, just an incomplete one.
      const key = deskKey(where, room, null, person);
      const desk = desks.get(key) ?? { where, room, machine: null, person, monitors: [] };
      desk.monitors.push(m);
      desks.set(key, desk);
    }

    const withScreens = [...desks.values()].filter((d) => d.monitors.length > 0);
    const byVerdict = new Map<Verdict, number>();
    for (const d of withScreens) {
      const { verdict } = judge(d.monitors);
      byVerdict.set(verdict, (byVerdict.get(verdict) ?? 0) + 1);
    }
    console.log(`\n=== ${withScreens.length} desk(s) with at least one screen ===\n`);
    for (const [verdict, count] of [...byVerdict.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${verdict.padEnd(20)} ${String(count).padStart(4)}`);
    }

    const ACTIONABLE: Verdict[] = ['spare-dock', 'height-mismatch', 'dock-only', 'needs-dock-monitor'];
    for (const verdict of ACTIONABLE) {
      const rows = withScreens
        .filter((d) => judge(d.monitors).verdict === verdict)
        .sort((a, b) => (a.where + a.room).localeCompare(b.where + b.room));
      if (rows.length === 0) continue;
      console.log(`\n-- ${verdict} (${rows.length}) --`);
      for (const d of rows) {
        const who = d.person || (d.machine ? d.machine.display_name : '(nobody named)');
        console.log(`  ${d.where} / ${d.room} — ${who}`);
        console.log(`      machine: ${d.machine ? `${d.machine.display_name} (${d.machine.asset_type})` : '(no machine recorded here)'}`);
        console.log(`      screens: ${d.monitors.map(describe).join(' + ')}`);
        console.log(`      → ${judge(d.monitors).note}`);
      }
    }

    // The leftovers, by room. Not judged: nothing in the data says which of these stand
    // together, so the room is as far as this can honestly go.
    if (unattributed.length > 0) {
      const byRoom = new Map<string, MonitorRow[]>();
      for (const m of unattributed) {
        const key = `${whereOf(m.asset)} / ${roomOf(m.asset)}`;
        byRoom.set(key, [...(byRoom.get(key) ?? []), m]);
      }
      console.log(
        `\n=== ${unattributed.length} screen(s) on no known desk, in ${byRoom.size} room(s) ===\n` +
        '    Neither a machine nor a person is recorded for these, so which desk they are on\n' +
        '    is not in the data. Walk the room, or link them to their machine in the app.\n',
      );
      for (const [room, list] of [...byRoom.entries()].sort((a, b) => b[1].length - a[1].length)) {
        const counts = new Map<string, number>();
        for (const m of list) {
          const label = m.spec ? `${sizeLabel(m.spec)}${m.spec.dock ? ' dock' : ''}` : 'unknown';
          counts.set(label, (counts.get(label) ?? 0) + 1);
        }
        const breakdown = [...counts.entries()].map(([l, c]) => `${c}× ${l}`).join(', ');
        console.log(`  ${String(list.length).padStart(3)}  ${room} — ${breakdown}`);
      }
    }

    if (csvPath) {
      const lines = [
        'building_floor_zone,room,person,machine,machine_type,monitor,monitor_model,size_aspect,height_mm,dock,verdict,action',
      ];
      for (const d of [...desks.values()].sort((a, b) => (a.where + a.room).localeCompare(b.where + b.room))) {
        const { verdict, note } = judge(d.monitors);
        if (d.monitors.length === 0) continue;
        for (const m of d.monitors) {
          lines.push([
            d.where,
            d.room,
            d.person,
            d.machine?.display_name ?? '',
            d.machine?.asset_type ?? '',
            m.asset.display_name,
            m.spec?.model ?? '',
            m.spec ? sizeLabel(m.spec) : '',
            m.spec ? String(heightMm(m.spec.inches, m.spec.aspect)) : '',
            m.spec ? (m.spec.dock ? 'dock' : 'plain') : '',
            verdict,
            note,
          ].map(csvEscape).join(','));
        }
      }
      // The unattributed ones belong in the file too — leaving them out would make the
      // total silently smaller than the monitor count at the top.
      for (const m of unattributed) {
        lines.push([
          whereOf(m.asset),
          roomOf(m.asset),
          '', '', '',
          m.asset.display_name,
          m.spec?.model ?? '',
          m.spec ? sizeLabel(m.spec) : '',
          m.spec ? String(heightMm(m.spec.inches, m.spec.aspect)) : '',
          m.spec ? (m.spec.dock ? 'dock' : 'plain') : '',
          'no-known-desk',
          'No machine and no person recorded — walk the room, or link it to its machine',
        ].map(csvEscape).join(','));
      }
      fs.writeFileSync(csvPath, lines.join('\n'), 'utf8');
      console.log(`\nWritten to ${csvPath} — ${lines.length - 1} screen row(s)`);
    }
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error('Report failed:', err);
  process.exit(1);
});
