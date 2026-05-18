/**
 * UserManagement.test.tsx — Tests for the User Management admin page.
 *
 * Covers:
 *   - User table renders with loaded users
 *   - Current user row is marked with "(you)"
 *   - Non-admin user sees "access denied" message
 *   - Password hints appear while typing; all pass for a strong password
 *   - Deactivate button opens a confirm dialog
 *   - Inactive user shows an Activate button
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { rest } from 'msw';
import { server } from '../mocks/server';
import { ToastProvider } from '../contexts/ToastContext';
import { ThemeProvider } from '../contexts/ThemeContext';
import { useAuth } from '../contexts/AuthContext';
import UserManagement from '../pages/UserManagement';

const API = process.env.REACT_APP_API_URL || 'http://localhost:4000/api';

// Control auth state without requiring real JWTs or localStorage
jest.mock('../contexts/AuthContext', () => ({
  useAuth: jest.fn(),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const mockUseAuth = useAuth as jest.Mock;

const ADMIN_AUTH = {
  user: { id: '1', username: 'admin', role: 'admin' as const },
  token: 'mock-token',
  isAuthenticated: true,
  isAdmin: true,
  isOperator: true,
  passwordExpired: false,
  login: jest.fn(),
  logout: jest.fn(),
  clearPasswordExpired: jest.fn(),
};

jest.mock('react-router-dom', () => ({
  useNavigate: () => jest.fn(),
  useLocation: () => ({ pathname: '/users', search: '', hash: '', state: null }),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) =>
    <a href={String(to)}>{children}</a>,
}));

jest.mock('jspdf', () => function JsPDF() {
  return {
    save: jest.fn(), text: jest.fn(), addPage: jest.fn(),
    setFontSize: jest.fn(), setTextColor: jest.fn(),
    internal: { pageSize: { getWidth: () => 210, getHeight: () => 297 } },
  };
});
jest.mock('jspdf-autotable', () => jest.fn());

const SEED_USERS = [
  {
    _id: '1', username: 'admin', email: 'admin@example.com',
    role: 'admin' as const, active: true,
    last_login: null, password_changed_at: null, failed_login_attempts: 0, locked_until: null,
  },
  {
    _id: '2', username: 'alice_op', email: null,
    role: 'operator' as const, active: true,
    last_login: null, password_changed_at: null, failed_login_attempts: 0, locked_until: null,
  },
  {
    _id: '3', username: 'bob_inactive', email: null,
    role: 'viewer' as const, active: false,
    last_login: null, password_changed_at: null, failed_login_attempts: 0, locked_until: null,
  },
];

beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }));
beforeEach(() => mockUseAuth.mockReturnValue(ADMIN_AUTH));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ToastProvider>
          <UserManagement />
        </ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

function seedUsers(users = SEED_USERS) {
  server.use(
    rest.get(`${API}/users`, (_req, res, ctx) =>
      res(ctx.json({ success: true, data: users })),
    ),
  );
}

// ── Rendering ─────────────────────────────────────────────────────────────────

describe('UserManagement — rendering', () => {
  it('renders the Create New User heading', () => {
    seedUsers();
    renderPage();
    expect(screen.getByText('Create New User')).toBeInTheDocument();
  });

  it('renders all users in the table after load', async () => {
    seedUsers();
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('alice_op')).toBeInTheDocument();
      expect(screen.getByText('bob_inactive')).toBeInTheDocument();
    }, { timeout: 4000 });
  });

  it('marks the current admin user with "(you)"', async () => {
    seedUsers();
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('(you)')).toBeInTheDocument();
    }, { timeout: 4000 });
  });
});

// ── Access control ────────────────────────────────────────────────────────────

describe('UserManagement — access control', () => {
  it('shows access denied for non-admin users', () => {
    mockUseAuth.mockReturnValue({
      ...ADMIN_AUTH,
      user: { id: '2', username: 'alice_op', role: 'operator' as const },
      isAdmin: false,
      isOperator: true,
    });
    renderPage();
    expect(screen.getByText(/don't have permission/i)).toBeInTheDocument();
  });
});

// ── Password hints ────────────────────────────────────────────────────────────

describe('UserManagement — password hints', () => {
  it('shows password rule hints when typing in the password field', () => {
    seedUsers();
    renderPage();
    const pwInput = screen.getByLabelText(/^password$/i);
    fireEvent.change(pwInput, { target: { value: 'abc' } });
    expect(screen.getByText(/at least 8 characters/i)).toBeInTheDocument();
    expect(screen.getByText(/one uppercase letter/i)).toBeInTheDocument();
    expect(screen.getByText(/one number/i)).toBeInTheDocument();
  });

  it('marks all 5 rules as passing for a strong password', () => {
    seedUsers();
    renderPage();
    const pwInput = screen.getByLabelText(/^password$/i);
    fireEvent.change(pwInput, { target: { value: 'StrongPass@1' } });
    const passedHints = document.querySelectorAll('[class*="pwHintOk"]');
    expect(passedHints.length).toBe(5);
  });
});

// ── Deactivate flow ───────────────────────────────────────────────────────────

describe('UserManagement — deactivate', () => {
  it('clicking Deactivate opens a confirm dialog', async () => {
    seedUsers();
    renderPage();
    await waitFor(() => screen.getByText('alice_op'), { timeout: 4000 });

    const deactivateBtn = screen.getAllByRole('button', { name: /deactivate/i })[0];
    fireEvent.click(deactivateBtn);

    await waitFor(() => {
      expect(screen.getByText(/are you sure you want to deactivate/i)).toBeInTheDocument();
    });
  });
});

// ── Activate ──────────────────────────────────────────────────────────────────

describe('UserManagement — activate', () => {
  it('shows Activate button for inactive users', async () => {
    seedUsers();
    renderPage();
    await waitFor(() => screen.getByText('bob_inactive'), { timeout: 4000 });
    expect(screen.getByRole('button', { name: /^activate$/i })).toBeInTheDocument();
  });
});
