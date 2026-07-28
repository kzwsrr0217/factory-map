/**
 * reconcile-report.ts — Bulk post-import ITSM reconcile report.
 *
 * After a bulk placement/linking pass (e.g. import-inventory-survey.ts), run
 * this to see the whole picture at once instead of clicking "Check ITSM" per
 * asset in the UI:
 *  - For every asset LINKED to ITSM (hardware_asset_id set), runs the exact
 *    same read-only diff check the per-asset "Check ITSM" button does
 *    (ReconcileService.reconcileAsset — zero live ITSM calls under
 *    ITSM_MODE=snapshot, purely local DB reads) and reports how many are in
 *    sync vs. have differences, listing every field-level diff.
 *  - For every asset NOT linked to ITSM (source_of_truth='local'), lists
 *    them as a separate backlog — devices ITSM doesn't track at all yet
 *    (e.g. monitors from the inventory survey) that someone still needs to
 *    register as real Hardware Assets in Alemba by hand; once they exist
 *    there, link them via the asset edit form's "search ITSM record", and
 *    they'll show up as linked on the next run of this report.
 *
 * Read-only except for reconcileAsset()'s existing side effect of persisting
 * reconcile_last_status/reconcile_diff_count onto each checked asset — the
 * same thing clicking "Check ITSM" in the UI already does.
 *
 * Usage:
 *   npx ts-node src/scripts/reconcile-report.ts                  (console only)
 *   npx ts-node src/scripts/reconcile-report.ts --csv=/tmp/out.csv (also writes a CSV)
 */
import 'reflect-metadata';
import * as fs from 'fs';
import { AppDataSource } from '../config/database';
import { Asset } from '../entities/Asset.entity';
import { reconcileAsset } from '../services/itsm/ReconcileService';

function csvEscape(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

interface DiffRow {
  asset: string;
  hardware_asset_id: string;
  field: string;
  local: string;
  itsm: string;
}

async function main(): Promise<void> {
  const csvArg = process.argv.find((a) => a.startsWith('--csv='));
  const csvPath = csvArg ? csvArg.slice('--csv='.length) : null;

  await AppDataSource.initialize();
  try {
    const assetRepo = AppDataSource.getRepository(Asset);

    const linked = await assetRepo
      .createQueryBuilder('a')
      .where('a.hardware_asset_id IS NOT NULL')
      .andWhere('a.successor_id IS NULL')
      .getMany();

    console.log(`🔎 Checking ${linked.length} ITSM-linked asset(s) against the snapshot...\n`);

    let inSync = 0;
    let withDiffs = 0;
    let missing = 0;
    let errored = 0;
    const diffRows: DiffRow[] = [];

    for (const asset of linked) {
      try {
        const result = await reconcileAsset(asset.id);
        if (result.missing_in_itsm) { missing++; continue; }
        if (result.error) { errored++; continue; }
        if (result.diffs.length === 0) { inSync++; continue; }
        withDiffs++;
        for (const d of result.diffs) {
          diffRows.push({
            asset: asset.display_name,
            hardware_asset_id: asset.hardware_asset_id!,
            field: d.label,
            local: d.local_value ?? '',
            itsm: d.itsm_value ?? '',
          });
        }
      } catch {
        errored++;
      }
    }

    console.log(`  In sync: ${inSync}`);
    console.log(`  With differences: ${withDiffs} asset(s), ${diffRows.length} field-level diff(s)`);
    console.log(`  Missing in ITSM (was linked, no longer found): ${missing}`);
    console.log(`  Errors: ${errored}`);

    if (diffRows.length > 0) {
      console.log('\nField-level differences (local vs. ITSM):');
      for (const d of diffRows) {
        console.log(`   - ${d.asset} [${d.hardware_asset_id}] ${d.field}: local="${d.local}" -> itsm="${d.itsm}"`);
      }
    }

    const unlinked = await assetRepo
      .createQueryBuilder('a')
      .where('a.hardware_asset_id IS NULL')
      .andWhere('a.successor_id IS NULL')
      .getMany();

    console.log(`\n📋 ${unlinked.length} asset(s) are not in ITSM yet (local-only) — register these as Hardware Assets in Alemba, then link them via the asset edit form's "search ITSM record":`);
    const byType = new Map<string, number>();
    for (const a of unlinked) byType.set(a.asset_type ?? 'other', (byType.get(a.asset_type ?? 'other') ?? 0) + 1);
    for (const [type, count] of [...byType.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`   - ${type}: ${count}`);
    }

    if (csvPath) {
      const lines = ['section,asset,hardware_asset_id,field_or_type,local_value,itsm_value'];
      for (const d of diffRows) {
        lines.push(['diff', d.asset, d.hardware_asset_id, d.field, d.local, d.itsm].map(csvEscape).join(','));
      }
      for (const a of unlinked) {
        lines.push(['not_in_itsm', a.display_name, '', a.asset_type ?? '', a.serial_number ?? '', ''].map(csvEscape).join(','));
      }
      fs.writeFileSync(csvPath, lines.join('\n'), 'utf8');
      console.log(`\n💾 Full report written to ${csvPath}`);
    }
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error('✖ Report failed:', err);
  process.exit(1);
});
