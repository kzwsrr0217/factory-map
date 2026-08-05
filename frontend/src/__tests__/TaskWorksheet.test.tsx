/**
 * TaskWorksheet.test.tsx — What the sheet has to say before anyone walks a floor.
 *
 * The page is a table, and a table is not worth testing. These three things are:
 *
 *   - rooms group, and the devices with no room end up under their own heading rather than
 *     scattered through the route;
 *   - a truncated sheet says so. Someone who walks a partial list and ticks it all off
 *     leaves the round open for reasons nobody can see;
 *   - the CSV carries the columns the Alemba typing needs, quoted, so a device name with a
 *     comma in it does not shift every following column.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { rest } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { server } from '../mocks/server';
import { ToastProvider } from '../contexts/ToastContext';
import { ThemeProvider } from '../contexts/ThemeContext';
import TaskWorksheet from '../pages/TaskWorksheet';

const API = process.env.REACT_APP_API_URL || 'http://localhost:4000/api';

jest.mock('react-router-dom', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={String(to)}>{children}</a>,
}));

beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const ROW = {
  task_id: 't1',
  kind: 'label-device',
  state: 'open',
  summary: 'MMH-PC-9: put an HWA label on it',
  evidence: 'matched on serial, not read from a sticker',
  assigned_to: null,
  itsm_id: 'HWA12345',
  age_days: 3,
  machine_verifiable: false,
  asset_id: 'a1',
  device: 'MMH-PC-9',
  asset_type: 'workstation',
  serial_number: 'SN-1',
  person: 'Móder, Hajnalka',
  building: 'Werk1',
  floor: 'Ground Floor',
  zone: 'HR',
  room: 'HR Iroda',
};

function seed(rows: unknown[] = [ROW], meta: Record<string, unknown> = {}) {
  server.use(
    rest.get(`${API}/tasks/worksheet`, (_req, res, ctx) => res(ctx.json({
      success: true,
      data: rows,
      meta: {
        total: rows.length,
        truncated: false,
        without_place: rows.filter((r: any) => !r.room).length,
        generated_at: new Date().toISOString(),
        ...meta,
      },
    }))),
  );
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ToastProvider>
          <TaskWorksheet />
        </ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

/**
 * The download, intercepted. jsdom has no file save, so the blob and the filename are taken
 * where the page hands them over. Patched in a hook rather than inside the test body, since
 * Jest will not accept a hook registered from there.
 */
const download: { blob: Blob | null; filename: string } = { blob: null, filename: '' };
let realCreateObjectURL: typeof URL.createObjectURL;
let realRevokeObjectURL: typeof URL.revokeObjectURL;

beforeEach(() => {
  download.blob = null;
  download.filename = '';
  realCreateObjectURL = URL.createObjectURL;
  realRevokeObjectURL = URL.revokeObjectURL;
  (URL as any).createObjectURL = (b: Blob) => { download.blob = b; return 'blob:test'; };
  (URL as any).revokeObjectURL = () => {};
  jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    download.filename = this.download;
  });
});

afterEach(() => {
  (URL as any).createObjectURL = realCreateObjectURL;
  (URL as any).revokeObjectURL = realRevokeObjectURL;
  jest.restoreAllMocks();
});

describe('TaskWorksheet', () => {
  it('groups by room and names where the room is', async () => {
    seed();
    renderPage();
    expect(await screen.findByText('HR / HR Iroda')).toBeInTheDocument();
    expect(screen.getByText('Werk1 / Ground Floor')).toBeInTheDocument();
    expect(screen.getByText('MMH-PC-9')).toBeInTheDocument();
  });

  it('collects the devices with no room under one heading, and says how many', async () => {
    seed([
      ROW,
      { ...ROW, task_id: 't2', device: 'MMH-PC-10', room: null, zone: null },
      { ...ROW, task_id: 't3', device: 'MMH-PC-11', room: null, zone: null },
    ]);
    renderPage();
    // One heading, not one per device: these need a different kind of hunt.
    expect(await screen.findByText('No room recorded')).toBeInTheDocument();
    expect(screen.getByText(/2 of these have no room recorded/)).toBeInTheDocument();
  });

  it('admits when the sheet is only part of the list', async () => {
    seed([ROW], { total: 900, truncated: true });
    renderPage();
    expect(await screen.findByText(/Only the first 1 of 900/)).toBeInTheDocument();
  });

  it('exports a quoted CSV with the columns the typing needs', async () => {
    seed([{ ...ROW, device: 'PC, the second' }]);
    renderPage();

    // The button exists immediately and is disabled until the sheet arrives — clicking it
    // before then does nothing, which is the behaviour, so the test has to wait for it.
    const csvButton = await screen.findByRole('button', { name: /CSV/ });
    await waitFor(() => expect(csvButton).toBeEnabled());
    fireEvent.click(csvButton);
    await waitFor(() => expect(download.filename).toMatch(/^tasks-label-device-\d{4}-\d{2}-\d{2}\.csv$/));

    // Read as bytes: jsdom's Blob has no `.text()`, and `readAsText` swallows the BOM —
    // which is one of the things being checked.
    const bytes = await new Promise<Uint8Array>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
      reader.onerror = () => reject(new Error('could not read the blob'));
      reader.readAsArrayBuffer(download.blob!);
    });
    // A UTF-8 BOM, or Excel mangles the Hungarian names.
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
    const csv = Buffer.from(bytes).toString('utf8');
    expect(csv).toContain('"Device","HWA","ITSM record","Type","Serial","Person"');
    // The comma in the name stays inside its cell.
    expect(csv).toContain('"PC, the second"');
    expect(csv).toContain('"HR Iroda"');
  });

  it('offers nothing to print when there is nothing on the sheet', async () => {
    seed([]);
    renderPage();
    expect(await screen.findByText(/Nothing open of this kind/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Print/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /CSV/ })).toBeDisabled();
  });
});
