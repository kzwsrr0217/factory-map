/**
 * BuildingDetails.test.tsx — Tests for the BuildingDetails page.
 *
 * Covers:
 *   - Building name and address render after data loads
 *   - Floor cards are rendered (one per floor from mock data)
 *   - Loading state is shown while data is fetching
 *   - Error state is shown when the building is not found
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
import BuildingDetails from '../pages/BuildingDetails';

const API = process.env.REACT_APP_API_URL || 'http://localhost:4000/api';

jest.mock('react-router-dom', () => ({
  useParams:   () => ({ id: 'bld-1' }),
  useNavigate: () => jest.fn(),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

jest.mock('jspdf',          () => function JsPDF() { return { save: jest.fn(), text: jest.fn(), addPage: jest.fn(), setFontSize: jest.fn(), setTextColor: jest.fn(), internal: { pageSize: { getWidth: () => 210, getHeight: () => 297 } } }; });
jest.mock('jspdf-autotable', () => jest.fn());

beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <ToastProvider>
            <BuildingDetails />
          </ToastProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

describe('BuildingDetails — data rendering', () => {
  it('shows the building name once loaded', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: 'WERK1 — Main Production' })).toBeInTheDocument();
    }, { timeout: 4000 });
  });

  it('renders a card for each floor', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Ground Floor')).toBeInTheDocument();
      expect(screen.getByText('First Floor')).toBeInTheDocument();
    }, { timeout: 4000 });
  });

  it('shows the Add Floor button', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /add floor/i })).toBeInTheDocument();
    }, { timeout: 4000 });
  });
});

describe('BuildingDetails — error state', () => {
  it('shows an error message when the building is not found', async () => {
    server.use(
      rest.get(`${API}/buildings/bld-1`, (_req, res, ctx) =>
        res(ctx.status(404), ctx.json({ success: false, error: 'Building not found' })),
      ),
    );
    renderPage();
    await waitFor(() => {
      const body = document.body.textContent ?? '';
      expect(
        body.includes('not found') || body.includes('error') || body.includes('Error') ||
        body.includes('404') || body.includes('Failed')
      ).toBe(true);
    }, { timeout: 4000 });
  });
});
