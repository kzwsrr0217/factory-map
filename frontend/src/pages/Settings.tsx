/**
 * Settings.tsx — User preferences and account page ("/settings").
 *
 * Sections:
 *   Appearance   — light/dark theme toggle (persisted via ThemeContext →
 *                  localStorage).
 *   Password     — change password form with live rule-checklist. Requires
 *                  current password; validates the new password against
 *                  PASSWORD_RULES before submitting to POST /auth/change-password.
 *   Preferences  — AppSettings managed by utils/settings.ts: defaultView,
 *                  itemsPerPage, autoRefresh, notifications.
 *
 * The password rule checklist (PASSWORD_RULES array) mirrors the backend policy
 * in passwordPolicy.ts and gives instant visual feedback as the user types.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Sun, Moon, Check, Monitor, Trash2 } from 'lucide-react';
import { useTheme } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { loadSettings, saveSettings, resetSettings, AppSettings } from '../utils/settings';
import api from '../services/api';
import styles from '../styles/pages/Settings.module.css';

const PASSWORD_RULES = [
  { label: 'At least 8 characters', test: (p: string) => p.length >= 8 },
  { label: 'One uppercase letter', test: (p: string) => /[A-Z]/.test(p) },
  { label: 'One lowercase letter', test: (p: string) => /[a-z]/.test(p) },
  { label: 'One number', test: (p: string) => /[0-9]/.test(p) },
  { label: 'One special character', test: (p: string) => /[^A-Za-z0-9]/.test(p) },
];

const getStrength = (pw: string): number => {
  if (!pw) return 0;
  return PASSWORD_RULES.filter((r) => r.test(pw)).length;
};

const STRENGTH_LABELS = ['', 'Weak', 'Fair', 'Fair', 'Good', 'Strong'];
const STRENGTH_CLASSES = ['', styles.pwStrengthWeak, styles.pwStrengthFair, styles.pwStrengthFair, styles.pwStrengthGood, styles.pwStrengthStrong];

const Settings: React.FC = () => {
  const { theme, toggleTheme } = useTheme();
  const { user, clearPasswordExpired } = useAuth();
  const toast = useToast();
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const [saved, setSaved] = useState(false);

  // Email update state
  const [emailDraft, setEmailDraft] = useState('');
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailLoaded, setEmailLoaded] = useState(false);

  // Password change state
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [pwLoading, setPwLoading] = useState(false);
  const [pwError, setPwError] = useState('');
  const [pwSuccess, setPwSuccess] = useState('');

  // Sessions
  interface SessionInfo {
    jti: string;
    issued_at: string;
    expires_at: string;
    ip_address: string | null;
    user_agent: string | null;
    is_current: boolean;
  }
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);

  const loadSessions = useCallback(async () => {
    setSessionsLoading(true);
    try {
      const res = await api.get<{ success: boolean; data: SessionInfo[] }>('/auth/sessions');
      if (res.data.success) setSessions(res.data.data);
    } catch {
      // silently ignore
    } finally {
      setSessionsLoading(false);
    }
  }, []);

  const handleRevokeSession = async (jti: string) => {
    setRevoking(jti);
    try {
      await api.delete(`/auth/sessions/${jti}`);
      setSessions(prev => prev.filter(s => s.jti !== jti));
      toast.success('Session revoked');
    } catch {
      toast.error('Failed to revoke session');
    } finally {
      setRevoking(null);
    }
  };

  useEffect(() => {
    api.get('/auth/me').then((res) => {
      setEmailDraft(res.data?.data?.email ?? '');
      setEmailLoaded(true);
    }).catch(() => setEmailLoaded(true));
    loadSessions();
  }, [loadSessions]);

  const handleSaveEmail = async () => {
    setEmailLoading(true);
    try {
      await api.patch('/auth/profile', { email: emailDraft });
      toast.success('Email updated');
    } catch (err: any) {
      toast.error(err?.response?.data?.error ?? 'Failed to update email');
    } finally {
      setEmailLoading(false);
    }
  };

  const update = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  };

  const handleSave = () => {
    saveSettings(settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleReset = () => {
    const defaults = resetSettings();
    setSettings(defaults);
    setSaved(false);
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwError('');
    setPwSuccess('');
    if (!currentPw || !newPw || !confirmPw) {
      setPwError('All fields are required.');
      return;
    }
    if (newPw !== confirmPw) {
      setPwError('New passwords do not match.');
      return;
    }
    const strength = getStrength(newPw);
    if (strength < 5) {
      setPwError('New password does not meet all requirements.');
      return;
    }
    setPwLoading(true);
    try {
      await api.patch('/auth/password', { currentPassword: currentPw, newPassword: newPw });
      setPwSuccess('Password changed successfully.');
      setCurrentPw('');
      setNewPw('');
      setConfirmPw('');
      clearPasswordExpired();
      toast.success('Password changed successfully');
    } catch (err: any) {
      const msg = err?.response?.data?.error ?? 'Failed to change password.';
      setPwError(msg);
    } finally {
      setPwLoading(false);
    }
  };

  const newPwStrength = getStrength(newPw);

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Settings</h1>
        <p className={styles.subtitle}>Configure your Factory Map preferences</p>
      </div>

      <div className={styles.sections}>
        {/* Appearance */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Appearance</h2>
          <div className={styles.row}>
            <div className={styles.rowLabel}>
              <span className={styles.label}>Theme</span>
              <span className={styles.hint}>Choose between light and dark mode</span>
            </div>
            <div className={styles.rowControl}>
              <button
                className={`${styles.themeBtn} ${theme === 'light' ? styles.themeBtnActive : ''}`}
                onClick={() => theme === 'dark' && toggleTheme()}
              >
                <Sun size={15} style={{ marginRight: 6 }} />
                Light
              </button>
              <button
                className={`${styles.themeBtn} ${theme === 'dark' ? styles.themeBtnActive : ''}`}
                onClick={() => theme === 'light' && toggleTheme()}
              >
                <Moon size={15} style={{ marginRight: 6 }} />
                Dark
              </button>
            </div>
          </div>
        </section>

        {/* Display */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Display</h2>

          <div className={styles.row}>
            <div className={styles.rowLabel}>
              <span className={styles.label}>Items per page</span>
              <span className={styles.hint}>Number of assets shown in lists</span>
            </div>
            <div className={styles.rowControl}>
              {[10, 25, 50, 100].map((n) => (
                <button
                  key={n}
                  className={`${styles.chipBtn} ${settings.itemsPerPage === n ? styles.chipBtnActive : ''}`}
                  onClick={() => update('itemsPerPage', n)}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          <div className={styles.row}>
            <div className={styles.rowLabel}>
              <span className={styles.label}>Date format</span>
              <span className={styles.hint}>How dates are displayed throughout the app</span>
            </div>
            <div className={styles.rowControl}>
              {(['relative', 'short', 'long'] as const).map((fmt) => (
                <button
                  key={fmt}
                  className={`${styles.chipBtn} ${settings.dateFormat === fmt ? styles.chipBtnActive : ''}`}
                  onClick={() => update('dateFormat', fmt)}
                >
                  {fmt.charAt(0).toUpperCase() + fmt.slice(1)}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* Map */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Map</h2>

          <div className={styles.row}>
            <div className={styles.rowLabel}>
              <span className={styles.label}>Grid size</span>
              <span className={styles.hint}>Snap grid cell size in pixels</span>
            </div>
            <div className={styles.rowControl}>
              {[10, 20, 40, 80].map((n) => (
                <button
                  key={n}
                  className={`${styles.chipBtn} ${settings.mapGridSize === n ? styles.chipBtnActive : ''}`}
                  onClick={() => update('mapGridSize', n)}
                >
                  {n}px
                </button>
              ))}
            </div>
          </div>

          <div className={styles.row}>
            <div className={styles.rowLabel}>
              <span className={styles.label}>Snap to grid</span>
              <span className={styles.hint}>Automatically align assets to grid when placing</span>
            </div>
            <div className={styles.rowControl}>
              <label className={styles.toggle}>
                <input
                  type="checkbox"
                  className={styles.toggleInput}
                  checked={settings.mapSnapToGrid}
                  onChange={(e) => update('mapSnapToGrid', e.target.checked)}
                />
                <span className={styles.toggleSlider} />
              </label>
            </div>
          </div>
        </section>

        {/* Security — Change Password */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Security</h2>
          <form className={styles.pwForm} onSubmit={handleChangePassword}>
            <div className={styles.pwField}>
              <label className={styles.pwLabel} htmlFor="current-pw">Current password</label>
              <input
                id="current-pw"
                className={styles.pwInput}
                type="password"
                autoComplete="current-password"
                value={currentPw}
                onChange={(e) => setCurrentPw(e.target.value)}
                disabled={pwLoading}
              />
            </div>

            <div className={styles.pwField}>
              <label className={styles.pwLabel} htmlFor="new-pw">New password</label>
              <input
                id="new-pw"
                className={styles.pwInput}
                type="password"
                autoComplete="new-password"
                value={newPw}
                onChange={(e) => { setNewPw(e.target.value); setPwError(''); setPwSuccess(''); }}
                disabled={pwLoading}
              />
              {newPw && (
                <>
                  <div className={styles.pwStrength}>
                    {[1, 2, 3, 4, 5].map((i) => (
                      <div
                        key={i}
                        className={`${styles.pwStrengthBar} ${i <= newPwStrength ? STRENGTH_CLASSES[newPwStrength] : ''}`}
                      />
                    ))}
                  </div>
                  <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)', marginTop: 2 }}>
                    Strength: {STRENGTH_LABELS[newPwStrength]}
                  </span>
                  <div className={styles.pwHints}>
                    {PASSWORD_RULES.map((r) => (
                      <span key={r.label} className={r.test(newPw) ? styles.pwHintOk : styles.pwHintFail}>
                        {r.test(newPw) ? '✓' : '✗'} {r.label}
                      </span>
                    ))}
                  </div>
                </>
              )}
            </div>

            <div className={styles.pwField}>
              <label className={styles.pwLabel} htmlFor="confirm-pw">Confirm new password</label>
              <input
                id="confirm-pw"
                className={styles.pwInput}
                type="password"
                autoComplete="new-password"
                value={confirmPw}
                onChange={(e) => { setConfirmPw(e.target.value); setPwError(''); setPwSuccess(''); }}
                disabled={pwLoading}
              />
              {confirmPw && newPw && confirmPw !== newPw && (
                <span className={styles.pwHintFail} style={{ fontSize: '0.8125rem' }}>Passwords do not match</span>
              )}
            </div>

            {pwError && <p className={styles.pwError}>{pwError}</p>}
            {pwSuccess && <p className={styles.pwSuccess}>{pwSuccess}</p>}

            <button className={styles.pwBtn} type="submit" disabled={pwLoading}>
              {pwLoading ? 'Changing…' : 'Change password'}
            </button>
          </form>
        </section>

        {/* Sessions */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Active Sessions</h2>
          <p className={styles.hint} style={{ marginBottom: 12 }}>
            These are all devices where your account is currently signed in. Revoke any session you don't recognise.
          </p>
          {sessionsLoading ? (
            <p className={styles.hint}>Loading sessions…</p>
          ) : sessions.length === 0 ? (
            <p className={styles.hint}>No active sessions found.</p>
          ) : (
            <div className={styles.sessionList}>
              {sessions.map((s) => (
                <div key={s.jti} className={`${styles.sessionRow} ${s.is_current ? styles.sessionRowCurrent : ''}`}>
                  <Monitor size={16} className={styles.sessionIcon} aria-hidden="true" />
                  <div className={styles.sessionInfo}>
                    <span className={styles.sessionAgent}>
                      {s.user_agent ? s.user_agent.slice(0, 60) : 'Unknown device'}
                      {s.is_current && <span className={styles.sessionCurrentBadge}>Current</span>}
                    </span>
                    <span className={styles.sessionMeta}>
                      {s.ip_address ?? 'Unknown IP'} · Signed in {new Date(s.issued_at).toLocaleString()} · Expires {new Date(s.expires_at).toLocaleString()}
                    </span>
                  </div>
                  {!s.is_current && (
                    <button
                      className={styles.sessionRevokeBtn}
                      onClick={() => handleRevokeSession(s.jti)}
                      disabled={revoking === s.jti}
                      title="Revoke this session"
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Account */}
        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Account</h2>
          <div className={styles.row}>
            <div className={styles.rowLabel}>
              <span className={styles.label}>Signed in as</span>
              <span className={styles.hint}>Your current session (expires in 8 hours)</span>
            </div>
            <div className={styles.rowControl}>
              <span className={styles.userChip}>
                {user?.username}
                <span className={styles.rolePill}>{user?.role}</span>
              </span>
            </div>
          </div>
          <div className={styles.row}>
            <div className={styles.rowLabel}>
              <span className={styles.label}>Email address</span>
              <span className={styles.hint}>Used for account recovery and notifications</span>
            </div>
            <div className={styles.rowControl} style={{ gap: 8 }}>
              <input
                className={styles.emailInput}
                type="email"
                placeholder={emailLoaded ? 'Not set' : 'Loading…'}
                value={emailDraft}
                onChange={(e) => setEmailDraft(e.target.value)}
                disabled={!emailLoaded || emailLoading}
              />
              <button
                className={styles.emailSaveBtn}
                onClick={handleSaveEmail}
                disabled={!emailLoaded || emailLoading}
              >
                {emailLoading ? '…' : 'Save'}
              </button>
            </div>
          </div>
          {user?.role === 'admin' && (
            <div className={styles.row}>
              <div className={styles.rowLabel}>
                <span className={styles.label}>User Management</span>
                <span className={styles.hint}>Create and manage user accounts</span>
              </div>
              <div className={styles.rowControl}>
                <Link to="/settings/users" className={styles.linkBtn}>
                  Manage users →
                </Link>
              </div>
            </div>
          )}
          <div className={styles.row}>
            <div className={styles.rowLabel}>
              <span className={styles.label}>Audit Log</span>
              <span className={styles.hint}>View recent changes and security events</span>
            </div>
            <div className={styles.rowControl}>
              <Link to="/audit" className={styles.linkBtn}>
                View audit log →
              </Link>
            </div>
          </div>
        </section>
      </div>

      <div className={styles.footer}>
        <button className={styles.resetBtn} onClick={handleReset}>
          Reset to defaults
        </button>
        <button
          className={`${styles.saveBtn} ${saved ? styles.saveBtnSuccess : ''}`}
          onClick={handleSave}
        >
          {saved ? <><Check size={14} style={{ marginRight: 4 }} />Saved</> : 'Save settings'}
        </button>
      </div>
    </div>
  );
};

export default Settings;
