/**
 * Input.tsx — Controlled text input with label, validation, and helper text.
 *
 * Extends all native `<input>` attributes. When `error` is set the input
 * border turns red and the error message is displayed below the field;
 * `helperText` shows secondary guidance when there is no error.
 *
 * The `label` element is rendered above the input without an explicit `htmlFor`
 * because the label and input share the same wrapper div — consumers should
 * pass `id` to the input if accessibility tooling requires explicit association.
 */
import React from 'react';
import styles from '../../styles/components/Input.module.css';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

const Input: React.FC<InputProps> = ({
  label,
  error,
  helperText,
  className = '',
  ...props
}) => {
  return (
    <div className={styles.inputWrapper}>
      {label && <label className={styles.label}>{label}</label>}
      <input
        className={`${styles.input} ${error ? styles.error : ''} ${className}`}
        {...props}
      />
      {error && <span className={styles.errorText}>{error}</span>}
      {helperText && !error && <span className={styles.helperText}>{helperText}</span>}
    </div>
  );
};

export default Input;