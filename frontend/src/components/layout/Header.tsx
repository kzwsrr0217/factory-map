/**
 * Header.tsx — Top application bar.
 *
 * Contains:
 *   Hamburger button  — calls `onSidebarToggle` to collapse/expand the Sidebar.
 *   Logo link         — navigates to "/".
 *   Search button     — opens GlobalSearch (also triggered by Ctrl+K / Cmd+K).
 *   Theme toggle      — switches between light/dark via ThemeContext.
 *   User chip         — shows avatar initial, username, and role badge.
 *   Logout button     — calls AuthContext.logout() which clears tokens and
 *                       redirects to /login.
 *
 * The Ctrl+K listener is attached at the window level so it fires even when
 * focus is inside a form. The effect cleans up the listener on unmount.
 */
import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Menu, Search, Moon, Sun, LogOut, Factory, Keyboard } from 'lucide-react';
import { useTheme } from '../../contexts/ThemeContext';
import { useAuth } from '../../contexts/AuthContext';
import GlobalSearch from '../search/GlobalSearch';
import KeyboardShortcutsModal from '../common/KeyboardShortcutsModal';
import styles from '../../styles/components/Header.module.css';

interface HeaderProps {
  onSidebarToggle: () => void;
}

const Header: React.FC<HeaderProps> = ({ onSidebarToggle }) => {
  const [searchOpen, setSearchOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const { user, logout } = useAuth();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const inInput = e.target instanceof HTMLInputElement
        || e.target instanceof HTMLTextAreaElement
        || (e.target as HTMLElement)?.isContentEditable;

      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen(true);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('app:new-asset'));
        return;
      }
      if (e.key === '?' && !inInput && !e.ctrlKey && !e.metaKey) {
        e.preventDefault();
        setShortcutsOpen(true);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <>
      <header className={styles.header}>
        <div className={styles.container}>
          <div className={styles.left}>
            <button
              className={styles.sidebarToggle}
              onClick={onSidebarToggle}
              aria-label="Toggle sidebar"
              title="Toggle sidebar"
            >
              <Menu size={20} />
            </button>

            <Link to="/" className={styles.logo}>
              <Factory size={22} className={styles.logoIcon} />
              <span className={styles.logoText}>Factory Map</span>
            </Link>
          </div>

          <div className={styles.actions}>
            <button
              className={styles.searchButton}
              onClick={() => setSearchOpen(true)}
              aria-label="Search"
              title="Search (Ctrl+K)"
            >
              <Search size={16} className={styles.searchIcon} />
              <span className={styles.searchText}>Search…</span>
              <kbd className={styles.kbd}>Ctrl+K</kbd>
            </button>

            <button
              className={styles.iconButton}
              onClick={() => setShortcutsOpen(true)}
              aria-label="Keyboard shortcuts"
              title="Keyboard shortcuts (?)"
            >
              <Keyboard size={17} />
            </button>

            <button
              className={styles.iconButton}
              onClick={toggleTheme}
              aria-label={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
              title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`}
            >
              {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
            </button>

            {user && (
              <div className={styles.userInfo}>
                <div className={styles.avatar} aria-hidden="true">
                  {user.username.charAt(0).toUpperCase()}
                </div>
                <span className={styles.username}>{user.username}</span>
                <span className={styles.roleBadge}>{user.role}</span>
              </div>
            )}

            <button
              className={`${styles.iconButton} ${styles.logoutButton}`}
              onClick={logout}
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut size={18} />
            </button>
          </div>
        </div>
      </header>

      <GlobalSearch isOpen={searchOpen} onClose={() => setSearchOpen(false)} />
      <KeyboardShortcutsModal isOpen={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
    </>
  );
};

export default Header;
