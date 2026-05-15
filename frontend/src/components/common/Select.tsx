/**
 * Select.tsx — Controlled native `<select>` wrapper.
 *
 * Renders a styled dropdown driven by an `options` array of `{ value, label }`
 * pairs. An empty-value placeholder option is always prepended so the
 * controlled value can be cleared to ''.
 *
 * `onChange` receives the string value directly (not the native event) so
 * callers don't need `e.target.value` boilerplate.
 */
import React from 'react';
import styles from '../../styles/components/Select.module.css';

interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  disabled?: boolean;
}

const Select: React.FC<SelectProps> = ({
  id,
  value,
  onChange,
  options,
  placeholder = 'Select...',
  disabled = false,
}) => {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={styles.select}
      disabled={disabled}
    >
      <option value="">{placeholder}</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
};

export default Select;