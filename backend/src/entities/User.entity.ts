/**
 * User.entity.ts — Application user account.
 *
 * Supports three authentication providers:
 *  - `local`: password stored as bcrypt hash in the database
 *  - `ldap`: user authenticated against Active Directory; `ldap_dn` stores the
 *    distinguished name for subsequent logins
 *  - `azure`: Azure AD OAuth (configuration placeholders; not yet implemented)
 *
 * Security features:
 *  - Passwords are auto-hashed before insert/update via `@BeforeInsert` / `@BeforeUpdate`.
 *    The check `!password.startsWith('$2')` prevents double-hashing if the field is
 *    already a bcrypt hash (important when TypeORM triggers the hook on unrelated updates).
 *  - `password` column has `select: false` — it is excluded from all regular queries
 *    and must be explicitly added with `.addSelect('u.password')` when needed.
 *  - `failed_login_attempts` and `locked_until` implement the account lockout policy
 *    (5 attempts → locked for 30 minutes).
 *
 * Roles:
 *  - `viewer` — read-only access
 *  - `operator` — can create and edit assets and hierarchy
 *  - `admin` — full access including user management and deletions
 */
import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  BeforeInsert,
  BeforeUpdate,
  Index,
} from 'typeorm';
import bcrypt from 'bcryptjs';

export type AuthProvider = 'local' | 'ldap' | 'azure';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index({ unique: true })
  @Column({ type: 'nvarchar', length: 50 })
  username!: string;

  @Column({ type: 'nvarchar', length: 200, nullable: true })
  email!: string | null;

  @Column({ type: 'nvarchar', length: 100, nullable: true, select: false })
  password!: string | null;

  @Column({ type: 'nvarchar', length: 20, default: 'viewer' })
  role!: string;

  @Column({ default: true })
  active!: boolean;

  @Column({ name: 'auth_provider', type: 'nvarchar', length: 20, default: 'local' })
  auth_provider!: AuthProvider;

  @Column({ name: 'ldap_dn', type: 'nvarchar', length: 500, nullable: true })
  ldap_dn!: string | null;

  @Column({ name: 'azure_oid', type: 'nvarchar', length: 200, nullable: true })
  azure_oid!: string | null;

  @Column({ name: 'last_login', type: 'datetime', nullable: true })
  last_login!: Date | null;

  @Column({ name: 'failed_login_attempts', type: 'int', default: 0 })
  failed_login_attempts!: number;

  @Column({ name: 'locked_until', type: 'datetime', nullable: true })
  locked_until!: Date | null;

  @Column({ name: 'password_changed_at', type: 'datetime', nullable: true })
  password_changed_at!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  created_at!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updated_at!: Date;

  @BeforeInsert()
  @BeforeUpdate()
  async hashPasswordIfNeeded(): Promise<void> {
    if (this.password && !this.password.startsWith('$2')) {
      const salt = await bcrypt.genSalt(12);
      this.password = await bcrypt.hash(this.password, salt);
      this.password_changed_at = new Date();
    }
  }

  async comparePassword(candidate: string): Promise<boolean> {
    if (!this.password) return false;
    return bcrypt.compare(candidate, this.password);
  }

  toApiResponse() {
    return {
      _id: this.id,
      username: this.username,
      email: this.email,
      role: this.role,
      active: this.active,
      auth_provider: this.auth_provider,
      last_login: this.last_login,
      password_changed_at: this.password_changed_at,
      created_at: this.created_at,
      updated_at: this.updated_at,
    };
  }
}
