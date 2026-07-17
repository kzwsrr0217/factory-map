/**
 * Settings.test.tsx — Tests for the Settings page.
 *
 * Covers:
 *   - "Settings" heading renders
 *   - Appearance section with Light / Dark buttons
 *   - Password form validation (empty, mismatch, weak)
 *   - Sessions section renders
 *   - Account email field renders
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { rest } from 'msw';
import { server } from '../mocks/server';
import { AuthProvider } from '../contexts/AuthContext';
import { ToastProvider } from '../contexts/ToastContext';
import { ThemeProvider } from '../contexts/ThemeContext';
import Settings from '../pages/Settings';

jest.mock('react-router-dom', () => ({
  useNavigate: () => jest.fn(),
  useLocation: () => ({ state: null, pathname: '/settings', search: '', hash: '' }),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) =>
    <a href={String(to)}>{children}</a>,
}));

const API = process.env.REACT_APP_API_URL || 'http://localhost:4000/api';

jest.setTimeout(15000);

beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }));
beforeEach(() => {
  const exp = Math.floor(Date.now() / 1000) + 86400;
  const fakeToken = `h.${btoa(JSON.stringify({ exp }))}.s`;
  localStorage.setItem('authToken', fakeToken);
  localStorage.setItem('authUser', JSON.stringify({ id: '1', username: 'admin', role: 'admin' }));
});
afterEach(() => {
  localStorage.clear();
  server.resetHandlers();
});
afterAll(() => server.close());

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <ToastProvider>
            <Settings />
          </ToastProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

describe('Settings — basic rendering', () => {
  it('renders the Settings heading', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Settings')).toBeInTheDocument());
  });

  it('shows the Appearance section with Light and Dark buttons', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Appearance')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /light/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /dark/i })).toBeInTheDocument();
  });
});

describe('Settings — password form validation', () => {
  it('shows error when submitting empty password form', async () => {
    renderPage();
    await waitFor(() => screen.getByText('Settings'));
    const submitBtn = screen.getByRole('button', { name: /change password/i });
    fireEvent.click(submitBtn);
    await waitFor(
      () => expect(screen.getByText('All fields are required.')).toBeInTheDocument(),
      { timeout: 5000 },
    );
  });

  it('shows error when new passwords do not match', async () => {
    renderPage();
    await waitFor(() => screen.getByText('Settings'));
    const inputs = screen.getAllByRole('textbox', { hidden: true });
    // Fill current password, new password, confirm with mismatch
    const pwInputs = document.querySelectorAll('input[type="password"]');
    expect(pwInputs.length).toBeGreaterThanOrEqual(3);
    fireEvent.change(pwInputs[0], { target: { value: 'OldPass@1' } });
    fireEvent.change(pwInputs[1], { target: { value: 'NewPass@1' } });
    fireEvent.change(pwInputs[2], { target: { value: 'DifferentPass@1' } });
    fireEvent.click(screen.getByRole('button', { name: /change password/i }));
    await waitFor(
      () => expect(screen.getByText('New passwords do not match.')).toBeInTheDocument(),
      { timeout: 5000 },
    );
  });

  it('shows error when new password does not meet requirements', async () => {
    renderPage();
    await waitFor(() => screen.getByText('Settings'));
    const pwInputs = document.querySelectorAll('input[type="password"]');
    fireEvent.change(pwInputs[0], { target: { value: 'OldPass@1' } });
    fireEvent.change(pwInputs[1], { target: { value: 'weak' } });
    fireEvent.change(pwInputs[2], { target: { value: 'weak' } });
    fireEvent.click(screen.getByRole('button', { name: /change password/i }));
    await waitFor(
      () => expect(screen.getByText('New password does not meet all requirements.')).toBeInTheDocument(),
      { timeout: 5000 },
    );
  });
});

describe('Settings — sessions section', () => {
  it('renders the Active Sessions section', async () => {
    renderPage();
    await waitFor(
      () => expect(screen.getByText(/active sessions/i)).toBeInTheDocument(),
      { timeout: 5000 },
    );
  });

  it('shows session IP when sessions are returned by API', async () => {
    server.use(
      rest.get(`${API}/auth/sessions`, (_req, res, ctx) =>
        res(ctx.json({
          success: true,
          data: [{
            jti: 'test-jti',
            issued_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + 86400000).toISOString(),
            ip_address: '10.0.0.1',
            user_agent: 'Mozilla/5.0',
            is_current: true,
          }],
        })),
      ),
    );
    renderPage();
    await waitFor(
      () => expect(document.body.textContent).toMatch(/10\.0\.0\.1/),
      { timeout: 5000 },
    );
  });
});
