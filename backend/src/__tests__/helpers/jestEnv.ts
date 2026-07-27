import dotenv from 'dotenv';

// Set NODE_ENV to 'test' before any module (including server.ts) is imported.
// This prevents server.ts from calling startServer() and trying to bind the port.
process.env.NODE_ENV = 'test';

// Load .env here too (config.ts also calls this, later, via testApp.ts) —
// dotenv never overwrites an already-set var, so this is just to make sure
// MSSQL_DATABASE is populated from .env BEFORE the redirect check below runs.
// Without this, a local `npm test` run whose MSSQL_DATABASE lives only in
// .env (not the shell env) would see it as unset here, skip the redirect,
// and only pick up the real (non-`_test`) name once config.ts loads it —
// silently defeating the isolation this file exists to provide.
dotenv.config();

// Redirect to an isolated `_test` database on the same SQL Server instance,
// before config.ts (imported later, via testApp.ts) ever reads MSSQL_DATABASE.
// Without this, the test suite ran directly against the dev database — the
// itsm.test.ts sync/all test in particular writes real mock ITSM records
// into whatever DB it's pointed at, which polluted the dev DB more than
// once. testApp.ts creates this database on first connect if it doesn't
// exist yet (synchronize:true then creates the schema).
if (process.env.MSSQL_DATABASE && !process.env.MSSQL_DATABASE.endsWith('_test')) {
  process.env.MSSQL_DATABASE = `${process.env.MSSQL_DATABASE}_test`;
}
