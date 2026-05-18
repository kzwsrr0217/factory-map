import React, { useState } from 'react';
import { Asset, assetService } from '../../services/asset.service';
import { NetworkRack } from '../../services/network.service';
import { useToast } from '../../contexts/ToastContext';
import styles from '../../styles/components/RackDiagram.module.css';

const U_H = 24; // px per rack unit

const CONN_COLORS: Record<string, string> = {
  ethernet: '#3b82f6',
  fiber:    '#f97316',
  power:    '#ef4444',
  network:  '#8b5cf6',
  wifi:     '#06b6d4',
  other:    '#6b7280',
};

const CONN_TYPES = ['ethernet','fiber','network','power','usb','wifi','serial','other'];

function connColor(type: string) {
  return CONN_COLORS[type] ?? CONN_COLORS.other;
}

interface RackConnection {
  fromId: string;
  toId:   string;
  type:   string;
  sourcePort: string | null;
  targetPort: string | null;
}

interface RackDiagramProps {
  rack:     NetworkRack;
  assets:   Asset[];       // only assets with rack_id === rack._id
  onRefresh: () => void;
}

export const RackDiagram: React.FC<RackDiagramProps> = ({ rack, assets, onRefresh }) => {
  const toast = useToast();
  const [patchFrom, setPatchFrom]   = useState<Asset | null>(null);
  const [patchToId, setPatchToId]   = useState('');
  const [patchType, setPatchType]   = useState('ethernet');
  const [patchSrc,  setPatchSrc]    = useState('');
  const [patchDst,  setPatchDst]    = useState('');
  const [saving,    setSaving]      = useState(false);

  // Derive intra-rack connections from the assets' connection lists
  const rackAssetIds = new Set(assets.map(a => a._id!));
  const connections: RackConnection[] = [];
  const seen = new Set<string>();
  for (const a of assets) {
    for (const c of a.connections ?? []) {
      if (!rackAssetIds.has(c.connected_asset_id)) continue;
      const key = [a._id, c.connected_asset_id].sort().join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      connections.push({
        fromId: a._id!,
        toId:   c.connected_asset_id,
        type:   c.connection_type,
        sourcePort: (c as any).source_port ?? null,
        targetPort: (c as any).target_port ?? null,
      });
    }
  }

  // Center-Y of a device in the SVG (0-based from top)
  const centerY = (a: Asset) => {
    const u = a.hierarchy?.u_position ?? null;
    const sz = a.hierarchy?.rack_u_size ?? 1;
    if (u == null) return null;
    return ((u - 1) + sz / 2) * U_H;
  };

  const svgH = rack.u_count * U_H;
  const svgW = 160;

  const handleSavePatch = async () => {
    if (!patchFrom || !patchToId) { toast.error('Select both devices'); return; }
    setSaving(true);
    try {
      await assetService.addConnection(patchFrom._id!, {
        connected_asset_id: patchToId,
        connection_type:    patchType,
        bidirectional:      true,
        source_port:        patchSrc.trim() || null,
        target_port:        patchDst.trim() || null,
      });
      toast.success('Patch cable added');
      setPatchFrom(null); setPatchToId(''); setPatchSrc(''); setPatchDst('');
      onRefresh();
    } catch {
      toast.error('Failed to add patch cable');
    } finally {
      setSaving(false);
    }
  };

  // Sort by u_position; unpositioned assets at the end
  const sorted = [...assets].sort((a, b) => {
    const ua = a.hierarchy?.u_position ?? 9999;
    const ub = b.hierarchy?.u_position ?? 9999;
    return ua - ub;
  });

  // Build U slot occupancy map (1-indexed)
  const slotMap = new Map<number, Asset>();
  for (const a of sorted) {
    const u = a.hierarchy?.u_position;
    const sz = a.hierarchy?.rack_u_size ?? 1;
    if (u == null) continue;
    for (let i = 0; i < sz; i++) slotMap.set(u + i, a);
  }

  return (
    <div className={styles.wrap}>
      <div className={styles.diagramRow}>
        {/* U-slot grid */}
        <div className={styles.slotCol}>
          {Array.from({ length: rack.u_count }, (_, i) => {
            const u = i + 1;
            const asset = slotMap.get(u);
            const isTop = asset && asset.hierarchy?.u_position === u;
            const sz = asset?.hierarchy?.rack_u_size ?? 1;

            if (asset && !isTop) return null; // span handled by top row

            return (
              <div
                key={u}
                className={styles.uRow}
                style={{ height: (isTop ? sz : 1) * U_H }}
              >
                <span className={styles.uNum}>{u}</span>
                {asset ? (
                  <div
                    className={`${styles.device} ${patchFrom?._id === asset._id ? styles.deviceActive : ''}`}
                    style={{ height: sz * U_H - 2 }}
                    title={asset.basic_info?.display_name}
                  >
                    <span className={styles.deviceName}>
                      {asset.basic_info?.display_name}
                    </span>
                    <span className={styles.deviceMeta}>
                      {sz > 1 ? `${sz}U · ` : ''}{asset.basic_info?.type ?? ''}
                    </span>
                    <button
                      className={styles.patchBtn}
                      onClick={() => { setPatchFrom(a => a?._id === asset._id ? null : asset); setPatchToId(''); }}
                      title="Add patch cable from this device"
                    >
                      + patch
                    </button>
                  </div>
                ) : (
                  <div className={styles.emptySlot} />
                )}
              </div>
            );
          })}
        </div>

        {/* SVG connection cables */}
        <svg className={styles.cableSvg} width={svgW} height={svgH} viewBox={`0 0 ${svgW} ${svgH}`}>
          {connections.map((conn, idx) => {
            const from = assets.find(a => a._id === conn.fromId);
            const to   = assets.find(a => a._id === conn.toId);
            const y1   = from ? centerY(from) : null;
            const y2   = to   ? centerY(to)   : null;
            if (y1 == null || y2 == null) return null;

            const cx = 60 + (idx % 4) * 20; // stagger overlapping cables
            const color = connColor(conn.type);

            return (
              <g key={idx}>
                <path
                  d={`M 0,${y1} C ${cx},${y1} ${cx},${y2} 0,${y2}`}
                  fill="none"
                  stroke={color}
                  strokeWidth={2}
                  strokeOpacity={0.85}
                />
                {conn.sourcePort && (
                  <text x={4} y={y1 - 3} fontSize={9} fill={color}>{conn.sourcePort}</text>
                )}
                {conn.targetPort && (
                  <text x={4} y={y2 + 10} fontSize={9} fill={color}>{conn.targetPort}</text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      {/* Assets without a U position */}
      {sorted.filter(a => a.hierarchy?.u_position == null).length > 0 && (
        <div className={styles.noUSection}>
          <span className={styles.noULabel}>No U position assigned</span>
          {sorted.filter(a => a.hierarchy?.u_position == null).map(a => (
            <div key={a._id} className={styles.noUItem}>
              <span>{a.basic_info?.display_name}</span>
              <button
                className={styles.patchBtn}
                onClick={() => { setPatchFrom(p => p?._id === a._id ? null : a); setPatchToId(''); }}
              >+ patch</button>
            </div>
          ))}
        </div>
      )}

      {/* Inline patch form */}
      {patchFrom && (
        <div className={styles.patchForm}>
          <span className={styles.patchFromLabel}>
            📌 {patchFrom.basic_info?.display_name}
          </span>
          <input
            className={styles.patchInput}
            value={patchSrc}
            onChange={e => setPatchSrc(e.target.value)}
            placeholder="My port  e.g. Gi0/1"
          />
          <span className={styles.patchArrow}>——→</span>
          <select
            className={styles.patchInput}
            value={patchToId}
            onChange={e => setPatchToId(e.target.value)}
          >
            <option value="">Select target device…</option>
            {assets.filter(a => a._id !== patchFrom._id).map(a => (
              <option key={a._id} value={a._id!}>{a.basic_info?.display_name}</option>
            ))}
          </select>
          <input
            className={styles.patchInput}
            value={patchDst}
            onChange={e => setPatchDst(e.target.value)}
            placeholder="Their port  e.g. eth0"
          />
          <select
            className={styles.patchInput}
            value={patchType}
            onChange={e => setPatchType(e.target.value)}
          >
            {CONN_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <button
            className={styles.patchSave}
            disabled={!patchToId || saving}
            onClick={handleSavePatch}
          >
            {saving ? '…' : 'Connect'}
          </button>
          <button className={styles.patchCancel} onClick={() => setPatchFrom(null)}>✕</button>
        </div>
      )}
    </div>
  );
};

export default RackDiagram;
