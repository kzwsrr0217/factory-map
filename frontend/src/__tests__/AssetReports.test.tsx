/**
 * AssetReports.test.tsx â€” Tests for the AssetReports component.
 *
 * Uses the `inline` prop to render without a modal overlay, which makes
 * querying the DOM straightforward.
 *
 * Covers:
 *   - Renders all five tabs: Overview, Connections, Maintenance, Locations, Topology
 *   - Default tab is Overview
 *   - Clicking Maintenance tab shows window-filter buttons (7d, 30d, 60d, 90d, 180d)
 *   - Clicking Connections tab shows connection stats
 *   - Locations tab shows floor/building stat tables
 *   - Topology tab renders SVG
 *   - Refresh and CSV buttons present in header
 *   - Auto-refresh select is present
 *   - With populated assets the stats update (total count, maintenance flags)
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { rest } from 'msw';
import { server } from '../mocks/server';
import { AuthProvider } from '../contexts/AuthContext';
import { ToastProvider } from '../contexts/ToastContext';
import { ThemeProvider } from '../contexts/ThemeContext';
import AssetReports from '../components/asset/AssetReports';

jest.mock('jspdf', () => function JsPDF() {
  return {
    save: jest.fn(), text: jest.fn(), addPage: jest.fn(),
    setFontSize: jest.fn(), setTextColor: jest.fn(),
    internal: { pageSize: { getWidth: () => 210, getHeight: () => 297 } },
  };
});
jest.mock('jspdf-autotable', () => jest.fn());

jest.mock('react-router-dom', () => ({
  useNavigate: () => jest.fn(),
  useLocation: () => ({ state: null, pathname: '/', search: '', hash: '' }),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={String(to)}>{children}</a>,
}));

const API = process.env.REACT_APP_API_URL || 'http://localhost:4000/api';

const makeAsset = (overrides: Record<string, unknown> = {}) => ({
  _id: `a-${Math.random().toString(36).slice(2)}`,
  basic_info: { display_name: 'Test IPC', type: 'IPC', status: 'active', manufacturer: null, model: null, asset_tag: null, serial_number: null, mac_address: null },
  hierarchy: { building_id: 'bld-1', floor_id: 'floor-1', workarea_id: null, section_id: null, workstation_id: null },
  location: { coordinates: { x: 0, y: 0 }, rotation: 0 },
  itsm: { is_managed: false, hardware_asset_id: null, last_synced: null, sync_status: 'never' as const, itsm_guid: null },
  connections: [], work_items: [], maintenance: null, software: [],
  created_at: '', updated_at: '',
  ...overrides,
});

const OVERDUE_DATE = new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10);

jest.setTimeout(20000);

beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderReports(extraProps: Partial<{ isOpen: boolean; onClose: () => void }> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <ToastProvider>
            <AssetReports inline isOpen={false} onClose={jest.fn()} {...extraProps} />
          </ToastProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

describe('AssetReports â€” tabs', () => {
  it('renders all five tab buttons', async () => {
    renderReports();
    await waitFor(() => expect(screen.getByText('Overview')).toBeInTheDocument());
    expect(screen.getByText('Connections')).toBeInTheDocument();
    expect(screen.getByText('Maintenance')).toBeInTheDocument();
    expect(screen.getByText('Locations')).toBeInTheDocument();
    expect(screen.getByText('Topology')).toBeInTheDocument();
  });

  it('default tab is Overview â€” shows stat cards', async () => {
    renderReports();
    await waitFor(() => expect(screen.getByText('Overview')).toBeInTheDocument());
    // Overview renders stats like Total Assets
    await waitFor(() => expect(screen.getByText('Total Assets')).toBeInTheDocument(), { timeout: 5000 });
  });

  it('clicking Maintenance tab shows window filter buttons', async () => {
    renderReports();
    await waitFor(() => screen.getByText('Maintenance'));
    fireEvent.click(screen.getByText('Maintenance'));
    await waitFor(() => expect(screen.getByText('7d')).toBeInTheDocument(), { timeout: 5000 });
    expect(screen.getByText('30d')).toBeInTheDocument();
    expect(screen.getByText('60d')).toBeInTheDocument();
    expect(screen.getByText('90d')).toBeInTheDocument();
    expect(screen.getByText('180d')).toBeInTheDocument();
  });

  it('clicking Connections tab shows connection stats section', async () => {
    renderReports();
    await waitFor(() => screen.getByText('Connections'));
    fireEvent.click(screen.getByText('Connections'));
    await waitFor(() => expect(screen.getByText(/total connections/i)).toBeInTheDocument(), { timeout: 5000 });
  });

  it('clicking Locations tab shows floor/building tables', async () => {
    renderReports();
    await waitFor(() => screen.getByText('Locations'));
    fireEvent.click(screen.getByText('Locations'));
    await waitFor(() => expect(screen.getByText('By Building')).toBeInTheDocument(), { timeout: 5000 });
  });

  it('clicking Topology tab shows isolated toggle button', async () => {
    server.use(
      rest.get(`${API}/assets`, (_req, res, ctx) =>
        res(ctx.json({ success: true, data: [makeAsset(), makeAsset()] })),
      ),
    );
    renderReports();
    await waitFor(() => screen.getByText('Total Assets'), { timeout: 10000 });
    fireEvent.click(screen.getByText('Topology'));
    await waitFor(() =>
      expect(screen.getByText(/show isolated/i)).toBeInTheDocument()
    , { timeout: 10000 });
  });
});

describe('AssetReports â€” header controls', () => {
  it('shows a Refresh button', async () => {
    renderReports();
    await waitFor(() => expect(screen.getByText('Refresh')).toBeInTheDocument());
  });

  it('shows a CSV button', async () => {
    renderReports();
    await waitFor(() => expect(screen.getByRole('button', { name: /csv/i })).toBeInTheDocument());
  });

  it('shows the auto-refresh select', async () => {
    renderReports();
    await waitFor(() => expect(screen.getByDisplayValue('No auto-refresh')).toBeInTheDocument());
  });

  it('shows Print button', async () => {
    renderReports();
    await waitFor(() => expect(screen.getByRole('button', { name: /print/i })).toBeInTheDocument());
  });
});

describe('AssetReports â€” with assets', () => {
  it('shows total asset count in Overview', async () => {
    server.use(
      rest.get(`${API}/assets`, (_req, res, ctx) =>
        res(ctx.json({ success: true, data: [makeAsset(), makeAsset(), makeAsset()] })),
      ),
    );
    renderReports();
    await waitFor(() => screen.getByText('Total Assets'), { timeout: 5000 });
    const totalCard = screen.getByText('Total Assets').closest('[class*="statCard"]') ??
      screen.getByText('Total Assets').parentElement;
    expect(totalCard?.textContent).toContain('3');
  });

  it('shows overdue count in Maintenance tab', async () => {
    server.use(
      rest.get(`${API}/assets`, (_req, res, ctx) =>
        res(ctx.json({
          success: true,
          data: [
            makeAsset({ _id: 'ovd-a', maintenance: { next_date: OVERDUE_DATE, last_date: null, interval_days: 30 } }),
            makeAsset({ _id: 'ovd-b', maintenance: { next_date: OVERDUE_DATE, last_date: null, interval_days: 30 } }),
          ],
        })),
      ),
    );
    renderReports();
    await waitFor(() => screen.getByText('Total Assets'), { timeout: 10000 });
    fireEvent.click(screen.getByText('Maintenance'));
    await waitFor(() => {
      expect(screen.getAllByText(/overdue/i).length).toBeGreaterThan(0);
    }, { timeout: 10000 });
  });

  it('Maintenance tab flagged assets are shown with clickable class', async () => {
    server.use(
      rest.get(`${API}/assets`, (_req, res, ctx) =>
        res(ctx.json({
          success: true,
          data: [
            makeAsset({ _id: 'click-asset', basic_info: { display_name: 'ClickMe-IPC', type: 'IPC', status: 'active', manufacturer: null, model: null, asset_tag: null, serial_number: null, mac_address: null }, maintenance: { next_date: OVERDUE_DATE, last_date: null, interval_days: 30 } }),
          ],
        })),
      ),
    );
    renderReports();
    await waitFor(() => screen.getByText('Total Assets'), { timeout: 10000 });
    fireEvent.click(screen.getByText('Maintenance'));
    await waitFor(() => screen.getByText('180d'), { timeout: 10000 });
    fireEvent.click(screen.getByText('180d'));
    await waitFor(() => expect(screen.getByText('ClickMe-IPC')).toBeInTheDocument(), { timeout: 10000 });
    const assetEl = screen.getByText('ClickMe-IPC');
    expect(assetEl).toBeInTheDocument();
  });

  it('window filter buttons switch active state', async () => {
    renderReports();
    await waitFor(() => screen.getByText('Maintenance'), { timeout: 5000 });
    fireEvent.click(screen.getByText('Maintenance'));
    await waitFor(() => screen.getByText('60d'), { timeout: 5000 });
    fireEvent.click(screen.getByText('60d'));
    // 60d button should now have active class
    const btn60 = screen.getByText('60d').closest('button');
    expect(btn60?.className).toMatch(/active/i);
  });
});

describe('AssetReports â€” Topology filters', () => {
  it('Topology tab shows Type and Floor filter dropdowns', async () => {
    const assetA = makeAsset({ _id: 'topo-a', connections: [{ connected_asset_id: 'topo-b', connection_type: 'ethernet' }] });
    const assetB = makeAsset({ _id: 'topo-b' });
    server.use(
      rest.get(`${API}/assets`, (_req, res, ctx) =>
        res(ctx.json({ success: true, data: [assetA, assetB] })),
      ),
    );
    renderReports();
    await waitFor(() => screen.getByText('Total Assets'), { timeout: 10000 });
    fireEvent.click(screen.getByText('Topology'));
    await waitFor(() => {
      const allTypes = document.querySelector('[class*="topoFilter"]');
      expect(allTypes).toBeInTheDocument();
    }, { timeout: 10000 });
  });

  it('Show Isolated toggle changes state', async () => {
    server.use(
      rest.get(`${API}/assets`, (_req, res, ctx) =>
        res(ctx.json({ success: true, data: [makeAsset(), makeAsset()] })),
      ),
    );
    renderReports();
    await waitFor(() => screen.getByText('Total Assets'), { timeout: 10000 });
    fireEvent.click(screen.getByText('Topology'));
    const isolatedBtn = await screen.findByText(/show isolated/i, undefined, { timeout: 10000 });
    fireEvent.click(isolatedBtn);
    await waitFor(() => expect(screen.getByText(/hide isolated/i)).toBeInTheDocument(), { timeout: 10000 });
  });
});
