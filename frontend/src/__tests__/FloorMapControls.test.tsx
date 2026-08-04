/**
 * FloorMapControls.test.tsx — The map's control rail.
 *
 * Two things worth holding still. First, the layer toggles are a named checkbox list
 * rather than six unlabelled icons, and the checkbox state is the layer state — the
 * icons only signalled it as a highlight. Second, and this is the bug that named list
 * exposed: the toggles have to work on a page that doesn't own layer state. Only
 * MapView passes `layers` + `onLayerToggle`; the floor page and the dashboard's
 * embedded map don't, and there every click used to be dropped while the buttons
 * still looked enabled.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import FloorMap from '../components/map/FloorMap';

jest.mock('react-router-dom', () => ({
  useNavigate: () => jest.fn(),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => <a href={String(to)}>{children}</a>,
}));

// The rail's export buttons pull these in; neither is exercised here.
jest.mock('jspdf', () => function JsPDF() {
  return { save: jest.fn(), text: jest.fn(), addImage: jest.fn(), internal: { pageSize: { getWidth: () => 210, getHeight: () => 297 } } };
});

function renderMap(props: Partial<React.ComponentProps<typeof FloorMap>> = {}) {
  return render(<FloorMap workareas={[]} assets={[]} {...props} />);
}

const gridRect = (container: HTMLElement) => container.querySelector('rect[fill="url(#grid)"]');

describe('FloorMap control rail', () => {
  it('names every control instead of relying on a hovered tooltip', () => {
    renderMap();
    for (const name of ['Zoom in', 'Zoom out', 'Fit to content', 'Reset view', 'Export as PNG', 'Print']) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: /Layers/ })).toBeInTheDocument();
  });

  it('lists the layers by name, with their state in the checkboxes', () => {
    renderMap();
    fireEvent.click(screen.getByRole('button', { name: /Layers/ }));
    for (const label of ['Work areas', 'Devices', 'Device names', 'Connections', 'Grid', 'Minimap']) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
    // Connections are off by default, everything else on — see DEFAULT_LAYERS.
    expect(screen.getByLabelText('Connections')).not.toBeChecked();
    expect(screen.getByLabelText('Grid')).toBeChecked();
  });

  it('toggles a layer on a page that does not own layer state', () => {
    const { container } = renderMap();
    expect(gridRect(container)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Layers/ }));
    fireEvent.click(screen.getByLabelText('Grid'));

    expect(screen.getByLabelText('Grid')).not.toBeChecked();
    expect(gridRect(container)).not.toBeInTheDocument();
  });

  it('leaves the decision to the host page when it does own the state', () => {
    // MapView persists the choice, so FloorMap must not keep a second copy that
    // disagrees with it.
    const onLayerToggle = jest.fn();
    const { container } = renderMap({
      layers: { workareas: true, assets: true, connections: false, grid: false },
      onLayerToggle,
    });
    expect(gridRect(container)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Layers/ }));
    fireEvent.click(screen.getByLabelText('Grid'));

    expect(onLayerToggle).toHaveBeenCalledWith('grid');
    // Still off: the prop hasn't changed, and nothing local overrides it.
    expect(gridRect(container)).not.toBeInTheDocument();
  });

  it('closes the layer list with Escape', () => {
    renderMap();
    fireEvent.click(screen.getByRole('button', { name: /Layers/ }));
    fireEvent.keyDown(screen.getByLabelText('Grid'), { key: 'Escape' });
    expect(screen.queryByLabelText('Grid')).not.toBeInTheDocument();
  });
});
