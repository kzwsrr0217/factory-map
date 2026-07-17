/**
 * Maintenance.test.tsx — Tests for the Maintenance calendar page.
 *
 * Covers:
 *   - Page heading renders
 *   - Month navigation buttons (Today)
 *   - Weekday headers visible
 *   - Overdue section shows overdue assets
 *   - Overdue asset appears in both overdue panel and calendar cell (getAllByText)
 *   - Collapsing the overdue panel hides the list
 *   - Switching to list view changes heading
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
import Maintenance from '../pages/Maintenance';

jest.mock('react-router-dom', () => ({
  useNavigate: () => jest.fn(),
  useLocation: () => ({ state: null, pathname: '/maintenance', search: '', hash: '' }),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) =>
    <a href={String(to)}>{children}</a>,
}));

const API = process.env.REACT_APP_API_URL || 'http://localhost:4000/api';

// 10 days in the past: overdue AND within the current calendar month
const OVERDUE_DATE = new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10);

const makeAsset = (id: string, displayName: string, nextDate: string) => ({
  _id: id,
  basic_info: {
    display_name: displayName,
    type: 'IPC',
    status: 'active',
    manufacturer: null,
    model: null,
    asset_tag: null,
    serial_number: null,
    mac_address: null,
  },
  hierarchy: {
    building_id: 'bld-1',
    floor_id: 'floor-1',
    workarea_id: null,
    section_id: null,
    workstation_id: null,
  },
  location: { coordinates: { x: 0, y: 0 }, rotation: 0 },
  itsm: {
    is_managed: false,
    hardware_asset_id: null,
    last_synced: null,
    sync_status: 'never' as const,
    itsm_guid: null,
  },
  connections: [],
  work_items: [],
  maintenance: { next_date: nextDate, last_date: null, interval_days: 30 },
  software: [],
  created_at: '',
  updated_at: '',
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
            <Maintenance />
          </ToastProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

describe('Maintenance — page rendering', () => {
  it('renders the Maintenance heading', async () => {
    renderPage();
    await waitFor(
      () => expect(screen.getByText(/maintenance/i)).toBeInTheDocument(),
    );
  });

  it('shows Today navigation button', async () => {
    renderPage();
    await waitFor(
      () => expect(screen.getByRole('button', { name: /today/i })).toBeInTheDocument(),
      { timeout: 5000 },
    );
  });

  it('renders weekday headers', async () => {
    renderPage();
    await waitFor(
      () => expect(screen.getByText('Mon')).toBeInTheDocument(),
      { timeout: 5000 },
    );
    expect(screen.getByText('Fri')).toBeInTheDocument();
  });
});

describe('Maintenance — overdue section', () => {
  it('overdue asset appears in overdue panel', async () => {
    server.use(
      rest.get(`${API}/assets`, (_req, res, ctx) =>
        res(ctx.json({
          success: true,
          data: [
            makeAsset('ovd-1', 'Asset-ovd-1', OVERDUE_DATE),
            makeAsset('ovd-2', 'Asset-ovd-2', OVERDUE_DATE),
          ],
        })),
      ),
    );
    renderPage();
    await waitFor(
      () => expect(screen.getAllByText('Asset-ovd-2')[0]).toBeInTheDocument(),
      { timeout: 8000 },
    );
  });

  it('collapsing overdue panel hides the list', async () => {
    server.use(
      rest.get(`${API}/assets`, (_req, res, ctx) =>
        res(ctx.json({
          success: true,
          data: [makeAsset('ovd-3', 'Asset-ovd-3', OVERDUE_DATE)],
        })),
      ),
    );
    renderPage();
    await waitFor(
      () => expect(document.querySelector('[class*="overdueList"]')).toBeInTheDocument(),
      { timeout: 8000 },
    );
    fireEvent.click(screen.getByRole('button', { name: /overdue asset/i }));
    await waitFor(
      () => expect(document.querySelector('[class*="overdueList"]')).not.toBeInTheDocument(),
      { timeout: 5000 },
    );
  });
});

describe('Maintenance — view toggle', () => {
  it('switching to list view changes heading to Work Orders', async () => {
    renderPage();
    await waitFor(
      () => screen.getByRole('button', { name: /today/i }),
      { timeout: 5000 },
    );
    const viewBtns = document.querySelectorAll('[class*="viewBtn"]');
    expect(viewBtns.length).toBeGreaterThanOrEqual(2);
    fireEvent.click(viewBtns[1]);
    await waitFor(
      () => expect(screen.getByText(/work orders/i)).toBeInTheDocument(),
      { timeout: 5000 },
    );
  });
});
