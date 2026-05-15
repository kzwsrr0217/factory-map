/**
 * Skeleton.tsx — Loading placeholder animations.
 *
 * Base `Skeleton` component renders a single animated placeholder block.
 * Three pre-built composite layouts are also exported:
 *
 *   CardSkeleton   — thumbnail + three text lines (used on Buildings/Floors).
 *   ListSkeleton   — N avatar + two-line rows (used on asset tables).
 *   TableSkeleton  — grid of M rows × N columns (used on generic data tables).
 *
 * Variants: text (default, slight border-radius) | circular | rectangular
 * Animations: pulse (opacity fade) | wave (shimmer sweep) | none
 */
import React from 'react';
import styles from '../../styles/components/Skeleton.module.css';

interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  variant?: 'text' | 'circular' | 'rectangular';
  animation?: 'pulse' | 'wave' | 'none';
  className?: string;
}

const Skeleton: React.FC<SkeletonProps> = ({
  width = '100%',
  height = '20px',
  variant = 'text',
  animation = 'pulse',
  className = '',
}) => {
  const style: React.CSSProperties = {
    width: typeof width === 'number' ? `${width}px` : width,
    height: typeof height === 'number' ? `${height}px` : height,
  };

  return (
    <div
      className={`${styles.skeleton} ${styles[variant]} ${styles[animation]} ${className}`}
      style={style}
    />
  );
};

export default Skeleton;

// Pre-built skeleton layouts
export const CardSkeleton: React.FC = () => (
  <div className={styles.cardSkeleton}>
    <Skeleton variant="rectangular" height={200} />
    <div className={styles.cardContent}>
      <Skeleton width="60%" height={24} />
      <Skeleton width="40%" height={16} />
      <Skeleton width="100%" height={16} />
      <Skeleton width="80%" height={16} />
    </div>
  </div>
);

export const ListSkeleton: React.FC<{ count?: number }> = ({ count = 5 }) => (
  <div className={styles.listSkeleton}>
    {Array.from({ length: count }).map((_, i) => (
      <div key={i} className={styles.listItem}>
        <Skeleton variant="circular" width={48} height={48} />
        <div className={styles.listContent}>
          <Skeleton width="70%" height={20} />
          <Skeleton width="50%" height={16} />
        </div>
      </div>
    ))}
  </div>
);

export const TableSkeleton: React.FC<{ rows?: number; cols?: number }> = ({ 
  rows = 5, 
  cols = 4 
}) => (
  <div className={styles.tableSkeleton}>
    {Array.from({ length: rows }).map((_, i) => (
      <div key={i} className={styles.tableRow}>
        {Array.from({ length: cols }).map((_, j) => (
          <Skeleton key={j} height={20} />
        ))}
      </div>
    ))}
  </div>
);