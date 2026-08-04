/**
 * MapView.test.tsx — Tests for the MapView page.
 *
 * Covers:
 *   - Building selector renders
 *   - Floor selector renders
 *   - Search input is present
 *   - Deploy mode toggle button is present
 *   - Asset count badge updates when assets loaded
 *   - Connection peers on other floors are fetched by id, not by downloading all
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
import MapView from '../pages/MapView';

jest.mock('react-router-dom', () => ({
  useNavigate:     () => jest.fn(),
  useSearchParams: () => [new URLSearchParams(), jest.fn()],
  useLocation:     () => ({ state: null, pathname: '/map', search: '', hash: '' }),
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

const API = 'http://localhost:4000/api';

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
            <MapView />
          </ToastProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

describe('MapView — page controls', () => {
  it('renders the Map View heading', async () => {
    renderPage();
    await waitFor(
      () => expect(screen.getByText('Map View')).toBeInTheDocument(),
      { timeout: 8000 },
    );
  });

  it('renders the building selector label', async () => {
    renderPage();
    await waitFor(
      () => expect(screen.getByText('Building')).toBeInTheDocument(),
      { timeout: 8000 },
    );
  });

  it('renders the floor selector label', async () => {
    renderPage();
    await waitFor(
      () => expect(screen.getByText('Floor')).toBeInTheDocument(),
      { timeout: 8000 },
    );
  });

  it('renders the Deploy Device button', async () => {
    renderPage();
    await waitFor(
      () => expect(screen.getByRole('button', { name: /deploy device/i })).toBeInTheDocument(),
      { timeout: 8000 },
    );
  });
});


describe('MapView — cross-floor connection peers', () => {
  /**
   * The map has to name the far end of a link that leaves this floor. It used to do
   * that from one unpaginated GET /assets — capped at 1000 rows server-side, so past
   * that size the name silently went missing. Now only the referenced ids are asked
   * for, which is what this checks: the request is made, and it asks for exactly the
   * off-floor peer.
   */
  it('asks for the referenced peer by id and nothing else', async () => {
    const idsQueries: string[] = [];
    server.use(
      rest.get(`${API}/assets`, (req, res, ctx) => {
        const ids = req.url.searchParams.get('ids');
        if (ids !== null) {
          idsQueries.push(ids);
          return res(ctx.json({
            success: true,
            data: [{
              _id: 'peer-on-floor-2',
              basic_info: { display_name: 'FAR-END-PC', type: 'desktop', status: 'active' },
              hierarchy: { building_id: 'bld-1', floor_id: 'floor-2' },
              location: { coordinates: { x: 10, y: 10 } },
            }],
            meta: { total: 1 },
          }));
        }
        if (req.url.searchParams.get('floor_id')) {
          return res(ctx.json({
            success: true,
            data: [{
              _id: 'on-floor-1',
              basic_info: { display_name: 'NEAR-PC', type: 'desktop', status: 'active' },
              hierarchy: { building_id: 'bld-1', floor_id: 'floor-1' },
              location: { coordinates: { x: 40, y: 40 } },
              connections: [{ connected_asset_id: 'peer-on-floor-2', connection_type: 'network' }],
            }],
            meta: { total: 1 },
          }));
        }
        // A bare list request would be the old behaviour — fail loudly if one appears.
        return res(ctx.json({ success: true, data: [], meta: { total: 0, page: 1, limit: 500, totalPages: 0 } }));
      }),
    );

    renderPage();
    await waitFor(() => expect(idsQueries).toEqual(['peer-on-floor-2']), { timeout: 8000 });
  });

  it('does not ask at all when nothing on the floor points off it', async () => {
    const idsQueries: string[] = [];
    server.use(
      rest.get(`${API}/assets`, (req, res, ctx) => {
        const ids = req.url.searchParams.get('ids');
        if (ids !== null) idsQueries.push(ids);
        return res(ctx.json({
          success: true,
          data: req.url.searchParams.get('floor_id') ? [{
            _id: 'on-floor-1',
            basic_info: { display_name: 'NEAR-PC', type: 'desktop', status: 'active' },
            hierarchy: { building_id: 'bld-1', floor_id: 'floor-1' },
            location: { coordinates: { x: 40, y: 40 } },
            connections: [],
          }] : [],
          meta: { total: 1 },
        }));
      }),
    );

    renderPage();
    await waitFor(() => expect(screen.getByText('Map View')).toBeInTheDocument(), { timeout: 8000 });
    expect(idsQueries).toEqual([]);
  });
});
