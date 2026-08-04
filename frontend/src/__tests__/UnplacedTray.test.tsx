/**
 * UnplacedTray.test.tsx — The tray's search contract and the keep-placing flow.
 *
 * The cross-floor pool is fetched lazily, on the first keystroke, so the tray has
 * to be usable while that pool is still empty. It briefly was not: the search box
 * only rendered when the pool was non-empty, and the pool only loaded once someone
 * searched. These tests pin the loop shut from this end; FloorMap keeps the tray
 * mounted from the other (`hasTrayContent`).
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import UnplacedTray from '../components/map/UnplacedTray';
import { Asset } from '../services/asset.service';

function asset(name: string, extra: Record<string, unknown> = {}): Asset {
  return {
    _id: name,
    basic_info: { display_name: name, type: 'desktop', status: 'active' },
    custom_fields: {},
    ...extra,
  } as unknown as Asset;
}

function renderTray(props: Partial<React.ComponentProps<typeof UnplacedTray>> = {}) {
  const onSearch = jest.fn();
  const utils = render(
    <UnplacedTray
      unplacedAssets={[]}
      searchableUnplacedAssets={[]}
      placingAssetId={null}
      onSelect={jest.fn()}
      onClose={jest.fn()}
      onSearch={onSearch}
      {...props}
    />,
  );
  return { ...utils, onSearch, input: screen.getByRole('textbox') };
}

describe('UnplacedTray search', () => {
  it('offers the search box even with nothing loaded yet', () => {
    // Without this the lazy pool can never be requested.
    const { input } = renderTray();
    expect(input).toBeInTheDocument();
  });

  it('asks the parent to load the pool on the first keystroke', () => {
    const { input, onSearch } = renderTray();
    fireEvent.change(input, { target: { value: 'pc' } });
    expect(onSearch).toHaveBeenCalled();
  });

  it('does not ask for the pool when the box is only cleared', () => {
    const { input, onSearch } = renderTray({ initialSearch: 'pc' });
    fireEvent.change(input, { target: { value: '' } });
    expect(onSearch).not.toHaveBeenCalled();
  });

  it('shows pool matches once they arrive, without a second keystroke', () => {
    const { input, rerender } = renderTray();
    fireEvent.change(input, { target: { value: 'mmh42' } });
    expect(screen.getByText('No matches')).toBeInTheDocument();

    // What the awaited fetch does: new props, same typed query.
    rerender(
      <UnplacedTray
        unplacedAssets={[]}
        searchableUnplacedAssets={[asset('MMH42-PC'), asset('MMH43-PC')]}
        placingAssetId={null}
        onSelect={jest.fn()}
        onClose={jest.fn()}
        onSearch={jest.fn()}
      />,
    );
    expect(screen.getByText('MMH42-PC')).toBeInTheDocument();
    expect(screen.queryByText('MMH43-PC')).not.toBeInTheDocument();
  });

  it('keeps the query when reopened after the tray was closed', () => {
    const { input } = renderTray({
      initialSearch: 'mmh42',
      searchableUnplacedAssets: [asset('MMH42-PC')],
    });
    expect(input).toHaveValue('mmh42');
    expect(screen.getByText('MMH42-PC')).toBeInTheDocument();
  });
});

describe('UnplacedTray keep placing', () => {
  /**
   * Placing a room's worth of devices should be click-click-click. The tray arms the
   * next device in the order it is displaying, which is what makes the sequence
   * follow whatever filter the person is working through.
   */
  const three = [asset('PC-1'), asset('PC-2'), asset('PC-3')];

  function renderWithQueue(props: Partial<React.ComponentProps<typeof UnplacedTray>> = {}) {
    const onSelect = jest.fn();
    const utils = render(
      <UnplacedTray
        unplacedAssets={three}
        searchableUnplacedAssets={[]}
        placingAssetId={null}
        onSelect={onSelect}
        onClose={jest.fn()}
        {...props}
      />,
    );
    return { ...utils, onSelect };
  }

  beforeEach(() => localStorage.clear());

  it('arms the device after the one just placed', () => {
    const { onSelect, rerender } = renderWithQueue();
    rerender(
      <UnplacedTray
        unplacedAssets={three}
        searchableUnplacedAssets={[]}
        placingAssetId={null}
        onSelect={onSelect}
        onClose={jest.fn()}
        justPlacedId="PC-1"
      />,
    );
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ _id: 'PC-2' }));
  });

  it('wraps to what is left rather than stopping at the end of the list', () => {
    // Placing the last row mid-room shouldn't end the run; the earlier rows that are
    // still unplaced are the obvious continuation.
    const { onSelect, rerender } = renderWithQueue();
    rerender(
      <UnplacedTray
        unplacedAssets={three}
        searchableUnplacedAssets={[]}
        placingAssetId={null}
        onSelect={onSelect}
        onClose={jest.fn()}
        justPlacedId="PC-3"
      />,
    );
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ _id: 'PC-1' }));
  });

  it('counts placements without arming anything when switched off', () => {
    localStorage.setItem('map-keep-placing', 'off');
    const { onSelect, rerender } = renderWithQueue();
    rerender(
      <UnplacedTray
        unplacedAssets={three}
        searchableUnplacedAssets={[]}
        placingAssetId={null}
        onSelect={onSelect}
        onClose={jest.fn()}
        justPlacedId="PC-1"
      />,
    );
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByText('1 placed')).toBeInTheDocument();
  });

  it('ignores an id that was already placed before this tray was opened', () => {
    // The map keeps the last placed id; reopening the tray must not re-arm from it.
    const { onSelect } = renderWithQueue({ justPlacedId: 'PC-1' });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('follows the search results, not the unfiltered list', () => {
    const { onSelect, rerender } = renderWithQueue({
      unplacedAssets: [asset('PC-1'), asset('SRV-1'), asset('PC-2')],
    });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'pc' } });
    rerender(
      <UnplacedTray
        unplacedAssets={[asset('PC-1'), asset('SRV-1'), asset('PC-2')]}
        searchableUnplacedAssets={[]}
        placingAssetId={null}
        onSelect={onSelect}
        onClose={jest.fn()}
        justPlacedId="PC-1"
      />,
    );
    // SRV-1 sits between them in the raw list but is filtered out, so PC-2 is next.
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ _id: 'PC-2' }));
  });
});
