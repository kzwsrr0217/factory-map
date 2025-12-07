import React from 'react';
import styles from '../../styles/components/Sidebar.module.css';

interface SidebarProps {
  isOpen: boolean;
}

interface MenuItem {
  icon: string;
  label: string;
  path: string;
  active?: boolean;
}

const menuItems: MenuItem[] = [
  { icon: '🏠', label: 'Dashboard', path: '/', active: true },
  { icon: '🏢', label: 'Buildings', path: '/buildings' },
  { icon: '📦', label: 'Assets', path: '/assets' },
  { icon: '🗺️', label: 'Map View', path: '/map' },
  { icon: '📊', label: 'Reports', path: '/reports' },
  { icon: '⚙️', label: 'Settings', path: '/settings' },
];

const Sidebar: React.FC<SidebarProps> = ({ isOpen }) => {
  return (
    <aside className={`${styles.sidebar} ${isOpen ? styles.open : styles.closed}`}>
      <nav className={styles.nav}>
        {menuItems.map((item) => (
            <a
          
            key={item.path}
            href={item.path}
            className={`${styles.navItem} ${item.active ? styles.active : ''}`}
          >
            <span className={styles.icon}>{item.icon}</span>
            <span className={styles.label}>{item.label}</span>
          </a>
        ))}
      </nav>
    </aside>
  );
};

export default Sidebar;