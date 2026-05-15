/**
 * FilterButton.tsx — Toggle chip used in filter bars.
 *
 * Visually distinguishes an active filter from an inactive one via
 * `styles.active`. Optionally shows a numeric `count` badge — useful for
 * indicating how many items match the filter so users can gauge impact before
 * clicking (e.g. "Active (14)").
 */
import React from 'react';
import styles from '../../styles/components/FilterButton.module.css';

interface FilterButtonProps {
  label: string;
  active: boolean;
  onClick: () => void;
  count?: number;
}

const FilterButton: React.FC<FilterButtonProps> = ({
  label,
  active,
  onClick,
  count,
}) => {
  return (
    <button
      className={`${styles.filterButton} ${active ? styles.active : ''}`}
      onClick={onClick}
    >
      {label}
      {count !== undefined && <span className={styles.count}>{count}</span>}
    </button>
  );
};

export default FilterButton;