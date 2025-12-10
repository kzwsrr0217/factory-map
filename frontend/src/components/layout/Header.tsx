import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import GlobalSearch from '../search/GlobalSearch';
import styles from '../../styles/components/Header.module.css';

const Header: React.FC = () => {
  const [searchOpen, setSearchOpen] = useState(false);

  // Keyboard shortcut: Ctrl+K or Cmd+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <>
      <header className={styles.header}>
        <div className={styles.container}>
          <Link to="/" className={styles.logo}>
            <span className={styles.logoIcon}>🏭</span>
            <span className={styles.logoText}>Factory Map</span>
          </Link>

          <nav className={styles.nav}>
            <Link to="/" className={styles.navLink}>
              Dashboard
            </Link>
            <Link to="/buildings" className={styles.navLink}>
              Buildings
            </Link>
          </nav>

          <div className={styles.actions}>
            <button
              className={styles.searchButton}
              onClick={() => setSearchOpen(true)}
              title="Search (Ctrl+K)"
            >
              <span className={styles.searchIcon}>🔍</span>
              <span className={styles.searchText}>Search...</span>
              <kbd className={styles.kbd}>Ctrl+K</kbd>
            </button>
          </div>
        </div>
      </header>

      <GlobalSearch isOpen={searchOpen} onClose={() => setSearchOpen(false)} />
    </>
  );
};

export default Header;