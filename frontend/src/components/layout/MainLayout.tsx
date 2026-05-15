/**
 * MainLayout.tsx — Shell layout shared by all authenticated pages.
 *
 * Renders the persistent Header across the top and a collapsible Sidebar on
 * the left. Page content is injected via `children` into the `<main>` area.
 *
 * Two full-width notification banners sit below the header when active:
 *
 *   Network error banner  — appears when api.ts fires the custom
 *     `factory-map:network-error` window event (raised on network-level
 *     failures like ECONNREFUSED). Manually dismissible.
 *
 *   Password-expired banner — driven by `AuthContext.passwordExpired`. Shown
 *     when the backend returns `password_expired: true` on login or token
 *     refresh. Links the user to /settings; dismissed via `clearPasswordExpired`.
 */
import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, WifiOff, X } from 'lucide-react';
import Header from './Header';
import Sidebar from './Sidebar';
import KeyboardShortcuts from '../common/KeyboardShortcuts';
import { useAuth } from '../../contexts/AuthContext';
import styles from '../../styles/components/MainLayout.module.css';

interface MainLayoutProps {
  children: React.ReactNode;
}

const MainLayout: React.FC<MainLayoutProps> = ({ children }) => {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [networkError, setNetworkError] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const { passwordExpired, clearPasswordExpired } = useAuth();

  useEffect(() => {
    const handleNetworkError = () => setNetworkError(true);
    window.addEventListener('factory-map:network-error', handleNetworkError);
    return () => window.removeEventListener('factory-map:network-error', handleNetworkError);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === '?' && !e.ctrlKey && !e.metaKey && !(e.target as HTMLElement).matches('input,textarea,select')) {
        setShortcutsOpen(v => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <div className={styles.layout}>
      <Header onSidebarToggle={() => setSidebarOpen((v) => !v)} />
      {networkError && (
        <div className={styles.networkErrorBanner}>
          <WifiOff size={16} />
          <span>Cannot reach the server. Check your connection or try refreshing.</span>
          <button className={styles.bannerDismiss} onClick={() => setNetworkError(false)} aria-label="Dismiss">
            <X size={14} />
          </button>
        </div>
      )}
      {passwordExpired && (
        <div className={styles.passwordExpiredBanner}>
          <AlertTriangle size={16} />
          <span>
            Your password has expired or was never set.{' '}
            <Link to="/settings" className={styles.bannerLink}>Change your password</Link> to maintain access.
          </span>
          <button className={styles.bannerDismiss} onClick={clearPasswordExpired} aria-label="Dismiss">
            <X size={14} />
          </button>
        </div>
      )}
      <div className={styles.container}>
        <Sidebar isOpen={sidebarOpen} onShortcuts={() => setShortcutsOpen(true)} />
        <main className={styles.main}>
          {children}
        </main>
      </div>
      <KeyboardShortcuts isOpen={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </div>
  );
};

export default MainLayout;
