/**
 * AssetFormModal.test.tsx — Tests for the asset create/edit modal form.
 *
 * Covers:
 *   - Modal renders when isOpen=true and is absent when isOpen=false
 *   - Required-field validation: submitting without Display Name shows an error
 *   - Filling Display Name and submitting calls createAsset and invokes onSuccess
 *   - Section headings are visible (Basic Information, Network, Technical Specifications)
 *   - Edit mode pre-populates the Display Name field
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { server } from '../mocks/server';
import { rest } from 'msw';
import { AuthProvider } from '../contexts/AuthContext';
import { ToastProvider } from '../contexts/ToastContext';
import { ThemeProvider } from '../contexts/ThemeContext';
import AssetFormModal from '../components/asset/AssetFormModal';
import type { Asset } from '../services/asset.service';

jest.mock('react-router-dom', () => ({
  useNavigate: () => jest.fn(),
  useLocation: () => ({ state: null, pathname: '/', search: '', hash: '' }),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

const API = process.env.REACT_APP_API_URL || 'http://localhost:4000/api';

const MOCK_ASSET: Asset = {
  _id: 'asset-1',
  basic_info: {
    display_name: 'Existing IPC',
    type: 'IPC',
    status: 'active',
    manufacturer: 'Beckhoff',
    model: 'CX2020',
    serial_number: 'SN-001',
    asset_tag: 'TAG-001',
  },
  hierarchy: {
    building_id: null,
    floor_id: null,
    workarea_id: null,
    section_id: null,
    workstation_id: null,
  },
  location: { coordinates: { x: 0, y: 0 } },
  itsm: {
    hardware_asset_id: null,
    is_managed: false,
    last_synced: null,
    sync_status: 'never' as const,
  },
  work_items: [],
  connections: [],
  created_at: '',
  updated_at: '',
} as unknown as Asset;

beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderModal(props: {
  isOpen?: boolean;
  asset?: Asset | null;
  onSuccess?: () => void;
  onClose?: () => void;
}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <ToastProvider>
            <AssetFormModal
              isOpen={props.isOpen ?? true}
              onClose={props.onClose ?? jest.fn()}
              onSuccess={props.onSuccess ?? jest.fn()}
              asset={props.asset ?? null}
            />
          </ToastProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

describe('AssetFormModal — create mode', () => {
  it('renders when isOpen=true', () => {
    renderModal({});
    expect(screen.getByText(/create asset/i)).toBeInTheDocument();
  });

  it('does not render modal content when isOpen=false', () => {
    renderModal({ isOpen: false });
    expect(screen.queryByText(/create asset/i)).not.toBeInTheDocument();
  });

  it('shows Basic Information, Network, and Technical Specifications sections', async () => {
    renderModal({});
    await waitFor(() => {
      expect(screen.getByText('Basic Information')).toBeInTheDocument();
    });
    expect(screen.getByText('Network')).toBeInTheDocument();
    expect(screen.getByText('Technical Specifications')).toBeInTheDocument();
  });

  it('shows required-field error when submitting without Display Name', async () => {
    renderModal({});
    await waitFor(() => screen.getByRole('button', { name: /create asset/i }));

    fireEvent.click(screen.getByRole('button', { name: /create asset/i }));

    await waitFor(() => {
      expect(screen.getByText(/asset name is required/i)).toBeInTheDocument();
    });
  });

  it('clears the required-field error once the user starts typing', async () => {
    renderModal({});
    await waitFor(() => screen.getByRole('button', { name: /create asset/i }));

    fireEvent.click(screen.getByRole('button', { name: /create asset/i }));
    await waitFor(() => screen.getByText(/asset name is required/i));

    const nameInput = screen.getByPlaceholderText(/john's workstation/i);
    fireEvent.change(nameInput, { target: { value: 'NEW-IPC-001' } });

    await waitFor(() => {
      expect(screen.queryByText(/asset name is required/i)).not.toBeInTheDocument();
    });
  });

  it('calls onSuccess after a successful create', async () => {
    const onSuccess = jest.fn();
    server.use(
      rest.post(`${API}/assets`, (_req, res, ctx) =>
        res(ctx.status(201), ctx.json({
          success: true,
          data: { ...MOCK_ASSET, _id: 'asset-new', basic_info: { ...MOCK_ASSET.basic_info, display_name: 'NEW-IPC-001' } },
        })),
      ),
    );
    renderModal({ onSuccess });
    await waitFor(() => screen.getByRole('button', { name: /create asset/i }));

    const nameInput = screen.getByPlaceholderText(/john's workstation/i);
    fireEvent.change(nameInput, { target: { value: 'NEW-IPC-001' } });
    fireEvent.click(screen.getByRole('button', { name: /create asset/i }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1), { timeout: 3000 });
  });
});

describe('AssetFormModal — edit mode', () => {
  it('renders Update Asset button in edit mode', () => {
    renderModal({ asset: MOCK_ASSET });
    expect(screen.getByRole('button', { name: /update asset/i })).toBeInTheDocument();
  });

  it('pre-populates Display Name with existing asset name', async () => {
    renderModal({ asset: MOCK_ASSET });
    await waitFor(() => {
      const nameInput = screen.getByDisplayValue('Existing IPC');
      expect(nameInput).toBeInTheDocument();
    });
  });

  it('calls onSuccess after a successful update', async () => {
    const onSuccess = jest.fn();
    server.use(
      rest.patch(`${API}/assets/asset-1`, (_req, res, ctx) =>
        res(ctx.json({ success: true, data: { ...MOCK_ASSET, basic_info: { ...MOCK_ASSET.basic_info, display_name: 'Updated IPC' } } })),
      ),
    );
    renderModal({ asset: MOCK_ASSET, onSuccess });
    await waitFor(() => screen.getByRole('button', { name: /update asset/i }));

    fireEvent.click(screen.getByRole('button', { name: /update asset/i }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1), { timeout: 3000 });
  });
});
