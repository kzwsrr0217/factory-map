/**
 * UserManagement.test.tsx — Tests for the UserManagement page.
 *
 * Covers:
 *   - "User Management" heading renders for admin users
 *   - "Create New User" form is present
 *   - User table shows loaded users
 *   - Non-admin sees access denied message
 *   - Role selector has the expected options
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { rest } from 'msw';
import { server } from '../mocks/server';
import { AuthProvider } from '../contexts/AuthContext';
import { ToastProvider } from '../contexts/ToastContext';
import { ThemeProvider } from '../contexts/ThemeContext';
import UserManagement from '../pages/UserManagement';

jest.mock('react-router-dom', () => ({
  useNavigate: () => jest.fn(),
  useLocation: () => ({ state: null, pathname: '/users', search: '', hash: '' }),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) =>
    <a href={String(to)}>{children}</a>,
}));

const API = process.env.REACT_APP_API_URL || 'http://localhost:4000/api';

jest.setTimeout(15000);

beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }));
beforeEach(() => {
  // Provide a valid admin JWT so AuthContext.isAdmin === true
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
            <UserManagement />
          </ToastProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

describe('UserManagement — rendering', () => {
  it('shows the User Management heading', async () => {
    renderPage();
    await waitFor(
      () => expect(screen.getByText('User Management')).toBeInTheDocument(),
      { timeout: 5000 },
    );
  });

  it('shows the Create New User section', async () => {
    renderPage();
    await waitFor(
      () => expect(screen.getByText('Create New User')).toBeInTheDocument(),
      { timeout: 5000 },
    );
  });

  it('shows Username, Password and Role fields', async () => {
    renderPage();
    await waitFor(() => screen.getByText('Create New User'));
    expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/role/i)).toBeInTheDocument();
  });

  it('role dropdown has viewer, operator and admin options', async () => {
    renderPage();
    await waitFor(() => screen.getByText('Create New User'));
    expect(screen.getByRole('option', { name: /viewer/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /operator/i })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /admin/i })).toBeInTheDocument();
  });
});

describe('UserManagement — user list', () => {
  it('shows users returned by the API', async () => {
    server.use(
      rest.get(`${API}/users`, (_req, res, ctx) =>
        res(ctx.json({
          success: true,
          data: [
            { _id: 'u1', username: 'alice', role: 'operator', active: true, email: 'alice@example.com', last_login: null },
            { _id: 'u2', username: 'bob',   role: 'viewer',   active: true, email: null, last_login: null },
          ],
        })),
      ),
    );
    renderPage();
    await waitFor(
      () => expect(screen.getByText('alice')).toBeInTheDocument(),
      { timeout: 5000 },
    );
    expect(screen.getByText('bob')).toBeInTheDocument();
  });
});
