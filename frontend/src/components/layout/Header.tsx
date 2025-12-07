import React from 'react';
import styles from '../../styles/components/Header.module.css';

interface HeaderProps {
  onMenuToggle?: () => void;
}

const Header: React.FC<HeaderProps> = ({ onMenuToggle }) => {
  return (
    <header className={styles.header}>
      <div className={styles.leftSection}>
        <button className={styles.menuButton} onClick={onMenuToggle}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <h1 className={styles.logo}>
          🏭 Factory Map
        </h1>
      </div>

      <div className={styles.rightSection}>
        <span className={styles.userName}>Admin User</span>
        <div className={styles.avatar}>A</div>
      </div>
    </header>
  );
};

export default Header;