/**
 * reclassify-catalog-types.ts — Re-reads the type of a device out of its catalogue name.
 *
 * The `Type` field on an Alemba catalogue item is a hand-set dropdown, and on at least one
 * item it is wrong: `DELL CAD Docking Station USB-C (WD19DCS)` is typed Monitor, so five
 * docking stations were counted as screens. Others (`Aruba Switches`) have no usable Type
 * at all. classifyFromCatalogName reads the product out of the name instead — see
 * services/itsm/snapshotImport.ts — but the stored rows were classified before that rule
 * existed, and a re-import is the user's step, not this script's.
 *
 * So this recomputes the type for rows already here, in both places it is stored:
 *  - the imported snapshot rows, which is where the classification is derived, and
 *  - the local assets linked to them.
 *
 * A local asset is only changed when its type still equals what the snapshot said — if
 * somebody has since decided otherwise by hand, their decision stands. Nothing is written
 * to ITSM: the mistake stays in Alemba, and this only stops the app repeating it.
 *
 * Usage:
 *   npx ts-node src/scripts/reclassify-catalog-types.ts            (reports, writes nothing)
 *   npx ts-node src/scripts/reclassify-catalog-types.ts --apply
 */
import 'reflect-metadata';
import { AppDataSource } from '../config/database';
import { Asset } from '../entities/Asset.entity';
import { ItsmHardwareSnapshot } from '../entities/ItsmHardwareSnapshot.entity';
import { classifyFromCatalogName } from '../services/itsm/snapshotImport';
import { chunkForEntity } from '../utils/mssqlBatch';

async function main(): Promise<void> {
  const apply = process.argv.includes('--apply');

  await AppDataSource.initialize();
  try {
    const snapshotRepo = AppDataSource.getRepository(ItsmHardwareSnapshot);
    const assetRepo = AppDataSource.getRepository(Asset);

    const rows = await snapshotRepo.find();
    const assets = (await assetRepo.find()).filter((a) => !a.successor_id);
    const localByHwa = new Map(
      assets.filter((a) => a.hardware_asset_id).map((a) => [a.hardware_asset_id!, a]),
    );

    const snapshotChanges: ItsmHardwareSnapshot[] = [];
    const assetChanges: Asset[] = [];
    const kept: Array<{ asset: string; local: string; wanted: string }> = [];
    const byName = new Map<string, { from: string; to: string; rows: number; assets: number }>();

    for (const row of rows) {
      const wanted = classifyFromCatalogName(row.catalog_item_name);
      if (!wanted || wanted === row.asset_type) continue;

      const key = row.catalog_item_name ?? '(no catalogue name)';
      const entry = byName.get(key) ?? { from: row.asset_type ?? '(none)', to: wanted, rows: 0, assets: 0 };
      entry.rows++;

      const local = localByHwa.get(row.itsm_id);
      if (local) {
        // Only where nobody has decided otherwise since the import.
        if ((local.asset_type ?? '') === (row.asset_type ?? '')) {
          local.asset_type = wanted;
          assetChanges.push(local);
          entry.assets++;
        } else {
          kept.push({ asset: local.display_name, local: local.asset_type ?? '(none)', wanted });
        }
      }
      byName.set(key, entry);

      row.asset_type = wanted;
      snapshotChanges.push(row);
    }

    console.log(`\n${apply ? 'Applying' : 'Dry run'} — the catalogue name disagrees with the stored type:\n`);
    if (byName.size === 0) {
      console.log('  Nothing to change: every catalogue name agrees with the type already stored.');
    }
    for (const [name, e] of [...byName.entries()].sort((a, b) => b[1].rows - a[1].rows)) {
      console.log(`  ${String(e.rows).padStart(4)} × ${name}`);
      console.log(`       ${e.from} → ${e.to}   (${e.assets} local asset(s) follow)`);
    }

    if (kept.length > 0) {
      console.log('\n  Left alone — the local type was changed by hand since the import:');
      for (const k of kept) console.log(`   - ${k.asset}: is '${k.local}', the name says '${k.wanted}'`);
    }

    console.log(`\n  snapshot rows: ${snapshotChanges.length}, local assets: ${assetChanges.length}`);

    if (!apply) {
      console.log('\n  Nothing written. Re-run with --apply.');
      return;
    }
    // Chunked for MSSQL's 2100-parameter cap — see utils/mssqlBatch.ts.
    if (snapshotChanges.length > 0) {
      await snapshotRepo.save(snapshotChanges, { chunk: chunkForEntity(ItsmHardwareSnapshot) });
    }
    if (assetChanges.length > 0) {
      await assetRepo.save(assetChanges, { chunk: chunkForEntity(Asset) });
    }
    console.log('\n  Written.');
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error('Reclassify failed:', err);
  process.exit(1);
});
