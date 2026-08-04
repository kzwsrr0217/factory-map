/**
 * normalise-macs.ts — Rewrites MAC addresses into one canonical form.
 *
 * Canonical here is `AA:BB:CC:DD:EE:FF`: twelve hex digits, uppercase, colon-separated
 * pairs. On the real data `report:quality` finds 132 addresses stored some other way
 * — dashes, dots, no separator at all, lowercase — plus 3 that are not addresses.
 *
 * ── Why this matters more than tidiness ─────────────────────────────────────────
 * The plan for filling in switch ports after the switch replacement is to join the
 * switches' MAC tables against `Asset.mac_address` (docs/CONNECTIONS_WORKFLOW.md,
 * phase C). A join on the raw column silently misses every row stored in a different
 * separator style, and "silently missed" is the failure mode that costs: those
 * sockets look un-surveyed rather than unmatched, so nobody goes looking.
 *
 * ── What this does NOT do ───────────────────────────────────────────────────────
 * Malformed addresses — anything that isn't twelve hex digits — are reported and left
 * alone. The three in the real data look like typos (letter O for zero, letter I for
 * one), but "looks like" is not good enough to rewrite a hardware address by: an O
 * could equally mean a digit was dropped, and a wrong MAC in the database is worse
 * than an obviously broken one, because it will match something eventually.
 *
 * DRY RUN BY DEFAULT. Pass `--apply` to write.
 *
 * Usage:
 *   npm run normalise:macs
 *   npm run normalise:macs -- --csv > ops/results/macs.csv
 *   npm run normalise:macs -- --apply
 */
import 'reflect-metadata';
import { AppDataSource } from '../config/database';
import { Asset } from '../entities/Asset.entity';
import { chunkForEntity } from '../utils/mssqlBatch';

/** Bare uppercase hex, so every separator style compares equal. */
function hexOnly(mac: string): string {
  return mac.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
}

/** `AA:BB:CC:DD:EE:FF` from twelve hex digits. */
function canonical(hex: string): string {
  return (hex.match(/.{2}/g) ?? []).join(':');
}

function isCanonical(mac: string): boolean {
  return /^([0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(mac);
}

/** Characters that are hex-adjacent typos rather than separators. */
function suspectTypo(mac: string): string | null {
  if (/[OoIilL]/.test(mac)) return 'contains O/I/L — likely a typo for 0/1';
  if (/[^0-9a-fA-F:.\- ]/.test(mac)) return 'contains a character that is neither hex nor a separator';
  return null;
}

interface Change {
  id: string;
  name: string;
  from: string;
  to: string;
}

interface Skipped {
  name: string;
  value: string;
  reason: string;
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');
  const csv = process.argv.includes('--csv');

  await AppDataSource.initialize();
  try {
    const repo = AppDataSource.getRepository(Asset);
    // Superseded rows are replacement history; rewriting their addresses would churn
    // rows nothing reads and muddy the audit trail. Same rule as the quality report.
    const assets = (await repo.find()).filter((a) => !a.successor_id && a.mac_address?.trim());

    const changes: Change[] = [];
    const skipped: Skipped[] = [];
    /** Canonical value -> the assets that will hold it, to catch collisions. */
    const byCanonical = new Map<string, string[]>();

    for (const a of assets) {
      const raw = a.mac_address!.trim();
      const hex = hexOnly(raw);

      if (hex.length !== 12) {
        skipped.push({
          name: a.display_name,
          value: raw,
          reason: `${hex.length} hex digits, not 12`
            + (suspectTypo(raw) ? ` — ${suspectTypo(raw)}` : '')
            + '. Left alone: a guessed address is worse than a broken one',
        });
        continue;
      }

      const target = canonical(hex);
      byCanonical.set(target, [...(byCanonical.get(target) ?? []), a.display_name]);
      if (raw === target) continue;
      if (isCanonical(raw)) continue;
      changes.push({ id: a.id, name: a.display_name, from: raw, to: target });
    }

    /**
     * Two rows holding the same address. Reported because it changes how the planned
     * switch-port join has to be written, not because it is necessarily wrong:
     *
     *  - one machine recorded twice (the real data has such pairs, sharing a serial
     *    as well) — a person has to merge those;
     *  - a docking station and the laptop docked in it. Dell docks pass the dock's
     *    MAC through to the machine, so the pair is correct and must not be
     *    "fixed" — in the real data `D8:D0:90:15:40:53` sits on a WD15 dock and a
     *    Precision 7530 for exactly this reason.
     *
     * The consequence for phase C: a MAC does not identify one asset. The join has
     * to cope with a hit on two rows rather than assuming uniqueness.
     */
    const collisions = [...byCanonical].filter(([, names]) => names.length > 1);

    if (csv) {
      console.log('action,asset,from,to,reason');
      for (const c of changes) console.log(`rewrite,"${c.name}","${c.from}","${c.to}",`);
      for (const s of skipped) console.log(`skip,"${s.name}","${s.value}",,"${s.reason}"`);
      for (const [value, names] of collisions) {
        console.log(`collision,"${names.join(' | ')}","${value}",,"${names.length} assets share this address"`);
      }
      return;
    }

    console.log(`🔤 ${apply ? 'Normalising' : 'Dry run —'} MAC addresses (${assets.length} rows carry one)\n`);

    console.log(`${changes.length} to rewrite:`);
    for (const c of changes) console.log(`   ${c.name}: ${c.from} → ${c.to}`);
    if (changes.length === 0) console.log('   none — every address is already canonical');

    console.log(`\n${skipped.length} left alone:`);
    for (const s of skipped) console.log(`   ${s.name}: "${s.value}"\n      ${s.reason}`);
    if (skipped.length === 0) console.log('   none — every address has 12 hex digits');

    if (collisions.length > 0) {
      console.log(`\n⚠ ${collisions.length} address(es) shared by more than one asset:`);
      for (const [value, names] of collisions) {
        console.log(`   ${value}: ${names.join(', ')}`);
      }
      console.log('   Normalising does not create these — they are already the same address.');
      console.log('   Two causes, and only one is a defect: the same machine recorded twice,');
      console.log('   or a docking station and the laptop docked in it (Dell docks pass their');
      console.log('   MAC through). Check the types before merging anything.');
    }

    if (!apply) {
      console.log('\nNothing was written. Re-run with --apply to commit, or --csv for a file.');
      return;
    }
    if (changes.length === 0) return;

    for (const batch of chunked(changes, chunkForEntity(Asset))) {
      await repo.save(batch.map((c) => ({ id: c.id, mac_address: c.to })));
    }
    console.log(`\n✅ Rewrote ${changes.length} address(es). The ${skipped.length} malformed one(s) still need a person.`);
  } finally {
    await AppDataSource.destroy();
  }
}

/** Local chunker — `chunkForEntity` gives the size, this walks the list. */
function chunked<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

main().catch((err) => {
  console.error('✖ Normalising failed:', err);
  process.exit(1);
});
