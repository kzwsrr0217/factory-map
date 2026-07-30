/**
 * mssqlBatch.ts — Helpers for staying under SQL Server's per-statement
 * parameter cap.
 *
 * MSSQL rejects any single statement carrying more than 2100 parameters with
 * error 8003 ("The incoming request has too many parameters"). Two shapes in
 * this codebase hit that ceiling on real data:
 *
 *  - A bulk INSERT spends one parameter **per column per row**. `Asset` has 84
 *    persisted columns, so ~25 rows is already the limit — and a full-snapshot
 *    run inserts ~1000. This is not theoretical: it took down
 *    `createAssetsFromUnlinkedMmh` in production with all 1057 rows.
 *  - An `In([...])` lookup spends one parameter **per value**, so a >1900-item
 *    id list overflows on its own.
 *
 * Everything bulk therefore has to be chunked. This module is the single home
 * for that arithmetic — it previously existed as three independent copies (in
 * import-master-data.ts, import-itsm-snapshot.ts and ReconcileService.ts), each
 * with its own hand-maintained column count, so raising the headroom or fixing
 * the derivation meant finding all three by grep.
 */
import { In, ObjectLiteral, Repository, EntityTarget } from 'typeorm';
import { AppDataSource } from '../config/database';

/**
 * Parameters we allow per statement — 2100 minus headroom, since a row's
 * parameter count isn't always exactly its column count (TypeORM may add or
 * omit a few depending on defaults and generated values).
 */
export const MSSQL_PARAM_BUDGET = 1900;

/** Splits an array into fixed-size batches. */
export function chunked<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size));
  return batches;
}

/** How many rows of `columnCount` columns fit in one statement. */
export function chunkFor(columnCount: number): number {
  return Math.max(1, Math.floor(MSSQL_PARAM_BUDGET / columnCount));
}

/**
 * `chunkFor` with the column count read from TypeORM's own metadata instead of
 * hand-counted. Prefer this for entities: a hardcoded count silently goes
 * stale the moment someone adds a column, and the failure only surfaces on the
 * large-batch path that nobody exercises in dev. Requires an initialised
 * DataSource, so call it inside a function rather than at module scope.
 */
export function chunkForEntity<T extends ObjectLiteral>(entity: EntityTarget<T>): number {
  return chunkFor(AppDataSource.getMetadata(entity).columns.length);
}

/**
 * `repo.find({ where: { [field]: In(values) } })`, split so the `In` list never
 * exceeds the parameter budget. Returns the concatenated rows; an empty
 * `values` array short-circuits without querying.
 */
export async function findByIn<T extends ObjectLiteral>(
  repo: Repository<T>,
  field: keyof T & string,
  values: string[],
): Promise<T[]> {
  const rows: T[] = [];
  for (const batch of chunked(values, MSSQL_PARAM_BUDGET)) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rows.push(...(await repo.find({ where: { [field]: In(batch) } as any })));
  }
  return rows;
}
