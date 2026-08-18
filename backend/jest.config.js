/**
 * jest.config.js — the two settings that make a jest invocation safe here, in the config rather
 * than only in the npm script.
 *
 * Both of these were already on `npm test` as `--runInBand --forceExit`. Moving them here changes
 * one thing that matters: a direct `npx jest src/__tests__/one.test.ts` now behaves the same way.
 * Without that, running a single suite the obvious way is both unsafe and appears to hang, and the
 * npm script papering over it is exactly what makes the trap hard to see.
 *
 * ── maxWorkers: 1 ───────────────────────────────────────────────────────────────
 * Every suite talks to the SAME `factorymap_test` database, and several assert global properties —
 * "at least one audit entry in the last hour", "the comparison is not stale". Parallel workers
 * would have them writing over each other's premises. Serial is not a performance choice here, it
 * is the only correct one until those assertions are scoped to the rows each suite creates.
 *
 * ── forceExit ───────────────────────────────────────────────────────────────────
 * The suites connect through `AppDataSource`, the app's own singleton, and nothing closes it —
 * because nothing should: it is a process-lifetime pool the app owns and the tests borrow. So a
 * live handle remains when a suite ends and Node will not exit on its own.
 *
 * Measured on 2026-08-18: `npx jest src/__tests__/audit.test.ts` without this was killed at 600s,
 * twice. With it, 17.7s. That cost three separate attempts to bisect a failing suite in one day
 * before the cause was found, and the cause was running jest directly rather than through the npm
 * script — which is precisely the mistake this file exists to make impossible.
 *
 * Closing the DataSource in a shared `afterAll` was considered and rejected: hooks registered by a
 * setup file run alongside each suite's own `afterAll` cleanups, several of which delete rows
 * through that same connection, and the ordering between them is not something to bet on. Closing a
 * connection the tests do not own is the wrong fix for the tests not owning it.
 *
 * What forceExit costs: a genuinely leaked handle no longer shows up as a hang. To check a suite for
 * that, run it with `--detectOpenHandles --forceExit=false`.
 */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/src/__tests__/**/*.test.ts'],
  setupFiles: ['<rootDir>/src/__tests__/helpers/jestEnv.ts'],
  setupFilesAfterEnv: ['<rootDir>/src/__tests__/helpers/jestSetup.ts'],
  moduleNameMapper: {
    /**
     * Strip the `.js` extension from relative ESM-style imports so ts-jest resolves the .ts source.
     *
     * `[.]` rather than `\.` on purpose. In package.json's JSON this was `"\\."`; carried into a JS
     * file it needs the same doubling, and a single `\.` silently becomes `.` — "any character" —
     * which then matches `.cjs` as well. That broke `zod`'s internal `./v3/external.cjs` import and
     * every suite importing the validation middleware failed to RUN, not to pass. A character class
     * needs no escaping at all, so it cannot rot the same way.
     */
    '^([.]{1,2}/.*)[.]js$': '$1',
  },
  // See the block comment above. Neither of these is a preference.
  maxWorkers: 1,
  forceExit: true,
};
