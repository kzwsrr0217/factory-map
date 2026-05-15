/**
 * NetworkGraph.tsx — Force-directed connection graph for all assets ("/network").
 *
 * Fetches all assets (with connections) and renders a 2-D force-directed graph
 * using `react-force-graph-2d`. Each node represents an asset; each edge
 * represents an AssetConnection.
 *
 * Node colour encodes asset status:
 *   active       → #22c55e (green)
 *   maintenance  → #f59e0b (amber)
 *   inactive     → #94a3b8 (slate)
 *   retired      → #6b7280 (gray)
 *   unknown      → #a78bfa (purple)
 *
 * Interactions:
 *   - Click a node  → navigate to /assets/:id
 *   - Hover a node  → show tooltip with name, type, status, IP
 *   - Filter        → limit visible nodes to a specific asset type
 *
 * The graph data is memoised from the asset list and only rebuilt when the raw
 * data changes. All assets are loaded once on mount via GET /api/assets.
 */
import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import ForceGraph2D from 'react-force-graph-2d';
import { assetService } from '../services/asset.service';
import type { Asset } from '../services/asset.service';
import styles from '../styles/pages/NetworkGraph.module.css';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GraphNode {
  id: string;
  name: string;
  type: string;
  status: string;
  ip?: string;
  color: string;
  val: number; // node size (connections count)
}

interface GraphLink {
  source: string;
  target: string;
  connectionType: string;
}

interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

interface HoveredNode extends GraphNode {
  x?: number;
  y?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<string, string> = {
  active:      '#22c55e',
  maintenance: '#f59e0b',
  inactive:    '#94a3b8',
  retired:     '#6b7280',
};

function nodeColor(status: string): string {
  return STATUS_COLORS[status?.toLowerCase()] ?? '#a78bfa';
}

function buildGraphData(assets: Asset[], typeFilter: string): GraphData {
  const filteredIds = new Set<string>();
  const idMap = new Map<string, Asset>();

  for (const a of assets) {
    idMap.set(a._id, a);
  }

  // Determine which nodes to include based on filter
  const baseAssets = typeFilter
    ? assets.filter(a => a.basic_info?.type === typeFilter)
    : assets;

  for (const a of baseAssets) {
    filteredIds.add(a._id);
    // Include directly connected assets even if they don't match the type filter
    for (const c of a.connections ?? []) {
      if (idMap.has(c.connected_asset_id)) {
        filteredIds.add(c.connected_asset_id);
      }
    }
  }

  const degreeMap = new Map<string, number>();
  const seenLinks = new Set<string>();
  const links: GraphLink[] = [];

  for (const a of assets) {
    if (!filteredIds.has(a._id)) continue;
    for (const c of a.connections ?? []) {
      if (!filteredIds.has(c.connected_asset_id)) continue;
      const key = [a._id, c.connected_asset_id].sort().join('|');
      if (seenLinks.has(key)) continue;
      seenLinks.add(key);
      links.push({
        source: a._id,
        target: c.connected_asset_id,
        connectionType: c.connection_type,
      });
      degreeMap.set(a._id, (degreeMap.get(a._id) ?? 0) + 1);
      degreeMap.set(c.connected_asset_id, (degreeMap.get(c.connected_asset_id) ?? 0) + 1);
    }
  }

  const nodes: GraphNode[] = [];
  for (const id of Array.from(filteredIds)) {
    const a = idMap.get(id);
    if (!a) continue;
    const status = a.basic_info?.status ?? 'unknown';
    nodes.push({
      id: a._id,
      name: a.basic_info?.display_name ?? a._id,
      type: a.basic_info?.type ?? 'unknown',
      status,
      ip: a.network?.ip_address,
      color: nodeColor(status),
      val: Math.max(1, degreeMap.get(id) ?? 0),
    });
  }

  return { nodes, links };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const NetworkGraph: React.FC = () => {
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState('');
  const [hoveredNode, setHoveredNode] = useState<HoveredNode | null>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  // Load all assets with connections once
  useEffect(() => {
    assetService.getAssetsWithConnections().then(list => {
      setAssets(list);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  // Track container size
  useEffect(() => {
    if (!containerRef.current) return;
    const obs = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      setDimensions({ width, height });
    });
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, []);

  const graphData = useMemo(
    () => buildGraphData(assets, typeFilter),
    [assets, typeFilter],
  );

  const assetTypes = useMemo(() => {
    const types = new Set(assets.map(a => a.basic_info?.type).filter(Boolean));
    return Array.from(types).sort() as string[];
  }, [assets]);

  const handleNodeClick = useCallback(
    (node: { id?: string | number }) => {
      if (node.id) navigate(`/assets/${node.id}`);
    },
    [navigate],
  );

  const handleNodeHover = useCallback(
    (node: unknown | null) => {
      setHoveredNode(node as HoveredNode | null);
    },
    [],
  );

  const nodeCanvasObject = useCallback(
    (node: { x?: number; y?: number; color?: string; val?: number; name?: string }, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const r = Math.max(4, Math.sqrt((node.val ?? 1) + 1) * 3);
      ctx.beginPath();
      ctx.arc(node.x ?? 0, node.y ?? 0, r, 0, 2 * Math.PI);
      ctx.fillStyle = node.color ?? '#a78bfa';
      ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 1 / globalScale;
      ctx.stroke();

      // Label only when zoomed in enough
      if (globalScale > 1.2) {
        const label = node.name ?? '';
        const fontSize = Math.max(6, 12 / globalScale);
        ctx.font = `${fontSize}px sans-serif`;
        ctx.fillStyle = 'var(--color-text-primary, #1e293b)';
        ctx.textAlign = 'center';
        ctx.fillText(label, node.x ?? 0, (node.y ?? 0) + r + fontSize);
      }
    },
    [],
  );

  return (
    <div className={styles.page}>
      <div className={styles.toolbar}>
        <h1 className={styles.title}>Network Graph</h1>

        <div className={styles.filterGroup}>
          <span className={styles.filterLabel}>Type:</span>
          <select value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
            <option value="">All types</option>
            {assetTypes.map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>

        <span style={{ fontSize: '0.8125rem', color: 'var(--color-text-secondary)' }}>
          {graphData.nodes.length} nodes · {graphData.links.length} links
        </span>

        <div className={styles.legend}>
          {Object.entries(STATUS_COLORS).map(([status, color]) => (
            <span key={status} className={styles.legendItem}>
              <span className={styles.legendDot} style={{ background: color }} />
              {status}
            </span>
          ))}
          <span className={styles.legendItem}>
            <span className={styles.legendDot} style={{ background: '#a78bfa' }} />
            unknown
          </span>
        </div>
      </div>

      <div className={styles.graphWrap} ref={containerRef}>
        {loading ? (
          <div className={styles.loading}>Loading assets…</div>
        ) : graphData.nodes.length === 0 ? (
          <div className={styles.empty}>
            <span>No connections found.</span>
            <span style={{ fontSize: '0.875rem' }}>
              Add connections between assets to see the network graph.
            </span>
          </div>
        ) : (
          <ForceGraph2D
            graphData={graphData}
            width={dimensions.width}
            height={dimensions.height}
            nodeId="id"
            nodeColor="color"
            nodeVal="val"
            nodeLabel="name"
            linkLabel="connectionType"
            linkColor={() => 'rgba(100,116,139,0.5)'}
            linkWidth={1.5}
            onNodeClick={handleNodeClick}
            onNodeHover={handleNodeHover}
            nodeCanvasObject={nodeCanvasObject}
            nodeCanvasObjectMode={() => 'replace'}
            backgroundColor="var(--color-bg-secondary, #f8fafc)"
            enableNodeDrag
            enableZoomInteraction
          />
        )}

        {hoveredNode && hoveredNode.x !== undefined && (
          <div
            className={styles.tooltip}
            style={{
              left: (hoveredNode.x ?? 0) + 16,
              top: (hoveredNode.y ?? 0) - 8,
            }}
          >
            <div className={styles.tooltipName}>{hoveredNode.name}</div>
            <div className={styles.tooltipDetail}>
              Type: {hoveredNode.type}<br />
              Status: {hoveredNode.status}<br />
              {hoveredNode.ip && <>IP: {hoveredNode.ip}<br /></>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default NetworkGraph;
