/**
 * convert-survey-csv.ts — A survey export that only exists as CSV, turned into the tool's
 * own JSON so it can be imported like every other one.
 *
 * The walk-around tool writes both formats, and the JSON is the one worth having: it carries
 * a row `id`, which is how re-importing a refined export updates rows instead of duplicating
 * them, and an `azonosito_mod` column saying whether the device is in ITSM. One export in
 * hand has neither, because only the CSV survived. Rather than hand-edit it:
 *
 *  - **The mode is derived from the identifier column.** A row with something in it is read
 *    as an ITSM row. Guessing the other way round would create a fresh local asset for every
 *    device that is already registered — 65 duplicates on the file this was written for.
 *  - **Ids are minted from the row's own content**, not from a counter or a clock, so
 *    converting the same CSV twice produces the same ids and the import dedupes. That is the
 *    whole reason the id exists.
 *
 * The output is a plain export: same shape, same field names, marked with `converted_from` so
 * nobody later mistakes it for something the tool wrote.
 *
 * Usage:
 *   npx ts-node src/scripts/convert-survey-csv.ts <file.csv> [-o out.json]
 */
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

/** The CSV headers the tool writes, in Hungarian, mapped to the JSON field names. */
const COLUMNS: Record<string, string> = {
  'hwa szám': 'hwa',
  'eszköz típus': 'eszkoz_tipus',
  sorozatszám: 'sorozatszam',
  terület: 'terulet',
  épület: 'epulet',
  emelet: 'emelet',
  helyszín: 'helyszin',
  'work area': 'work_area',
  személy: 'szemely',
  megjegyzés: 'megjegyzes',
  létrehozva: 'letrehozva',
  módosítva: 'modositva',
};

/** Values the tool writes into the identifier column that are not identifiers. */
const NOT_AN_IDENTIFIER = /^(?:-+|\?+|n\s*\/?\s*a)$/i;

/**
 * A minimal CSV reader for this one shape: semicolon-separated, optional double quotes,
 * doubled quotes for a literal one. Deliberately not a dependency — the file comes from a
 * tool we know, and a parser that silently accepts anything is how a shifted column goes
 * unnoticed.
 */
function parseCsv(text: string, delimiter = ';'): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === delimiter) { row.push(field); field = ''; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += ch;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/**
 * A stable id for a row, from the row itself.
 *
 * Shaped like the tool's own uuids so nothing downstream has to care where it came from, but
 * derived: the same CSV converted twice gives the same ids, and a re-import updates rather
 * than duplicates.
 */
function idFor(row: Record<string, string>): string {
  const material = ['hwa', 'sorozatszam', 'eszkoz_tipus', 'epulet', 'emelet', 'helyszin', 'work_area', 'szemely', 'megjegyzes']
    .map((k) => (row[k] ?? '').trim().toLowerCase()).join('|');
  const h = createHash('sha1').update(material).digest('hex');
  return [h.slice(0, 8), h.slice(8, 12), h.slice(12, 16), h.slice(16, 20), h.slice(20, 32)].join('-');
}

function main(): void {
  const input = process.argv[2];
  if (!input) {
    console.error('✖ Usage: convert-survey-csv.ts <file.csv> [-o out.json]');
    process.exit(1);
  }
  const outFlag = process.argv.indexOf('-o');
  const output = outFlag > 0 ? process.argv[outFlag + 1] : input.replace(/\.csv$/i, '.converted.json');

  // The tool writes UTF-8 with a BOM; strip it or the first header keeps an invisible
  // character and never matches.
  const text = fs.readFileSync(path.resolve(input), 'utf8').replace(/^﻿/, '');
  const table = parseCsv(text);
  if (table.length < 2) { console.error('✖ Nothing in that file but a header.'); process.exit(1); }

  const headers = table[0].map((h) => h.trim().toLowerCase());
  const mapped = headers.map((h) => COLUMNS[h]);
  const unknown = headers.filter((_, i) => !mapped[i]);
  if (unknown.length > 0) {
    // Named, not ignored: an unexpected column usually means the export is a different
    // shape, and reading it anyway would put values in the wrong fields.
    console.warn(`⚠️  Columns this converter does not know, and will drop: ${unknown.join(', ')}`);
  }
  if (!mapped.includes('hwa')) {
    console.error('✖ No "HWA szám" column — this does not look like a survey export.');
    process.exit(1);
  }

  const rows: Array<Record<string, string>> = [];
  const seen = new Set<string>();
  let duplicates = 0;
  let withIdentifier = 0;
  for (const line of table.slice(1)) {
    const row: Record<string, string> = {};
    mapped.forEach((field, i) => { if (field) row[field] = (line[i] ?? '').trim(); });

    const identifier = (row.hwa ?? '').trim();
    const usable = identifier && !NOT_AN_IDENTIFIER.test(identifier);
    if (usable) withIdentifier++;
    // The tool's own values, so the importer needs no special case for a converted file.
    row.azonosito_mod = usable ? 'HWA' : 'EGYEB';
    row.id = idFor(row);

    // Two identical rows are one device recorded twice; they collapse here rather than
    // becoming two entries with the same derived id.
    if (seen.has(row.id)) { duplicates++; continue; }
    seen.add(row.id);
    rows.push(row);
  }

  const doc = {
    verzio: 1,
    mentve: new Date().toISOString().slice(0, 19),
    converted_from: path.basename(input),
    eszkozok: rows,
  };
  fs.writeFileSync(path.resolve(output), JSON.stringify(doc, null, 2), 'utf8');

  console.log(`📋 ${path.basename(input)} → ${path.basename(output)}`);
  console.log(`  ${rows.length} entries (${withIdentifier} with an identifier → read as ITSM rows, ${rows.length - withIdentifier} as not-in-ITSM)`);
  if (duplicates > 0) console.log(`  ${duplicates} identical row(s) collapsed — the same device recorded twice`);
  console.log('  Ids are derived from each row, so converting again gives the same ids and a');
  console.log('  re-import updates instead of duplicating. Preview it before applying.');
}

main();
