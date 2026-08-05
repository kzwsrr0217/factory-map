/**
 * BuildingFormModal.test.tsx — A save that shows.
 *
 * Renaming a building on its own detail page looked like it did nothing: the PATCH went
 * through, but the page's `onSuccess` only closed the modal and the detail query sits behind
 * a five-minute `staleTime`, so the old name stayed on screen. The list page worked only
 * because it happened to pass an explicit `refetch()`.
 *
 * So the behaviour worth pinning is not "it sends the request" — it is that the component
 * doing the write invalidates what it wrote, for every caller, whatever they pass in.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { rest } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { server } from '../mocks/server';
import { ToastProvider } from '../contexts/ToastContext';
import { ThemeProvider } from '../contexts/ThemeContext';
import BuildingFormModal from '../components/building/BuildingFormModal';
import { buildingKeys } from '../hooks/queries/useBuildings';

const API = process.env.REACT_APP_API_URL || 'http://localhost:4000/api';

beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const BUILDING = { _id: 'b1', name: 'Werk1', address: null, metadata: {} } as any;

function renderModal(building: any, onSuccess = jest.fn()) {
  // gcTime must NOT be 0 here: these seeded queries have no observer, so a zero garbage
  // window drops them from the cache immediately and there is nothing left to assert on.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  // Seed both caches with the old name, the way a page that has already loaded would hold it.
  queryClient.setQueryData(buildingKeys.all, [BUILDING]);
  queryClient.setQueryData(buildingKeys.detail('b1'), BUILDING);
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ToastProvider>
          <BuildingFormModal isOpen onClose={jest.fn()} onSuccess={onSuccess} building={building} />
        </ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return { ...utils, queryClient, onSuccess };
}

describe('BuildingFormModal', () => {
  it('marks the building queries stale after a rename, so the page it was opened from updates', async () => {
    let sent: unknown;
    server.use(rest.patch(`${API}/buildings/b1`, async (req, res, ctx) => {
      sent = await req.json();
      return res(ctx.json({ success: true, data: { ...BUILDING, name: 'Werk 1' } }));
    }));

    const { queryClient, onSuccess } = renderModal(BUILDING);
    fireEvent.change(screen.getByLabelText(/Building Name/), { target: { value: 'Werk 1' } });
    fireEvent.click(screen.getByRole('button', { name: /Update Building/ }));

    await waitFor(() => expect(sent).toMatchObject({ name: 'Werk 1' }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalled());

    // Both the list and the detail: they share the ['buildings'] prefix on purpose, and the
    // detail is the one that used to keep showing the old name.
    expect(queryClient.getQueryState(buildingKeys.all)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(buildingKeys.detail('b1'))?.isInvalidated).toBe(true);
  });

  it('does the same after a create, so a new building appears without a reload', async () => {
    server.use(rest.post(`${API}/buildings`, (_req, res, ctx) =>
      res(ctx.json({ success: true, data: { _id: 'b2', name: 'Werk 2' } }))));

    const { queryClient } = renderModal(null);
    fireEvent.change(screen.getByLabelText(/Building Name/), { target: { value: 'Werk 2' } });
    fireEvent.click(screen.getByRole('button', { name: /Create Building/ }));

    await waitFor(() =>
      expect(queryClient.getQueryState(buildingKeys.all)?.isInvalidated).toBe(true));
  });

  it('leaves the caches alone when the save fails', async () => {
    server.use(rest.patch(`${API}/buildings/b1`, (_req, res, ctx) =>
      res(ctx.status(400), ctx.json({ success: false, error: 'name is required' }))));

    const { queryClient, onSuccess } = renderModal(BUILDING);
    fireEvent.change(screen.getByLabelText(/Building Name/), { target: { value: 'Werk 1' } });
    fireEvent.click(screen.getByRole('button', { name: /Update Building/ }));

    // The server's own message, not a generic one — and nothing is marked stale, because
    // nothing changed.
    expect(await screen.findByText(/name is required/)).toBeInTheDocument();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(queryClient.getQueryState(buildingKeys.all)?.isInvalidated).toBe(false);
  });
});
