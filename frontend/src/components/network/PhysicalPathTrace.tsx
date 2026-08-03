/**
 * PhysicalPathTrace.tsx — "Where does this device's network cable actually go?"
 *
 * Renders the socket chain for one asset:
 *   socket → patch panel + port → rack → network room (IDF/MDF) → switch port → switch
 *
 * This is the answer to the service desk's most common question, so it has to be
 * reachable from both places someone lands on a device: the map's side panel and
 * the asset's own page. It used to exist only inside MapView.
 *
 * Every hop is optional. A socket with no panel, or a panel with no switch, is a
 * normal mid-survey state and is shown as such rather than hidden — see
 * docs/CONNECTIONS_WORKFLOW.md.
 */
import React from 'react';
import { Asset } from '../../services/asset.service';
import styles from '../../styles/components/PhysicalPathTrace.module.css';

interface PhysicalPathTraceProps {
  asset: Asset;
  /** Used to name the switch behind `switch_asset_id`. Optional — the port shows either way. */
  allAssets?: Asset[];
  /** Shown when the asset has no socket assigned. */
  emptyHint?: string;
}

const PhysicalPathTrace: React.FC<PhysicalPathTraceProps> = ({
  asset, allAssets = [], emptyHint = 'No wall port assigned — edit the asset to set one',
}) => {
  const port = asset.wall_port;

  if (!port) {
    return <div className={styles.unpatched}>{emptyHint}</div>;
  }

  const switchAsset = port.switch_asset_id
    ? allAssets.find((a) => a._id === port.switch_asset_id)
    : undefined;

  return (
    <div className={styles.connection}>
      <div className={styles.endpoint}>
        <div className={styles.endpointName}>
          🔌 {port.label}
          {port.description && <span className={styles.endpointSub}> — {port.description}</span>}
        </div>

        {port.patch_panel_name && (
          <div className={styles.step}>
            📋 {port.patch_panel_name}
            {port.patch_port != null && <span className={styles.stepBadge}>port {port.patch_port}</span>}
          </div>
        )}
        {port.rack_name && <div className={styles.step}>🗄️ {port.rack_name}</div>}
        {port.room_name && (
          <div className={styles.step}>
            🏠 {port.room_name}
            {port.room_type && <span className={styles.stepBadge}>{port.room_type.toUpperCase()}</span>}
          </div>
        )}
        {port.switch_port && (
          <div className={styles.step}>
            🔀 switch port <span className={styles.stepMono}>{port.switch_port}</span>
          </div>
        )}
        {switchAsset && (
          <div className={styles.step}>
            🖧 <span className={styles.stepMono}>{switchAsset.basic_info.display_name}</span>
            <span className={styles.stepBadge}>{switchAsset.basic_info.type}</span>
          </div>
        )}

        {!port.patch_panel_id && <div className={styles.unpatched}>Not patched to a panel</div>}
        {port.patch_panel_id && !port.switch_port && (
          <div className={styles.unpatched}>Patched, but no switch port recorded</div>
        )}
      </div>
    </div>
  );
};

export default PhysicalPathTrace;
