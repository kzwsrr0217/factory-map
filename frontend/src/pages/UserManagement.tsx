/**
 * UserManagement.tsx — Admin-only user management page ("/users").
 *
 * Only rendered for users with role === 'admin' (enforced by ProtectedRoute
 * and the backend's `requireAdmin` middleware).
 *
 * Actions available per user row:
 *   Change role    — viewer / operator / admin (admin cannot demote themselves).
 *   Change email   — inline input toggled per row.
 *   Reset password — sends a temp password or triggers a reset flow (admin only).
 *   Deactivate     — soft-disables the account (login blocked).
 *   Activate       — re-enables the account and clears any lockout.
 *   Delete         — legacy alias for deactivate (calls the same endpoint).
 *
 * The "Create User" form at the top creates local (username + password)
 * accounts only. LDAP and Azure AD users are auto-provisioned on first login.
 */
import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import Button from '../components/common/Button';
import Badge from '../components/common/Badge';
import Card from '../components/common/Card';
import ConfirmDialog from '../components/common/ConfirmDialog';
import {
  useUsers, useCreateUser, useUpdateUserRole,
  useDeactivateUser, useActivateUser, useResetUserPassword,
} from '../hooks/queries/useUsers';
import styles from '../styles/pages/UserManagement.module.css';

interface User {
  _id: string;
  username: string;
  email?: string;
  role: 'admin' | 'operator' | 'viewer';
  active: boolean;
  last_login?: string | null;
  failed_login_attempts?: number;
  locked_until?: string | null;
  password_changed_at?: string | null;
}

const PASSWORD_RULES = [
  { label: 'At least 8 characters', test: (p: string) => p.length >= 8 },
  { label: 'One uppercase letter', test: (p: string) => /[A-Z]/.test(p) },
  { label: 'One lowercase letter', test: (p: string) => /[a-z]/.test(p) },
  { label: 'One number', test: (p: string) => /[0-9]/.test(p) },
  { label: 'One special character', test: (p: string) => /[^A-Za-z0-9]/.test(p) },
];

const getStrength = (pw: string) => PASSWORD_RULES.filter((r) => r.test(pw)).length;
const STRENGTH_CLASSES = ['', styles.pwStrengthWeak, styles.pwStrengthFair, styles.pwStrengthFair, styles.pwStrengthGood, styles.pwStrengthStrong];

const formatDate = (d?: string | null) =>
  d ? new Date(d).toLocaleString() : '—';

const isLocked = (u: User) =>
  !!u.locked_until && new Date(u.locked_until) > new Date();

const UserManagement: React.FC = () => {
  const { user: currentUser, isAdmin } = useAuth();
  const toast = useToast();

  const { data: users = [], isLoading: loading } = useUsers(!!isAdmin);
  const createUser = useCreateUser();
  const updateRole = useUpdateUserRole();
  const deactivateUser = useDeactivateUser();
  const activateUser = useActivateUser();
  const resetPassword = useResetUserPassword();

  const [newUsername, setNewUsername] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState<'admin' | 'operator' | 'viewer'>('viewer');

  const [resetTarget, setResetTarget] = useState<User | null>(null);
  const [resetPw, setResetPw] = useState('');

  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [deactivateTarget, setDeactivateTarget] = useState<User | null>(null);

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUsername.trim() || !newPassword.trim()) { toast.error('Username and password are required.'); return; }
    if (getStrength(newPassword) < 5) { toast.error('Password does not meet complexity requirements.'); return; }
    createUser.mutate(
      { username: newUsername.trim(), password: newPassword, role: newRole, email: newEmail.trim() || undefined },
      {
        onSuccess: created => {
          setNewUsername(''); setNewEmail(''); setNewPassword(''); setNewRole('viewer');
          toast.success(`User "${created.username}" created.`);
        },
        onError: (err: any) => {
          const details = err?.response?.data?.details;
          const msg = err?.response?.data?.error ?? 'Failed to create user.';
          toast.error(details ? `${msg}: ${details.join(', ')}` : msg);
        },
      }
    );
  };

  const handleRoleChange = (target: User, role: 'admin' | 'operator' | 'viewer') => {
    setActionLoading(target._id + '-role');
    updateRole.mutate(
      { id: target._id, role },
      {
        onSuccess: () => { toast.success(`"${target.username}" role updated to ${role}.`); setActionLoading(null); },
        onError: (err: any) => { toast.error(err?.response?.data?.error ?? 'Failed to change role.'); setActionLoading(null); },
      }
    );
  };

  const handleDeactivate = (target: User) => { setDeactivateTarget(target); };

  const confirmDeactivate = () => {
    if (!deactivateTarget) return;
    const target = deactivateTarget;
    setDeactivateTarget(null);
    setActionLoading(target._id + '-deactivate');
    deactivateUser.mutate(target._id, {
      onSuccess: () => { toast.success(`"${target.username}" deactivated.`); setActionLoading(null); },
      onError: (err: any) => { toast.error(err?.response?.data?.error ?? 'Failed to deactivate user.'); setActionLoading(null); },
    });
  };

  const handleActivate = (target: User) => {
    setActionLoading(target._id + '-activate');
    activateUser.mutate(target._id, {
      onSuccess: () => { toast.success(`"${target.username}" activated.`); setActionLoading(null); },
      onError: (err: any) => { toast.error(err?.response?.data?.error ?? 'Failed to activate user.'); setActionLoading(null); },
    });
  };

  const handleResetPassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetTarget || !resetPw) return;
    if (getStrength(resetPw) < 5) { toast.error('Password does not meet complexity requirements.'); return; }
    resetPassword.mutate(
      { id: resetTarget._id, password: resetPw },
      {
        onSuccess: () => { toast.success(`Password reset for "${resetTarget!.username}".`); setResetTarget(null); setResetPw(''); },
        onError: (err: any) => {
          const details = err?.response?.data?.details;
          const msg = err?.response?.data?.error ?? 'Failed to reset password.';
          toast.error(details ? `${msg}: ${details.join(', ')}` : msg);
        },
      }
    );
  };

  const newPwStrength = getStrength(newPassword);
  const resetPwStrength = getStrength(resetPw);

  if (!isAdmin) {
    return (
      <div className={styles.page}>
        <Card padding="lg" className={styles.accessDenied}>
          <p>You don't have permission to view this page.</p>
        </Card>
      </div>
    );
  }

  return (
    <>
    <ConfirmDialog
      isOpen={deactivateTarget !== null}
      onClose={() => setDeactivateTarget(null)}
      onConfirm={confirmDeactivate}
      title="Deactivate User"
      message={`Are you sure you want to deactivate "${deactivateTarget?.username}"? They will no longer be able to log in.`}
      confirmText="Deactivate"
      variant="danger"
    />
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>User Management</h1>
      </div>

      {/* Create user form */}
      <Card padding="lg" className={styles.createForm}>
        <h2 className={styles.sectionTitle}>Create New User</h2>
        <form onSubmit={handleCreate} className={styles.formRow}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="new-username">Username</label>
            <input
              id="new-username"
              className={styles.input}
              type="text"
              placeholder="Username"
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              autoComplete="off"
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="new-email">Email (optional)</label>
            <input
              id="new-email"
              className={styles.input}
              type="email"
              placeholder="user@example.com"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              autoComplete="off"
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="new-password">Password</label>
            <input
              id="new-password"
              className={styles.input}
              type="password"
              placeholder="Password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
            />
            {newPassword && (
              <>
                <div className={styles.pwStrength}>
                  {[1,2,3,4,5].map((i) => (
                    <div key={i} className={`${styles.pwStrengthBar} ${i <= newPwStrength ? STRENGTH_CLASSES[newPwStrength] : ''}`} />
                  ))}
                </div>
                <div className={styles.pwHints}>
                  {PASSWORD_RULES.map((r) => (
                    <span key={r.label} className={r.test(newPassword) ? styles.pwHintOk : styles.pwHintFail}>
                      {r.test(newPassword) ? '✓' : '✗'} {r.label}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="new-role">Role</label>
            <select
              id="new-role"
              className={styles.select}
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as 'admin' | 'operator' | 'viewer')}
            >
              <option value="viewer">Viewer — read-only access</option>
              <option value="operator">Operator — can edit assets</option>
              <option value="admin">Admin — full access</option>
            </select>
          </div>

          <div className={styles.field} style={{ justifyContent: 'flex-end' }}>
            <Button type="submit" variant="primary" size="sm" loading={createUser.isPending} disabled={createUser.isPending}>
              Create User
            </Button>
          </div>
        </form>
      </Card>

      {/* Users table */}
      <Card padding="lg">
        {loading ? (
          <p className={styles.emptyState}>Loading users…</p>
        ) : users.length === 0 ? (
          <p className={styles.emptyState}>No users found.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.th}>Username</th>
                <th className={styles.th}>Role</th>
                <th className={styles.th}>Status</th>
                <th className={styles.th}>Last Login</th>
                <th className={styles.th}>Pw Changed</th>
                <th className={styles.th}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const isSelf = currentUser?.id === u._id;
                const locked = isLocked(u);

                return (
                  <tr key={u._id} className={styles.userRow}>
                    <td className={styles.td}>
                      <span style={{ fontWeight: 500 }}>{u.username}</span>
                      {isSelf && <span style={{ marginLeft: 6, fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>(you)</span>}
                      {u.email && (
                        <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', marginTop: 1 }}>
                          {u.email}
                        </div>
                      )}
                    </td>

                    <td className={styles.td}>
                      {isSelf ? (
                        <Badge variant={u.role === 'admin' ? 'info' : u.role === 'operator' ? 'warning' : 'neutral'}>
                          {u.role}
                        </Badge>
                      ) : (
                        <select
                          className={styles.select}
                          style={{ height: 28, fontSize: '0.8125rem', padding: '0 0.4rem' }}
                          value={u.role}
                          onChange={(e) => handleRoleChange(u, e.target.value as 'admin' | 'operator' | 'viewer')}
                          disabled={actionLoading === u._id + '-role'}
                        >
                          <option value="viewer">viewer</option>
                          <option value="operator">operator</option>
                          <option value="admin">admin</option>
                        </select>
                      )}
                    </td>

                    <td className={styles.td}>
                      <span
                        className={`${styles.statusDot} ${u.active && !locked ? styles.active : styles.inactive}`}
                        title={locked ? `Locked until ${formatDate(u.locked_until)}` : u.active ? 'Active' : 'Inactive'}
                      />
                      {locked ? 'Locked' : u.active ? 'Active' : 'Inactive'}
                      {(u.failed_login_attempts ?? 0) > 0 && !locked && (
                        <span style={{ marginLeft: 6, fontSize: '0.75rem', color: '#f59e0b' }}>
                          ({u.failed_login_attempts} failed)
                        </span>
                      )}
                    </td>

                    <td className={styles.td} style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)' }}>
                      {formatDate(u.last_login)}
                    </td>

                    <td className={styles.td} style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)' }}>
                      {formatDate(u.password_changed_at)}
                    </td>

                    <td className={styles.td}>
                      <div className={styles.actions}>
                        {!isSelf && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => { setResetTarget(u); setResetPw(''); }}
                          >
                            Reset Pw
                          </Button>
                        )}
                        {!isSelf && u.active && (
                          <Button
                            variant="danger"
                            size="sm"
                            loading={actionLoading === u._id + '-deactivate'}
                            disabled={!!actionLoading}
                            onClick={() => handleDeactivate(u)}
                          >
                            Deactivate
                          </Button>
                        )}
                        {!isSelf && !u.active && (
                          <Button
                            variant="primary"
                            size="sm"
                            loading={actionLoading === u._id + '-activate'}
                            disabled={!!actionLoading}
                            onClick={() => handleActivate(u)}
                          >
                            Activate
                          </Button>
                        )}
                        {!isSelf && locked && (
                          <Button
                            variant="outline"
                            size="sm"
                            loading={actionLoading === u._id + '-activate'}
                            disabled={!!actionLoading}
                            onClick={() => handleActivate(u)}
                          >
                            Unlock
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      {/* Reset password modal */}
      {resetTarget && (
        <div
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => !resetPassword.isPending && setResetTarget(null)}
        >
          <div
            style={{
              background: 'var(--color-bg-primary)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-lg)',
              padding: 'var(--spacing-xl)',
              width: 380,
              maxWidth: '90vw',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ marginTop: 0, marginBottom: 'var(--spacing-lg)' }}>
              Reset password for <em>{resetTarget.username}</em>
            </h3>
            <form onSubmit={handleResetPassword}>
              <div className={styles.field} style={{ marginBottom: 'var(--spacing-md)' }}>
                <label className={styles.label}>New password</label>
                <input
                  className={styles.input}
                  type="password"
                  autoComplete="new-password"
                  autoFocus
                  value={resetPw}
                  onChange={(e) => setResetPw(e.target.value)}
                  disabled={resetPassword.isPending}
                />
                {resetPw && (
                  <>
                    <div className={styles.pwStrength}>
                      {[1,2,3,4,5].map((i) => (
                        <div key={i} className={`${styles.pwStrengthBar} ${i <= resetPwStrength ? STRENGTH_CLASSES[resetPwStrength] : ''}`} />
                      ))}
                    </div>
                    <div className={styles.pwHints}>
                      {PASSWORD_RULES.map((r) => (
                        <span key={r.label} className={r.test(resetPw) ? styles.pwHintOk : styles.pwHintFail}>
                          {r.test(resetPw) ? '✓' : '✗'} {r.label}
                        </span>
                      ))}
                    </div>
                  </>
                )}
              </div>
              <div style={{ display: 'flex', gap: 'var(--spacing-sm)', justifyContent: 'flex-end' }}>
                <Button variant="outline" size="sm" onClick={() => setResetTarget(null)} disabled={resetPassword.isPending}>
                  Cancel
                </Button>
                <Button variant="primary" size="sm" type="submit" loading={resetPassword.isPending} disabled={resetPassword.isPending || resetPwStrength < 5}>
                  Reset Password
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
    </>
  );
};

export default UserManagement;
