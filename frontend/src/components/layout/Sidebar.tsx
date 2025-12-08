import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import styles from '../../styles/components/Sidebar.module.css';

interface SidebarProps {
  isOpen: boolean;
}

interface MenuItem {
  icon: string;
  label: string;
  path: string;
}

const menuItems: MenuItem[] = [
  { icon: '🏠', label: 'Dashboard', path: '/' },
  { icon: '🏢', label: 'Buildings', path: '/buildings' },
  { icon: '📦', label: 'Assets', path: '/assets' },
  { icon: '🗺️', label: 'Map View', path: '/map' },
  { icon: '📊', label: 'Reports', path: '/reports' },
  { icon: '⚙️', label: 'Settings', path: '/settings' },
];

const Sidebar: React.FC<SidebarProps> = ({ isOpen }) => {
  const location = useLocation();

  return (
    <aside className={`${styles.sidebar} ${isOpen ? styles.open : styles.closed}`}>
      <nav className={styles.nav}>
        {menuItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <Link
              key={item.path}
              to={item.path}
              className={`${styles.navItem} ${isActive ? styles.active : ''}`}
            >
              <span className={styles.icon}>{item.icon}</span>
              <span className={styles.label}>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
};

export default Sidebar;