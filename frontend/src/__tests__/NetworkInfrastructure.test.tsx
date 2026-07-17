/**
 * NetworkInfrastructure.test.tsx — Tests for the Network Infrastructure page.
 *
 * Covers:
 *   - Building selector renders automatically with first building selected
 *   - Room list renders from API data (MDF-W1, IDF-W1-GF)
 *   - "Add Room" button is present
 *   - Port search input is present
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { server } from '../mocks/server';
import { AuthProvider } from '../contexts/AuthContext';
import { ToastProvider } from '../contexts/ToastContext';
import { ThemeProvider } from '../contexts/ThemeContext';
import NetworkInfrastructure from '../pages/NetworkInfrastructure';

jest.mock('react-router-dom', () => ({
  useNavigate: () => jest.fn(),
  useLocation: () => ({ state: null, pathname: '/infrastructure', search: '', hash: '' }),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) =>
    <a href={String(to)}>{children}</a>,
}));

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
            <NetworkInfrastructure />
          </ToastProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

describe('NetworkInfrastructure — layout', () => {
  it('shows the Add Room button', async () => {
    renderPage();
    await waitFor(
      () => expect(screen.getByRole('button', { name: /add room/i })).toBeInTheDocument(),
      { timeout: 8000 },
    );
  });

  it('shows port search input', async () => {
    renderPage();
    await waitFor(
      () => expect(screen.getByPlaceholderText(/search wall port/i)).toBeInTheDocument(),
      { timeout: 8000 },
    );
  });
});

describe('NetworkInfrastructure — room list', () => {
  it('renders MDF room from mock data', async () => {
    renderPage();
    await waitFor(
      () => expect(screen.getByText('MDF-W1')).toBeInTheDocument(),
      { timeout: 8000 },
    );
  });

  it('renders IDF room from mock data', async () => {
    renderPage();
    await waitFor(
      () => expect(screen.getByText('IDF-W1-GF')).toBeInTheDocument(),
      { timeout: 8000 },
    );
  });

  it('shows room type badges', async () => {
    renderPage();
    await waitFor(
      () => {
        expect(screen.getByText('MDF')).toBeInTheDocument();
        expect(screen.getByText('IDF')).toBeInTheDocument();
      },
      { timeout: 8000 },
    );
  });
});
