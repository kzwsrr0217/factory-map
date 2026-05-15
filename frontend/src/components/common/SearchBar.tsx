/**
 * SearchBar.tsx — Inline text filter input with clear button.
 *
 * Lightweight alternative to GlobalSearch for page-level filtering (e.g.
 * Buildings list, Audit Log). Renders a search icon on the left and an × clear
 * button that appears when the value is non-empty.
 *
 * `onChange` receives the raw string value; callers filter their data lists in
 * response, typically with a simple `.toLowerCase().includes()` check.
 */
import React from 'react';
import styles from '../../styles/components/SearchBar.module.css';

interface SearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

const SearchBar: React.FC<SearchBarProps> = ({
  value,
  onChange,
  placeholder = 'Search...',
}) => {
  return (
    <div className={styles.searchBar}>
      <svg
        className={styles.searchIcon}
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
      >
        <circle cx="11" cy="11" r="8" strokeWidth="2" />
        <path d="M21 21l-4.35-4.35" strokeWidth="2" strokeLinecap="round" />
      </svg>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={styles.input}
      />
      {value && (
        <button className={styles.clearButton} onClick={() => onChange('')}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  );
};

export default SearchBar;