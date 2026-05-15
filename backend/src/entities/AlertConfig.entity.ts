/**
 * AlertConfig.entity.ts — Global alert configuration (single-row table).
 *
 * There is always exactly one row with id='global'. Use AlertService.getConfig()
 * to read it and AlertService.saveConfig() to upsert it. All recipient lists and
 * channel toggles live here so the frontend settings page has a single source of
 * truth.
 */
import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('alert_config')
export class AlertConfig {
  @PrimaryColumn({ type: 'nvarchar', length: 36 })
  id!: string;

  /** Toggle email notifications on/off */
  @Column({ type: 'bit', default: false })
  email_enabled!: boolean;

  /** Comma-separated or JSON-stored list of recipient emails */
  @Column({ type: 'simple-json', nullable: true })
  email_recipients!: string[] | null;

  /** Toggle Microsoft Teams notifications on/off */
  @Column({ type: 'bit', default: false })
  teams_enabled!: boolean;

  /** Incoming webhook URL for the Teams channel */
  @Column({ type: 'nvarchar', length: 500, nullable: true })
  teams_webhook_url!: string | null;

  /** How many days before maint_next_date to start alerting */
  @Column({ type: 'int', default: 7 })
  days_before_alert!: number;

  /** Send alert when maintenance is coming up within days_before_alert */
  @Column({ type: 'bit', default: true })
  alert_on_maintenance!: boolean;

  /** Send alert when maintenance is past due (maint_next_date < today) */
  @Column({ type: 'bit', default: true })
  alert_on_overdue!: boolean;

  @CreateDateColumn()
  created_at!: Date;

  @UpdateDateColumn()
  updated_at!: Date;
}
