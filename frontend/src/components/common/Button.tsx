/**
 * Button.tsx — Primary interactive control.
 *
 * Extends native `<button>` with visual variants, sizes, and a loading state.
 * When `loading` is true the button is also disabled and shows a spinner.
 *
 * Variants: primary | secondary | success | danger | warning | outline
 * Sizes:    sm | md (default) | lg
 * Extra:    fullWidth — stretches to 100% of container.
 *
 * All native HTMLButtonElement attributes are forwarded via `...props`.
 */
import React from 'react';
import styles from '../../styles/components/Button.module.css';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'success' | 'danger' | 'warning' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
  loading?: boolean;
  children: React.ReactNode;
}

const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  loading = false,
  disabled,
  children,
  className = '',
  ...props
}) => {
  const classNames = [
    styles.button,
    styles[variant],
    styles[size],
    fullWidth && styles.fullWidth,
    loading && styles.loading,
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button className={classNames} disabled={disabled || loading} {...props}>
      {loading ? (
        <>
          <span className={styles.spinner}></span>
          <span>Loading...</span>
        </>
      ) : (
        children
      )}
    </button>
  );
};

export default Button;