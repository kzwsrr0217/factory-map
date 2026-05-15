/**
 * ErrorBoundary.tsx — React class-component error boundary.
 *
 * Catches unhandled render-phase errors anywhere in the wrapped subtree and
 * shows a friendly "Something went wrong" UI instead of a blank screen.
 *
 * Props:
 *   children  — The component subtree to protect.
 *   fallback  — Optional custom fallback node; if omitted the built-in error
 *               card is shown.
 *
 * In development (`NODE_ENV === 'development'`) a collapsible `<details>`
 * block renders the raw error message and component stack to aid debugging.
 * The "Try Again" button resets the error state without a full page reload;
 * "Reload Page" triggers `window.location.reload()` as a last resort.
 */
import React, { Component, ReactNode } from 'react';
import Card from './Card';
import Button from './Button';
import styles from '../../styles/components/ErrorBoundary.module.css';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): State {
    return {
      hasError: true,
      error,
      errorInfo: null,
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    this.setState({
      error,
      errorInfo,
    });
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className={styles.errorBoundary}>
          <Card padding="lg" className={styles.errorCard}>
            <div className={styles.errorIcon}>⚠️</div>
            <h2 className={styles.errorTitle}>Oops! Something went wrong</h2>
            <p className={styles.errorMessage}>
              We're sorry for the inconvenience. An unexpected error has occurred.
            </p>

            {process.env.NODE_ENV === 'development' && this.state.error && (
              <details className={styles.errorDetails}>
                <summary>Error Details (Development Only)</summary>
                <div className={styles.errorStack}>
                  <strong>{this.state.error.toString()}</strong>
                  <pre>{this.state.errorInfo?.componentStack}</pre>
                </div>
              </details>
            )}

            <div className={styles.errorActions}>
              <Button variant="outline" onClick={this.handleReset}>
                Try Again
              </Button>
              <Button variant="primary" onClick={this.handleReload}>
                Reload Page
              </Button>
            </div>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;