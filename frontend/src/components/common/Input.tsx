/**
 * Input.tsx — Controlled text input with label, validation, and helper text.
 *
 * Extends all native `<input>` attributes. When `error` is set the input
 * border turns red and the error message is displayed below the field;
 * `helperText` shows secondary guidance when there is no error.
 *
 * The label is tied to the input with `htmlFor`, using the `id` the consumer passed or a
 * generated one. It used to be left unassociated on the reasoning that the two share a
 * wrapper — which is not what a label does: clicking it did not focus the field, a screen
 * reader announced an unlabelled box, and a test asking for the field by its visible label
 * could not find it. Every form in the app uses this component, so it is worth being right
 * here rather than per caller.
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
  id,
  ...props
}) => {
  const generatedId = React.useId();
  const inputId = id ?? generatedId;
  const describedBy = error ? `${inputId}-error` : (helperText ? `${inputId}-helper` : undefined);

  return (
    <div className={styles.inputWrapper}>
      {label && <label className={styles.label} htmlFor={inputId}>{label}</label>}
      <input
        id={inputId}
        className={`${styles.input} ${error ? styles.error : ''} ${className}`}
        // So the message under the field is read out with it, not left as decoration.
        aria-describedby={describedBy}
        aria-invalid={error ? true : undefined}
        {...props}
      />
      {error && <span id={`${inputId}-error`} className={styles.errorText}>{error}</span>}
      {helperText && !error && (
        <span id={`${inputId}-helper`} className={styles.helperText}>{helperText}</span>
      )}
    </div>
  );
};

export default Input;
