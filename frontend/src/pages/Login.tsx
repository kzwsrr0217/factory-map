/**
 * Login.tsx — Authentication page ("/login").
 *
 * On mount, fetches GET /auth/capabilities to discover which auth methods are
 * enabled on the server (local, ldap, azure). This hides LDAP/Azure tabs when
 * those integrations are not configured.
 *
 * Login modes:
 *   local — username + password submitted to POST /auth/login.
 *   ldap  — username + password submitted with `mode: 'ldap'` to the same
 *           endpoint; the server routes it to LdapAuthService.
 *
 * After a successful login AuthContext.login() stores the JWT and the page
 * redirects to `location.state.from` (the path that triggered the redirect to
 * /login) or "/" if there is no prior location.
 *
 * Locked-out accounts (5 failed attempts) show a server-returned message
 * with the remaining lockout duration.
 */
import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Factory, Network } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import api from '../services/api';
import styles from '../styles/pages/Login.module.css';

interface AuthCapabilities {
  local: boolean;
  ldap: boolean;
  azure: boolean;
}

type LoginMode = 'local' | 'ldap';

const Login: React.FC = () => {
  const { login, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string })?.from ?? '/';

  const [capabilities, setCapabilities] = useState<AuthCapabilities>({ local: true, ldap: false, azure: false });
  const [mode, setMode] = useState<LoginMode>('local');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [lockoutSecondsLeft, setLockoutSecondsLeft] = useState(0);

  useEffect(() => {
    if (isAuthenticated) navigate(from, { replace: true });
  }, [isAuthenticated, navigate, from]);

  // Countdown timer for locked accounts
  useEffect(() => {
    if (lockoutSecondsLeft <= 0) return;
    const t = setInterval(() => {
      setLockoutSecondsLeft(s => {
        if (s <= 1) { clearInterval(t); setError(''); return 0; }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [lockoutSecondsLeft]);

  useEffect(() => {
    api.get<{ success: boolean; data: AuthCapabilities }>('/auth/capabilities')
      .then(res => {
        setCapabilities(res.data.data);
      })
      .catch(() => {});
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password.trim()) {
      setError('Username and password are required');
      return;
    }
    setLoading(true);
    setError('');
    try {
      if (mode === 'ldap') {
        const res = await api.post<{ success: boolean; data: { token: string; user: { id: string; username: string; role: string } } }>(
          '/auth/login/ldap',
          { username: username.trim(), password }
        );
        const { token, user } = res.data.data;
        localStorage.setItem('authToken', token);
        localStorage.setItem('authUser', JSON.stringify(user));
        navigate(from, { replace: true });
      } else {
        const { passwordExpired } = await login(username.trim(), password);
        navigate(passwordExpired ? '/settings' : from, { replace: true });
      }
    } catch (err: any) {
      const msg: string = err?.response?.data?.error ?? 'Invalid username or password';
      setError(msg);
      // Parse lockout duration from "Account locked. Try again in X minute(s)."
      const minuteMatch = msg.match(/(\d+)\s*minute/i);
      if (minuteMatch) {
        setLockoutSecondsLeft(parseInt(minuteMatch[1], 10) * 60);
      }
    } finally {
      setLoading(false);
    }
  };

  const showTabs = capabilities.ldap;

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.logo}>
          <Factory size={32} className={styles.logoIcon} />
          <h1 className={styles.logoText}>Factory Map</h1>
        </div>

        <h2 className={styles.title}>Sign in</h2>

        {showTabs && (
          <div className={styles.tabs}>
            <button
              type="button"
              className={`${styles.tab} ${mode === 'local' ? styles.tabActive : ''}`}
              onClick={() => { setMode('local'); setError(''); }}
            >
              Local
            </button>
            <button
              type="button"
              className={`${styles.tab} ${mode === 'ldap' ? styles.tabActive : ''}`}
              onClick={() => { setMode('ldap'); setError(''); }}
            >
              <Network size={14} style={{ marginRight: 4 }} />
              LDAP / AD
            </button>
          </div>
        )}

        <form className={styles.form} onSubmit={handleSubmit}>
          <div className={styles.field}>
            <label className={styles.label} htmlFor="username">
              {mode === 'ldap' ? 'Domain Username' : 'Username'}
            </label>
            <input
              id="username"
              className={styles.input}
              type="text"
              autoComplete="username"
              autoFocus
              placeholder={mode === 'ldap' ? 'e.g. jsmith' : ''}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              disabled={loading}
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label} htmlFor="password">Password</label>
            <input
              id="password"
              className={styles.input}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={loading}
            />
          </div>

          {error && (
            <p className={styles.error}>
              {error}
              {lockoutSecondsLeft > 0 && (
                <span> ({Math.floor(lockoutSecondsLeft / 60)}:{String(lockoutSecondsLeft % 60).padStart(2, '0')} remaining)</span>
              )}
            </p>
          )}

          <button className={styles.button} type="submit" disabled={loading || lockoutSecondsLeft > 0}>
            {loading ? 'Signing in…' : mode === 'ldap' ? 'Sign in with LDAP' : 'Sign in'}
          </button>
        </form>

        {mode === 'local' && (
          <p className={styles.hint}>Default: admin / admin123</p>
        )}
        {mode === 'ldap' && (
          <p className={styles.hint}>Use your Active Directory / LDAP credentials</p>
        )}
      </div>
    </div>
  );
};

export default Login;
