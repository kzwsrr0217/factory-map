/**
 * nexthink-win11-readiness.ts — which machines can take Windows 11, and which cannot ever.
 *
 * The fifth Nexthink report, and the one that answers the question asked on the first day: when a
 * machine is swapped out, does it get reinstalled and put back to work, or set aside for
 * decommission? Every other report here had to say "that eligibility is not in this data". It is
 * now — but not from the device inventory.
 *
 * ── Where the data actually comes from ──────────────────────────────────────────
 * TPM and Secure Boot are NOT inventory fields. Three separate attempts to query
 * `hardware.tpm_version` and `hardware.secure_boot_enabled` were rejected by NQL, because Nexthink
 * collects them with a REMOTE ACTION and the results live in `remote_action.executions`. The
 * export this reads is:
 *
 *   remote_action.executions during past 30d
 *   | where remote_action.name == "Get Windows 11 readiness"
 *   | list device.name, time, status, outputs
 *   | sort time desc
 *
 * `outputs` is a JSON blob per execution, and its field names come from that remote action's own
 * script rather than from any product schema — which is exactly why they had to be read off a real
 * export instead of guessed. On the real one they are: Readiness, TPMCompliance,
 * SecureBootCompliance, CPUCompliance, CPUFamilyCompliance, ClockSpeedCompliance,
 * LogicalCoresCompliance, AddressWidthCompliance, RAMCompliance, StorageCompliance,
 * DirectXCompliance, WDDMCompliance, SystemReservedPartitionSize.
 *
 * ── The two things that make this report trustworthy ────────────────────────────
 * 1. One row per DEVICE, not per execution. Thirty days of scheduled runs gave 6095 rows for 330
 *    devices; only the newest per device means anything.
 * 2. A non-successful execution is UNKNOWN, never "not ready". 16 devices came back expired,
 *    waiting or failed, and 15 of those carry no output fields at all. Counting a missing value as
 *    a failed criterion put 16 phantom devices on the not-ready list and invented failures on four
 *    criteria that nothing had actually failed. Reading it right moved 99 not-ready down to 83.
 *
 * ── Critical versus fixable ─────────────────────────────────────────────────────
 * Per Nexthink's own guidance, CPU and TPM are the criteria that cannot be upgraded — a device
 * failing either needs replacing. Secure Boot is a firmware setting, storage is disk space, and
 * DirectX/WDDM are graphics drivers; those are jobs, not write-offs. Keeping the two apart is the
 * whole value of the report, because it turns one list of 83 into a shelf list and a work list.
 *
 *   npx ts-node src/scripts/nexthink-win11-readiness.ts <path-to-readiness.csv>
 */
import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { In } from 'typeorm';
import config from '../config/config';
import { AppDataSource } from '../config/database';
import { Asset } from '../entities/Asset.entity';

/** Cannot be upgraded. A device failing either of these is a replacement, not a task. */
const CRITICAL = ['CPUCompliance', 'CPUFamilyCompliance', 'TPMCompliance'] as const;

/**
 * The criterion a device fails, mapped to the JOB that fixes it.
 *
 * DirectX and WDDM share one job on purpose: they are two criteria and a single graphics driver
 * update. Anything not listed here falls through as its own raw criterion name rather than being
 * silently dropped — a new criterion from a future version of the remote action must show up as
 * something unfamiliar, not as nothing.
 */
const FIXABLE_JOB: Record<string, string> = {
  SecureBootCompliance: 'enable Secure Boot in firmware',
  StorageCompliance: 'free up or grow the system disk',
  DirectXCompliance: 'update the graphics driver',
  WDDMCompliance: 'update the graphics driver',
  RAMCompliance: 'add memory',
  ClockSpeedCompliance: 'CPU clock below the bar — usually means replacement',
  LogicalCoresCompliance: 'too few cores — usually means replacement',
  AddressWidthCompliance: '32-bit — needs a rebuild',
};

interface DeviceReadiness {
  device: string;
  time: string;
  status: string;
  out: Record<string, number | null>;
}

/**
 * Newest execution per device.
 *
 * Compared on the timestamp string rather than trusting the export's sort order: the query does
 * sort newest-first, but a report that silently depends on how somebody exported it is a report
 * that breaks the day they forget the `sort` line.
 */
function latestPerDevice(csv: string): { devices: Map<string, DeviceReadiness>; rows: number; malformed: number } {
  const lines = csv.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '').slice(1);
  const devices = new Map<string, DeviceReadiness>();
  let malformed = 0;
  for (const line of lines) {
    const m = /^"([^"]*)","([^"]*)","([^"]*)","(.*)"$/.exec(line);
    if (!m) { malformed++; continue; }
    const [, device, time, status, rawJson] = m;
    let out: Record<string, number | null> = {};
    // The CSV doubles the quotes inside the JSON blob. A row whose JSON will not parse is kept
    // with empty outputs rather than dropped: its status still says something.
    try { out = JSON.parse(rawJson.replace(/""/g, '"')); } catch { out = {}; }
    const prev = devices.get(device);
    if (!prev || time > prev.time) devices.set(device, { device, time, status, out });
  }
  return { devices, rows: lines.length, malformed };
}

type Verdict = 'ready' | 'critical' | 'fixable' | 'unknown';

function classify(d: DeviceReadiness): { verdict: Verdict; failed: string[] } {
  // Anything but a completed run tells us nothing. See the file header — this is the distinction
  // that moved 16 devices off the not-ready list.
  if (d.status !== 'success' || d.out.Readiness === undefined || d.out.Readiness === null) {
    return { verdict: 'unknown', failed: [] };
  }
  if (d.out.Readiness === 1) return { verdict: 'ready', failed: [] };
  const failed = Object.entries(d.out)
    .filter(([k, v]) => k.endsWith('Compliance') && v !== 1)
    .map(([k]) => k);
  const hitsCritical = failed.some((f) => (CRITICAL as readonly string[]).includes(f));
  return { verdict: hitsCritical ? 'critical' : 'fixable', failed };
}

async function main(): Promise<void> {
  const arg = process.argv.slice(2).find((a) => !a.startsWith('--'));
  if (!arg) {
    console.error('✖ Usage: nexthink-win11-readiness.ts <path-to-readiness.csv>');
    console.error('  The export of: remote_action.executions | where remote_action.name ==');
    console.error('  "Get Windows 11 readiness" | list device.name, time, status, outputs');
    process.exit(1);
  }
  const file = path.resolve(arg);
  if (!fs.existsSync(file)) {
    console.error(`✖ Not found: ${file}`);
    process.exit(1);
  }

  const { devices, rows, malformed } = latestPerDevice(fs.readFileSync(file, 'utf8'));
  console.log(`🪟 Windows 11 readiness from ${path.basename(file)}`);
  console.log(`   ${rows} execution(s) over ${devices.size} device(s)`
    + `${malformed > 0 ? `, ${malformed} line(s) unreadable` : ''}`);

  const classified = [...devices.values()].map((d) => ({ d, ...classify(d) }));
  const of = (v: Verdict) => classified.filter((c) => c.verdict === v);
  const ready = of('ready');
  const critical = of('critical');
  const fixable = of('fixable');
  const unknown = of('unknown');

  console.log('\n  Verdict:');
  console.log(`    ${String(ready.length).padStart(4)}  ready — can be reinstalled and put back to work`);
  console.log(`    ${String(fixable.length).padStart(4)}  not ready, but every failing criterion is fixable`);
  console.log(`    ${String(critical.length).padStart(4)}  not ready on CPU or TPM — cannot be upgraded, set aside`);
  console.log(`    ${String(unknown.length).padStart(4)}  no usable result — the remote action did not report`);

  try {
    await AppDataSource.initialize();
  } catch (err) {
    const { host, port, database } = config.mssql;
    console.error(`\n✖ Could not connect to the database at ${host}:${port} (${database}).`);
    console.error(`  ${String(err)}`);
    console.error('  The counts above needed no database; the rest of the report does.');
    process.exit(1);
  }

  try {
    const names = [...devices.keys()];
    const assetRepo = AppDataSource.getRepository(Asset);
    const byName = new Map<string, Asset>();
    for (let i = 0; i < names.length; i += 500) {
      const chunk = names.slice(i, i + 500);
      for (const a of await assetRepo.find({
        where: [{ hardware_asset_id: In(chunk) }, { display_name: In(chunk) }],
      })) {
        if (a.hardware_asset_id) byName.set(a.hardware_asset_id, a);
        if (!byName.has(a.display_name)) byName.set(a.display_name, a);
      }
    }

    /**
     * The question from the first day, answered per machine: a device the map records as replaced
     * either goes back into service or onto a shelf, and until now nothing here could say which.
     */
    const replaced = classified.filter((c) => byName.get(c.d.device)?.successor_id);
    console.log('\n── Machines the map records as replaced ──');
    if (replaced.length === 0) {
      console.log('    None of the devices in this export are recorded as replaced.');
    } else {
      for (const c of replaced) {
        const a = byName.get(c.d.device)!;
        const verdict = c.verdict === 'ready' ? 'REINSTALL and reuse'
          : c.verdict === 'critical' ? 'SET ASIDE — cannot take Windows 11'
            : c.verdict === 'fixable' ? `fixable first: ${c.failed.join(', ')}`
              : 'unknown — re-run the readiness action';
        console.log(`    ${c.d.device.padEnd(11)} ${a.display_name.slice(0, 18).padEnd(19)} ${verdict}`);
      }
    }

    console.log(`\n── ${critical.length} that cannot take Windows 11 (CPU or TPM) ──`);
    console.log('    Not upgradeable. These are the decommission and replacement budget.');
    for (const c of critical.slice(0, 25)) {
      const a = byName.get(c.d.device);
      const why = c.failed.filter((f) => (CRITICAL as readonly string[]).includes(f))
        .map((f) => f.replace('Compliance', '')).join(' + ');
      console.log(`    ${c.d.device.padEnd(11)} ${why.padEnd(18)} ${(a?.person_full_name ?? '—').slice(0, 22).padEnd(23)}`
        + ` ${a ? (a.model ?? '') : 'not in the map'}`);
    }
    if (critical.length > 25) console.log(`    … and ${critical.length - 25} more`);

    console.log(`\n── ${fixable.length} that only need work ──`);
    /**
     * Grouped by the SET of jobs a device needs, so each device appears exactly once and the rows
     * add up to the total above.
     *
     * Grouping by individual criterion instead let one machine count in several rows: DirectX and
     * WDDM are two criteria and ONE graphics driver update, so 28 devices read as 56 pieces of
     * work. A report that doubles the size of its own backlog is one nobody believes twice.
     */
    const jobs = new Map<string, string[]>();
    for (const c of fixable) {
      const signature = [...new Set(c.failed.map((f) => FIXABLE_JOB[f] ?? f))].sort().join(' + ');
      jobs.set(signature, [...(jobs.get(signature) ?? []), c.d.device]);
    }
    for (const [job, list] of [...jobs].sort((a, b) => b[1].length - a[1].length)) {
      console.log(`    ${String(list.length).padStart(3)}  ${job}`);
      console.log(`         ${list.slice(0, 12).join(', ')}${list.length > 12 ? `, … (+${list.length - 12})` : ''}`);
    }

    if (unknown.length > 0) {
      console.log(`\n── ${unknown.length} with no usable result ──`);
      const byStatus = new Map<string, number>();
      for (const c of unknown) byStatus.set(c.d.status, (byStatus.get(c.d.status) ?? 0) + 1);
      console.log(`    ${[...byStatus].map(([s, n]) => `${s}: ${n}`).join('  ')}`);
      console.log('    These are NOT "not ready" — the action did not report, so nothing is known.');
      console.log('    Re-run "Get Windows 11 readiness" on them before any decision.');
    }

    const notInMap = classified.filter((c) => !byName.get(c.d.device)).length;
    if (notInMap > 0) {
      console.log(`\n  ${notInMap} device(s) in this export are not in the factory map — see nexthink:unknown.`);
    }
    console.log('\n  Nothing was written.');
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error('✖ Failed:', err);
  process.exit(1);
});
