/**
 * ImportRun.entity.ts — one row per import, so the snapshots stop being amnesiac.
 *
 * Every landing table in this app is replaced wholesale on each import. That is the right choice —
 * it means each table always says "what the source reported as of the last export", never an
 * incrementally-merged cache nobody can reason about. But it throws away the one thing that only
 * a comparison can tell you: what CHANGED.
 *
 * Two concrete losses this recovers:
 *
 *  1. `import-itsm-snapshot` already computes "8 new, 35 changed, 1039 unchanged" and prints it to
 *     a terminal that scrolls away. Nobody can answer "what did Alemba change last week" the day
 *     after.
 *  2. Nexthink ages long-inactive devices out of its export entirely, so a retired machine does
 *     not appear with a stale `last_seen` — it DISAPPEARS. That makes absence the decommission
 *     signal, and absence is only observable against a previous run. With full-replace and no
 *     ledger, the strongest lifecycle signal in the estate is unobtainable.
 *
 * It also gives every report a defensible age. "7 devices quiet for 30+ days" means something
 * different if the export is three weeks old, and until now nothing recorded when it was taken.
 *
 * Deliberately NOT a table of changes — just of runs. Storing a diff per field per row would be a
 * second, subtly different history alongside the audit log, and the questions above need only the
 * key set and the counts.
 */
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * Which source an import came from.
 *
 * The two Nexthink datasets are separate values rather than one: they come from different NQL
 * queries with different windows (`devices` accepts 91 days, `session.logins` refuses 90), so they
 * genuinely are two imports that happen to be run together, and a single row would have to pick
 * one of two row counts.
 */
export type ImportRunSource =
  | 'itsm-hardware'
  | 'nexthink-devices'
  | 'nexthink-logins'
  | 'survey';

@Entity('import_runs')
export class ImportRun {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'source', type: 'nvarchar', length: 40 })
  @Index('IDX_import_runs_source')
  source!: ImportRunSource;

  /**
   * When the export itself was produced, where the source says so — not when we loaded it.
   *
   * Null when unknowable, which is the common case for a hand-taken CSV: the file's own timestamp
   * is when it was saved, which may be long before it reached the app. Left null rather than
   * guessed, so "how old is this data" is either answered or visibly unanswered.
   */
  @Column({ name: 'taken_at', type: 'datetime2', nullable: true })
  taken_at!: Date | null;

  @Column({ name: 'imported_at', type: 'datetime2' })
  @Index('IDX_import_runs_imported_at')
  imported_at!: Date;

  /** Rows the import actually stored, after malformed and skipped ones were dropped. */
  @Column({ name: 'row_count', type: 'int' })
  row_count!: number;

  /**
   * Against the run before it. Null where the importer does not compute them.
   *
   * `gone` counts keys the previous run had and this one does not — the number that matters for
   * Nexthink, and the reason this column exists at all.
   */
  @Column({ name: 'counts', type: 'simple-json', nullable: true })
  counts!: { created?: number; changed?: number; gone?: number; unchanged?: number } | null;

  /**
   * The natural keys present in this run, for sources where absence carries meaning.
   *
   * Only populated for Nexthink devices today. ~334 short strings, so a few kilobytes a run: at
   * one run a day that is around a megabyte a year, which buys the disappearance signal. Storing
   * it for the ITSM export too would be reasonable and is not done, because that importer already
   * derives its own new/changed/gone against the live table it is replacing.
   */
  @Column({ name: 'present_keys', type: 'simple-json', nullable: true })
  present_keys!: string[] | null;

  /**
   * Whatever identifies the input: file name, NQL query id, entity filter. Free-form on purpose —
   * every source describes itself differently and a column per source would be mostly nulls.
   */
  @Column({ name: 'detail', type: 'simple-json', nullable: true })
  detail!: Record<string, unknown> | null;

  /** Who or what ran it. `system` for a scheduled run. */
  @Column({ name: 'imported_by', type: 'nvarchar', length: 100, nullable: true })
  imported_by!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  created_at!: Date;

  toApiResponse() {
    return {
      id: this.id,
      source: this.source,
      taken_at: this.taken_at,
      imported_at: this.imported_at,
      row_count: this.row_count,
      counts: this.counts,
      detail: this.detail,
      imported_by: this.imported_by,
    };
  }
}
