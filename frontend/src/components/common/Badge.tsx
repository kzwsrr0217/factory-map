/**
 * Badge.tsx — Small semantic label chip.
 *
 * Used throughout the app to indicate status (active/inactive/maintenance),
 * asset type, ITSM source, connection type, etc.
 *
 * Variants map to colour tokens defined in Badge.module.css:
 *   success → green   warning → amber   error → red
 *   info → blue       neutral → grey (default)
 * Sizes: sm (small text, tight padding) | md (default).
 */
import React from 'react';
import styles from '../../styles/components/Badge.module.css';

interface BadgeProps {
  children: React.ReactNode;
  variant?: 'success' | 'warning' | 'error' | 'info' | 'neutral';
  size?: 'sm' | 'md';
}

const Badge: React.FC<BadgeProps> = ({ 
  children, 
  variant = 'neutral', 
  size = 'md' 
}) => {
  const classNames = [styles.badge, styles[variant], styles[size]]
    .filter(Boolean)
    .join(' ');

  return <span className={classNames}>{children}</span>;
};

export default Badge;