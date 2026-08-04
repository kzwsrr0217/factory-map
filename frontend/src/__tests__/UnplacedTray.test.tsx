/**
 * UnplacedTray.test.tsx — The tray's search contract.
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
