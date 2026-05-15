/**
 * Textarea.tsx — Controlled multiline text input with label and validation.
 *
 * Mirrors the Input component API: supports `label`, `error` (red border +
 * message), and `helperText`. All native HTMLTextAreaElement attributes are
 * forwarded via `...props` so rows, maxLength, etc. work without extra wiring.
 */
import React from 'react';
import styles from '../../styles/components/Textarea.module.css';

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

const Textarea: React.FC<TextareaProps> = ({
  label,
  error,
  helperText,
  className = '',
  ...props
}) => {
  return (
    <div className={styles.textareaWrapper}>
      {label && <label className={styles.label}>{label}</label>}
      <textarea
        className={`${styles.textarea} ${error ? styles.error : ''} ${className}`}
        {...props}
      />
      {error && <span className={styles.errorText}>{error}</span>}
      {helperText && !error && <span className={styles.helperText}>{helperText}</span>}
    </div>
  );
};

export default Textarea;