/**
 * Card.tsx — Generic surface container with optional elevation and interactivity.
 *
 * Wraps content in a rounded, shadowed div. When `onClick` is provided the
 * cursor changes to pointer and focus styles are applied. `hoverable` adds a
 * lift effect on hover without making the card keyboard-focusable.
 *
 * Padding levels: none | sm | md (default) | lg
 */
import React from 'react';
import styles from '../../styles/components/Card.module.css';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  padding?: 'none' | 'sm' | 'md' | 'lg';
  hoverable?: boolean;
  onClick?: () => void;
}

const Card: React.FC<CardProps> = ({
  children,
  className = '',
  style,
  padding = 'md',
  hoverable = false,
  onClick,
}) => {
  const classNames = [
    styles.card,
    styles[`padding-${padding}`],
    hoverable && styles.hoverable,
    onClick && styles.clickable,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classNames} style={style} onClick={onClick}>
      {children}
    </div>
  );
};

export default Card;