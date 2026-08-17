/**
 * import-nexthink-snapshot.ts — imports the two Nexthink Investigations CSV exports.
 *
 * Nexthink is the third source on the same estate, and the only one that is not something a
 * person typed: ITSM holds what was recorded, the survey holds what was seen on a walk-around,
 * and this holds what the machines themselves reported. It is evidence, not a system of record
 * — nothing here overwrites an asset.
 *
 * Both exports come from Investigations (NQL editor -> Run -> export the grid to CSV). Scope
 * BOTH to the same entities or the two files describe different populations and every
 * cross-table report is quietly wrong; the first attempt at this scoped one to Veszprem-Client
 * and the other to nothing, and 92 devices appeared in the logons that were not in the device
 * list at all. The `entity` list below is the full site, IPCs included — they live in the
 * Industry entities, so a Client-only export omits every shop-floor machine.
 *
 *   nexthink-devices.csv
 *     devices
 *     | where entity in ["Veszprem-Client","Veszprem-Industry-Low","Veszprem-Industry-Medium",
 *                        "Veszprem-Remote","Veszprem-not-categorized"]
 *     | list name, first_seen, last_seen, entity, hardware.type, hardware.manufacturer,
 *            hardware.model, hardware.bios_serial_number, operating_system.name
 *
 *   nexthink-logins.csv
 *     session.logins during past 30d
 *     | where device.entity in [ ...the same five... ]
 *     | summarize logins = count() by device.name, user.name, user.ad.full_name
 *     | list device.name, user.name, user.ad.full_name, logins
 *
 * Two limits of the source, both hit while writing this: `devices` accepts at most a 91-day
 * window, and `session.logins` refuses 90 days outright ("the requested precision cannot be
 * met"), so the logon window is necessarily shorter than the device one. Do not widen it to
 * match — anything comparing the two tables has to tolerate the difference instead.
 *
 * Dry run by default, like every other importer here. The dry run is also the only place the
 * one genuinely unknown number gets stated: how much of the Nexthink estate the factory map
 * knows about at all.
 *
 *   npm run import:nexthink -- /path/to/export/dir             # measures, writes nothing
 *   npm run import:nexthink -- /path/to/export/dir --apply     # replaces both tables
 *
 * Or, with an API credential configured, the same thing without the manual export step:
 *
 *   npm run import:nexthink -- --from-api                      # measures, writes nothing
 *   npm run import:nexthink -- --from-api --apply              # replaces both tables
 *
 * The two paths converge at `planNexthinkImport`, so everything below this line — the counts, the
 * join measurement, the transaction — is identical either way. `--from-api` is not the successor
 * of the directory argument; the hand export stays the fallback for a revoked credential or a
 * renamed saved query, both of which will happen eventually.
 */
import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import config from '../config/config';
import { AppDataSource } from '../config/database';
import {
  planNexthinkImport,
  parseNexthinkDevicesCsv,
  parseNexthinkLoginsCsv,
  NexthinkDeviceInput,
  NexthinkParseResult,
  NexthinkLoginRow,
  NEXTHINK_VISIBLE_ASSET_TYPES,
} from '../services/nexthink/snapshotImport';
import { fetchDevices, fetchLogins, missingApiConfig, describeSource } from '../services/nexthink/nexthinkApi';

const DEVICES_FILE = 'nexthink-devices.csv';
const LOGINS_FILE = 'nexthink-logins.csv';

function readIfPresent(dir: string, file: string): string | null {
  const full = path.join(dir, file);
  return fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : null;
}

function resolveDir(): string {
  const arg = process.argv.slice(2).find((a) => !a.startsWith('--'));
  if (!arg) {
    console.error('✖ Usage: import-nexthink-snapshot.ts <export-directory> [--apply]');
    console.error('     or: import-nexthink-snapshot.ts --from-api [--apply]');
    console.error(`  Expects ${DEVICES_FILE} and/or ${LOGINS_FILE} in that directory.`);
    process.exit(1);
  }
  return path.resolve(arg);
}

interface Sources {
  devices: NexthinkDeviceInput | null;
  logins: NexthinkParseResult<NexthinkLoginRow> | null;
  /** Both are always present from the API; from a directory either file may be missing. */
  haveDevices: boolean;
  haveLogins: boolean;
}

/**
 * Pull both datasets from the NQL API.
 *
 * `malformed` is 0 rather than absent: no line splitting happens, so there is no such thing as a
 * malformed row here. Reporting it as zero keeps the printed summary the same shape for both
 * paths instead of making every line conditional on where the data came from.
 */
async function readFromApi(): Promise<Sources> {
  const missing = missingApiConfig();
  if (missing.length > 0) {
    console.error('\n✖ --from-api needs these environment variables, which are not set:');
    for (const key of missing) console.error(`    ${key}`);
    console.error('\n  NEXTHINK_INSTANCE and NEXTHINK_REGION come from the portal URL');
    console.error('  (https://<instance>.<region>.nexthink.cloud). The client id and secret come from');
    console.error('  Administration -> API credentials, with the NQL API permission granted. The two');
    console.error('  query ids are saved NQL queries flagged for API use, in the form #some_id.');
    process.exit(1);
  }
  console.log(`  · source: ${describeSource()}`);
  const devices = await fetchDevices();
  const logins = await fetchLogins();
  // Recorded because the saved queries live in Nexthink, not in this repo: if someone widens an
  // entity filter there, this line is the only place the change is visible afterwards.
  console.log(`  · devices query ran: ${devices.executed_query}`);
  console.log(`  · logins query ran:  ${logins.executed_query}`);
  return {
    devices: {
      rows: devices.rows, malformed: 0, skipped: 0, unparseable_dates: devices.unparseable_dates,
    },
    logins: { rows: logins.rows, malformed: 0, skipped: logins.skipped },
    haveDevices: true,
    haveLogins: true,
  };
}

function readFromDir(dir: string): Sources {
  const devicesCsv = readIfPresent(dir, DEVICES_FILE);
  const loginsCsv = readIfPresent(dir, LOGINS_FILE);
  if (!devicesCsv && !loginsCsv) {
    console.error(`✖ Neither ${DEVICES_FILE} nor ${LOGINS_FILE} is present in ${dir}.`);
    process.exit(1);
  }
  if (!devicesCsv) console.log(`  – ${DEVICES_FILE}: not present, device table left alone`);
  if (!loginsCsv) console.log(`  – ${LOGINS_FILE}: not present, login table left alone`);
  return {
    devices: devicesCsv ? parseNexthinkDevicesCsv(devicesCsv) : null,
    logins: loginsCsv ? parseNexthinkLoginsCsv(loginsCsv) : null,
    haveDevices: Boolean(devicesCsv),
    haveLogins: Boolean(loginsCsv),
  };
}

async function main(): Promise<void> {
  // Opt in to writing, rather than opt out: this replaces two tables wholesale.
  const apply = process.argv.includes('--apply');
  const fromApi = process.argv.includes('--from-api');

  let sources: Sources;
  if (fromApi) {
    console.log(`📥 ${apply ? 'Importing' : 'Dry run —'} Nexthink snapshot from the NQL API`);
    sources = await readFromApi();
  } else {
    const dir = resolveDir();
    if (!fs.existsSync(dir)) {
      console.error(`✖ Directory not found: ${dir}`);
      process.exit(1);
    }
    console.log(`📥 ${apply ? 'Importing' : 'Dry run —'} Nexthink snapshot from: ${dir}`);
    sources = readFromDir(dir);
  }

  /**
   * Named separately so the failure can say which host it tried.
   *
   * The default config points at `mssql`, the compose service name, which resolves inside the
   * container and nowhere else. Run from a laptop it produces a `getaddrinfo ENOTFOUND mssql`
   * buried in a 25-line stack trace, which reads like a broken script rather than a missing
   * environment variable — so it is caught and translated here.
   */
  try {
    await AppDataSource.initialize();
  } catch (err) {
    const { host, port, database } = config.mssql;
    console.error(`\n✖ Could not connect to the database at ${host}:${port} (${database}).`);
    if (/ENOTFOUND|EAI_AGAIN/.test(String(err))) {
      console.error(`  The name "${host}" did not resolve. Inside the backend container that is`);
      console.error('  the compose service name and is correct; from a host shell it is not.');
      console.error('  Set MSSQL_HOST=localhost (and start the DB: docker-compose up -d mssql).');
    } else if (/Login failed/i.test(String(err))) {
      console.error('  The credentials were rejected. If the SA password was rotated but the');
      console.error('  mssql_data volume predates it, the stored password is still the old one.');
    } else {
      console.error(`  ${String(err)}`);
    }
    process.exit(1);
  }
  try {
    const plan = await planNexthinkImport({ devices: sources.devices, logins: sources.logins, apply });
    const d = plan.devices;
    const l = plan.logins;
    const j = plan.join;

    if (sources.haveDevices) {
      console.log(`\n  ${apply ? '✔' : '·'} nexthink_device_snapshot: ${d.parsed} rows ${apply ? 'replaced' : 'would be replaced'}`);
      if (d.malformed > 0) console.log(`    ${d.malformed} line(s) skipped — field count did not match the header`);
      if (d.skipped > 0) console.log(`    ${d.skipped} row(s) skipped — no device name`);
      if (d.unparseable_dates > 0) {
        console.log(`    ${d.unparseable_dates} row(s) had an unreadable last_seen — stored as NULL, not guessed`);
      }
      console.log('    per entity (Win11 / total):');
      for (const [entity, s] of Object.entries(d.by_entity).sort((a, b) => b[1].total - a[1].total)) {
        const industrial = /industry/i.test(entity) && s.windows_11 === 0 && s.total > 0;
        console.log(`      ${entity.padEnd(26)} ${String(s.windows_11).padStart(3)} / ${String(s.total).padStart(3)}${industrial ? '   ← none on Windows 11' : ''}`);
      }
      // Absence is the "gone" signal here, not an old date — Nexthink ages inactive devices
      // out of the export entirely. So a large quiet count is unexpected, and worth saying.
      console.log(`    quiet for 30+ days: ${d.quiet_30d} (Nexthink drops long-inactive devices, so this is normally near zero)`);
    }

    if (sources.haveLogins) {
      console.log(`\n  ${apply ? '✔' : '·'} nexthink_login_snapshot: ${l.parsed} rows ${apply ? 'replaced' : 'would be replaced'}, across ${l.devices_with_logins} device(s)`);
      if (l.malformed > 0) console.log(`    ${l.malformed} line(s) skipped — field count did not match the header`);
      if (l.skipped > 0) console.log(`    ${l.skipped} row(s) skipped — missing device/user, or a repeated pair`);
      const kinds = Object.entries(l.by_account_kind).sort((a, b) => b[1] - a[1]);
      console.log('    by account kind:');
      for (const [kind, n] of kinds) console.log(`      ${kind.padEnd(16)} ${String(n).padStart(4)}`);
      const people = l.by_account_kind.person ?? 0;
      console.log(`    ${people} of ${l.parsed} rows are a named person — the rest are admin/machine/generic/local accounts`);
      if ((l.by_account_kind.person_unnamed ?? 0) > 0) {
        console.log(`    ${l.by_account_kind.person_unnamed} look like a person but carry no AD name — reported, never counted as evidence`);
      }
      if (l.near_ties > 0) {
        console.log(`    ${l.near_ties} device(s) have their top two users within one login of each other`);
        console.log('      — shared machines: "whose is this" has no single answer and must not be decided automatically');
      }
    }

    if (sources.haveDevices) {
      console.log('\n  Against the factory map:');
      console.log(`    ${j.matched}/${d.parsed} Nexthink devices match an asset in the map (by hardware_asset_id, or by name where that is blank)`);
      if (j.unknown_to_map.length > 0) {
        const sample = j.unknown_to_map.slice(0, 15).join(', ');
        console.log(`    ${j.unknown_to_map.length} device(s) Nexthink sees that the map has never heard of:`);
        console.log(`      ${sample}${j.unknown_to_map.length > 15 ? `, … (+${j.unknown_to_map.length - 15})` : ''}`);
      }
      console.log(`    ${j.never_seen_by_nexthink}/${j.visible_type_assets} assets of a type Nexthink could see (${NEXTHINK_VISIBLE_ASSET_TYPES.join('/')}) are absent from this export`);
      console.log('      — either genuinely inactive, or simply outside the exported entities. A question, not a verdict.');
    }

    if (!apply) {
      console.log('\n  Nothing was written. Re-run with --apply to replace the tables.');
    }
  } finally {
    await AppDataSource.destroy();
  }
}

main().catch((err) => {
  console.error('✖ Import failed:', err);
  process.exit(1);
});
