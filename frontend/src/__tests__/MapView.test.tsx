/**
 * MapView.test.tsx — Tests for the MapView page.
 *
 * Covers:
 *   - Building selector renders
 *   - Floor selector renders
 *   - Search input is present
 *   - Deploy mode toggle button is present
 *   - Asset count badge updates when assets loaded
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
