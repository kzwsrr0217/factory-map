/**
 * backfill-itsm-fields.ts — one-off runner for
 * ReconcileService.backfillAssetsFromSnapshot() (see that function for the
 * full rationale). Run after re-importing the snapshot with newly-resolved
 * fields (e.g. manufacturer/asset_type from the Catalog Items CSV join) to
 * fill the gaps on assets that were already created before those fields
 * existed — never overwrites a field that already has a value.
 *
 *   docker exec factory-map-backend npx ts-node src/scripts/backfill-itsm-fields.ts
 */
import 'reflect-metadata';
import { AppDataSource } from '../config/database';
import { backfillAssetsFromSnapshot } from '../services/itsm/ReconcileService';

async function main(): Promise<void> {
  await AppDataSource.initialize();
  try {
    const result = await backfillAssetsFromSnapshot();
    console.log(`Checked ${result.checked} linked assets, updated ${result.updated}, wrote ${result.fieldsWritten} field(s).`);
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error('✖ Backfill failed:', err);
  process.exit(1);
});
