/**
 * NormalisationTask.entity.ts — One thing that has to happen before the inventory,
 * the app and ITSM agree.
 *
 * ── Derived, not kept ───────────────────────────────────────────────────────────
 * These rows are not a to-do list someone maintains. They are recomputed from the
 * three sources (the ITSM export, the physical survey as it landed in the app, and the
 * app's own records) every time the generator runs — see services/itsm/taskGenerator.ts.
 * A hand-kept list drifts and then lies, which would defeat the point: the whole reason
 * this exists is to be able to say "nothing is left" and have that be true.
 *
 * So the only thing stored here that a generator cannot recompute is the HUMAN part:
 * who it is assigned to, a note, and whether someone dismissed it and why. Everything
 * else is a cache of the last derivation, kept so the list has stable ids to link to
 * and so `first_seen_at` can show how long something has been outstanding.
 *
 * ── Closing ────────────────────────────────────────────────────────────────────
 * Two kinds of task, and the difference decides who may close them:
 *   - machine-verifiable — "register this in ITSM" is done when the next export
 *     contains it. The generator closes those itself, `closed_by = 'system'`.
 *   - human-attested — "put a label on it" leaves no trace in any data source. Only a
 *     person can close it, and the app must not pretend otherwise.
 *
 * ── Dismissal ──────────────────────────────────────────────────────────────────
 * A dismissed task stays dismissed while the facts stay the same, and comes back if
 * they change — `evidence_hash` is what "the same" means. This mirrors the per-field
 * ignore on the reconcile page: an ignored difference resurfaces if ITSM changes,
 * because a decision made about one situation should not silently cover another.
 */
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * What has to be done. The list is deliberately small and each value names an action
 * rather than a symptom — "register-in-itsm", not "missing from itsm".
 */
export type NormalisationTaskKind =
  /** Confident match found: link the asset to the ITSM record. */
  | 'link-to-itsm'
  /** Several candidates or a contradiction: a person decides which record it is. */
  | 'decide-match'
  /** Nothing in ITSM carries this device's serial: register it in Alemba. */
  | 'register-in-itsm'
  /** Nothing to match on at all: read a serial off the device so it can be checked. */
  | 'identify-device'
  /** Matched, not read from a sticker: put a label on the device. */
  | 'label-device'
  /** Carries an HWA the export does not contain: check the number or the record. */
  | 'check-hwa'
  /** ITSM has hardware the survey never found: confirm it exists or retire it. */
  | 'verify-disposal'
  /** The asset and its ITSM record disagree on fields: resolve them. */
  | 'resolve-field-differences'
  /**
   * ITSM has it, Nexthink saw it running, the map does not hold it: add it.
   *
   * This is `verify-disposal` with the question already answered. That task sends a person to
   * find out whether hardware ITSM lists still exists; when the machine reported to Nexthink
   * this week, it does, and walking the floor to confirm it is waste. Emitted INSTEAD of
   * verify-disposal for those devices, never alongside it.
   */
  | 'create-in-map'
  /**
   * The logon record and the map name different people: confirm who uses it.
   *
   * Deliberately not folded into `resolve-field-differences`, which is keyed on the ITSM
   * reconcile status of the same asset — one row per (kind, subject) means the two would
   * overwrite each other's evidence and one of the two disagreements would vanish.
   */
  | 'confirm-primary-user'
  /**
   * A machine that was replaced is still switched on: reinstall it into service, or shut it
   * down and set it aside for decommission.
   *
   * The operating rule is that a Win11-capable machine gets reinstalled and reused and one that
   * is not gets set aside. Which is correct needs the readiness data, which is not in this
   * system — so the task states the observation and the choice, and does not pick.
   */
  | 'dispose-replaced-machine'
  /**
   * The app's value is right and Alemba is wrong: correct it in ITSM.
   *
   * The third decision, next to accepting an ITSM value and ignoring it. It closes ITSELF:
   * once a later export carries the app's value, the correction demonstrably happened. That is
   * the only kind here whose completion is proven by an outside system changing.
   */
  | 'correct-in-itsm';

export type NormalisationTaskState = 'open' | 'done' | 'dismissed';

@Entity('normalisation_tasks')
// The natural key: one task of a given kind per subject. The generator upserts on this,
// which is what stops a re-run from producing a second copy of everything.
@Index('UQ_normalisation_tasks_subject', ['kind', 'subject_key'], { unique: true })
@Index('IDX_normalisation_tasks_state', ['state'])
export class NormalisationTask {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'nvarchar', length: 40 })
  kind!: NormalisationTaskKind;

  /**
   * The asset id, or the ITSM id for a task about a record with no local asset. Held
   * as one column so the unique index above can cover both cases — a task is about one
   * subject, whichever side it lives on.
   */
  @Column({ name: 'subject_key', type: 'nvarchar', length: 100 })
  subject_key!: string;

  @Column({ name: 'asset_id', type: 'nvarchar', length: 36, nullable: true })
  asset_id!: string | null;

  @Column({ name: 'itsm_id', type: 'nvarchar', length: 100, nullable: true })
  itsm_id!: string | null;

  /** What the reader needs to act, in the generator's words. */
  @Column({ type: 'nvarchar', length: 1000 })
  summary!: string;

  /**
   * Why this task exists — the evidence at the time of the last derivation. Kept as
   * text rather than a relation because it is a description of a moment, not live data:
   * a person reading a three-week-old task needs to know what was true when it was
   * raised, not what is true now.
   */
  @Column({ type: 'nvarchar', length: 'max' as unknown as number, nullable: true })
  evidence!: string | null;

  /**
   * Fingerprint of the evidence, so a dismissal can be scoped to the situation it was
   * made about. Same facts: stays dismissed. Different facts: comes back.
   */
  @Column({ name: 'evidence_hash', type: 'nvarchar', length: 64 })
  evidence_hash!: string;

  @Column({ type: 'nvarchar', length: 20, default: 'open' })
  state!: NormalisationTaskState;

  /** Free text, and free of any assumption that it matches a real user account. */
  @Column({ name: 'assigned_to', type: 'nvarchar', length: 200, nullable: true })
  assigned_to!: string | null;

  /** Required when dismissing: a decision without a reason cannot be reviewed. */
  @Column({ type: 'nvarchar', length: 1000, nullable: true })
  note!: string | null;

  /** 'system' when the generator proved it done, otherwise the username. */
  @Column({ name: 'closed_by', type: 'nvarchar', length: 200, nullable: true })
  closed_by!: string | null;

  @Column({ name: 'closed_at', type: 'datetime2', nullable: true })
  closed_at!: Date | null;

  /** How long this has been outstanding — kept across re-derivations on purpose. */
  @CreateDateColumn({ name: 'first_seen_at', type: 'datetime2' })
  first_seen_at!: Date;

  /** Last run that still found this necessary. */
  @UpdateDateColumn({ name: 'last_seen_at', type: 'datetime2' })
  last_seen_at!: Date;

  toApiResponse(): Record<string, unknown> {
    return {
      _id: this.id,
      kind: this.kind,
      asset_id: this.asset_id,
      itsm_id: this.itsm_id,
      summary: this.summary,
      evidence: this.evidence,
      state: this.state,
      assigned_to: this.assigned_to,
      note: this.note,
      closed_by: this.closed_by,
      closed_at: this.closed_at,
      first_seen_at: this.first_seen_at,
      last_seen_at: this.last_seen_at,
    };
  }
}
