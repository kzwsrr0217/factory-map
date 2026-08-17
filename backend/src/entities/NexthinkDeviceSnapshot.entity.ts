/**
 * NexthinkDeviceSnapshot.entity.ts — Read-only landing table for the Nexthink device
 * inventory, imported from a CSV exported by hand from Investigations.
 *
 * Why a third source at all, when ITSM and the survey already disagree with each other:
 * both of those are things a person typed. This one is what the machines themselves
 * reported. It settles questions neither of the other two can — whether a device that
 * ITSM still lists is actually switched on, and (with the login table beside it) who has
 * really been using it. It is not a system of record and nothing here is authoritative
 * about placement; it is evidence.
 *
 * `device_name` IS the HWA number (confirmed against the real export: "HWA35858"), so no
 * serial-matching heuristics are needed — worth stating, because the export also carries three
 * *different* serial numbers (BIOS, chassis, and a UUID-format "machine serial") and only the
 * first two resemble what Alemba holds. `bios_serial` is kept for cross-checking a suspected
 * mislabelling, not for joining.
 *
 * It joins onto `Asset.hardware_asset_id`, NOT onto `Asset.id`: the latter is a generated uuid,
 * and binding an HWA against it makes SQL Server reject the parameter as an invalid GUID rather
 * than simply matching nothing. `record-replacement.ts` resolves an HWA the same way, with a
 * `display_name` fallback for assets whose `hardware_asset_id` was never filled in.
 *
 * Two properties of the source that shape how this may be read:
 *
 *  1. Nexthink ages inactive devices out of the `devices` table entirely. Measured on the
 *     real export: over a 91-day window the oldest `last_seen` was ~5 weeks old and only one
 *     device was 30+ days quiet. So a decommissioned machine does not appear here with a
 *     stale `last_seen` — it *disappears*. The signal for "nobody has seen this in months" is
 *     therefore ABSENCE from this table, not an old timestamp. Reports must be written that
 *     way round.
 *  2. Nexthink's own documentation warns that `last_seen` does not account for every kind of
 *     device connection, so it is a lower bound on activity. Fine for "this has been quiet
 *     for weeks", wrong for "this was last used at 14:32".
 *
 * Only agent-carrying machines are here: no monitors, phones, docks or network gear, however
 * complete the factory map is. Coverage also spans several Nexthink "entities"
 * (Veszprem-Client, -Industry-Low, -Industry-Medium, -Remote, -not-categorized); the IPCs
 * live in the Industry ones, so an import scoped to Veszprem-Client alone silently omits
 * every shop-floor machine — which is exactly the population the factory map exists for.
 *
 * Full-replace on each import, like `itsm_hardware_snapshot`: this table always means
 * "what Nexthink reported as of the last export", never an incrementally-merged cache.
 */
import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('nexthink_device_snapshot')
export class NexthinkDeviceSnapshot {
  /** The Nexthink device name — the HWA tag. Joins to `Asset.hardware_asset_id`, not `Asset.id`. */
  @PrimaryColumn({ name: 'device_name', type: 'nvarchar', length: 100 })
  device_name!: string;

  /**
   * Nexthink's own grouping (Veszprem-Client, Veszprem-Industry-Low, ...). Indexed because
   * "the industrial machines" and "the office machines" are genuinely different populations
   * with different lifecycles, and every report wants to say which it is talking about.
   */
  @Column({ name: 'entity', type: 'nvarchar', length: 100, nullable: true })
  @Index('IDX_nexthink_device_entity')
  entity!: string | null;

  @Column({ name: 'first_seen', type: 'datetime2', nullable: true })
  first_seen!: Date | null;

  /**
   * Parsed rather than stored verbatim, because every use of it is a comparison ("quiet for
   * more than N days"). The export's format is a consistent `YYYY-MM-DD HH:MM:SS`; a row
   * whose date will not parse lands here as NULL and is counted in the import report rather
   * than silently becoming epoch-zero and looking like the oldest device in the estate.
   */
  @Column({ name: 'last_seen', type: 'datetime2', nullable: true })
  @Index('IDX_nexthink_device_last_seen')
  last_seen!: Date | null;

  /** Nexthink's classification: desktop / laptop / virtual. Note it has no `ipc` bucket. */
  @Column({ name: 'hardware_type', type: 'nvarchar', length: 50, nullable: true })
  hardware_type!: string | null;

  @Column({ name: 'manufacturer', type: 'nvarchar', length: 100, nullable: true })
  manufacturer!: string | null;

  @Column({ name: 'model', type: 'nvarchar', length: 200, nullable: true })
  model!: string | null;

  /**
   * BIOS serial (the Dell service tag). Empty for ~13% of the real export — the industrial
   * machines mostly. Present for cross-checking, never for joining; see the class comment.
   */
  @Column({ name: 'bios_serial', type: 'nvarchar', length: 100, nullable: true })
  bios_serial!: string | null;

  /**
   * The full OS name as Nexthink reports it, e.g. "Windows 11 Enterprise 25H2". Kept as the
   * raw string rather than a derived is_windows_11 flag: the flag is a pure function of this
   * value, and a stored copy of a derivable fact is a copy that can go stale.
   */
  @Column({ name: 'os_name', type: 'nvarchar', length: 200, nullable: true })
  os_name!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  created_at!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updated_at!: Date;

  /** Timestamp of the import run that (re)wrote this row. */
  @Column({ name: 'imported_at', type: 'datetime', nullable: true })
  imported_at!: Date | null;

  toApiResponse() {
    return {
      device_name: this.device_name,
      entity: this.entity,
      first_seen: this.first_seen,
      last_seen: this.last_seen,
      hardware_type: this.hardware_type,
      manufacturer: this.manufacturer,
      model: this.model,
      bios_serial: this.bios_serial,
      os_name: this.os_name,
      imported_at: this.imported_at,
    };
  }
}
