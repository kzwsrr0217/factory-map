import * as path from 'path';
import dotenv from 'dotenv';

// Set NODE_ENV to 'test' before any module (including server.ts) is imported.
// This prevents server.ts from calling startServer() and trying to bind the port.
process.env.NODE_ENV = 'test';

/**
 * Load the same .env the rest of the tooling uses, from BOTH plausible places.
 *
 * `dotenv.config()` with no path reads the process cwd, which under jest is `backend/`. The
 * repository's .env lives at the root, one level up, so the bare call found nothing and every
 * value fell back to the code defaults. dotenv never overwrites an already-set variable, so
 * listing both paths is safe and the shell still wins over either file.
 */
dotenv.config();
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });

/**
 * Force an isolated `_test` database. UNCONDITIONALLY.
 *
 * This used to be `if (process.env.MSSQL_DATABASE && !endsWith('_test'))`, which fails OPEN: with
 * MSSQL_DATABASE unset the redirect was skipped entirely and config.ts then supplied its own
 * default — the real development database. That is not hypothetical. It happened on 2026-08-17: a
 * suite run with only MSSQL_HOST set wrote 22 assets, 9 buildings, 9 floors, 9 work areas and 3
 * users into the dev database and emptied `itsm_hardware_snapshot`, which had to be re-imported.
 * The old comment above even predicted the mechanism and then guarded against it with a condition
 * that could not fire.
 *
 * So the suffix is applied to whatever the name resolves to, including the fallback, and there is
 * no branch in which tests can address a database not ending in `_test`. DEFAULT_DATABASE has to
 * match config.ts's own default; if that ever changes, the worst case here is an oddly-named test
 * database rather than a run against real data.
 */
const DEFAULT_DATABASE = 'factorymap';
const configured = process.env.MSSQL_DATABASE || DEFAULT_DATABASE;
process.env.MSSQL_DATABASE = configured.endsWith('_test') ? configured : `${configured}_test`;

// Said out loud on every run. The failure above was silent for three whole suite runs; a line
// naming the target database is the cheapest possible way to never wonder again.
console.log(`🧪 tests will use database "${process.env.MSSQL_DATABASE}" on ${process.env.MSSQL_HOST || 'localhost'}`);
