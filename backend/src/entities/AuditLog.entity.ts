/**
 * AuditLog.entity.ts — Immutable audit trail for all data changes.
 *
 * Every create, update, and delete operation on assets and users is automatically
 * recorded here by the `auditLog` middleware in `audit.middleware.ts`. The records
 * are insert-only — the application never updates or deletes audit log entries.
 *
 * The `diff` field stores:
 *  - For `create`: a summary of the created record's key fields
 *  - For `update`: `{ before: <old entity>, after: <request body> }`
 *  - For `delete`: the entity state at the time of deletion
 *
 * The `action` field for auth events includes: `login`, `logout`, `login_failed`,
 * `account_locked`, `password_changed`, `login_ldap`.
 *
 * All columns that are commonly filtered on (username, action, entity_type,
 * document_id, timestamp) are individually indexed for fast query performance.
 */
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('audit_logs')
export class AuditLog {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'user_id', type: 'nvarchar', length: 36 })
  user_id!: string;

  @Index()
  @Column({ type: 'nvarchar', length: 100 })
  username!: string;

  @Index()
  @Column({ type: 'nvarchar', length: 50 })
  action!: string;

  @Index()
  @Column({ name: 'entity_type', type: 'nvarchar', length: 100 })
  entity_type!: string;

  @Index()
  @Column({ name: 'document_id', type: 'nvarchar', length: 36 })
  document_id!: string;

  @Column({ type: 'simple-json', nullable: true })
  diff!: unknown;

  @Column({ name: 'ip_address', type: 'nvarchar', length: 100, nullable: true })
  ip_address!: string | null;

  @Column({ name: 'user_agent', type: 'nvarchar', length: 500, nullable: true })
  user_agent!: string | null;

  @Index()
  @CreateDateColumn({ name: 'timestamp' })
  timestamp!: Date;

  toApiResponse() {
    return {
      _id: this.id,
      user_id: this.user_id,
      username: this.username,
      action: this.action,
      entity_type: this.entity_type,
      document_id: this.document_id,
      diff: this.diff,
      ip_address: this.ip_address,
      user_agent: this.user_agent,
      timestamp: this.timestamp,
    };
  }
}
