/**
 * AssetReports.tsx — Aggregated statistics and ITSM-diff report panel.
 *
 * Can render either as a full-screen Modal (default) or inline (`inline` prop)
 * for embedding inside the Reports page without a backdrop overlay.
 *
 * Report sections:
 *   Overview         — total assets, ITSM-managed count, assets by status and
 *                      type (bar-style percentage breakdowns).
 *   Connections      — total connections, average per asset, most-connected
 *                      asset, and a breakdown by connection type.
 *   Maintenance      — assets needing maintenance, with warranty-expired count
 *                      and upcoming expiries (next 30 days).
 *   Location         — placed vs unplaced counts, assets per building/floor.
 *   ITSM Sync        — assets with pending ITSM snapshots (itsm_snapshot ≠ null)
 *                      grouped by field differences; accept/dismiss actions.
 *
 * All data is fetched fresh on open (`isOpen` or `inline` mount) via parallel
 * Promise.all calls to `assetService`, `hierarchyService`, and `floorService`.
 */
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  PieChart, Pie, Legend,
} from 'recharts';
import Modal from '../common/Modal';
import Button from '../common/Button';
import Badge from '../common/Badge';
import Card from '../common/Card';
import { assetService, Asset } from '../../services/asset.service';
import { hierarchyService, Building } from '../../services/hierarchy.service';
import { floorService, Floor } from '../../services/floor.service';
import styles from '../../styles/components/AssetReports.module.css';

const STATUS_COLORS: Record<string, string> = {
  active: '#10b981',
  maintenance: '#f59e0b',
  inactive: '#6b7280',
  retired: '#ef4444',
};

const TYPE_COLORS = [
  '#3b82f6', '#8b5cf6', '#06b6d4', '#f97316', '#84cc16',
  '#ec4899', '#14b8a6', '#f59e0b', '#6366f1', '#78716c',
];

// ── Topology constants ──────────────────────────────────────
const VW = 1800;
const VH = 1200;

const TOPO_TYPE_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#06b6d4', '#f97316', '#84cc16', '#ec4899', '#14b8a6',
  '#6366f1', '#78716c', '#a855f7', '#0ea5e9', '#22d3ee',
];

const EDGE_COLORS: Record<string, string> = {
  network: '#3b82f6', ethernet: '#3b82f6', fiber: '#8b5cf6',
  wifi: '#06b6d4', power: '#ef4444', usb: '#f59e0b',
  bluetooth: '#6366f1', dependency: '#f97316',
  'parent-child': '#84cc16', peer: '#14b8a6',
  serial: '#78716c', parallel: '#78716c',
};

function buildTopoLayout(
  nodes: Asset[],
  edges: { s: string; t: string }[],
): Map<string, { x: number; y: number }> {
  if (nodes.length === 0) return new Map();

  const typeGroups = new Map<string, Asset[]>();
  nodes.forEach((n) => {
    const t = n.basic_info?.type ?? 'other';
    if (!typeGroups.has(t)) typeGroups.set(t, []);
    typeGroups.get(t)!.push(n);
  });

  const groups = Array.from(typeGroups.values());
  const numGroups = groups.length;
  const CX = VW / 2;
  const CY = VH / 2;
  const CLUSTER_R = Math.min(VW, VH) * 0.35;

  const pos = new Map<string, { x: number; y: number }>();
  const vel = new Map<string, { vx: number; vy: number }>();

  groups.forEach((group, gi) => {
    const cAngle = (gi / numGroups) * 2 * Math.PI - Math.PI / 2;
    const cx = CX + (numGroups > 1 ? CLUSTER_R : 0) * Math.cos(cAngle);
    const cy = CY + (numGroups > 1 ? CLUSTER_R : 0) * Math.sin(cAngle);
    const NODES_PER_RING = 8;
    const BASE_R = 30;
    const RING_STEP = 36;

    group.forEach((n, ni) => {
      const ring = Math.floor(ni / NODES_PER_RING);
      const posInRing = ni % NODES_PER_RING;
      const ringCount = Math.min(NODES_PER_RING, group.length - ring * NODES_PER_RING);
      const r = BASE_R + ring * RING_STEP;
      const angle = (posInRing / ringCount) * 2 * Math.PI;
      pos.set(n._id, { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
      vel.set(n._id, { vx: 0, vy: 0 });
    });
  });

  const REPULSE = 6000, ATTRACT = 0.04, DAMP = 0.82;
  for (let it = 0; it < 180; it++) {
    for (let a = 0; a < nodes.length; a++) {
      for (let b = a + 1; b < nodes.length; b++) {
        const pa = pos.get(nodes[a]._id)!;
        const pb = pos.get(nodes[b]._id)!;
        const va = vel.get(nodes[a]._id)!;
        const vb = vel.get(nodes[b]._id)!;
        const dx = pa.x - pb.x; const dy = pa.y - pb.y;
        const d = Math.sqrt(dx * dx + dy * dy) + 0.1;
        const f = REPULSE / (d * d);
        va.vx += (dx / d) * f; va.vy += (dy / d) * f;
        vb.vx -= (dx / d) * f; vb.vy -= (dy / d) * f;
      }
    }
    edges.forEach((e) => {
      const pa = pos.get(e.s); const pb = pos.get(e.t);
      const va = vel.get(e.s); const vb = vel.get(e.t);
      if (!pa || !pb || !va || !vb) return;
      const dx = pb.x - pa.x; const dy = pb.y - pa.y;
      va.vx += dx * ATTRACT; va.vy += dy * ATTRACT;
      vb.vx -= dx * ATTRACT; vb.vy -= dy * ATTRACT;
    });
    nodes.forEach((n) => {
      const p = pos.get(n._id)!; const v = vel.get(n._id)!;
      p.x += v.vx; p.y += v.vy;
      v.vx *= DAMP; v.vy *= DAMP;
      p.x = Math.max(20, Math.min(VW - 20, p.x));
      p.y = Math.max(20, Math.min(VH - 20, p.y));
    });
  }

  return pos;
}

const TopologyView: React.FC<{ assets: Asset[] }> = ({ assets }) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ sx: number; sy: number; vx: number; vy: number } | null>(null);
  const [vp, setVp] = useState({ x: 0, y: 0, scale: 1 });
  const [hoverId, setHoverId] = useState<string | null>(null);

  const { nodes, edges, layout } = useMemo(() => {
    const connectedIds = new Set<string>();
    assets.forEach((a) => {
      if (a.connections?.length) {
        connectedIds.add(a._id);
        a.connections.forEach((c) => connectedIds.add(c.connected_asset_id));
      }
    });
    const nodes = assets.filter((a) => connectedIds.has(a._id));
    const edgeSet = new Set<string>();
    const edges: { s: string; t: string; type: string }[] = [];
    assets.forEach((a) => {
      a.connections?.forEach((c) => {
        const key = [a._id, c.connected_asset_id].sort().join('|');
        if (!edgeSet.has(key)) {
          edgeSet.add(key);
          edges.push({ s: a._id, t: c.connected_asset_id, type: c.connection_type });
        }
      });
    });
    const layout = buildTopoLayout(nodes, edges);
    return { nodes, edges, layout };
  }, [assets]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || nodes.length === 0) return;
    const { width, height } = wrap.getBoundingClientRect();
    const scale = Math.min(width / VW, height / VH) * 0.92;
    setVp({ x: (width - VW * scale) / 2, y: (height - VH * scale) / 2, scale });
  }, [layout, nodes.length]);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.12 : 0.89;
      setVp((prev) => {
        const s = Math.max(0.05, Math.min(10, prev.scale * factor));
        const rect = el.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        return { scale: s, x: mx - (mx - prev.x) * (s / prev.scale), y: my - (my - prev.y) * (s / prev.scale) };
      });
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const onMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    dragRef.current = { sx: e.clientX, sy: e.clientY, vx: vp.x, vy: vp.y };
  };
  const onMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const d = dragRef.current;
    if (!d) return;
    setVp((prev) => ({ ...prev, x: d.vx + e.clientX - d.sx, y: d.vy + e.clientY - d.sy }));
  };
  const onMouseUp = () => { dragRef.current = null; };

  const degreeMap = useMemo(() => {
    const m = new Map<string, number>();
    edges.forEach((e) => {
      m.set(e.s, (m.get(e.s) ?? 0) + 1);
      m.set(e.t, (m.get(e.t) ?? 0) + 1);
    });
    return m;
  }, [edges]);

  const typeIndex = useMemo(() => {
    const types = Array.from(new Set(nodes.map((n) => n.basic_info?.type ?? 'other')));
    return new Map(types.map((t, i) => [t, i]));
  }, [nodes]);

  const uniqueEdgeTypes = useMemo(() => Array.from(new Set(edges.map((e) => e.type))), [edges]);
  const uniqueNodeTypes = useMemo(() => Array.from(typeIndex.keys()), [typeIndex]);

  const fitView = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const { width, height } = wrap.getBoundingClientRect();
    const scale = Math.min(width / VW, height / VH) * 0.92;
    setVp({ x: (width - VW * scale) / 2, y: (height - VH * scale) / 2, scale });
  }, []);

  if (nodes.length === 0) {
    return (
      <div className={styles.placeholder}>
        <p>No connections found. Connect assets on the map to see the topology graph.</p>
      </div>
    );
  }

  const hoverNode = hoverId ? nodes.find((n) => n._id === hoverId) : null;
  const hoverLayout = hoverId ? layout.get(hoverId) : null;
  const hoverConnIds = hoverId
    ? new Set(edges.filter((e) => e.s === hoverId || e.t === hoverId).flatMap((e) => [e.s, e.t]))
    : null;

  return (
    <div className={styles.topologyContainer}>
      <div className={styles.topologyToolbar}>
        <p className={styles.topologyHint}>
          {nodes.length} nodes · {edges.length} edges · {uniqueNodeTypes.length} types — scroll to zoom, drag to pan
        </p>
        <div className={styles.topologyControls}>
          <button className={styles.topoBtn} onClick={() => setVp((p) => ({ ...p, scale: Math.min(10, p.scale * 1.25) }))}>+</button>
          <span className={styles.topoZoomLabel}>{Math.round(vp.scale * 100)}%</span>
          <button className={styles.topoBtn} onClick={() => setVp((p) => ({ ...p, scale: Math.max(0.05, p.scale * 0.8) }))}>−</button>
          <button className={styles.topoBtn} onClick={fitView}>Fit</button>
        </div>
      </div>

      <div ref={wrapRef} className={styles.topologySvgWrap}>
        <svg
          ref={svgRef}
          className={styles.topologySvg}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
        >
          <g transform={`translate(${vp.x},${vp.y}) scale(${vp.scale})`}>
            {edges.map((e, i) => {
              const pa = layout.get(e.s); const pb = layout.get(e.t);
              if (!pa || !pb) return null;
              const dimmed = hoverConnIds !== null && !hoverConnIds.has(e.s) && !hoverConnIds.has(e.t);
              return (
                <line key={i} x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y}
                  stroke={EDGE_COLORS[e.type] ?? '#9ca3af'}
                  strokeWidth={hoverId && !dimmed ? 2.5 : 1.5}
                  opacity={dimmed ? 0.07 : 0.6} />
              );
            })}
            {nodes.map((n) => {
              const p = layout.get(n._id);
              if (!p) return null;
              const colorIdx = typeIndex.get(n.basic_info?.type ?? 'other') ?? 0;
              const color = TOPO_TYPE_COLORS[colorIdx % TOPO_TYPE_COLORS.length];
              const degree = degreeMap.get(n._id) ?? 0;
              const r = 8 + Math.min(degree, 12) * 0.8;
              const isHovered = n._id === hoverId;
              const isDimmed = hoverConnIds !== null && !hoverConnIds.has(n._id);
              const showLabel = degree >= 5 || isHovered;
              return (
                <g key={n._id} style={{ cursor: 'default' }}
                  onMouseEnter={() => setHoverId(n._id)}
                  onMouseLeave={() => setHoverId(null)}>
                  {isHovered && (
                    <circle cx={p.x} cy={p.y} r={r + 7} fill="none"
                      stroke={color} strokeWidth="2" opacity="0.45" />
                  )}
                  <circle cx={p.x} cy={p.y} r={r}
                    fill={color} stroke="var(--color-bg-secondary)" strokeWidth="2"
                    opacity={isDimmed ? 0.12 : 1} />
                  {showLabel && (
                    <text x={p.x} y={p.y + r + 12} textAnchor="middle" fontSize="10"
                      fill="var(--color-text-primary)"
                      stroke="var(--color-bg-secondary)" strokeWidth="2.5" paintOrder="stroke"
                      opacity={isDimmed ? 0.15 : 1}>
                      {(n.basic_info?.display_name ?? '?').slice(0, 18)}
                    </text>
                  )}
                </g>
              );
            })}
          </g>
        </svg>

        {hoverNode && hoverLayout && (
          <div className={styles.topologyTooltip} style={{
            left: hoverLayout.x * vp.scale + vp.x + 14,
            top: hoverLayout.y * vp.scale + vp.y - 10,
          }}>
            <div className={styles.topologyTooltipName}>{hoverNode.basic_info?.display_name}</div>
            <div className={styles.topologyTooltipDetail}>
              {hoverNode.basic_info?.type && <div>Type: {hoverNode.basic_info.type}</div>}
              {hoverNode.basic_info?.status && <div>Status: {hoverNode.basic_info.status}</div>}
              <div>Connections: {degreeMap.get(hoverNode._id) ?? 0}</div>
            </div>
          </div>
        )}
      </div>

      <div className={styles.topologyLegends}>
        <div className={styles.topologyLegend}>
          <span className={styles.topologyLegendLabel}>Types:</span>
          {uniqueNodeTypes.slice(0, 8).map((type) => (
            <span key={type} className={styles.topologyLegendItem}>
              <span className={styles.topologyLegendDot}
                style={{ background: TOPO_TYPE_COLORS[(typeIndex.get(type) ?? 0) % TOPO_TYPE_COLORS.length] }} />
              {type}
            </span>
          ))}
        </div>
        <div className={styles.topologyLegend}>
          <span className={styles.topologyLegendLabel}>Connections:</span>
          {uniqueEdgeTypes.map((type) => (
            <span key={type} className={styles.topologyLegendItem}>
              <span className={styles.topologyLegendLine} style={{ background: EDGE_COLORS[type] ?? '#9ca3af' }} />
              {type}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};

interface AssetReportsProps {
  isOpen: boolean;
  onClose: () => void;
  /** When true, renders content directly without a Modal wrapper */
  inline?: boolean;
}

interface ReportData {
  totalAssets: number;
  itsmManaged: number;
  assetsByStatus: Record<string, number>;
  assetsByType: Record<string, number>;
  connectionStats: {
    totalConnections: number;
    averageConnectionsPerAsset: number;
    mostConnectedAsset: Asset | null;
    typeBreakdown: Record<string, number>;
  };
  maintenanceStats: {
    needsMaintenance: number;
    overdueMaintenance: number;
    recentlyServiced: number;
    flagged: Asset[];
  };
  locationStats: {
    assetsByBuilding: Record<string, { name: string; count: number }>;
    assetsByFloor: Record<string, { name: string; count: number }>;
  };
}

const downloadCSV = (rows: string[][], filename: string) => {
  const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

type ReportTab = 'overview' | 'connections' | 'maintenance' | 'locations' | 'topology';

const AssetReports: React.FC<AssetReportsProps> = ({ isOpen, onClose, inline = false }) => {
  const [reportData, setReportData] = useState<ReportData | null>(null);
  const [allAssets, setAllAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedTab, setSelectedTab] = useState<ReportTab>('overview');

  const generateReport = useCallback(async () => {
    setLoading(true);
    try {
      const [assets, buildings, floors] = await Promise.all([
        assetService.getAssetsWithConnections(),
        hierarchyService.getBuildings(),
        floorService.getFloors(),
      ]);

      const buildingMap = new Map<string, string>(buildings.map((b: Building) => [b._id, b.name]));
      const floorMap = new Map<string, string>(
        floors.map((f: Floor) => [f._id, `${f.name} (Floor ${f.floor_number})`])
      );

      const now = Date.now();
      const thirtyDays = 30 * 86400_000;

      const report: ReportData = {
        totalAssets: assets.length,
        itsmManaged: 0,
        assetsByStatus: {},
        assetsByType: {},
        connectionStats: {
          totalConnections: 0,
          averageConnectionsPerAsset: 0,
          mostConnectedAsset: null,
          typeBreakdown: {},
        },
        maintenanceStats: {
          needsMaintenance: 0,
          overdueMaintenance: 0,
          recentlyServiced: 0,
          flagged: [],
        },
        locationStats: {
          assetsByBuilding: {},
          assetsByFloor: {},
        },
      };

      assets.forEach((asset: Asset) => {
        if (asset.itsm?.is_managed) report.itsmManaged++;

        const status = asset.basic_info?.status ?? 'unknown';
        report.assetsByStatus[status] = (report.assetsByStatus[status] ?? 0) + 1;

        const type = asset.basic_info?.type ?? 'untyped';
        report.assetsByType[type] = (report.assetsByType[type] ?? 0) + 1;

        // Connections
        const connCount = asset.connections?.length ?? 0;
        report.connectionStats.totalConnections += connCount;
        asset.connections?.forEach((c) => {
          report.connectionStats.typeBreakdown[c.connection_type] =
            (report.connectionStats.typeBreakdown[c.connection_type] ?? 0) + 1;
        });
        if (
          !report.connectionStats.mostConnectedAsset ||
          connCount > (report.connectionStats.mostConnectedAsset.connections?.length ?? 0)
        ) {
          report.connectionStats.mostConnectedAsset = asset;
        }

        // Maintenance
        const flagged =
          (asset.maintenance?.next_date && new Date(asset.maintenance.next_date).getTime() < now) ||
          asset.custom_fields?.physical_condition === 'Poor' ||
          asset.basic_info?.status === 'maintenance' ||
          asset.basic_info?.status === 'inactive';

        if (asset.maintenance?.next_date) {
          const next = new Date(asset.maintenance.next_date).getTime();
          if (next < now) {
            report.maintenanceStats.overdueMaintenance++;
            report.maintenanceStats.needsMaintenance++;
          } else if (next - now < thirtyDays) {
            report.maintenanceStats.needsMaintenance++;
          }
        }
        if (asset.maintenance?.last_date) {
          if (now - new Date(asset.maintenance.last_date).getTime() < thirtyDays) {
            report.maintenanceStats.recentlyServiced++;
          }
        }
        if (flagged) report.maintenanceStats.flagged.push(asset);

        // Locations — resolve real names
        const bId = asset.hierarchy?.building_id;
        if (bId) {
          if (!report.locationStats.assetsByBuilding[bId]) {
            report.locationStats.assetsByBuilding[bId] = {
              name: buildingMap.get(bId) ?? `Building …${bId.slice(-6)}`,
              count: 0,
            };
          }
          report.locationStats.assetsByBuilding[bId].count++;
        }

        const fId = asset.hierarchy?.floor_id;
        if (fId) {
          if (!report.locationStats.assetsByFloor[fId]) {
            report.locationStats.assetsByFloor[fId] = {
              name: floorMap.get(fId) ?? `Floor …${fId.slice(-6)}`,
              count: 0,
            };
          }
          report.locationStats.assetsByFloor[fId].count++;
        }
      });

      report.connectionStats.averageConnectionsPerAsset =
        assets.length > 0 ? report.connectionStats.totalConnections / assets.length : 0;

      setReportData(report);
      setAllAssets(assets);
    } catch (err) {
      console.error('Error generating report:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen || inline) generateReport();
  }, [isOpen, inline, generateReport]);

  // ── CSV exports ──────────────────────────────────────────────
  const exportCSV = () => {
    if (!reportData) return;
    if (selectedTab === 'overview') {
      downloadCSV(
        [
          ['Metric', 'Value'],
          ['Total Assets', String(reportData.totalAssets)],
          ['ITSM Managed', String(reportData.itsmManaged)],
          ['Total Connections', String(reportData.connectionStats.totalConnections)],
          ['Avg Connections/Asset', reportData.connectionStats.averageConnectionsPerAsset.toFixed(1)],
          [],
          ['Status', 'Count'],
          ...Object.entries(reportData.assetsByStatus).map(([s, c]) => [s, String(c)]),
          [],
          ['Type', 'Count'],
          ...Object.entries(reportData.assetsByType).sort((a, b) => b[1] - a[1]).map(([t, c]) => [t, String(c)]),
        ] as string[][],
        'report-overview.csv'
      );
    } else if (selectedTab === 'maintenance') {
      downloadCSV(
        [
          ['Asset', 'Type', 'Status', 'Next Maintenance', 'Condition'],
          ...reportData.maintenanceStats.flagged.map((a) => [
            a.basic_info?.display_name ?? '',
            a.basic_info?.type ?? '',
            a.basic_info?.status ?? '',
            a.maintenance?.next_date ? new Date(a.maintenance.next_date).toLocaleDateString() : '',
            a.custom_fields?.physical_condition ?? '',
          ]),
        ] as string[][],
        'report-maintenance.csv'
      );
    } else if (selectedTab === 'locations') {
      downloadCSV(
        [
          ['Type', 'Name', 'Asset Count'],
          ...Object.values(reportData.locationStats.assetsByBuilding).map((b) => ['Building', b.name, String(b.count)]),
          ...Object.values(reportData.locationStats.assetsByFloor).map((f) => ['Floor', f.name, String(f.count)]),
        ] as string[][],
        'report-locations.csv'
      );
    } else {
      downloadCSV(
        [
          ['Connection Type', 'Count'],
          ...Object.entries(reportData.connectionStats.typeBreakdown).sort((a, b) => b[1] - a[1]).map(([t, c]) => [t, String(c)]),
        ] as string[][],
        'report-connections.csv'
      );
    }
  };

  // ── Tab renderers ────────────────────────────────────────────
  const renderOverview = () => {
    if (!reportData) return null;
    return (
      <div className={styles.reportGrid}>
        <Card padding="lg" className={styles.statCard}>
          <h4>Total Assets</h4>
          <div className={styles.statValue}>{reportData.totalAssets}</div>
          <div className={styles.statSubtext}>{reportData.itsmManaged} ITSM-managed</div>
        </Card>

        <Card padding="lg" className={styles.statCard}>
          <h4>Connections</h4>
          <div className={styles.statValue}>{reportData.connectionStats.totalConnections}</div>
          <div className={styles.statSubtext}>
            {reportData.connectionStats.averageConnectionsPerAsset.toFixed(1)} avg per asset
          </div>
        </Card>

        <Card padding="lg" className={styles.statCard}>
          <h4>Needs Maintenance</h4>
          <div className={styles.statValue} style={{ color: reportData.maintenanceStats.overdueMaintenance > 0 ? '#ef4444' : 'var(--color-text-primary)' }}>
            {reportData.maintenanceStats.needsMaintenance}
          </div>
          <div className={styles.statSubtext}>
            {reportData.maintenanceStats.overdueMaintenance} overdue
          </div>
        </Card>

        <Card padding="lg" className={styles.statCard}>
          <h4>Locations</h4>
          <div className={styles.statValue}>{Object.keys(reportData.locationStats.assetsByBuilding).length}</div>
          <div className={styles.statSubtext}>
            buildings · {Object.keys(reportData.locationStats.assetsByFloor).length} floors
          </div>
        </Card>

        <Card padding="lg" className={styles.chartCard} style={{ gridColumn: 'span 2' }}>
          <h4>By Status</h4>
          <ResponsiveContainer width="100%" height={180}>
            <PieChart>
              <Pie
                data={Object.entries(reportData.assetsByStatus).map(([name, value]) => ({ name, value }))}
                dataKey="value"
                nameKey="name"
                cx="50%"
                cy="50%"
                outerRadius={70}
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                labelLine={false}
              >
                {Object.keys(reportData.assetsByStatus).map((status) => (
                  <Cell key={status} fill={STATUS_COLORS[status] ?? '#9ca3af'} />
                ))}
              </Pie>
              <Tooltip formatter={(v: number) => [v, 'Assets']} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </Card>

        <Card padding="lg" className={styles.chartCard} style={{ gridColumn: 'span 2' }}>
          <h4>By Asset Type (top 10)</h4>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart
              data={Object.entries(reportData.assetsByType)
                .sort(([, a], [, b]) => b - a)
                .slice(0, 10)
                .map(([name, value]) => ({ name, value }))}
              layout="vertical"
              margin={{ left: 16, right: 16, top: 4, bottom: 4 }}
            >
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: number) => [v, 'Assets']} />
              <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                {Object.keys(reportData.assetsByType).slice(0, 10).map((_, i) => (
                  <Cell key={i} fill={TYPE_COLORS[i % TYPE_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>
    );
  };

  const renderConnections = () => {
    if (!reportData) return null;
    const breakdown = Object.entries(reportData.connectionStats.typeBreakdown).sort(([, a], [, b]) => b - a);
    const totalConns = breakdown.reduce((s, [, c]) => s + c, 0) || 1;
    return (
      <div className={styles.reportContent}>
        <Card padding="lg">
          <h4 className={styles.chartCard}>Connection Statistics</h4>
          <div className={styles.connectionStats}>
            <div className={styles.statItem}>
              <span>Total connections</span>
              <strong>{reportData.connectionStats.totalConnections}</strong>
            </div>
            <div className={styles.statItem}>
              <span>Average per asset</span>
              <strong>{reportData.connectionStats.averageConnectionsPerAsset.toFixed(1)}</strong>
            </div>
          </div>
        </Card>

        {reportData.connectionStats.mostConnectedAsset && (
          <Card padding="lg" style={{ marginTop: 16 }}>
            <h4 className={styles.chartCard}>Most Connected Asset</h4>
            <div className={styles.mostConnected}>
              <div className={styles.assetInfo}>
                <h5>{reportData.connectionStats.mostConnectedAsset.basic_info?.display_name}</h5>
                <p>{reportData.connectionStats.mostConnectedAsset.basic_info?.manufacturer} {reportData.connectionStats.mostConnectedAsset.basic_info?.model}</p>
                <Badge variant="success">
                  {reportData.connectionStats.mostConnectedAsset.connections?.length ?? 0} connections
                </Badge>
              </div>
            </div>
          </Card>
        )}

        <Card padding="lg" style={{ marginTop: 16 }}>
          <h4 className={styles.chartCard}>Connection Type Distribution</h4>
          {breakdown.length === 0 ? (
            <p className={styles.emptyText}>No connections found.</p>
          ) : (
            <div className={styles.statusChart}>
              {breakdown.map(([type, count]) => (
                <div key={type} className={styles.statusItem}>
                  <span className={styles.statusLabel}>{type}</span>
                  <div className={styles.statusBar}>
                    <div className={styles.statusFill} style={{ width: `${(count / totalConns) * 100}%` }} />
                  </div>
                  <span className={styles.statusCount}>{count}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    );
  };

  const renderMaintenance = () => {
    if (!reportData) return null;
    const now = Date.now();
    return (
      <div className={styles.reportContent}>
        <Card padding="lg">
          <h4 className={styles.chartCard}>Maintenance Overview</h4>
          <div className={styles.maintenanceStats}>
            <div className={styles.maintenanceItem}>
              <span>Needs maintenance (next 30 days)</span>
              <Badge variant="warning">{reportData.maintenanceStats.needsMaintenance}</Badge>
            </div>
            <div className={styles.maintenanceItem}>
              <span>Overdue</span>
              <Badge variant="error">{reportData.maintenanceStats.overdueMaintenance}</Badge>
            </div>
            <div className={styles.maintenanceItem}>
              <span>Serviced in last 30 days</span>
              <Badge variant="success">{reportData.maintenanceStats.recentlyServiced}</Badge>
            </div>
          </div>
        </Card>

        <Card padding="lg" style={{ marginTop: 16 }}>
          <h4 className={styles.chartCard}>Assets Requiring Attention</h4>
          {reportData.maintenanceStats.flagged.length === 0 ? (
            <p className={styles.emptyText}>All assets are in good condition.</p>
          ) : (
            <div className={styles.attentionList}>
              {reportData.maintenanceStats.flagged.slice(0, 20).map((asset) => {
                const overdue = asset.maintenance?.next_date && new Date(asset.maintenance.next_date).getTime() < now;
                return (
                  <div key={asset._id} className={styles.attentionItem}>
                    <div className={styles.attentionInfo}>
                      <strong>{asset.basic_info?.display_name}</strong>
                      <span>{asset.basic_info?.type ?? '—'}</span>
                    </div>
                    <div className={styles.attentionBadges}>
                      {asset.basic_info?.status === 'maintenance' && <Badge variant="warning">Maintenance</Badge>}
                      {asset.basic_info?.status === 'inactive' && <Badge variant="error">Inactive</Badge>}
                      {asset.custom_fields?.physical_condition === 'Poor' && <Badge variant="error">Poor Condition</Badge>}
                      {overdue && <Badge variant="error">Overdue</Badge>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>
    );
  };

  const renderLocations = () => {
    if (!reportData) return null;
    const bEntries = Object.values(reportData.locationStats.assetsByBuilding).sort((a, b) => b.count - a.count);
    const fEntries = Object.values(reportData.locationStats.assetsByFloor).sort((a, b) => b.count - a.count);
    const maxCount = Math.max(...bEntries.map((e) => e.count), ...fEntries.map((e) => e.count), 1);

    return (
      <div className={styles.reportContent}>
        <Card padding="lg">
          <h4 className={styles.chartCard}>By Building</h4>
          {bEntries.length === 0 ? (
            <p className={styles.emptyText}>No location data.</p>
          ) : (
            <ResponsiveContainer width="100%" height={Math.max(120, bEntries.length * 36)}>
              <BarChart data={bEntries.map(b => ({ name: b.name, value: b.count }))} layout="vertical" margin={{ left: 16, right: 16, top: 4, bottom: 4 }}>
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: number) => [v, 'Assets']} />
                <Bar dataKey="value" fill="#3b82f6" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card padding="lg" style={{ marginTop: 16 }}>
          <h4 className={styles.chartCard}>By Floor</h4>
          {fEntries.length === 0 ? (
            <p className={styles.emptyText}>No floor data.</p>
          ) : (
            <div className={styles.statusChart}>
              {fEntries.map((f) => (
                <div key={f.name} className={styles.statusItem}>
                  <span className={styles.statusLabel}>{f.name}</span>
                  <div className={styles.statusBar}>
                    <div className={styles.statusFill} style={{ width: `${(f.count / maxCount) * 100}%`, background: 'var(--color-success, #22c55e)' }} />
                  </div>
                  <span className={styles.statusCount}>{f.count}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card padding="lg" style={{ marginTop: 16 }}>
          <h4 className={styles.chartCard}>Asset Density</h4>
          <div className={styles.heatmapContainer}>
            <p className={styles.heatmapTitle}>Buildings</p>
            <div className={styles.heatmapGrid}>
              {bEntries.map((b) => (
                <div
                  key={b.name}
                  className={styles.heatmapCell}
                  style={{ '--heat': b.count / maxCount } as React.CSSProperties}
                  title={`${b.count} assets`}
                >
                  <span className={styles.heatmapCellLabel}>{b.name}</span>
                  <span className={styles.heatmapCellCount}>{b.count}</span>
                </div>
              ))}
            </div>
            {fEntries.length > 0 && (
              <>
                <p className={styles.heatmapTitle} style={{ marginTop: 12 }}>Floors</p>
                <div className={styles.heatmapGrid}>
                  {fEntries.slice(0, 12).map((f) => (
                    <div
                      key={f.name}
                      className={styles.heatmapCell}
                      style={{ '--heat': f.count / maxCount } as React.CSSProperties}
                      title={`${f.count} assets`}
                    >
                      <span className={styles.heatmapCellLabel}>{f.name}</span>
                      <span className={styles.heatmapCellCount}>{f.count}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
            <div className={styles.heatmapLegend}>
              <span>Low</span>
              <div className={styles.heatmapLegendBar} />
              <span>High</span>
            </div>
          </div>
        </Card>
      </div>
    );
  };

  const renderTopology = () => {
    return <TopologyView assets={allAssets} />;
  };

  const renderContent = () => {
    switch (selectedTab) {
      case 'connections':  return renderConnections();
      case 'maintenance':  return renderMaintenance();
      case 'locations':    return renderLocations();
      case 'topology':     return renderTopology();
      default:             return renderOverview();
    }
  };

  const controls = (
    <div className={styles.header}>
      <div className={styles.reportTabs}>
        {(['overview', 'connections', 'maintenance', 'locations', 'topology'] as ReportTab[]).map((tab) => (
          <Button
            key={tab}
            variant={selectedTab === tab ? 'primary' : 'outline'}
            size="sm"
            onClick={() => setSelectedTab(tab)}
          >
            {tab.charAt(0).toUpperCase() + tab.slice(1)}
          </Button>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <Button variant="outline" size="sm" onClick={exportCSV} disabled={loading || !reportData}>
          ⬇ Export CSV
        </Button>
        <Button variant="outline" size="sm" onClick={generateReport} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </Button>
      </div>
    </div>
  );

  const body = (
    <div className={inline ? styles.containerInline : styles.container}>
      {controls}
      <div className={styles.reportContent}>
        {loading ? (
          <div className={styles.loading}>Generating report…</div>
        ) : (
          renderContent()
        )}
      </div>
    </div>
  );

  if (inline) return body;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Asset Reports & Analytics">
      {body}
    </Modal>
  );
};

export default AssetReports;
