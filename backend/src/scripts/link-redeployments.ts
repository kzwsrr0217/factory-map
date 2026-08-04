/**
 * link-redeployments.ts — Links the retired half of a redeployment to the live one.
 *
 * When a machine is re-registered in ITSM it gets a new Hardware Asset id, and the
 * old record is decommissioned. Both rows then carry the same service tag, so they
 * show up in `report:quality` as a duplicate serial forever, and the app treats
 * them as two devices: two rows in every list, both counted, both placeable.
 *
 * Setting `successor_id` on the retired row says what actually happened. The app
 * already understands that relationship — superseded rows drop out of the stats,
 * the reports and the auto-place candidates — so this is recording a fact, not
 * inventing a convention.
 *
 * DRY RUN BY DEFAULT. Pass `--apply` to write.
 *
 * ── On direction, which is the one thing this cannot verify ──────────────────
 * The local data holds no evidence of chronological order: `itsm_modified_at` is
 * null on these rows and `created_at` is only when our import ran. So the
 * direction is inferred from status alone — the decommissioned row is treated as
 * the predecessor of the live one.
 *
 * That is sound as a statement about which record is current, and it is what the
 * app needs. But it is not a claim about dates, and on the real data one pair
 * (23LM95J) has the LOWER Hardware Asset id still live and the higher one
 * decommissioned, which contradicts what HWA numbering would suggest. The dry run
 * prints the HWA order for every pair so that case is visible rather than assumed
 * away.
 *
 * Usage:
 *   npm run link:redeployments
 *   npm run link:redeployments -- --apply
 */
import 'reflect-metadata';
import { AppDataSource } from '../config/database';
import { Asset } from '../entities/Asset.entity';

/** Statuses that mean the record is history. Matches data-quality-report.ts. */
const RETIRED_STATUSES = new Set(['decommissioned', 'retired']);
const isRetired = (a: Asset): boolean => RETIRED_STATUSES.has((a.status ?? '').toLowerCase());

const fold = (v: string): string => v.trim().toLowerCase();

interface Pair {
  serial: string;
  retired: Asset;
  live: Asset;
  /** True when the live row's HWA sorts BELOW the retired one — worth a look. */
  hwaOrderLooksOdd: boolean;
}

interface Skipped {
  serial: string;
  members: string;
  reason: string;
}

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');

  await AppDataSource.initialize();
  try {
    const repo = AppDataSource.getRepository(Asset);
    // Rows already superseded are done; including them would try to re-link them.
    const assets = (await repo.find()).filter((a) => !a.successor_id);

    const bySerial = new Map<string, Asset[]>();
    for (const a of assets) {
      if (!a.serial_number || !fold(a.serial_number)) continue;
      const key = fold(a.serial_number);
      bySerial.set(key, [...(bySerial.get(key) ?? []), a]);
    }

    const pairs: Pair[] = [];
    const skipped: Skipped[] = [];

    for (const [serial, group] of bySerial) {
      if (group.length < 2) continue;
      const members = group.map((a) => `${a.display_name} (${a.status ?? 'no status'})`).join(', ');

      // Only the unambiguous shape is touched: exactly two rows, exactly one live.
      // Everything else is a judgement call and is left to a person.
      if (group.length > 2) {
        skipped.push({ serial, members, reason: `${group.length} rows share this serial — link them by hand` });
        continue;
      }
      const live = group.filter((a) => !isRetired(a));
      const retired = group.filter(isRetired);
      if (live.length !== 1 || retired.length !== 1) {
        skipped.push({
          serial, members,
          reason: live.length === 0
            ? 'both rows are retired — history, nothing to link'
            : 'both rows are live — decide which is real first (it may also be two real devices sharing a model-level code)',
        });
        continue;
      }
      if (retired[0].predecessor_id || live[0].predecessor_id) {
        skipped.push({ serial, members, reason: 'one row already has a lifecycle link' });
        continue;
      }

      pairs.push({
        serial,
        retired: retired[0],
        live: live[0],
        hwaOrderLooksOdd: (live[0].hardware_asset_id ?? '') < (retired[0].hardware_asset_id ?? ''),
      });
    }

    console.log(`🔗 ${apply ? 'Linking' : 'Dry run —'} redeployment pairs found by matching serial numbers\n`);
    console.log(`${pairs.length} pair(s) to link:`);
    for (const p of pairs) {
      console.log(`   ${p.serial}: ${p.retired.display_name} (${p.retired.status}) → ${p.live.display_name} (${p.live.status})`);
      if (p.hwaOrderLooksOdd) {
        console.log(`      ⚠ the live row's HWA sorts below the retired one — check this pair by hand`);
      }
    }

    if (skipped.length > 0) {
      console.log(`\n${skipped.length} duplicate serial(s) left alone:`);
      for (const s of skipped) console.log(`   ${s.serial}: ${s.members}\n      ${s.reason}`);
    }

    if (!apply) {
      console.log('\nNothing was written. Re-run with --apply to commit.');
      console.log('Direction comes from status, not from dates — the data holds none. See the file header.');
      return;
    }

    for (const p of pairs) {
      // Both ends, so the relationship reads from either row. The API's cycle check
      // is bypassed here, but a retired→live pair with no existing links (checked
      // above) cannot form one.
      p.retired.successor_id = p.live.id;
      p.live.predecessor_id = p.retired.id;
      await repo.save([p.retired, p.live]);
    }

    console.log(`\n✅ Linked ${pairs.length} pair(s). The retired rows now drop out of the`);
    console.log('   asset lists, the stats and the duplicate-serial report.');
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error('✖ Linking failed:', err);
  process.exit(1);
});
