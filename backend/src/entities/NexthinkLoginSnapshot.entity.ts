/**
 * NexthinkLoginSnapshot.entity.ts — who has actually logged into which machine, from
 * Nexthink's `session.logins`, aggregated per device+user over the export window.
 *
 * This is the third opinion on the question ITSM and the survey keep disagreeing about: who
 * uses this machine. ITSM holds one assigned person per asset, the survey holds whoever was
 * standing there during the walk-around, and this holds what the logon records say. It does
 * not decide anything — it is a vote, and often it shows the premise is wrong: on the real
 * export one desktop had six different people on it, the top two separated by a single login.
 * A tool that picked a winner there would be inventing a fact. Reports must surface the
 * near-tie, not resolve it.
 *
 * A separate table from the device snapshot because the grain is different (one row per
 * device+user, not per device) and because the two exports come from different NQL queries
 * with different windows: `devices` accepts up to 91 days, `session.logins` refuses that
 * range outright ("the requested precision cannot be met"), so the login window is
 * necessarily the shorter of the two. Anything comparing the two tables has to tolerate that.
 *
 * Roughly half the rows are not people. Measured on the real export: of 671 rows, 338 were a
 * named person, 79 admin accounts, 66 the machine's own account, 64 generic/shared
 * (MMHGEN00xx, MMH_SHOP_FLOOR_WB2, IPC@), 51 local `win11local@` accounts, and 73 looked
 * exactly like a person but carried no AD display name. Filtering these at query time meant
 * the rule lived in every caller; `account_kind` is resolved once at import by
 * `classifyAccount`, so there is one definition of "is this a person" and it can be checked
 * against real data rather than argued about. `person_unnamed` is deliberately its own value
 * rather than being folded into either side: those accounts follow the same MMH+initials
 * pattern as the named ones and are almost certainly people, but the name is missing and
 * guessing it would be worse than admitting it.
 */
import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * What kind of account a logon belongs to.
 *
 * - `person`         — a named human (has an AD display name)
 * - `person_unnamed` — looks like a human account, no AD display name resolved
 * - `admin`          — an administrative account (mmhadmin, *Admin)
 * - `machine`        — the device's own account (HWA12345@…)
 * - `generic`        — shared/generic (MMHGEN00xx, MMH_SHOP_FLOOR_*, IPC@)
 * - `local`          — a local, non-domain account (win11local@…)
 */
export type NexthinkAccountKind =
  | 'person'
  | 'person_unnamed'
  | 'admin'
  | 'machine'
  | 'generic'
  | 'local';

@Entity('nexthink_login_snapshot')
export class NexthinkLoginSnapshot {
  /** The HWA, same key as NexthinkDeviceSnapshot.device_name (→ Asset.hardware_asset_id). */
  @PrimaryColumn({ name: 'device_name', type: 'nvarchar', length: 100 })
  @Index('IDX_nexthink_login_device_name')
  device_name!: string;

  /**
   * The full logon name including realm, e.g. `mmhgeza@MAXON_IES`. Part of the key: the pair
   * (device, user) is unique in the export — verified on the real file, 671 pairs and no
   * duplicates — because the source query already aggregates by it.
   *
   * Case varies in the source (`MMHATKO` and `mmhlato` both occur), so anything matching this
   * against an ITSM person id must fold case.
   */
  @PrimaryColumn({ name: 'user_name', type: 'nvarchar', length: 200 })
  user_name!: string;

  /**
   * The AD display name, "Surname, Firstname" — the same shape Alemba uses, so it can be
   * compared without normalising. Null for 73 of 671 real rows. Accents and case are not
   * dependable here ("Palotas, Monika", "vasarhelyi, Zsuzsanna"), so a comparison against
   * ITSM has to be accent- and case-insensitive to avoid reporting differences that are only
   * spelling.
   */
  @Column({ name: 'full_name', type: 'nvarchar', length: 200, nullable: true })
  full_name!: string | null;

  /** Logon count over the export window — the weight behind "this is whose machine it is". */
  @Column({ name: 'logins', type: 'int', default: 0 })
  logins!: number;

  @Column({ name: 'account_kind', type: 'nvarchar', length: 20 })
  @Index('IDX_nexthink_login_account_kind')
  account_kind!: NexthinkAccountKind;

  @CreateDateColumn({ name: 'created_at' })
  created_at!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updated_at!: Date;

  @Column({ name: 'imported_at', type: 'datetime', nullable: true })
  imported_at!: Date | null;

  toApiResponse() {
    return {
      device_name: this.device_name,
      user_name: this.user_name,
      full_name: this.full_name,
      logins: this.logins,
      account_kind: this.account_kind,
      imported_at: this.imported_at,
    };
  }
}
