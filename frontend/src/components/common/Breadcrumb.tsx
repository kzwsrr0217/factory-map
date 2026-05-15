/**
 * Breadcrumb.tsx — Hierarchical navigation trail.
 *
 * Renders an `aria-label="Breadcrumb"` `<nav>` with ChevronRight separators.
 * Each item with an `href` is rendered as a React Router `<Link>` unless it
 * is the last item, which is always a plain `<span>` styled as the current
 * page. Items without `href` are also rendered as spans (non-interactive).
 *
 * Usage: `<Breadcrumb items={[{label:'Buildings',href:'/buildings'},{label:'Floor 1'}]} />`
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import styles from '../../styles/components/Breadcrumb.module.css';

export interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface BreadcrumbProps {
  items: BreadcrumbItem[];
}

const Breadcrumb: React.FC<BreadcrumbProps> = ({ items }) => (
  <nav className={styles.breadcrumb} aria-label="Breadcrumb">
    {items.map((item, i) => {
      const isLast = i === items.length - 1;
      return (
        <React.Fragment key={i}>
          {i > 0 && (
            <ChevronRight size={14} className={styles.separator} aria-hidden="true" />
          )}
          {item.href && !isLast ? (
            <Link to={item.href} className={styles.link}>{item.label}</Link>
          ) : (
            <span className={isLast ? styles.current : styles.link}>{item.label}</span>
          )}
        </React.Fragment>
      );
    })}
  </nav>
);

export default Breadcrumb;
