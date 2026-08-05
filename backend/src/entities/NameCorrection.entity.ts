/**
 * NameCorrection.entity.ts — "When the survey says this, it means that."
 *
 * The walk-around tool takes free text. A room is "hr iroda" on one tablet and "HR
 * Iroda" on the map; a person is "gorog tomi" in the survey and "Görög Tamás" in ITSM.
 * The importer folds case and diacritics, which handles the easy half; the rest are
 * nicknames, abbreviations and typos, and only a person can say what they meant.
 *
 * That statement is a lasting decision, not a detail of one import run. It was living in
 * an `inventory-corrections.json` file next to the export, which meant it existed only
 * on whichever machine last ran the script, and only for whoever knew the file was
 * there. Here it is data: one row per "from", shared by the CLI importer and the upload
 * in the browser, and visible to the next person who imports a survey.
 *
 * The lookup key is the FOLDED form, so "Gorog Tomi", "gorog tomi" and "GÖRÖG TOMI" are
 * one correction rather than three. `from_value` keeps the spelling as it was actually
 * typed, because that is what a reader recognises in the list.
 *
 * Scoped, because the same word can need different treatment in different columns — a
 * zone called "HR" and a room called "HR" are separate facts.
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
 * Which survey column the correction applies to. These are the tool's own field names
 * (`helyszin` is the zone, `work_area` the room), kept as they are so a correction can
 * be read against the export it came from.
 */
export type NameCorrectionScope = 'building' | 'floor' | 'helyszin' | 'work_area' | 'persons';

export const NAME_CORRECTION_SCOPES: NameCorrectionScope[] = [
  'building', 'floor', 'helyszin', 'work_area', 'persons',
];

@Entity('name_corrections')
// One correction per folded name per column: a second, contradicting one would make the
// import's result depend on row order.
@Index('UQ_name_corrections_scope_from', ['scope', 'from_folded'], { unique: true })
export class NameCorrection {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'nvarchar', length: 20 })
  scope!: NameCorrectionScope;

  /** As typed in the survey — shown in the list, never matched against. */
  @Column({ name: 'from_value', type: 'nvarchar', length: 300 })
  from_value!: string;

  /** Lowercase, diacritic-folded, whitespace-stripped. The actual key. */
  @Column({ name: 'from_folded', type: 'nvarchar', length: 300 })
  from_folded!: string;

  /** What the app should read instead, spelled the way the app spells it. */
  @Column({ name: 'to_value', type: 'nvarchar', length: 300 })
  to_value!: string;

  /**
   * Why. Optional, but the difference between "typo" and a deliberate merge of two rooms
   * is exactly what the next person will want to know before trusting the row.
   */
  @Column({ type: 'nvarchar', length: 500, nullable: true })
  note!: string | null;

  @Column({ name: 'created_by', type: 'nvarchar', length: 200, nullable: true })
  created_by!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime2' })
  created_at!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime2' })
  updated_at!: Date;

  toApiResponse(): Record<string, unknown> {
    return {
      _id: this.id,
      scope: this.scope,
      from_value: this.from_value,
      to_value: this.to_value,
      note: this.note,
      created_by: this.created_by,
      created_at: this.created_at,
      updated_at: this.updated_at,
    };
  }
}
