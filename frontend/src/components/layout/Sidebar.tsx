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
  AlertTriangle,
  Bell,
  Network,
  Server,
  Wrench,
  RefreshCw,
  Keyboard,
  Gauge,
  LucideIcon,
} from 'lucide-react';
import { useMaintenanceCounts } from '../../hooks/useMaintenanceCounts';
import styles from '../../styles/components/Sidebar.module.css';

interface MenuItem {
  icon: LucideIcon;
  label: string;
  path: string;
}

/**
 * The menu, in groups.
 *
 * Thirteen equal-weight entries gave no clue which are the daily ones and which are
 * looked at once a month, and related pages sat apart (Network next to Reports,
 * Infrastructure next to Maintenance). The groups say what a page is for; within a
 * group the order is roughly how often it is opened.
 *
 * Headings are hidden when the rail is collapsed — a heading with no room for its
 * text is just a gap — but the grouping still shows as spacing between the icons.
 */
interface MenuGroup {
  /** Shown above the group; omitted for the first, which needs no explaining. */
  title?: string;
  items: MenuItem[];
}

const menuGroups: MenuGroup[] = [
  {
    items: [
      { icon: LayoutDashboard, label: 'Dashboard', path: '/' },
    ],
  },
  {
    title: 'Places',
    items: [
      { icon: Building2, label: 'Buildings', path: '/buildings' },
      { icon: Map,       label: 'Map View',  path: '/map' },
      // Where the survey stands, floor by floor — the phase this app is in.
      { icon: Gauge,     label: 'Survey progress', path: '/progress' },
    ],
  },
  {
    title: 'Devices',
    items: [
      { icon: MapPin,        label: 'Unplaced Assets', path: '/unplaced' },
      { icon: AlertTriangle, label: 'Orphaned Assets', path: '/orphaned' },
      { icon: Wrench,        label: 'Maintenance',     path: '/maintenance' },
    ],
  },
  {
    title: 'Network',
    items: [
      { icon: Server,  label: 'Infrastructure', path: '/infrastructure' },
      { icon: Network, label: 'Connections',    path: '/network' },
    ],
  },
  {
    title: 'Data & admin',
    items: [
      { icon: RefreshCw,     label: 'ITSM Reconcile', path: '/itsm' },
      { icon: BarChart2,     label: 'Reports',        path: '/reports' },
      { icon: Bell,          label: 'Alerts',         path: '/alerts' },
      { icon: ClipboardList, label: 'Audit Log',      path: '/audit' },
      { icon: Settings,      label: 'Settings',       path: '/settings' },
    ],
  },
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
        {menuGroups.map((group, gi) => (
          <div key={group.title ?? `group-${gi}`} className={styles.navGroup} role="group" aria-label={group.title}>
            {group.title && isOpen && <div className={styles.navGroupTitle}>{group.title}</div>}
            {group.items.map((item) => {
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
          </div>
        ))}
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
