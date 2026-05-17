import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  Building2,
  Map,
  BarChart2,
  Settings,
  ClipboardList,
  MapPin,
  Bell,
  Network,
  Server,
  Wrench,
  Keyboard,
  LucideIcon,
} from 'lucide-react';
import { useMaintenanceCounts } from '../../hooks/useMaintenanceCounts';
import styles from '../../styles/components/Sidebar.module.css';

interface MenuItem {
  icon: LucideIcon;
  label: string;
  path: string;
}

const menuItems: MenuItem[] = [
  { icon: LayoutDashboard, label: 'Dashboard',  path: '/' },
  { icon: Building2,       label: 'Buildings',  path: '/buildings' },
  { icon: Map,             label: 'Map View',   path: '/map' },
  { icon: MapPin,          label: 'Unplaced',   path: '/unplaced' },
  { icon: BarChart2,       label: 'Reports',    path: '/reports' },
  { icon: Network,         label: 'Network',    path: '/network' },
  { icon: Server,          label: 'Infra',      path: '/infrastructure' },
  { icon: Wrench,          label: 'Maintenance', path: '/maintenance' },
  { icon: ClipboardList,   label: 'Audit Log',  path: '/audit' },
  { icon: Bell,            label: 'Alerts',     path: '/alerts' },
  { icon: Settings,        label: 'Settings',   path: '/settings' },
];

interface SidebarProps {
  isOpen: boolean;
  onShortcuts?: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ isOpen, onShortcuts }) => {
  const location = useLocation();
  const { overdue } = useMaintenanceCounts();

  const isActive = (path: string) =>
    path === '/' ? location.pathname === '/' : location.pathname.startsWith(path);

  return (
    <aside
      className={`${styles.sidebar} ${isOpen ? styles.open : styles.closed}`}
      aria-label="Main navigation"
    >
      <nav className={styles.nav}>
        {menuItems.map((item) => {
          const Icon = item.icon;
          const active = isActive(item.path);
          const showBadge = item.path === '/maintenance' && overdue > 0;
          return (
            <Link
              key={item.path}
              to={item.path}
              className={`${styles.navItem} ${active ? styles.active : ''}`}
              title={!isOpen ? item.label : undefined}
              aria-current={active ? 'page' : undefined}
            >
              <div className={styles.navItemInner}>
                <Icon size={18} className={styles.icon} aria-hidden="true" />
                <span className={styles.label}>{item.label}</span>
              </div>
              {showBadge && (
                <span className={styles.badge} aria-label={`${overdue} overdue`}>
                  {overdue > 99 ? '99+' : overdue}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
      <div className={styles.footer}>
        <button
          className={styles.shortcutsBtn}
          onClick={onShortcuts}
          title={isOpen ? undefined : 'Keyboard shortcuts (?)'}
        >
          <Keyboard size={15} className={styles.icon} aria-hidden="true" />
          <span className={styles.label}>Shortcuts</span>
          <span className={styles.shortcutHint}>?</span>
        </button>
      </div>
    </aside>
  );
};

export default Sidebar;
