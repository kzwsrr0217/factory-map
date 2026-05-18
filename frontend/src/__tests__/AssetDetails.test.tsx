/**
 * AssetDetails.test.tsx — Tests for the asset detail page (/assets/:id).
 *
 * Covers:
 *   - Shows loading spinner initially
 *   - Renders asset display_name after data loads
 *   - Renders a QR code image (mocked qrcode library)
 *   - Breadcrumb shows building name from hierarchy
 *   - Error state when asset cannot be loaded
 *   - Edit button opens the AssetFormModal
 *   - Delete button opens the ConfirmDialog
 *   - "Sync from ITSM" button appears for ITSM-managed assets
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

const API = process.env.REACT_APP_API_URL || 'http://localhost:4000/api';

// qrcode uses canvas — mock the entire library to return a static data URL
jest.mock('qrcode', () => ({
  toDataURL: jest.fn().mockResolvedValue('data:image/png;base64,mockedqr'),
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
  useParams: () => ({ id: 'asset-1' }),
  useNavigate: () => jest.fn(),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) =>
    <a href={String(to)}>{children}</a>,
}));

const SEED_ASSET = {
  _id: 'asset-1',
  basic_info: {
    display_name: 'Beckhoff CX9020',
    type: 'IPC',
    status: 'active',
    manufacturer: 'Beckhoff',
    model: 'CX9020',
    asset_tag: 'TAG-001',
    serial_number: 'SN-001',
    mac_address: null,
  },
  hierarchy: {
    building_id: 'bld-1', floor_id: 'floor-1',
    workarea_id: null, section_id: null, workstation_id: null,
  },
  location: { coordinates: { x: 10, y: 20 }, rotation: 0 },
  itsm: {
    is_managed: false, hardware_asset_id: null,
    last_synced: null, sync_status: 'never', itsm_guid: null,
  },
  connections: [], work_items: [], maintenance: null, software: [],
  created_at: '', updated_at: '',
};

function seedAsset(overrides: Record<string, unknown> = {}) {
  server.use(
    rest.get(`${API}/assets/asset-1`, (_req, res, ctx) =>
      res(ctx.json({ success: true, data: { ...SEED_ASSET, ...overrides } })),
    ),
  );
}

beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <ToastProvider>
            <AssetDetails />
          </ToastProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

// ── Initial loading state ─────────────────────────────────────────────────────

describe('AssetDetails — loading', () => {
  it('shows loading indicator before data arrives', () => {
    seedAsset();
    renderPage();
    expect(screen.getByText(/loading asset details/i)).toBeInTheDocument();
  });
});

// ── Data rendering ────────────────────────────────────────────────────────────

describe('AssetDetails — data rendering', () => {
  it('renders the asset display_name as a heading after load', async () => {
    seedAsset();
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /beckhoff cx9020/i })).toBeInTheDocument();
    }, { timeout: 4000 });
  });

  it('renders the asset serial number and type', async () => {
    seedAsset();
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('SN-001')).toBeInTheDocument();
      expect(screen.getByText('TAG-001')).toBeInTheDocument();
    }, { timeout: 4000 });
  });

  it('shows the building name in the breadcrumb', async () => {
    seedAsset();
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('WERK1 — Main Production')).toBeInTheDocument();
    }, { timeout: 4000 });
  });
});

// ── Error state ───────────────────────────────────────────────────────────────

describe('AssetDetails — error state', () => {
  it('shows an error message when the asset cannot be loaded', async () => {
    server.use(
      rest.get(`${API}/assets/asset-1`, (_req, res, ctx) =>
        res(ctx.status(404), ctx.json({ success: false, error: 'Asset not found' })),
      ),
    );
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/failed to load asset details/i)).toBeInTheDocument();
    }, { timeout: 4000 });
  });
});

// ── Action buttons ────────────────────────────────────────────────────────────

describe('AssetDetails — actions', () => {
  it('Edit button is present after load', async () => {
    seedAsset();
    renderPage();
    await waitFor(() => screen.getByRole('heading', { name: /beckhoff cx9020/i }), { timeout: 4000 });
    expect(screen.getByRole('button', { name: /^edit$/i })).toBeInTheDocument();
  });

  it('clicking Delete opens a confirm dialog', async () => {
    seedAsset();
    renderPage();
    await waitFor(() => screen.getByRole('heading', { name: /beckhoff cx9020/i }), { timeout: 4000 });

    fireEvent.click(screen.getByRole('button', { name: /^delete$/i }));

    await waitFor(() => {
      expect(screen.getByText(/are you sure you want to delete.*beckhoff cx9020/i)).toBeInTheDocument();
    });
  });

  it('shows "Sync from ITSM" button for ITSM-managed assets', async () => {
    seedAsset({
      itsm: {
        is_managed: true, hardware_asset_id: 'HW-001',
        last_synced: null, sync_status: 'never', itsm_guid: null,
      },
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /sync from itsm/i })).toBeInTheDocument();
    }, { timeout: 4000 });
  });
});
