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