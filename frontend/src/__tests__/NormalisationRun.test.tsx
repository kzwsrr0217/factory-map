/**
 * NormalisationRun.test.tsx — The one thing this page says that no other page can.
 *
 * Four counts and four timestamps are not worth a test. `stale` is: the task list was
 * derived before the newest export or survey, so the numbers describe a situation that has
 * already changed. If that warning goes quiet, the page becomes a more convincing version
 * of the mistake it exists to prevent — and "nothing outstanding" gets believed.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { rest } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { server } from '../mocks/server';
import { ToastProvider } from '../contexts/ToastContext';
import { ThemeProvider } from '../contexts/ThemeContext';
import NormalisationRun from '../pages/NormalisationRun';

const API = process.env.REACT_APP_API_URL || 'http://localhost:4000/api';

jest.mock('react-router-dom', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={String(to)}>{children}</a>,
}));

beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const HOUR_AGO = new Date(Date.now() - 3600_000).toISOString();
const DAY_AGO = new Date(Date.now() - 86_400_000).toISOString();

const STATUS = {
  itsm_export: { records: 1057, loaded_at: DAY_AGO },
  survey: { applied_at: HOUR_AGO, assets_updated: 120, assets_created: 4 },
  app: { linked: 1054, local_only: 6, placed: 900, total: 1060 },
  tasks: {
    open: 3, done: 1, dismissed: 0,
    derived_at: DAY_AGO, consistent: false, stale: true,
  },
};

function seed(status: Record<string, unknown> = STATUS) {
  const generated: unknown[] = [];
  server.use(
    rest.get(`${API}/inventory/status`, (_req, res, ctx) =>
      res(ctx.json({ success: true, data: status }))),
    rest.post(`${API}/tasks/generate`, (_req, res, ctx) => {
      generated.push(true);
      return res(ctx.json({
        success: true,
        data: { created: 2, reopened: 0, unchanged: 1, closed: 1, awaiting_human: 0 },
      }));
    }),
  );
  return { generated };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ToastProvider>
          <NormalisationRun />
        </ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('NormalisationRun', () => {
  it('says the list is older than the data, and offers the fix in the same breath', async () => {
    const { generated } = seed();
    renderPage();

    expect(await screen.findByText(/older than the data/)).toBeInTheDocument();
    // The button lives inside the warning: reading it and then hunting for the action is how
    // a warning gets ignored.
    fireEvent.click(screen.getByRole('button', { name: /^Re-derive$/ }));
    await waitFor(() => expect(generated).toHaveLength(1));
  });

  it('calls the round closed only when the list is both empty and current', async () => {
    seed({ ...STATUS, tasks: { ...STATUS.tasks, open: 0, consistent: true, stale: false } });
    renderPage();
    expect(await screen.findByText(/This round is closed/)).toBeInTheDocument();
    expect(screen.queryByText(/older than the data/)).not.toBeInTheDocument();
  });

  it('does not claim the round is closed while the list is stale', async () => {
    // Zero open tasks and stale at once: the count is real, and it is about the past.
    seed({ ...STATUS, tasks: { ...STATUS.tasks, open: 0, consistent: true, stale: true } });
    renderPage();
    expect(await screen.findByText(/older than the data/)).toBeInTheDocument();
    expect(screen.queryByText(/This round is closed/)).not.toBeInTheDocument();
  });

  it('tells a first-time reader that nothing has happened yet, rather than showing zeroes', async () => {
    seed({
      itsm_export: { records: 0, loaded_at: null },
      survey: { applied_at: null, assets_updated: null, assets_created: null },
      app: { linked: 0, local_only: 0, placed: 0, total: 0 },
      tasks: { open: 0, done: 0, dismissed: 0, derived_at: null, consistent: false, stale: false },
    });
    renderPage();
    expect(await screen.findByText(/Nothing loaded yet/)).toBeInTheDocument();
    expect(screen.getByText(/No survey has been applied/)).toBeInTheDocument();
    expect(screen.getByText(/has never been derived/)).toBeInTheDocument();
    expect(screen.queryByText(/This round is closed/)).not.toBeInTheDocument();
  });

  it('shows the age of each step rather than a raw date', async () => {
    seed();
    renderPage();
    // The two age chips: the export and the last derive, both a day old in this fixture.
    // Scoped to the chip rather than the whole page, since the stale warning says it too.
    expect(await screen.findAllByText('1 day ago', { selector: 'span' })).toHaveLength(2);
    expect(screen.getByText('1 hour ago', { selector: 'span' })).toBeInTheDocument();
  });
});
