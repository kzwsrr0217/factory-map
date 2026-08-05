/**
 * import-inventory-survey.ts — Imports the physical device inventory survey
 * (the "IT_Eszkoz_Nyilvantarto" walk-around tool) into factorymap.
 *
 * This script is now only the file-reading and the printing. What the import actually
 * means — how a survey row is matched to an asset, what gets created, which names did not
 * resolve — lives in `services/inventory/surveyImport.ts`, shared with the upload in the
 * browser. Two copies of that logic would drift, and then two people comparing their
 * reports would disagree about the inventory.
 *
 * DRY RUN BY DEFAULT — this doubles as the validation tool. Re-run until the report is
 * clean, then pass `--apply`.
 *
 * Corrections ("the survey says 'hr iroda', we mean 'HR Iroda'") now live in the
 * `name_corrections` table and can be edited on the Inventory Import page. An
 * `inventory-corrections.json` next to the export is still read and layered on top, so an
 * existing file keeps working:
 *   { "persons": { "gorog tomi": "Görög Tamás" },
 *     "helyszin": { "hr": "HR" },
 *     "work_area": { "hr iroda": "HR Iroda" } }
 *
 * Usage (reads every *.json survey export in the directory, merging by the tool's own row
 * `id` if the same entry appears in more than one file):
 *   npx ts-node src/scripts/import-inventory-survey.ts /path/to/export/dir            (dry run)
 *   npx ts-node src/scripts/import-inventory-survey.ts /path/to/export/dir --apply    (commit)
 *   ... [--create-missing-workareas]  create the rooms the survey names and the map lacks
 */
import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { AppDataSource } from '../config/database';
import {
  Corrections,
  SurveyFile,
  SurveyRow,
  SurveyImportPlan,
  mergeSurveyRows,
  planSurveyImport,
} from '../services/inventory/surveyImport';

const CORRECTIONS_FILE = 'inventory-corrections.json';

function loadCorrectionsFile(dir: string): Corrections {
  const full = path.join(dir, CORRECTIONS_FILE);
  if (!fs.existsSync(full)) return {};
  try {
    const parsed = JSON.parse(fs.readFileSync(full, 'utf8').replace(/^﻿/, ''));
    return parsed && typeof parsed === 'object' ? (parsed as Corrections) : {};
  } catch {
    console.warn(`⚠️  ${CORRECTIONS_FILE} is not valid JSON — ignoring it.`);
    return {};
  }
}

function readSurveyRows(dir: string): SurveyRow[] {
  const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.json') && f !== CORRECTIONS_FILE);
  const batches: SurveyRow[][] = [];
  for (const file of files) {
    let parsed: SurveyFile;
    try {
      parsed = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8').replace(/^﻿/, ''));
    } catch {
      console.warn(`⚠️  ${file}: not valid JSON, skipping.`);
      continue;
    }
    if (!Array.isArray(parsed.eszkozok)) continue;
    batches.push(parsed.eszkozok);
  }
  return mergeSurveyRows(batches);
}

function printReport(plan: SurveyImportPlan): void {
  console.log(`Matched for update (existing ITSM-linked/local assets): ${plan.to_update}`);
  console.log(`Matched for creation (new local-only assets, not yet in ITSM): ${plan.to_create}`);
  console.log(`Would sit on a floor but in no room: ${plan.no_room}`);

  if (plan.unmatched_place.length > 0) {
    const total = plan.unmatched_place.reduce((sum, u) => sum + u.rows, 0);
    console.log(`\n⚠️  ${total} row(s) had no matching Building/Floor — add a "building"/"floor" correction, or check they exist:`);
    for (const u of plan.unmatched_place) {
      const hint = [
        u.building_suggestion ? `building → "${u.building_suggestion}"?` : '',
        u.floor_suggestion ? `floor → "${u.floor_suggestion}"?` : '',
      ].filter(Boolean).join(' ');
      console.log(`   - ${u.building || '(blank)'} / floor "${u.floor || '(blank)'}" (${u.rows} row(s)) ${hint}`);
    }
  }
  if (plan.missing_work_areas.length > 0) {
    console.log(`\n⚠️  ${plan.missing_work_areas.length} room(s) referenced by the survey don't exist on the map yet:`);
    for (const m of plan.missing_work_areas) {
      const hint = m.suggestion ? `  did you mean "${m.suggestion}"?` : '';
      console.log(`   - ${m.where}: ${m.zone_name || '(no zone)'} / ${m.room_name} (${m.rows} row(s))${hint}`);
    }
    console.log('   Either draw them (name = the room, Zone = the helyszín), fix the names on the');
    console.log('   Inventory Import page, or pass --create-missing-workareas to have them created.');
  }
  if (plan.unmatched_persons.length > 0) {
    console.log(`\n⚠️  ${plan.unmatched_persons.length} distinct person name(s) didn't match anyone known from ITSM — kept as free text; add a "persons" correction if it's a typo or nickname:`);
    for (const u of plan.unmatched_persons) {
      const hint = u.suggestion ? `  did you mean "${u.suggestion}"?` : '';
      console.log(`   - "${u.name}" (${u.rows} row(s))${hint}`);
    }
  }
  if (plan.unmatched_hwa.length > 0) {
    console.log(`\n⚠️  ${plan.unmatched_hwa.length} row(s) had an HWA number with no matching asset — likely still needs the unlinked-MMH bulk-create step, or has a typo:`);
    for (const r of plan.unmatched_hwa) console.log(`   - ${r.hwa} (${r.note || 'no note'})`);
  }
}

function resolveDir(): string {
  const arg = process.argv[2];
  if (!arg) {
    console.error('✖ Usage: import-inventory-survey.ts <export-directory> [--create-missing-workareas] [--apply]');
    process.exit(1);
  }
  return path.resolve(arg);
}

async function main(): Promise<void> {
  const dir = resolveDir();
  const apply = process.argv.includes('--apply');
  const createMissing = process.argv.includes('--create-missing-workareas');
  if (!fs.existsSync(dir)) { console.error(`✖ Directory not found: ${dir}`); process.exit(1); }

  const corrections = loadCorrectionsFile(dir);
  const rows = readSurveyRows(dir);
  console.log(`📋 ${apply ? 'Importing' : 'Validating (dry-run)'} inventory survey from: ${dir}`);
  console.log(`  ${rows.length} survey entries found across the export file(s).\n`);

  await AppDataSource.initialize();
  try {
    const { plan } = await planSurveyImport({ rows, corrections, createMissingWorkAreas: createMissing, apply });
    printReport(plan);

    if (plan.created_areas) {
      console.log(`\n🏗️  Created ${plan.created_areas.work_areas} work area(s) and ${plan.created_areas.zones} zone(s).`);
      console.log('   They have default-size rectangles stacked below whatever was already');
      console.log('   drawn on each floor — drag and resize them into place on the Map View.');
      if (plan.created_areas.duplicate_names.length > 0) {
        console.log(`   ⚠️  ${plan.created_areas.duplicate_names.length} share a name with another room on the same floor:`);
        for (const d of plan.created_areas.duplicate_names) console.log(`      - ${d}`);
      }
    }

    if (!apply) {
      if (createMissing && plan.missing_work_areas.length > 0) {
        console.log(`\nℹ️  --create-missing-workareas would create ${plan.missing_work_areas.length} room(s) and their zones, listed above.`);
      }
      console.log(`\nℹ️  Dry run only — nothing was written. Fix what's flagged above (on the Inventory Import page, via ${CORRECTIONS_FILE} in the same directory, by drawing the missing WorkAreas on the map, or by passing --create-missing-workareas), re-run to confirm it's clean, then pass --apply to commit.`);
      return;
    }

    console.log(`\n✅ Applied: ${plan.to_update} asset(s) updated, ${plan.to_create} new local asset(s) created.`);
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error('✖ Import failed:', err);
  process.exit(1);
});
