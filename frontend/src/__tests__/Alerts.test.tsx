/**
 * Alerts.test.tsx — Smoke tests for the Alerts settings page.
 *
 * Alerts.tsx uses no router hooks (no useNavigate/useLocation), so no Router
 * wrapper is needed. MSW mocks the /api/alerts/* endpoints.
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { server } from '../mocks/server';
import { AuthProvider } from '../contexts/AuthContext';
import { ToastProvider } from '../contexts/ToastContext';
import { ThemeProvider } from '../contexts/ThemeContext';
import Alerts from '../pages/Alerts';

beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function renderAlerts() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <ToastProvider>
            <Alerts />
          </ToastProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

describe('Alerts page', () => {
  it('renders the Maintenance Alerts heading', async () => {
    renderAlerts();
    await waitFor(() => {
      expect(screen.getByText(/maintenance alerts/i)).toBeInTheDocument();
    });
  });

  it('shows the Alert Conditions section', async () => {
    renderAlerts();
    await waitFor(() => {
      expect(screen.getByText(/alert conditions/i)).toBeInTheDocument();
    });
  });

  it('shows the Email Notifications section', async () => {
    renderAlerts();
    await waitFor(() => {
      expect(screen.getByText(/email notifications/i)).toBeInTheDocument();
    });
  });

  it('shows the Teams Notifications section', async () => {
    renderAlerts();
    await waitFor(() => {
      expect(screen.getByText(/microsoft teams/i)).toBeInTheDocument();
    });
  });

  it('shows the Alert History section', async () => {
    renderAlerts();
    await waitFor(() => {
      expect(screen.getByText(/alert history/i)).toBeInTheDocument();
    });
  });
});
