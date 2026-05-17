/**
 * MapView.test.tsx — Smoke tests for the MapView page.
 *
 * Covers:
 *   - Page renders without crashing
 *   - Building dropdown is present after initial load
 *   - Loaded buildings appear as options
 *   - Floor dropdown is disabled / empty before a building is chosen
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { server } from '../mocks/server';
import { AuthProvider } from '../contexts/AuthContext';
import { ToastProvider } from '../contexts/ToastContext';
import { ThemeProvider } from '../contexts/ThemeContext';
import MapView from '../pages/MapView';

jest.mock('react-router-dom', () => ({
  useNavigate: () => jest.fn(),
  useLocation: () => ({ state: null, pathname: '/map', search: '', hash: '' }),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

jest.mock('jspdf',          () => function JsPDF() { return { save: jest.fn(), text: jest.fn(), addPage: jest.fn(), setFontSize: jest.fn(), addImage: jest.fn(), setFont: jest.fn(), setFontSize: jest.fn(), internal: { pageSize: { getWidth: () => 297, getHeight: () => 210 } } }; });
jest.mock('jspdf-autotable', () => jest.fn());

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
            <MapView />
          </ToastProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

describe('MapView — initial render', () => {
  it('renders without crashing', () => {
    renderPage();
    expect(document.body).toBeInTheDocument();
  });

  it('shows at least one <select> element (building selector)', async () => {
    renderPage();
    await waitFor(() => {
      const selects = screen.getAllByRole('combobox');
      expect(selects.length).toBeGreaterThanOrEqual(1);
    }, { timeout: 4000 });
  });

  it('populates the building dropdown from the API', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('WERK1 — Main Production')).toBeInTheDocument();
    }, { timeout: 4000 });
  });

  it('does not show a floor map SVG before a floor is selected', async () => {
    renderPage();
    // Wait for buildings to load, then verify no floor-map viewBox is present
    await waitFor(() => {
      expect(screen.getByText('WERK1 — Main Production')).toBeInTheDocument();
    }, { timeout: 4000 });
    // Floor map SVG has a viewBox like "0 0 1000 800" — should not be present yet
    const mapSvg = Array.from(document.querySelectorAll('svg')).find(s =>
      (s.getAttribute('viewBox') ?? '').includes('1000')
    );
    expect(mapSvg).toBeUndefined();
  });
});
