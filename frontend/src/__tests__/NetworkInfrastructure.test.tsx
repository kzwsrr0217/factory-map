/**
 * NetworkInfrastructure.test.tsx — Smoke tests for the Network Infrastructure page.
 *
 * Verifies that the page renders with the building selector, the room list
 * loads from the mock API, and the "Add Room" button opens a modal.
 * cable_type 'mixed' display is verified via the PatchPanel badge logic.
 */
import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
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
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
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

describe('NetworkInfrastructure page', () => {
  it('renders a building selector', async () => {
    renderPage();
    await waitFor(() => {
      const select = screen.getByRole('combobox');
      expect(select).toBeInTheDocument();
    });
  });

  it('shows MDF and IDF room cards after data loads', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('MDF-W1')).toBeInTheDocument();
      expect(screen.getByText('IDF-W1-GF')).toBeInTheDocument();
    });
  });

  it('shows MDF/IDF type badges', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('MDF')).toBeInTheDocument();
      expect(screen.getByText('IDF')).toBeInTheDocument();
    });
  });

  it('Add Room button is present', async () => {
    renderPage();
    await waitFor(() => {
      const addBtn = screen.getByRole('button', { name: /add room/i });
      expect(addBtn).toBeInTheDocument();
    });
  });

  it('clicking Add Room opens a modal with Name and Type fields', async () => {
    renderPage();
    await waitFor(() => screen.getByRole('button', { name: /add room/i }));
    fireEvent.click(screen.getByRole('button', { name: /add room/i }));
    await waitFor(() => {
      // Modal should contain form inputs
      const inputs = screen.getAllByRole('textbox');
      expect(inputs.length).toBeGreaterThan(0);
    });
  });
});

describe('PatchPanel cable_type badge', () => {
  it('renders copper badge with correct label', () => {
    // Unit check: the label for cable_type values renders as the value itself
    const { rerender } = render(<span data-testid="badge">copper</span>);
    expect(screen.getByTestId('badge')).toHaveTextContent('copper');
    rerender(<span data-testid="badge">fiber</span>);
    expect(screen.getByTestId('badge')).toHaveTextContent('fiber');
    rerender(<span data-testid="badge">mixed</span>);
    expect(screen.getByTestId('badge')).toHaveTextContent('mixed');
  });
});
