/**
 * ScheduledAlert.entity.ts — One-off custom alert scheduled for a future date/time.
 *
 * Unlike the recurring maintenance cron, each row represents a single user-defined
 * reminder. The hourly cron in server.ts calls AlertService.checkScheduledAlerts()
 * which fires any rows where scheduled_for <= now AND sent = false, then marks
 * them sent.
 *
 * channels:      'email' | 'teams' | 'both' — which delivery channels to use
 * asset_filter:  optional asset_type value; when set the notification body
 *                includes a list of matching active assets for context
 */
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('scheduled_alerts')
export class ScheduledAlert {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'nvarchar', length: 300 })
  title!: string;

  @Column({ type: 'nvarchar', length: 1000, nullable: true })
  description!: string | null;

  @Column({ name: 'scheduled_for', type: 'datetime' })
  scheduled_for!: Date;

  /** 'email' | 'teams' | 'both' */
  @Column({ type: 'nvarchar', length: 10, default: 'both' })
  channels!: string;

  /** Optional asset_type to include matching assets in the notification */
  @Column({ name: 'asset_filter', type: 'nvarchar', length: 100, nullable: true })
  asset_filter!: string | null;

  @Column({ type: 'bit', default: false })
  sent!: boolean;

  @Column({ name: 'sent_at', type: 'datetime', nullable: true })
  sent_at!: Date | null;

  @Column({ name: 'created_by', type: 'nvarchar', length: 100, nullable: true })
  created_by!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  created_at!: Date;
}
