import { Entity, PrimaryGeneratedColumn, Column, Index, CreateDateColumn } from 'typeorm';

@Entity('active_sessions')
export class ActiveSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true, length: 36 })
  @Index()
  jti: string;

  @Column({ length: 36 })
  @Index()
  user_id: string;

  @CreateDateColumn()
  issued_at: Date;

  @Column({ type: 'datetime2', nullable: true })
  last_seen: Date | null;

  @Column({ type: 'datetime2' })
  expires_at: Date;

  @Column({ type: 'nvarchar', nullable: true, length: 45 })
  ip_address: string | null;

  @Column({ type: 'nvarchar', nullable: true, length: 512 })
  user_agent: string | null;

  @Column({ default: false })
  is_revoked: boolean;
}
