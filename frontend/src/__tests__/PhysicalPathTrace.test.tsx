/**
 * PhysicalPathTrace.test.tsx — The four-step chain and where it offers to act.
 *
 * The rule worth pinning down is that exactly one step carries an action: the first
 * unrecorded one. The steps are not independent — there is nothing to patch before a
 * socket is assigned — so offering every gap at once would misdescribe the workflow.
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import PhysicalPathTrace from '../components/network/PhysicalPathTrace';
import { Asset } from '../services/asset.service';

jest.mock('react-router-dom', () => ({
  Link: ({ children, to }: { children: React.ReactNode; to: string }) =>
    <a href={String(to)}>{children}</a>,
}));

type WallPort = NonNullable<Asset['wall_port']>;

function asset(over: { floor_id?: string | null; wall_port?: Partial<WallPort> | null }): Asset {
  return {
    _id: 'a1',
    basic_info: { display_name: 'MMH-PC-1', type: 'desktop', status: 'active' },
    hierarchy: { building_id: 'b1', floor_id: over.floor_id ?? null, workarea_id: null },
    wall_port: over.wall_port
      ? { _id: 'wp1', label: 'R1/001', floor_id: 'f1', patch_panel_id: null, patch_panel_name: null,
          patch_port: null, rack_name: null, room_name: null, room_type: null,
          switch_asset_id: null, switch_port: null, description: null, ...over.wall_port }
      : null,
  } as unknown as Asset;
}

describe('PhysicalPathTrace', () => {
  it('always shows all four steps, even for a device with nothing recorded', () => {
    // The chain doubles as the description of the workflow, so it must not collapse
    // to a single hint when the work has not started.
    render(<PhysicalPathTrace asset={asset({})} />);
    for (const label of ['On the floor plan', 'Socket', 'Patch panel', 'Switch port']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('offers placing first when the device is not on a floor', () => {
    render(<PhysicalPathTrace asset={asset({})} placeHref="/unplaced" onAssignSocket={jest.fn()} />);
    expect(screen.getByText(/Place it/)).toBeInTheDocument();
    // Socket comes later in the chain, so its action stays hidden for now.
    expect(screen.queryByText(/Assign a socket/)).not.toBeInTheDocument();
  });

  it('offers the socket once the device is placed', () => {
    const onAssignSocket = jest.fn();
    render(<PhysicalPathTrace asset={asset({ floor_id: 'f1' })} onAssignSocket={onAssignSocket} />);
    expect(screen.queryByText('Not placed yet')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText(/Assign a socket/));
    expect(onAssignSocket).toHaveBeenCalled();
  });

  it('links patching to the rack the socket sits in', () => {
    render(<PhysicalPathTrace asset={asset({ floor_id: 'f1', wall_port: { rack_id: 'rack-7', building_id: 'b1' } })} />);
    const action = screen.getByText(/Patch it at the rack/).closest('a');
    expect(action).toHaveAttribute('href', '/infrastructure?rack=rack-7&building=b1');
  });

  it('falls back to the infrastructure page when there is no rack yet', () => {
    // No panel means no rack to open — the link still has to go somewhere useful.
    render(<PhysicalPathTrace asset={asset({ floor_id: 'f1', wall_port: {} })} />);
    expect(screen.getByText(/Patch it at the rack/).closest('a')).toHaveAttribute('href', '/infrastructure');
  });

  it('asks for the switch port once the socket is patched', () => {
    render(<PhysicalPathTrace asset={asset({
      floor_id: 'f1',
      wall_port: { patch_panel_id: 'pp1', patch_panel_name: 'PP-1', patch_port: 12, rack_id: 'rack-7', rack_name: 'R1' },
    })} />);
    expect(screen.getByText('No switch port recorded')).toBeInTheDocument();
    expect(screen.getByText(/Record it at the rack/)).toBeInTheDocument();
    expect(screen.queryByText(/Patch it at the rack/)).not.toBeInTheDocument();
  });

  it('offers nothing when the whole chain is recorded', () => {
    render(<PhysicalPathTrace
      asset={asset({
        floor_id: 'f1',
        wall_port: { patch_panel_id: 'pp1', patch_panel_name: 'PP-1', patch_port: 12, switch_port: 'Gi1/0/12', switch_asset_id: 'sw1' },
      })}
      peerAssets={[{ _id: 'sw1', basic_info: { display_name: 'SW-CORE-1', type: 'switch' } } as unknown as Asset]}
      onAssignSocket={jest.fn()}
    />);
    expect(screen.getByText('R1/001')).toBeInTheDocument();
    expect(screen.getByText('Gi1/0/12')).toBeInTheDocument();
    expect(screen.getByText('SW-CORE-1')).toBeInTheDocument();
    expect(screen.queryByText(/Assign a socket|Patch it|Record it|Place it/)).not.toBeInTheDocument();
  });

  it('words each downstream gap for the state it is actually in', () => {
    // With no socket there is nothing to patch yet — which is a different fact from
    // a socket that exists and was never patched.
    render(<PhysicalPathTrace asset={asset({ floor_id: 'f1' })} />);
    expect(screen.getByText('Nothing to patch yet')).toBeInTheDocument();
    expect(screen.getByText('No switch reached yet')).toBeInTheDocument();
  });

  it('describes the gap even where the host page has no action to offer', () => {
    // The map's side panel has nowhere to put an editor, so the props are omitted —
    // the reader should still learn what is missing.
    render(<PhysicalPathTrace asset={asset({ floor_id: 'f1' })} />);
    expect(screen.getByText('No socket assigned')).toBeInTheDocument();
    expect(screen.queryByText(/Assign a socket/)).not.toBeInTheDocument();
  });
});
