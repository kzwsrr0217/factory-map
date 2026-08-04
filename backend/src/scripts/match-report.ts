/**
 * match-report.ts — "This device was found in a room. Which ITSM record is it?"
 *
 * Prints the verdicts from services/itsm/inventoryMatch.ts (which is where the rules
 * and the reasoning behind them live) for every local asset with no ITSM link, plus the
 * two directions that decide whether "everything is consistent" is actually true:
 * assets carrying an HWA the export does not contain, and hardware ITSM has that the
 * survey never found.
 *
 * READ ONLY — it writes nothing, ever. Deciding is a person's job; this exists so the
 * decisions can be made in bulk, from evidence, instead of one at a time from memory.
 *
 * Usage:
 *   npm run report:match
 *   npm run report:match -- --csv > ops/results/match.csv
 */
import 'reflect-metadata';
import { AppDataSource } from '../config/database';
import { Asset } from '../entities/Asset.entity';
import { ItsmHardwareSnapshot } from '../entities/ItsmHardwareSnapshot.entity';
import { findUnlinkedMmhAssets } from '../services/itsm/ReconcileService';
import {
  buildSnapshotIndex,
  matchRecord,
  describeCandidate,
  MatchResult,
  MatchVerdict,
  SnapshotCandidateRow,
} from '../services/itsm/inventoryMatch';

/** The rows are shaped for matching once, here, rather than in the matcher. */
function toCandidateRow(row: ItsmHardwareSnapshot): SnapshotCandidateRow {
  return {
    itsm_id: row.itsm_id,
    display_name: row.display_name,
    serial_number: row.serial_number,
    mac_address: row.mac_address,
    asset_tag: row.asset_tag,
    model: row.model,
    // Where this export actually keeps the model — see inventoryMatch's header.
    catalog_name: row.catalog_item_name,
    manufacturer: row.manufacturer,
    asset_type: row.asset_type,
    person_name: row.assigned_person_name,
  };
}

interface Finding {
  asset: Asset;
  result: MatchResult;
}

async function main(): Promise<void> {
  const csv = process.argv.includes('--csv');

  await AppDataSource.initialize();
  try {
    const snapshotRows = await AppDataSource.getRepository(ItsmHardwareSnapshot).find();
    if (snapshotRows.length === 0) {
      console.log('The ITSM snapshot table is empty — run import:itsm-snapshot first.');
      console.log('Without it there is nothing to match against, and every surveyed device');
      console.log('would look like one ITSM has never seen.');
      return;
    }

    const index = buildSnapshotIndex(snapshotRows.map(toCandidateRow));

    // Superseded rows are replacement history; they are nobody's task.
    const assets = (await AppDataSource.getRepository(Asset).find()).filter((a) => !a.successor_id);

    const findings: Finding[] = [];
    const hwaUnknown: Asset[] = [];
    for (const asset of assets) {
      const hwa = asset.hardware_asset_id?.trim();
      if (hwa) {
        // A sticker naming a record the export does not contain: a misread number, or a
        // record deleted in ITSM since. Either way it is not a match.
        if (!index.byItsmId.has(hwa.toUpperCase())) hwaUnknown.push(asset);
        continue;
      }
      findings.push({
        asset,
        result: matchRecord({
          serial_number: asset.serial_number,
          mac_address: asset.mac_address,
          asset_tag: asset.asset_tag,
          display_name: asset.display_name,
          model: asset.model,
          catalog_name: asset.catalog_display_name,
          manufacturer: asset.manufacturer,
          asset_type: asset.asset_type,
          person_name: asset.person_full_name,
        }, index),
      });
    }

    const onlyInItsm = await findUnlinkedMmhAssets();

    if (csv) {
      const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      console.log('verdict,asset,serial,mac,reason,candidates');
      for (const f of findings) {
        console.log([f.result.verdict, q(f.asset.display_name), q(f.asset.serial_number),
                     q(f.asset.mac_address), q(f.result.reason),
                     q(f.result.candidates.map(describeCandidate).join(' | '))].join(','));
      }
      for (const a of hwaUnknown) {
        console.log(['hwa-unknown', q(a.display_name), q(a.serial_number), q(a.mac_address),
                     q(`carries HWA ${a.hardware_asset_id}, which the ITSM export does not contain`),
                     q('')].join(','));
      }
      for (const row of onlyInItsm) {
        console.log(['only-in-itsm', q(row.display_name), q(''), q(''),
                     q('ITSM has this hardware; the survey did not find it'),
                     q(row.serial_match ? `serial matches local ${row.serial_match.display_name}` : '')].join(','));
      }
      return;
    }

    const unlinkedCount = findings.length;
    console.log('🔗 Matching the physical inventory against the ITSM export\n');
    console.log(`${assets.length} live assets · ${unlinkedCount} without an ITSM link · ${snapshotRows.length} rows in the export`);

    const by = (v: MatchVerdict) => findings.filter((f) => f.result.verdict === v);
    const section = (title: string, rows: Finding[], emptyText: string, note?: string) => {
      console.log(`\n${title}: ${rows.length}`);
      if (rows.length === 0) { console.log(`   ${emptyText}`); return; }
      if (note) console.log(`   ${note}`);
      for (const f of rows.slice(0, 40)) {
        console.log(`   - ${f.asset.display_name}: ${f.result.reason}`);
        for (const c of f.result.candidates.slice(0, 3)) console.log(`        ${describeCandidate(c)}`);
      }
      if (rows.length > 40) console.log(`   … and ${rows.length - 40} more (use --csv for all of them)`);
    };

    section('1. Confident — ITSM already knows it, the sticker is what is missing',
      by('confident'), 'None.',
      'Task for each: label it, then link it on the asset page. Safe to work in bulk.');
    section('2. Ambiguous — a person has to decide', by('ambiguous'), 'None.');
    section('3. Weak evidence only', by('weak-only'), 'None.');
    section('4. Nothing to match on', by('no-evidence'), 'None.');

    console.log(`\n5. Carries an HWA the export does not contain: ${hwaUnknown.length}`);
    if (hwaUnknown.length === 0) console.log('   None — every HWA in the app exists in the export.');
    else {
      console.log('   Either the number was misread, or the record was deleted in ITSM.');
      for (const a of hwaUnknown.slice(0, 20)) console.log(`   - ${a.display_name}: HWA ${a.hardware_asset_id}`);
    }

    console.log(`\n6. In ITSM, not found by the survey: ${onlyInItsm.length}`);
    if (onlyInItsm.length === 0) console.log('   None.');
    else {
      console.log('   Disposed but still active in ITSM, or simply not walked past yet.');
      for (const row of onlyInItsm.slice(0, 20)) {
        console.log(`   - ${row.display_name}${row.serial_match ? ` (serial matches local ${row.serial_match.display_name})` : ''}`);
      }
    }

    console.log('\nNothing was written. This report only reads.');
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error('✖ Match report failed:', err);
  process.exit(1);
});
