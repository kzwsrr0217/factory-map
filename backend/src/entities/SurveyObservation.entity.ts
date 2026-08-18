/**
 * SurveyObservation.entity.ts — what the physical survey said, kept after the import.
 *
 * The third source finally has a landing table. ITSM had `itsm_hardware_snapshot` and Nexthink has
 * `nexthink_device_snapshot`; the survey had nothing. `surveyImport.ts` read the file, applied what
 * it could to `assets`, and the file went back to the operator's Downloads folder. So after an
 * import nobody could answer the two questions that matter most about it:
 *
 *   - "What did the survey actually say about this machine?" The walkers stood in the room. Their
 *     observation was the most direct evidence in the system and it was the only one not stored.
 *   - "Where did the survey disagree with the app, and what happened?" The importer's rule is fill
 *     a gap, never overwrite — a good rule, but it means every conflict was resolved silently, in
 *     favour of the older value, with no record that a conflict existed.
 *
 * Both are answerable now, and the second is the input to letting a person decide instead.
 *
 * ── Raw, not interpreted ────────────────────────────────────────────────────────
 * The survey's own column names and values are stored as they arrived, before name corrections and
 * before place matching. That is the point of a landing table: `helyszin` here is what somebody
 * typed on the shop floor, not what the app decided it meant. The interpretation lives in
 * `resolved_*` beside it, so the two can be told apart — and so a correction applied later can be
 * shown to have changed the reading of an unchanged observation.
 *
 * ── Full replace ────────────────────────────────────────────────────────────────
 * Replaced wholesale on each import, like the other two, so this table always means "the survey as
 * of the last import" rather than an accumulating pile of rounds. `import_runs` records that each
 * import happened and when, which is where round history belongs if it is ever wanted; putting it
 * here would make every query have to pick a round first, and the common question is about now.
 */
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * What the importer did with this row.
 *
 * `declined` does not exist as a value on purpose: a row is never wholly declined. Placement and
 * person always apply, while serial, type and model are only filled when empty — so the same row is
 * simultaneously applied and partly suppressed. Which fields were suppressed is in
 * `suppressed_fields`, not in this verdict.
 */
export type SurveyResolution =
  /** Matched an existing asset, which was updated. */
  | 'updated'
  /** No existing asset matched, so one was created from this row. */
  | 'created'
  /** Matched nothing and could not be created — no usable serial, or an unresolved place. */
  | 'unmatched';

@Entity('survey_observation')
export class SurveyObservation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /**
   * The survey tool's own row id, where the file carries one.
   *
   * Indexed and not unique: not every export has it, and two rounds of a hand-kept file have been
   * seen to reuse one. `Asset.survey_row_id` points at this value, which is how a device stays
   * recognisable across rounds even after somebody corrects its serial.
   */
  @Column({ name: 'survey_row_id', type: 'nvarchar', length: 100, nullable: true })
  @Index('IDX_survey_observation_row_id')
  survey_row_id!: string | null;

  // ── Exactly as the survey wrote them ──────────────────────────────────────
  @Column({ name: 'terulet', type: 'nvarchar', length: 200, nullable: true })
  terulet!: string | null;

  @Column({ name: 'epulet', type: 'nvarchar', length: 200, nullable: true })
  epulet!: string | null;

  @Column({ name: 'emelet', type: 'nvarchar', length: 200, nullable: true })
  emelet!: string | null;

  @Column({ name: 'helyszin', type: 'nvarchar', length: 300, nullable: true })
  helyszin!: string | null;

  @Column({ name: 'work_area', type: 'nvarchar', length: 300, nullable: true })
  work_area!: string | null;

  @Column({ name: 'szemely', type: 'nvarchar', length: 200, nullable: true })
  szemely!: string | null;

  /**
   * The comment column, which in practice carries three different things: a device name, a
   * "belongs to HWA12345" parent claim, and free remarks. Stored whole rather than parsed into
   * columns, because the parsing rules change and the sentence is the evidence.
   */
  @Column({ name: 'megjegyzes', type: 'nvarchar', length: 1000, nullable: true })
  megjegyzes!: string | null;

  @Column({ name: 'azonosito_mod', type: 'nvarchar', length: 100, nullable: true })
  azonosito_mod!: string | null;

  @Column({ name: 'hwa', type: 'nvarchar', length: 100, nullable: true })
  @Index('IDX_survey_observation_hwa')
  hwa!: string | null;

  @Column({ name: 'eszkoz_tipus', type: 'nvarchar', length: 200, nullable: true })
  eszkoz_tipus!: string | null;

  @Column({ name: 'sorozatszam', type: 'nvarchar', length: 200, nullable: true })
  sorozatszam!: string | null;

  // ── What the importer made of it ──────────────────────────────────────────
  /**
   * The asset this row resolved to, or null when it matched nothing.
   *
   * A plain column, not a relation: this is evidence from outside, and a foreign key would refuse
   * to keep an observation whose asset was later deleted — which is exactly the row somebody would
   * want to look at afterwards. Same reasoning as the other two landing tables having no FK.
   */
  @Column({ name: 'resolved_asset_id', type: 'uniqueidentifier', nullable: true })
  @Index('IDX_survey_observation_asset')
  resolved_asset_id!: string | null;

  @Column({ name: 'resolution', type: 'nvarchar', length: 20 })
  @Index('IDX_survey_observation_resolution')
  resolution!: SurveyResolution;

  /**
   * Fields where the survey supplied a value, the asset already held a DIFFERENT one, and the
   * importer kept the old one.
   *
   * The record of every silent decision. Each entry keeps both values, so the disagreement can be
   * shown without re-reading the survey file — which is what turns "the survey is right, the record
   * is stale" from a thing somebody remembers into a thing the app can put on a list.
   */
  @Column({ name: 'suppressed_fields', type: 'simple-json', nullable: true })
  suppressed_fields!: Array<{ field: string; app_value: string | null; survey_value: string | null }> | null;

  /** Timestamp of the import that wrote this row. */
  @Column({ name: 'imported_at', type: 'datetime2', nullable: true })
  imported_at!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  created_at!: Date;

  toApiResponse() {
    return {
      id: this.id,
      survey_row_id: this.survey_row_id,
      where: [this.epulet, this.emelet, this.helyszin, this.work_area].filter(Boolean).join(' / '),
      szemely: this.szemely,
      megjegyzes: this.megjegyzes,
      hwa: this.hwa,
      eszkoz_tipus: this.eszkoz_tipus,
      sorozatszam: this.sorozatszam,
      resolved_asset_id: this.resolved_asset_id,
      resolution: this.resolution,
      suppressed_fields: this.suppressed_fields,
      imported_at: this.imported_at,
    };
  }
}
