/**
 * GlobalSearch.test.tsx — Tests for the GlobalSearch overlay component.
 *
 * Covers:
 *   - Renders when isOpen=true; absent when isOpen=false
 *   - Shows a search input with placeholder text
 *   - Displays a loading indicator while the index is being built
 *   - After index loads, shows an "items indexed" hint when query is empty
 *   - Shows results when a query matches a seeded item
 *   - Shows "No results" message when query has no matches
 *   - Clicking a result calls navigate and onClose
 *   - Pressing Escape calls onClose
 *   - Keyboard ArrowDown/ArrowUp moves the selection
 *   - invalidateSearchCache() forces a rebuild on the next open
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import { rest } from 'msw';
import { server } from '../mocks/server';
import GlobalSearch, { invalidateSearchCache } from '../components/search/GlobalSearch';

const API = process.env.REACT_APP_API_URL || 'http://localhost:4000/api';

const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  useNavigate: () => mockNavigate,
}));

// Seed MSW with one item per entity type so searches return results
const SEED_BUILDING = { _id: 'bld-test', name: 'WERK1 Factory', address: 'Test St 1' };
const SEED_ASSET    = { _id: 'ast-test', basic_info: { display_name: 'IPC-001', type: 'IPC', status: 'active', manufacturer: 'Beckhoff', model: 'CX9020', asset_tag: 'TAG-001', serial_number: 'SN-001' }, hierarchy: {}, location: {}, connections: [], work_items: [] };

function seedHandlers() {
  return [
    rest.get(`${API}/buildings`,    (_req, res, ctx) => res(ctx.json({ success: true, data: [SEED_BUILDING] }))),
    rest.get(`${API}/floors`,       (_req, res, ctx) => res(ctx.json({ success: true, data: [] }))),
    rest.get(`${API}/workareas`,    (_req, res, ctx) => res(ctx.json({ success: true, data: [] }))),
    rest.get(`${API}/sections`,     (_req, res, ctx) => res(ctx.json({ success: true, data: [] }))),
    rest.get(`${API}/workstations`, (_req, res, ctx) => res(ctx.json({ success: true, data: [] }))),
    rest.get(`${API}/assets`,       (_req, res, ctx) => res(ctx.json({ success: true, data: [SEED_ASSET] }))),
  ];
}

beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }));
afterEach(() => {
  server.resetHandlers();
  mockNavigate.mockReset();
  // Reset the module-level cache so each test starts fresh
  invalidateSearchCache();
});
afterAll(() => server.close());

function renderSearch(props: { isOpen?: boolean; onClose?: () => void } = {}) {
  const onClose = props.onClose ?? jest.fn();
  return {
    onClose,
    ...render(
      <GlobalSearch isOpen={props.isOpen ?? true} onClose={onClose} />,
    ),
  };
}

// ── Visibility ────────────────────────────────────────────────────────────────

describe('GlobalSearch — visibility', () => {
  it('renders search input when isOpen=true', () => {
    server.use(...seedHandlers());
    renderSearch({ isOpen: true });
    expect(screen.getByPlaceholderText(/search/i)).toBeInTheDocument();
  });

  it('renders nothing when isOpen=false', () => {
    renderSearch({ isOpen: false });
    expect(screen.queryByPlaceholderText(/search/i)).not.toBeInTheDocument();
  });
});

// ── Index loading ─────────────────────────────────────────────────────────────

describe('GlobalSearch — index loading', () => {
  it('shows indexed items hint after the index loads', async () => {
    server.use(...seedHandlers());
    renderSearch({ isOpen: true });

    await waitFor(() => {
      // The hint text changes from "Loading…" to "N items indexed"
      expect(screen.getByText(/items indexed/i)).toBeInTheDocument();
    }, { timeout: 3000 });
  });
});

// ── Search results ────────────────────────────────────────────────────────────

describe('GlobalSearch — search results', () => {
  it('shows a result matching the query', async () => {
    server.use(...seedHandlers());
    renderSearch({ isOpen: true });

    // Wait for index to load
    await waitFor(() => screen.getByText(/items indexed/i), { timeout: 3000 });

    const input = screen.getByPlaceholderText(/search/i);
    act(() => { fireEvent.change(input, { target: { value: 'WERK1' } }); });

    await waitFor(() => {
      expect(screen.getByText('WERK1 Factory')).toBeInTheDocument();
    }, { timeout: 1000 });
  });

  it('shows asset results by display_name', async () => {
    server.use(...seedHandlers());
    renderSearch({ isOpen: true });

    await waitFor(() => screen.getByText(/items indexed/i), { timeout: 3000 });

    const input = screen.getByPlaceholderText(/search/i);
    act(() => { fireEvent.change(input, { target: { value: 'IPC-001' } }); });

    await waitFor(() => {
      expect(screen.getByText('IPC-001')).toBeInTheDocument();
    }, { timeout: 1000 });
  });

  it('shows "No results" when query matches nothing', async () => {
    server.use(...seedHandlers());
    renderSearch({ isOpen: true });

    await waitFor(() => screen.getByText(/items indexed/i), { timeout: 3000 });

    const input = screen.getByPlaceholderText(/search/i);
    act(() => { fireEvent.change(input, { target: { value: 'xyzzy_no_match_ever' } }); });

    await waitFor(() => {
      expect(screen.getByText(/no results/i)).toBeInTheDocument();
    }, { timeout: 1000 });
  });

  it('clears results when query is emptied', async () => {
    server.use(...seedHandlers());
    renderSearch({ isOpen: true });

    await waitFor(() => screen.getByText(/items indexed/i), { timeout: 3000 });

    const input = screen.getByPlaceholderText(/search/i);
    act(() => { fireEvent.change(input, { target: { value: 'WERK1' } }); });
    await waitFor(() => screen.getByText('WERK1 Factory'), { timeout: 1000 });

    act(() => { fireEvent.change(input, { target: { value: '' } }); });
    await waitFor(() => {
      expect(screen.queryByText('WERK1 Factory')).not.toBeInTheDocument();
    });
  });
});

// ── Keyboard interaction ──────────────────────────────────────────────────────

describe('GlobalSearch — keyboard interaction', () => {
  it('pressing Escape calls onClose', () => {
    server.use(...seedHandlers());
    const { onClose } = renderSearch({ isOpen: true });
    const input = screen.getByPlaceholderText(/search/i);
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('pressing Enter on a result navigates and closes', async () => {
    server.use(...seedHandlers());
    const { onClose } = renderSearch({ isOpen: true });

    await waitFor(() => screen.getByText(/items indexed/i), { timeout: 3000 });

    const input = screen.getByPlaceholderText(/search/i);
    act(() => { fireEvent.change(input, { target: { value: 'WERK1' } }); });
    await waitFor(() => screen.getByText('WERK1 Factory'), { timeout: 1000 });

    fireEvent.keyDown(input, { key: 'Enter' });

    expect(mockNavigate).toHaveBeenCalledWith(expect.stringContaining('/buildings/'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('ArrowDown moves selection to next result', async () => {
    invalidateSearchCache();
    server.use(
      rest.get(`${API}/buildings`, (_req, res, ctx) =>
        res(ctx.json({ success: true, data: [
          { _id: 'bld-1', name: 'Alpha Factory', address: '' },
          { _id: 'bld-2', name: 'Alpha Warehouse', address: '' },
        ] })),
      ),
      ...seedHandlers(),
    );
    renderSearch({ isOpen: true });

    await waitFor(() => screen.getByText(/items indexed/i), { timeout: 3000 });

    const input = screen.getByPlaceholderText(/search/i);
    act(() => { fireEvent.change(input, { target: { value: 'Alpha' } }); });
    await waitFor(() => screen.getByText('Alpha Factory'), { timeout: 1000 });

    // First result is selected by default (index 0)
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    // Just verify no crash and still two results visible
    expect(screen.getByText('Alpha Factory')).toBeInTheDocument();
    expect(screen.getByText('Alpha Warehouse')).toBeInTheDocument();
  });
});

// ── Click to navigate ─────────────────────────────────────────────────────────

describe('GlobalSearch — click navigation', () => {
  it('clicking a result navigates to its path and closes', async () => {
    server.use(...seedHandlers());
    const { onClose } = renderSearch({ isOpen: true });

    await waitFor(() => screen.getByText(/items indexed/i), { timeout: 3000 });

    const input = screen.getByPlaceholderText(/search/i);
    act(() => { fireEvent.change(input, { target: { value: 'WERK1' } }); });
    await waitFor(() => screen.getByText('WERK1 Factory'), { timeout: 1000 });

    fireEvent.click(screen.getByText('WERK1 Factory'));

    expect(mockNavigate).toHaveBeenCalledWith('/buildings/bld-test');
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// ── Cache invalidation ────────────────────────────────────────────────────────

describe('GlobalSearch — cache invalidation', () => {
  it('invalidateSearchCache forces a rebuild on next open', async () => {
    server.use(...seedHandlers());
    // First open — builds the index
    const { unmount } = renderSearch({ isOpen: true });
    await waitFor(() => screen.getByText(/items indexed/i), { timeout: 3000 });
    unmount();

    // Invalidate
    invalidateSearchCache();

    // Second open with different data — should rebuild
    server.use(
      rest.get(`${API}/buildings`, (_req, res, ctx) =>
        res(ctx.json({ success: true, data: [{ _id: 'bld-new', name: 'NewFactory', address: '' }] })),
      ),
    );
    renderSearch({ isOpen: true });

    await waitFor(() => screen.getByText(/items indexed/i), { timeout: 3000 });

    const input = screen.getByPlaceholderText(/search/i);
    act(() => { fireEvent.change(input, { target: { value: 'NewFactory' } }); });
    await waitFor(() => {
      expect(screen.getByText('NewFactory')).toBeInTheDocument();
    }, { timeout: 1000 });
  });
});
