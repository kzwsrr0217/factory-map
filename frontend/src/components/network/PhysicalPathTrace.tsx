/**
 * PhysicalPathTrace.tsx — "Where does this device's network cable actually go?"
 *
 * Renders the physical chain for one asset as four steps:
 *   on the floor plan → socket → patch panel port → switch port
 *
 * This is the answer to the service desk's most common question, so it has to be
 * reachable from both places someone lands on a device: the map's side panel and
 * the asset's own page.
 *
 * ── Why all four steps are always drawn ──────────────────────────────────────
 * The chain is also the app's only description of the recording workflow (place the
 * device, find a free socket, assign it, then patch it onto a switch at the rack —
 * docs/CONNECTIONS_WORKFLOW.md). It used to render nothing but a one-line hint
 * until a socket existed, so someone looking at a half-recorded device could not
 * see what was left to do or where to do it. Now every step shows either its value
 * or what is missing, and the first missing step carries the action that fixes it:
 * `onAssignSocket` opens the asset's own editor, `rackHref` goes to the rack view
 * where patching is done.
 *
 * Actions are optional. Without them the step still says what is missing — the map
 * side panel, for instance, has nowhere to put an editor.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { MapPin, Plug, LayoutPanelTop, Network, Check, ArrowRight } from 'lucide-react';
import { Asset } from '../../services/asset.service';
import styles from '../../styles/components/PhysicalPathTrace.module.css';

interface PhysicalPathTraceProps {
  asset: Asset;
  /** Used to name the switch behind `switch_asset_id`. Optional — the port shows either way. */
  peerAssets?: Asset[];
  /** Opens the asset's editor at the socket field. Omit to show the gap without an action. */
  onAssignSocket?: () => void;
  /**
   * Where to place an unplaced asset. Given a floor, the floor's own page; otherwise
   * the Unplaced Assets list. Omit to describe the gap without linking.
   */
  placeHref?: string;
}

/** One row of the chain. `value` present = recorded; otherwise `missing` is shown. */
interface Step {
  icon: React.ReactNode;
  label: string;
  value?: React.ReactNode;
  /** What is not recorded yet, in the words of the person who would record it. */
  missing?: string;
  /** Offered on the first unrecorded step only — see `firstGapIndex` below. */
  action?: React.ReactNode;
}

const PhysicalPathTrace: React.FC<PhysicalPathTraceProps> = ({
  asset, peerAssets = [], onAssignSocket, placeHref,
}) => {
  const port = asset.wall_port;
  const placed = !!asset.hierarchy?.floor_id;
  const switchAsset = port?.switch_asset_id
    ? peerAssets.find((a) => a._id === port.switch_asset_id)
    : undefined;

  // Patching happens at the rack, so that is where the action points. Falls back to
  // the infrastructure page unfiltered when the rack id isn't resolved (the socket
  // has no panel yet, so there is no rack to open).
  const rackHref = port?.rack_id
    ? `/infrastructure?rack=${port.rack_id}${port.building_id ? `&building=${port.building_id}` : ''}`
    : '/infrastructure';

  const steps: Step[] = [
    {
      icon: <MapPin size={14} />,
      label: 'On the floor plan',
      value: placed ? (asset.hierarchy.workarea_id ? 'placed, in a work area' : 'placed') : undefined,
      missing: 'Not placed yet',
      action: placeHref
        ? <Link to={placeHref} className={styles.stepAction}>Place it <ArrowRight size={12} /></Link>
        : undefined,
    },
    {
      icon: <Plug size={14} />,
      label: 'Socket',
      value: port
        ? <>
            <span className={styles.stepMono}>{port.label}</span>
            {port.description && <span className={styles.endpointSub}> — {port.description}</span>}
          </>
        : undefined,
      missing: 'No socket assigned',
      action: onAssignSocket
        ? <button type="button" className={styles.stepAction} onClick={onAssignSocket}>
            Assign a socket <ArrowRight size={12} />
          </button>
        : undefined,
    },
    {
      icon: <LayoutPanelTop size={14} />,
      label: 'Patch panel',
      value: port?.patch_panel_id
        ? <>
            {port.patch_panel_name ?? 'panel'}
            {port.patch_port != null && <span className={styles.stepBadge}>port {port.patch_port}</span>}
            {port.rack_name && <span className={styles.stepBadge}>{port.rack_name}</span>}
            {port.room_name && (
              <span className={styles.stepBadge}>
                {port.room_name}{port.room_type ? ` · ${port.room_type.toUpperCase()}` : ''}
              </span>
            )}
          </>
        : undefined,
      // Each step describes its own state truthfully: with no socket there is nothing
      // to patch yet, which is different from a socket that was never patched.
      missing: port ? 'Socket not patched to a panel' : 'Nothing to patch yet',
      action: port ? <Link to={rackHref} className={styles.stepAction}>Patch it at the rack <ArrowRight size={12} /></Link> : undefined,
    },
    {
      icon: <Network size={14} />,
      label: 'Switch port',
      value: port?.switch_port
        ? <>
            <span className={styles.stepMono}>{port.switch_port}</span>
            {switchAsset && <span className={styles.stepBadge}>{switchAsset.basic_info.display_name}</span>}
          </>
        : undefined,
      missing: port?.patch_panel_id ? 'No switch port recorded' : 'No switch reached yet',
      action: port?.patch_panel_id
        ? <Link to={rackHref} className={styles.stepAction}>Record it at the rack <ArrowRight size={12} /></Link>
        : undefined,
    },
  ];

  // Only the first gap gets an action. Offering all of them at once would suggest
  // they can be done in any order; they cannot — there is nothing to patch before a
  // socket is assigned.
  const firstGapIndex = steps.findIndex((s) => s.value === undefined);

  return (
    <div className={styles.chain}>
      {steps.map((step, i) => {
        const done = step.value !== undefined;
        const isNext = i === firstGapIndex;
        return (
          <div
            key={step.label}
            className={`${styles.chainStep} ${done ? styles.chainStepDone : ''} ${isNext ? styles.chainStepNext : ''}`}
          >
            <span className={styles.chainIcon}>{done ? <Check size={14} /> : step.icon}</span>
            <span className={styles.chainBody}>
              <span className={styles.chainLabel}>{step.label}</span>
              {done
                ? <span className={styles.chainValue}>{step.value}</span>
                : <span className={styles.chainMissing}>{step.missing}</span>}
            </span>
            {isNext && step.action}
          </div>
        );
      })}
    </div>
  );
};

export default PhysicalPathTrace;
