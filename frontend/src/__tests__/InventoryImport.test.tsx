/**
 * InventoryImport.test.tsx — The two promises this page makes.
 *
 *   - Nothing is applied until the preview has been seen. The import re-places every device
 *     it matched and creates assets for the rest; an Apply button that works before a
 *     preview turns a validation tool back into a blind write.
 *   - The fix box appears next to the name that actually failed, and only that one. When the
 *     building is unknown the floor name was never looked up, and offering to correct it
 *     sends someone renaming a floor that is perfectly fine.
 *
 * The third behaviour worth holding still is the loop: saving a correction re-runs the
 * preview, so the list visibly shrinks. Without it a person cannot tell whether the fix
 * landed.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { rest } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { server } from '../mocks/server';
import { ToastProvider } from '../contexts/ToastContext';
import { ThemeProvider } from '../contexts/ThemeContext';
import InventoryImport from '../pages/InventoryImport';

const API = process.env.REACT_APP_API_URL || 'http://localhost:4000/api';

jest.mock('react-router-dom', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={String(to)}>{children}</a>,
}));

beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const EMPTY_PLAN = {
  parsed: 1,
  hwa_rows: 1,
  other_rows: 0,
  to_update: 1,
  to_create: 0,
  no_room: 0,
  unmatched_place: [],
  missing_work_areas: [],
  unmatched_persons: [],
  unmatched_hwa: [],
  create_sample: [],
  created_areas: null,
  applied: false,
};

/** Records every import call so the tests can assert the preview was re-run. */
function seed(plan: Record<string, unknown> = EMPTY_PLAN) {
  const imports: unknown[] = [];
  const puts: unknown[] = [];
  server.use(
    rest.get(`${API}/inventory/corrections`, (_req, res, ctx) =>
      res(ctx.json({ success: true, data: [] }))),
    rest.post(`${API}/inventory/survey/import`, async (req, res, ctx) => {
      imports.push(await req.json());
      return res(ctx.json({ success: true, data: plan }));
    }),
    rest.put(`${API}/inventory/corrections`, async (req, res, ctx) => {
      puts.push(await req.json());
      return res(ctx.json({ success: true, data: { _id: 'c1' } }));
    }),
  );
  return { imports, puts };
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ToastProvider>
          <InventoryImport />
        </ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

/** A survey export in the walk-around tool's own shape. */
function chooseFile(rows: unknown[] = [{ id: 'r1', azonosito_mod: 'HWA', hwa: 'HWA1' }]) {
  const file = new File([JSON.stringify({ eszkozok: rows })], 'eszkozok.json', { type: 'application/json' });
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [file] } });
  return file;
}

const previewButton = () => screen.getByRole('button', { name: /What would this change/ });
const applyButton = () => screen.getByRole('button', { name: /Apply/ });

describe('InventoryImport', () => {
  it('will not apply before a preview has been seen', async () => {
    seed();
    renderPage();

    // Nothing chosen: neither action is available.
    expect(previewButton()).toBeDisabled();
    expect(applyButton()).toBeDisabled();

    chooseFile();
    await waitFor(() => expect(previewButton()).toBeEnabled());
    expect(applyButton()).toBeDisabled();

    fireEvent.click(previewButton());
    await waitFor(() => expect(applyButton()).toBeEnabled());
  });

  it('reads the entry count off the file rather than asking the server', async () => {
    seed();
    renderPage();
    chooseFile([{ id: 'a' }, { id: 'b' }, { id: 'b' }]);
    // Three rows, two ids: a repeated entry id takes the last one, same as the CLI.
    expect(await screen.findByText(/2 entries across 1 file/)).toBeInTheDocument();
  });

  it('offers a fix box for the side that failed, and not for the other', async () => {
    seed({
      ...EMPTY_PLAN,
      unmatched_place: [
        {
          building: 'Nowhere House', floor: '0', rows: 4,
          building_matched: false, building_suggestion: 'Werk1', floor_suggestion: null,
        },
        {
          building: 'Werk1', floor: 'the attic', rows: 1,
          building_matched: true, building_suggestion: null, floor_suggestion: 'Attic',
        },
      ],
    });
    renderPage();
    chooseFile();
    await waitFor(() => expect(previewButton()).toBeEnabled());
    fireEvent.click(previewButton());

    // The unknown building gets a box; its floor does not, because it was never checked.
    const buildingBox = await screen.findByLabelText('What "Nowhere House" should read as');
    expect((buildingBox as HTMLInputElement).value).toBe('Werk1');
    expect(screen.getByLabelText('What "the attic" should read as')).toBeInTheDocument();
    expect(screen.queryByLabelText('What "0" should read as')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('What "Werk1" should read as')).not.toBeInTheDocument();
  });

  it('saves a fix and re-runs the preview so the list shrinks', async () => {
    const { imports, puts } = seed({
      ...EMPTY_PLAN,
      missing_work_areas: [{
        where: 'Werk1 / Ground', zone_name: 'HR', room_name: 'Rcpcio',
        raw_room_name: 'Rcpcio', rows: 3, suggestion: 'Recepció',
      }],
    });
    renderPage();
    chooseFile();
    await waitFor(() => expect(previewButton()).toBeEnabled());
    fireEvent.click(previewButton());

    const box = await screen.findByLabelText('What "Rcpcio" should read as');
    // Pre-filled with the suggestion, so confirming it is one click.
    expect((box as HTMLInputElement).value).toBe('Recepció');
    fireEvent.click(screen.getByRole('button', { name: /That one/ }));

    await waitFor(() => expect(puts).toEqual([
      { scope: 'work_area', from_value: 'Rcpcio', to_value: 'Recepció' },
    ]));
    // Twice: the first preview, and the one that shows the fix taking effect.
    await waitFor(() => expect(imports).toHaveLength(2));
  });

  it('says so when everything resolved', async () => {
    seed();
    renderPage();
    chooseFile();
    await waitFor(() => expect(previewButton()).toBeEnabled());
    fireEvent.click(previewButton());
    expect(await screen.findByText(/resolved/)).toBeInTheDocument();
  });

  it('passes the create-rooms choice to the server rather than deciding locally', async () => {
    const { imports } = seed();
    renderPage();
    chooseFile();
    await waitFor(() => expect(previewButton()).toBeEnabled());
    fireEvent.click(screen.getByLabelText(/create the rooms/i));
    fireEvent.click(previewButton());

    await waitFor(() => expect(imports).toHaveLength(1));
    expect(imports[0]).toMatchObject({ create_missing_workareas: true, apply: false });
  });
});
