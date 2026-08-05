/**
 * NormalisationTasks.test.tsx — The task page's two load-bearing behaviours.
 *
 * The page is mostly a list, but two things in it are promises to the reader and are worth
 * holding still:
 *
 *   - Dismissing is impossible without a reason. The server enforces it too; the UI must
 *     not offer a button that will be refused.
 *   - When the server says a tick will not stick, the page repeats that instead of showing
 *     a plain success. Someone who believes a tick settled it stops chasing the cause,
 *     which is the failure this whole list exists to prevent.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { rest } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { server } from '../mocks/server';
import { ToastProvider } from '../contexts/ToastContext';
import { ThemeProvider } from '../contexts/ThemeContext';
import NormalisationTasks from '../pages/NormalisationTasks';

const API = process.env.REACT_APP_API_URL || 'http://localhost:4000/api';

jest.mock('react-router-dom', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={String(to)}>{children}</a>,
}));

beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const TASK = {
  _id: 'task-1',
  kind: 'link-to-itsm',
  asset_id: 'asset-1',
  itsm_id: 'HWA12345',
  summary: 'MMH-PC-9: link to HWA12345 — ITSM already knows this device',
  evidence: 'one ITSM record, matched on serial and corroborated by type+person',
  state: 'open',
  assigned_to: null,
  note: null,
  closed_by: null,
  closed_at: null,
  first_seen_at: new Date().toISOString(),
  last_seen_at: new Date().toISOString(),
  machine_verifiable: true,
};

function seed(tasks: unknown[] = [TASK], consistent = false) {
  server.use(
    rest.get(`${API}/tasks/summary`, (_req, res, ctx) => res(ctx.json({
      success: true,
      data: {
        by_kind: { 'link-to-itsm': { open: tasks.length } },
        by_state: { open: tasks.length, done: 0, dismissed: 0 },
        open_unassigned: tasks.length,
        consistent,
      },
    }))),
    rest.get(`${API}/tasks`, (_req, res, ctx) => res(ctx.json({
      success: true,
      data: tasks,
      meta: { total: tasks.length, page: 1, limit: 25, totalPages: 1 },
    }))),
  );
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ToastProvider>
          <NormalisationTasks />
        </ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('NormalisationTasks', () => {
  it('shows the task with the evidence that raised it', async () => {
    seed();
    renderPage();
    expect(await screen.findByText(/link to HWA12345/)).toBeInTheDocument();
    // The evidence is the point: a task without it is an instruction to trust the tool.
    expect(screen.getByText(/corroborated by type\+person/)).toBeInTheDocument();
  });

  it('will not dismiss until a reason is typed', async () => {
    seed();
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Dismiss/ }));

    const confirm = screen.getByRole('button', { name: /Confirm/ });
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Reason for dismissing/), {
      target: { value: 'being scrapped next week' },
    });
    expect(confirm).toBeEnabled();
  });

  it('repeats the server’s warning instead of claiming success', async () => {
    seed();
    let sentState: string | undefined;
    server.use(rest.patch(`${API}/tasks/task-1`, async (req, res, ctx) => {
      sentState = ((await req.json()) as { state?: string }).state;
      return res(ctx.json({
        success: true,
        data: { ...TASK, state: 'done' },
        meta: { note: 'This kind is checked against the data. If the cause is still there, the next generation will reopen it.' },
      }));
    }));

    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Done/ }));

    await waitFor(() => expect(sentState).toBe('done'));
    expect(await screen.findByText(/will reopen it/)).toBeInTheDocument();
    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
  });

  it('says so when nothing is outstanding', async () => {
    // The state the whole exercise aims at, and the one claim the page must not make
    // loosely.
    seed([], true);
    renderPage();
    expect(await screen.findByText(/Nothing outstanding/)).toBeInTheDocument();
  });

  it('marks the kinds only a person can close', async () => {
    seed([{ ...TASK, _id: 'task-2', kind: 'label-device', machine_verifiable: false, summary: 'MMH-PC-9: put an HWA label on it' }]);
    renderPage();
    expect(await screen.findByText(/put an HWA label on it/)).toBeInTheDocument();
    expect(screen.getByText('needs a person')).toBeInTheDocument();
  });
});
