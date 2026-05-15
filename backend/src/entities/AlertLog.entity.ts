/**
 * AlertLog.entity.ts — Immutable audit trail of sent alert notifications.
 *
 * Insert-only (never updated or deleted in normal operation). Each row records
 * one outgoing notification attempt, whether it succeeded or failed.
 */
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Asset } from './Asset.entity';

@Entity('alert_log')
export class AlertLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @CreateDateColumn()
  sent_at!: Date;

  /** 'email' or 'teams' */
  @Column({ type: 'nvarchar', length: 20 })
  channel!: string;

  /** Asset this alert is about (nullable for system-level alerts) */
  @Column({ type: 'nvarchar', nullable: true })
  asset_id!: string | null;

  @ManyToOne(() => Asset, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'asset_id' })
  asset!: Asset | null;

  @Column({ type: 'nvarchar', length: 500 })
  subject!: string;

  @Column({ type: 'nvarchar', length: 1000 })
  body_snippet!: string;

  @Column({ type: 'bit', default: true })
  success!: boolean;

  @Column({ type: 'nvarchar', length: 1000, nullable: true })
  error_message!: string | null;
}
