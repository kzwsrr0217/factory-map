/**
 * AuditLog.test.tsx — Tests for the AuditLog page.
 *
 * Covers:
 *   - "Audit Log" heading renders
 *   - Export CSV button present
 *   - Empty state message when no entries
 *   - Filter panel controls (username input, action select)
 *   - Pagination row when total > 50
 *   - Entries render when data is seeded
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
import AuditLog from '../pages/AuditLog';

jest.mock('react-router-dom', () => ({
  useNavigate: () => jest.fn(),
  useLocation: () => ({ state: null, pathname: '/audit', search: '', hash: '' }),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) =>
    <a href={String(to)}>{children}</a>,
}));

const API = process.env.REACT_APP_API_URL || 'http://localhost:4000/api';

const makeEntry = (i: number) => ({
  _id: `entry-${i}`,
  user_id: 'user-1',
  username: 'admin',
  action: 'create' as const,
  entity_type: 'asset',
  document_id: `doc-${i}`,
  ip_address: '10.0.0.1',
  timestamp: new Date(Date.now() - i * 60000).toISOString(),
});

jest.setTimeout(15000);

beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }));
afterEach(() => server.resetHandlers());
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
            <AuditLog />
          </ToastProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

describe('AuditLog — basic rendering', () => {
  it('renders the Audit Log heading', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Audit Log')).toBeInTheDocument());
  });

  it('shows Export CSV button', async () => {
    renderPage();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /export csv/i })).toBeInTheDocument(),
    );
  });

  it('shows empty state when no entries', async () => {
    renderPage();
    await waitFor(
      () => expect(screen.getByText(/no audit entries yet/i)).toBeInTheDocument(),
      { timeout: 5000 },
    );
  });
});

describe('AuditLog — filter panel', () => {
  it('has a username filter input', async () => {
    renderPage();
    await waitFor(() => screen.getByText('Audit Log'));
    expect(screen.getByPlaceholderText(/any user/i)).toBeInTheDocument();
  });

  it('has an action filter select with "All actions" default', async () => {
    renderPage();
    await waitFor(() => screen.getByText('Audit Log'));
    expect(screen.getByDisplayValue('All actions')).toBeInTheDocument();
  });

  it('has Apply and Clear buttons', async () => {
    renderPage();
    await waitFor(() => screen.getByText('Audit Log'));
    expect(screen.getByRole('button', { name: /apply/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /clear/i })).toBeInTheDocument();
  });
});

describe('AuditLog — with data', () => {
  it('renders entries when the API returns them', async () => {
    server.use(
      rest.get(`${API}/audit`, (_req, res, ctx) =>
        res(ctx.json({
          success: true,
          data: [makeEntry(1), makeEntry(2)],
          total: 2,
          limit: 50,
          offset: 0,
        })),
      ),
    );
    renderPage();
    await waitFor(
      () => expect(screen.getAllByText('admin').length).toBeGreaterThan(0),
      { timeout: 5000 },
    );
  });

  it('shows pagination row when total > 50', async () => {
    const entries = Array.from({ length: 50 }, (_, i) => makeEntry(i + 1));
    server.use(
      rest.get(`${API}/audit`, (_req, res, ctx) =>
        res(ctx.json({
          success: true,
          data: entries,
          total: 150,
          limit: 50,
          offset: 0,
        })),
      ),
    );
    renderPage();
    await waitFor(
      () => expect(screen.getAllByText(/page 1 of 3/i)[0]).toBeInTheDocument(),
      { timeout: 5000 },
    );
    expect(screen.getAllByText(/← prev/i)[0]).toBeInTheDocument();
    expect(screen.getAllByText(/next →/i)[0]).toBeInTheDocument();
  });
});
