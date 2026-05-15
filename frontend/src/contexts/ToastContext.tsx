/**
 * ToastContext.tsx — Application-wide notification toasts.
 *
 * Provides `useToast()` with convenience methods:
 *   `success(message)`, `error(message)`, `warning(message)`, `info(message)`,
 *   `showToast(message, type?)` — generic form.
 *
 * Toasts are rendered in a fixed bottom-right overlay by the inline `ToastContainer`.
 * Each toast auto-dismisses after 4 seconds and can also be manually dismissed.
 * The counter ref prevents ID collisions when multiple toasts are shown quickly.
 *
 * All styling uses CSS custom properties (`--color-bg-primary`, `--color-text-primary`)
 * so toasts adapt correctly to light and dark themes.
 */
import React, { createContext, useContext, useState, useCallback, useRef } from 'react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

interface ToastContextType {
  showToast: (message: string, type?: ToastType) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  warning: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counter = useRef(0);

  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = ++counter.current;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const ctx: ToastContextType = {
    showToast,
    success: useCallback((m) => showToast(m, 'success'), [showToast]),
    error:   useCallback((m) => showToast(m, 'error'),   [showToast]),
    warning: useCallback((m) => showToast(m, 'warning'), [showToast]),
    info:    useCallback((m) => showToast(m, 'info'),    [showToast]),
  };

  return (
    <ToastContext.Provider value={ctx}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
};

// ── Inline container ───────────────────────────────────────────────────────
const ICONS: Record<ToastType, string> = {
  success: '✓',
  error:   '✕',
  warning: '⚠',
  info:    'ℹ',
};

const COLORS: Record<ToastType, string> = {
  success: '#22c55e',
  error:   '#ef4444',
  warning: '#f59e0b',
  info:    '#3b82f6',
};

const ToastContainer: React.FC<{
  toasts: Toast[];
  onDismiss: (id: number) => void;
}> = ({ toasts, onDismiss }) => {
  if (toasts.length === 0) return null;

  return (
    <div style={{
      position: 'fixed',
      bottom: '1.5rem',
      right: '1.5rem',
      zIndex: 99999,
      display: 'flex',
      flexDirection: 'column',
      gap: '0.5rem',
      maxWidth: '360px',
      pointerEvents: 'none',
    }}>
      {toasts.map((toast) => (
        <div
          key={toast.id}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.625rem',
            padding: '0.75rem 1rem',
            background: 'var(--color-bg-primary, #fff)',
            border: `1px solid ${COLORS[toast.type]}`,
            borderLeft: `4px solid ${COLORS[toast.type]}`,
            borderRadius: '8px',
            boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
            fontSize: '0.9rem',
            color: 'var(--color-text-primary, #111)',
            animation: 'toastIn 0.2s ease-out',
            pointerEvents: 'all',
          }}
        >
          <span style={{
            color: COLORS[toast.type],
            fontWeight: 700,
            fontSize: '1rem',
            flexShrink: 0,
            width: 18,
            textAlign: 'center',
          }}>
            {ICONS[toast.type]}
          </span>
          <span style={{ flex: 1, lineHeight: 1.4 }}>{toast.message}</span>
          <button
            onClick={() => onDismiss(toast.id)}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--color-text-secondary, #666)',
              fontSize: '1rem',
              padding: '0 2px',
              flexShrink: 0,
            }}
          >
            ✕
          </button>
        </div>
      ))}
      <style>{`
        @keyframes toastIn {
          from { opacity: 0; transform: translateX(20px); }
          to   { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </div>
  );
};
