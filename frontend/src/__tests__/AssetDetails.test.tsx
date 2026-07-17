/**
 * AssetDetails.test.tsx — Tests for the AssetDetails page.
 *
 * Covers:
 *   - Asset name and status badge render after load
 *   - Building name from hierarchy renders
 *   - More actions menu exposes Edit and Delete buttons
 *   - ITSM Sync button appears for managed assets
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
import AssetDetails from '../pages/AssetDetails';

jest.mock('qrcode', () => ({
  toDataURL: jest.fn().mockResolvedValue('data:image/png;base64,mock'),
}));
jest.mock('jspdf', () => function JsPDF() {
  return {
    save: jest.fn(), text: jest.fn(), addPage: jest.fn(),
    setFontSize: jest.fn(), setTextColor: jest.fn(),
    internal: { pageSize: { getWidth: () => 210, getHeight: () => 297 } },
  };
});
jest.mock('jspdf-autotable', () => jest.fn());

jest.mock('react-router-dom', () => ({
  useParams:   () => ({ id: 'asset-1' }),
  useNavigate: () => jest.fn(),
  useLocation: () => ({ state: null, pathname: '/assets/asset-1', search: '', hash: '' }),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) =>
    <a href={String(to)}>{children}</a>,
}));

const API = process.env.REACT_APP_API_URL || 'http://localhost:4000/api';

const BASE_ASSET = {
  _id: 'asset-1',
  basic_info: {
    display_name: 'Test IPC',
    type: 'IPC',
    status: 'active',
    manufacturer: 'Beckhoff',
    model: 'CX2020',
    serial_number: 'SN-001',
    asset_tag: 'TAG-001',
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
  maintenance: null,
  software: [],
  created_at: '2024-01-01T00:00:00Z',
  updated_at: '2024-01-01T00:00:00Z',
};

function seedAsset(overrides: Record<string, unknown> = {}) {
  const asset = { ...BASE_ASSET, ...overrides };
  server.use(
    rest.get(`${API}/assets/asset-1`, (_req, res, ctx) =>
      res(ctx.json({ success: true, data: asset })),
    ),
    rest.get(`${API}/assets`, (_req, res, ctx) =>
      res(ctx.json({ success: true, data: [asset] })),
    ),
  );
}

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
            <AssetDetails />
          </ToastProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

describe('AssetDetails — basic rendering', () => {
  it('shows the asset display name', async () => {
    seedAsset();
    renderPage();
    await waitFor(
      () => expect(screen.getAllByText('Test IPC')[0]).toBeInTheDocument(),
      { timeout: 8000 },
    );
  });

  it('shows building name from hierarchy', async () => {
    seedAsset();
    renderPage();
    await waitFor(
      () => expect(screen.getAllByText('WERK1 — Main Production')[0]).toBeInTheDocument(),
      { timeout: 8000 },
    );
  });

  it('shows active status badge', async () => {
    seedAsset();
    renderPage();
    await waitFor(
      () => expect(screen.getByText(/active/i)).toBeInTheDocument(),
      { timeout: 8000 },
    );
  });
});

describe('AssetDetails — overflow menu', () => {
  it('More actions button opens menu with Delete option', async () => {
    seedAsset();
    renderPage();
    await waitFor(() => screen.getAllByText('Test IPC')[0], { timeout: 8000 });
    fireEvent.click(screen.getByRole('button', { name: /more actions/i }));
    expect(
      await screen.findByRole('button', { name: /delete asset/i }),
    ).toBeInTheDocument();
  });

  it('clicking the Edit button opens the edit form', async () => {
    seedAsset();
    renderPage();
    await waitFor(() => screen.getAllByText('Test IPC')[0], { timeout: 8000 });
    fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));
    await waitFor(
      () => expect(screen.getByRole('button', { name: /update asset/i })).toBeInTheDocument(),
      { timeout: 8000 },
    );
  });
});

describe('AssetDetails — ITSM', () => {
  it('shows Sync button for managed assets', async () => {
    seedAsset({
      itsm: {
        is_managed: true,
        hardware_asset_id: 'HA-001',
        last_synced: null,
        sync_status: 'never',
        itsm_guid: null,
      },
    });
    renderPage();
    await waitFor(() => screen.getAllByText('Test IPC')[0], { timeout: 8000 });
    expect(screen.getByRole('button', { name: /sync/i })).toBeInTheDocument();
  });
});
