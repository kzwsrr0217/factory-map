/**
 * FloorMap.tsx — Interactive SVG-based floor plan canvas.
 *
 * Renders work areas as labelled rectangles and placed assets as icon+label
 * pins on top of an optional `backgroundImage` (base64 floor plan SVG/PNG).
 *
 * Interaction modes (controlled by props):
 *   editable         — enables drag-to-move work areas and assets; resize
 *                      handles appear on work area corners.
 *   deployMode       — clicking an empty canvas cell calls `onMapClick` with
 *                      grid-snapped coordinates for placing a new asset.
 *   connectionMode   — clicking assets accumulates `selectedAssetsForConnection`
 *                      for wiring a new connection between two assets.
 *   Grid snap        — all moves snap to GRID_SIZE (50 px) increments.
 *
 * Layer toggles (workareas | assets | connections | grid) filter visibility
 * without unmounting the underlying elements.
 *
 * Minimap — a scaled-down overview in the corner showing the full canvas
 * extent and a viewport rectangle.
 *
 * Export — `onExport` (not a prop; triggered via the toolbar inside the
 * component) serialises the SVG element to a downloadable `.svg` file.
 *
 * Key callbacks (all optional):
 *   onWorkareaMove / onWorkareaResize — called after drag ends; parent persists.
 *   onAssetMove    — called after drag ends; parent persists.
 *   onMapClick     — called in deployMode with { x, y, occupancy }.
 *   onWorkareaCreate / Delete / Rename — workarea management from context menu.
 *   onAssetEdit / Clone / StatusChange — asset quick actions from context menu.
 *   onConnectionDelete — remove a specific connection between two assets.
 */
import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { WorkArea } from '../../services/workarea.service';
import { Asset } from '../../services/asset.service';
import { WallPort } from '../../services/network.service';
import Tooltip from '../common/Tooltip';
import ConfirmDialog from '../common/ConfirmDialog';
import { getAssetIcon, ASSET_TYPE_MAP } from '../../utils/assetTypes';
import styles from '../../styles/components/FloorMap.module.css';

// ── Module-level pure helpers (no component state dependency) ─────────────────

function getAssetStatus(asset: Asset): string {
  return asset.basic_info.status || 'unknown';
}

function getAssetColor(asset: Asset): string {
  const status = getAssetStatus(asset);
  if (status === 'Decommissioned' || status === 'Retired' || status === 'retired') return '#9ca3af';
  switch (status) {
    case 'active':      return '#10b981';
    case 'maintenance': return '#f59e0b';
    case 'offline':     return '#ef4444';
    default:            return '#6b7280';
  }
}

function isEolOs(asset: Asset): boolean {
  const ver  = (asset.basic_info.os_version ?? '').toLowerCase();
  const type = (asset.basic_info.os_type    ?? '').toLowerCase();
  return /\b(7|xp|vista|2003|2008)\b/.test(ver) || (type === 'windows' && /\b7\b/.test(ver));
}

function isDecommissioned(asset: Asset): boolean {
  const s = (asset.basic_info.status ?? '').toLowerCase();
  return s === 'decommissioned' || s === 'retired';
}

function hasItsmConflict(asset: Asset): boolean {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return !!(asset as any).itsm_snapshot?.display_name && asset.itsm?.source_of_truth === 'local';
}

// ── Memoized per-asset SVG marker — only re-renders when its own props change ─

interface AssetMarkerProps {
  asset: Asset;
  isDragging: boolean;
  isHighlighted: boolean;
  isSelectedForConnection: boolean;
  isCrossFloor: boolean;
  showLabels: boolean;
  editable: boolean;
  onDragStart: (asset: Asset, e: React.MouseEvent) => void;
  onClick:     (asset: Asset, e: React.MouseEvent) => void;
  onHover:     (e: React.MouseEvent, content: React.ReactNode) => void;
  onHoverEnd:  () => void;
}

const AssetMarker = React.memo(function AssetMarker({
  asset, isDragging, isHighlighted, isSelectedForConnection, isCrossFloor,
  showLabels, editable, onDragStart, onClick, onHover, onHoverEnd,
}: AssetMarkerProps) {
  const x = asset.location.coordinates.x;
  const y = asset.location.coordinates.y;
  const eolOs        = isEolOs(asset);
  const decomm       = isDecommissioned(asset);
  const itsmConflict = hasItsmConflict(asset);
  const isIsolated   = !asset.assigned_person && (!asset.connections || asset.connections.length === 0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cf = (asset as any).custom_fields;
  const objectId = cf?.object_id as string | undefined;

  const tooltipContent = (
    <div>
      <h4>{getAssetIcon(asset.basic_info.type)} {asset.basic_info.display_name}</h4>
      {objectId && <p><span className={styles.label}>Station ID:</span> {objectId}</p>}
      {asset.itsm.hardware_asset_id && <p><span className={styles.label}>HWA ID:</span> {asset.itsm.hardware_asset_id}</p>}
      {asset.basic_info.manufacturer && asset.basic_info.model && (
        <p><span className={styles.label}>Model:</span> {asset.basic_info.manufacturer} {asset.basic_info.model}</p>
      )}
      {asset.basic_info.serial_number && (
        <p><span className={styles.label}>S/N:</span> {asset.basic_info.serial_number}</p>
      )}
      {(asset.basic_info.os_type || asset.basic_info.os_version) && (
        <p>
          <span className={styles.label}>OS:</span>{' '}
          {asset.basic_info.os_type} {asset.basic_info.os_version}
          {eolOs && <span style={{ color: '#f59e0b', fontWeight: 'bold' }}> ⚠ EOL</span>}
        </p>
      )}
      {asset.assigned_person && (
        <p><span className={styles.label}>Assigned:</span> {asset.assigned_person.full_name}</p>
      )}
      {cf?.remote_access_tool && <p><span className={styles.label}>Remote:</span> {cf.remote_access_tool}</p>}
      {cf?.backup_tool && <p><span className={styles.label}>Backup:</span> {cf.backup_tool} ({cf.backup_status ?? 'unknown'})</p>}
      <p>
        <span className={styles.label}>Status:</span>{' '}
        {decomm ? '⚫ Decommissioned' :
         getAssetStatus(asset) === 'active' ? '🟢 Active' :
         getAssetStatus(asset) === 'maintenance' ? '🟡 Maintenance' :
         getAssetStatus(asset) === 'offline' ? '🔴 Offline' : '⚪ Unknown'}
      </p>
      {itsmConflict && <p style={{ color: '#f59e0b', fontWeight: 'bold' }}>⚠ ITSM changes pending</p>}
      {asset.maintenance?.next_date && new Date(asset.maintenance.next_date) < new Date() && (
        <p style={{ color: '#ef4444', fontWeight: 'bold' }}>⚠ Maintenance overdue</p>
      )}
      <p style={{ fontSize: '10px', marginTop: '4px', fontStyle: 'italic' }}>Click for full details</p>
    </div>
  );

  return (
    <g opacity={decomm ? 0.45 : 1}>
      {isHighlighted && (
        <circle cx={x} cy={y} r="24" fill="none" stroke="#2563eb" strokeWidth="3" opacity="0.9" />
      )}
      {isIsolated && !isHighlighted && (
        <circle cx={x} cy={y} r="20" fill="none" stroke="#9ca3af" strokeWidth="2" strokeDasharray="4,3" opacity="0.7" />
      )}
      {isSelectedForConnection && (
        <circle cx={x} cy={y} r="20" fill="none" stroke="#ff6b35" strokeWidth="3" strokeDasharray="5,5" opacity="0.8" />
      )}
      <circle
        cx={x}
        cy={y}
        r="15"
        fill={getAssetColor(asset)}
        stroke="#fff"
        strokeWidth="3"
        className={`${styles.asset} ${isDragging ? styles.dragging : ''}`}
        onMouseDown={(e) => onDragStart(asset, e)}
        onClick={(e) => onClick(asset, e)}
        onMouseEnter={(e) => onHover(e as any, tooltipContent)}
        onMouseLeave={onHoverEnd}
        style={{ cursor: editable ? 'move' : 'pointer' }}
      />
      <text x={x} y={y + 5} textAnchor="middle" className={styles.assetIcon} pointerEvents="none" style={{ fontSize: '14px' }}>
        {getAssetIcon(asset.basic_info.type)}
      </text>
      {decomm && (
        <g pointerEvents="none">
          <line x1={x - 10} y1={y - 10} x2={x + 10} y2={y + 10} stroke="#6b7280" strokeWidth="2.5" />
          <line x1={x + 10} y1={y - 10} x2={x - 10} y2={y + 10} stroke="#6b7280" strokeWidth="2.5" />
        </g>
      )}
      {showLabels && (
        <>
          <text x={x} y={y + 33} textAnchor="middle" className={styles.assetLabel} pointerEvents="none"
            stroke="white" strokeWidth="3" paintOrder="stroke"
            style={{ fontSize: '11px', fontWeight: 'bold', fill: '#1f2937' }}>
            {asset.basic_info.display_name.length > 16
              ? asset.basic_info.display_name.slice(0, 14) + '…'
              : asset.basic_info.display_name}
          </text>
          {objectId && (
            <text x={x} y={y + 45} textAnchor="middle" pointerEvents="none"
              stroke="white" strokeWidth="2" paintOrder="stroke"
              style={{ fontSize: '9px', fill: '#6b7280', fontFamily: 'monospace' }}>
              {objectId}
            </text>
          )}
        </>
      )}
      {eolOs && !decomm && (
        <g pointerEvents="none">
          <circle cx={x - 12} cy={y - 12} r="7" fill="#f59e0b" stroke="#fff" strokeWidth="2" />
          <text x={x - 12} y={y - 8} textAnchor="middle" fill="#fff" fontSize="9" fontWeight="bold">!</text>
        </g>
      )}
      {itsmConflict && (
        <g pointerEvents="none">
          <circle cx={x + 12} cy={y - 12} r="5" fill="#f97316" stroke="#fff" strokeWidth="1.5" />
        </g>
      )}
      {isCrossFloor && (
        <g pointerEvents="none">
          <circle cx={x - 13} cy={y + 13} r="7" fill="#06b6d4" stroke="#fff" strokeWidth="2" />
          <text x={x - 13} y={y + 17} textAnchor="middle" fill="#fff" fontSize="8" fontWeight="bold">↕</text>
        </g>
      )}
      {!decomm && asset.maintenance?.next_date && new Date(asset.maintenance.next_date) < new Date() && (
        <g pointerEvents="none">
          <circle cx={x + 11} cy={y - 11} r="7" fill="#ef4444" stroke="#fff" strokeWidth="2" />
          <text x={x + 11} y={y - 7} textAnchor="middle" fill="#fff" fontSize="9" fontWeight="bold">!</text>
        </g>
      )}
    </g>
  );
});

interface FloorMapProps {
  workareas: WorkArea[];
  assets: Asset[];
  onWorkareaClick?: (workarea: WorkArea) => void;
  onAssetClick?: (asset: Asset) => void;
  onWorkareaMove?: (workareaId: string, x: number, y: number) => void;
  onWorkareaResize?: (workareaId: string, width: number, height: number) => void;
  onAssetMove?: (assetId: string, x: number, y: number) => void;
  onMapClick?: (x: number, y: number, occupancy?: { occupied: boolean; reason?: string }) => void;
  editable?: boolean;
  backgroundImage?: string;
  deployMode?: boolean;
  deployPosition?: { x: number; y: number } | null;
  layers?: {
    workareas: boolean;
    assets: boolean;
    connections: boolean;
    grid: boolean;
    wallports: boolean;
  };
  onLayerToggle?: (layer: keyof NonNullable<FloorMapProps['layers']>) => void;
  connectionMode?: boolean;
  selectedAssetsForConnection?: string[];
  onAssetSelectForConnection?: (assetId: string) => void;
  highlightedAssetId?: string | null;
  focusAsset?: { id: string; tick: number } | null;
  onWorkareaCreate?: (x: number, y: number, width: number, height: number) => void;
  onWorkareaDelete?: (workareaId: string) => void;
  onWorkareaRename?: (workareaId: string, name: string) => void;
  onAssetStatusChange?: (assetId: string, status: string) => void;
  onAssetEdit?: (asset: Asset) => void;
  onAssetClone?: (asset: Asset) => void;
  onConnectionDelete?: (assetId: string, connectedAssetId: string) => void;
  activeConnectionTypes?: Set<string>;
  unplacedAssets?: Asset[];
  onPlaceUnplaced?: (assetId: string, x: number, y: number) => void;
  allAssets?: Asset[];
  onNavigateToAsset?: (assetId: string, floorId: string) => void;
  wallPorts?: WallPort[];
  onWallPortMove?: (portId: string, x: number, y: number) => void;
  onAssetTrace?: (asset: Asset) => void;
  floorName?: string;
}

const GRID_SIZE = 50; // Grid snap size

const FloorMap: React.FC<FloorMapProps> = ({
  workareas,
  assets,
  onWorkareaClick,
  onAssetClick,
  onWorkareaMove,
  onWorkareaResize,
  onAssetMove,
  onMapClick,
  editable = false,
  backgroundImage,
  deployMode = false,
  deployPosition,
  layers = { workareas: true, assets: true, connections: false, grid: true, wallports: false },
  onLayerToggle,
  connectionMode = false,
  selectedAssetsForConnection = [],
  onAssetSelectForConnection,
  highlightedAssetId = null,
  focusAsset = null,
  onWorkareaCreate,
  onWorkareaDelete,
  onWorkareaRename,
  onAssetStatusChange,
  onAssetEdit,
  onAssetClone,
  onConnectionDelete,
  activeConnectionTypes,
  unplacedAssets = [],
  onPlaceUnplaced,
  allAssets = [],
  onNavigateToAsset,
  wallPorts = [],
  onWallPortMove,
  onAssetTrace,
  floorName,
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const minimapRef = useRef<SVGSVGElement>(null);
  const pannedRef = useRef(false);
  
  const [dragging, setDragging] = useState<{
    type: 'workarea' | 'asset' | 'resize' | 'pan' | 'wallport';
    id: string;
    offsetX: number;
    offsetY: number;
    startWidth?: number;
    startHeight?: number;
  } | null>(null);

  const [viewBox, setViewBox] = useState({ x: 0, y: 0, width: 1000, height: 800 });
  const [zoom, setZoom] = useState(1);
  const [backgroundOpacity, setBackgroundOpacity] = useState(0.5);
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [showMinimap, setShowMinimap] = useState(true);
  const [bgFitMode, setBgFitMode] = useState<'meet' | 'slice'>('meet');
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [drawRect, setDrawRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [popover, setPopover] = useState<{ asset: Asset; screenX: number; screenY: number } | null>(null);
  const [connPopover, setConnPopover] = useState<{ assetId: string; connectedAssetId: string; label: string; screenX: number; screenY: number } | null>(null);
  const [wallPortPopover, setWallPortPopover] = useState<{ port: WallPort; screenX: number; screenY: number } | null>(null);
  const [pendingDeleteWorkareaId, setPendingDeleteWorkareaId] = useState<string | null>(null);
  const [showLabels, setShowLabels] = useState(true);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [placingAsset, setPlacingAsset] = useState<Asset | null>(null);
  const [unplacedTrayOpen, setUnplacedTrayOpen] = useState(true);

  // Tooltip state
  const [tooltip, setTooltip] = useState<{
    visible: boolean;
    x: number;
    y: number;
    content: React.ReactNode;
  }>({
    visible: false,
    x: 0,
    y: 0,
    content: null,
  });

  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  // Ref-mirror of dragging so stable callbacks can read current value without being in the dep array
  const draggingRef = useRef(dragging);
  useEffect(() => { draggingRef.current = dragging; }, [dragging]);

  // Cancel placing mode on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPlacingAsset(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Pan the viewBox to center on the focused asset whenever focusAsset changes
  useEffect(() => {
    if (!focusAsset) return;
    const asset = assets.find(a => a._id === focusAsset.id);
    if (!asset) return;
    const { x, y } = asset.location.coordinates;
    setViewBox(prev => {
      const w = prev.width / zoom;
      const h = prev.height / zoom;
      return { ...prev, x: x - w / 2, y: y - h / 2 };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusAsset]);

  // Cross-floor connection detection — keyed by asset ID
  const crossFloorMap = useMemo(() => {
    const assetIds = new Set(assets.map(a => a._id));
    const wallPortIds = new Set(wallPorts.map(wp => wp._id));
    const result = new Map<string, Array<{ connectedAssetId: string; connectionType: string; connectedAsset: Asset | undefined }>>();
    assets.forEach(asset => {
      // Exclude wall port connections — they are on this floor, not cross-floor
      const offFloor = (asset.connections ?? []).filter(c =>
        !assetIds.has(c.connected_asset_id) && !wallPortIds.has(c.connected_asset_id)
      );
      if (offFloor.length > 0) {
        result.set(asset._id, offFloor.map(c => ({
          connectedAssetId: c.connected_asset_id,
          connectionType: c.connection_type,
          connectedAsset: allAssets.find(a => a._id === c.connected_asset_id),
        })));
      }
    });
    return result;
  }, [assets, allAssets, wallPorts]);

  // Snap to grid helper
  const snapToGridHelper = (value: number): number => {
    if (!snapToGrid) return value;
    return Math.round(value / GRID_SIZE) * GRID_SIZE;
  };

  const getAssetsInWorkarea = (workarea: WorkArea) => {
    return assets.filter((asset) => {
      if (asset.hierarchy.workarea_id === workarea._id) {
        return true;
      }
      if (!workarea.coordinates || !workarea.dimensions) {
        return false;
      }
      const { x, y } = workarea.coordinates;
      const { width, height } = workarea.dimensions;
      return (
        asset.location.coordinates.x >= x &&
        asset.location.coordinates.x <= x + width &&
        asset.location.coordinates.y >= y &&
        asset.location.coordinates.y <= y + height
      );
    });
  };

  const getConnectionColor = (type: string): string => {
    switch (type) {
      case 'power':       return '#ef4444'; // red
      case 'network':
      case 'ethernet':    return '#3b82f6'; // blue
      case 'fiber':       return '#8b5cf6'; // purple
      case 'wifi':        return '#06b6d4'; // cyan
      case 'bluetooth':   return '#6366f1'; // indigo
      case 'usb':         return '#f59e0b'; // amber
      case 'serial':
      case 'parallel':    return '#78716c'; // stone
      case 'dependency':  return '#f97316'; // orange
      case 'parent-child':return '#84cc16'; // lime
      case 'peer':        return '#14b8a6'; // teal
      default:            return '#9ca3af'; // gray
    }
  };

  // Hit-testing helpers
  const ASSET_COLLISION_RADIUS = 30; // Minimum distance between assets

  const isPointInWorkarea = (x: number, y: number): WorkArea | null => {
    for (const workarea of workareas) {
      if (!workarea.coordinates || !workarea.dimensions) continue;
      const { x: wx, y: wy } = workarea.coordinates;
      const { width, height } = workarea.dimensions;
      if (x >= wx && x <= wx + width && y >= wy && y <= wy + height) {
        return workarea;
      }
    }
    return null;
  };

  const isPointNearAsset = (x: number, y: number): Asset | null => {
    for (const asset of assets) {
      const { x: ax, y: ay } = asset.location.coordinates;
      const distance = Math.sqrt((x - ax) ** 2 + (y - ay) ** 2);
      if (distance < ASSET_COLLISION_RADIUS) {
        return asset;
      }
    }
    return null;
  };

  const getSpaceOccupancy = (x: number, y: number): { occupied: boolean; reason?: string } => {
    const workareaAtPoint = isPointInWorkarea(x, y);
    if (workareaAtPoint) {
      return { occupied: true, reason: `In workarea: ${workareaAtPoint.name || 'Unnamed'}` };
    }

    const assetNearPoint = isPointNearAsset(x, y);
    if (assetNearPoint) {
      return { occupied: true, reason: `Too close to: ${assetNearPoint.basic_info.display_name}` };
    }

    return { occupied: false };
  };

  const getSVGPoint = (e: React.MouseEvent): { x: number; y: number } | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const sp = pt.matrixTransform(svg.getScreenCTM()?.inverse());
    return { x: snapToGridHelper(sp.x), y: snapToGridHelper(sp.y) };
  };

  const handleDrawStart = (e: React.MouseEvent<SVGRectElement>) => {
    if (!editable || !onWorkareaCreate || deployMode) return;
    if (e.button !== 0 || e.shiftKey || e.altKey) return;
    const pt = getSVGPoint(e);
    if (!pt) return;
    e.stopPropagation();
    setDrawStart(pt);
    setDrawRect({ x: pt.x, y: pt.y, w: 0, h: 0 });
  };

  const handleDrawMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!drawStart) return;
    const pt = getSVGPoint(e);
    if (!pt) return;
    setDrawRect({
      x: Math.min(drawStart.x, pt.x),
      y: Math.min(drawStart.y, pt.y),
      w: Math.abs(pt.x - drawStart.x),
      h: Math.abs(pt.y - drawStart.y),
    });
  };

  const handleDrawEnd = () => {
    if (!drawStart || !drawRect) return;
    if (drawRect.w > 30 && drawRect.h > 20) {
      onWorkareaCreate?.(drawRect.x, drawRect.y, drawRect.w, drawRect.h);
    }
    setDrawStart(null);
    setDrawRect(null);
  };

  const handleWorkareaDelete = (workareaId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setPendingDeleteWorkareaId(workareaId);
  };

  const confirmWorkareaDelete = () => {
    if (pendingDeleteWorkareaId) {
      onWorkareaDelete?.(pendingDeleteWorkareaId);
    }
    setPendingDeleteWorkareaId(null);
  };

  // Handle mouse move for dragging
  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (drawStart) { handleDrawMove(e); return; }
    if (!dragging) return;

    const svg = svgRef.current;
    if (!svg) return;

    const point = svg.createSVGPoint();
    point.x = e.clientX;
    point.y = e.clientY;

    const svgPoint = point.matrixTransform(svg.getScreenCTM()?.inverse());

    if (dragging.type === 'pan') {
      // Pan the view
      const dx = svgPoint.x - dragging.offsetX;
      const dy = svgPoint.y - dragging.offsetY;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) pannedRef.current = true;

      setViewBox(prev => ({
        ...prev,
        x: prev.x - dx,
        y: prev.y - dy,
      }));

      setDragging({ ...dragging, offsetX: svgPoint.x, offsetY: svgPoint.y });
    } else if (dragging.type === 'workarea' && onWorkareaMove && editable) {
      const newX = snapToGridHelper(svgPoint.x - dragging.offsetX);
      const newY = snapToGridHelper(svgPoint.y - dragging.offsetY);
      onWorkareaMove(dragging.id, Math.round(newX), Math.round(newY));
    } else if (dragging.type === 'asset' && onAssetMove && editable) {
      const newX = snapToGridHelper(svgPoint.x - dragging.offsetX);
      const newY = snapToGridHelper(svgPoint.y - dragging.offsetY);
      onAssetMove(dragging.id, Math.round(newX), Math.round(newY));
    } else if (dragging.type === 'wallport' && onWallPortMove && editable) {
      const newX = snapToGridHelper(svgPoint.x - dragging.offsetX);
      const newY = snapToGridHelper(svgPoint.y - dragging.offsetY);
      onWallPortMove(dragging.id, Math.round(newX), Math.round(newY));
    } else if (dragging.type === 'resize' && onWorkareaResize && editable) {
      const workarea = workareas.find((w) => w._id === dragging.id);
      if (!workarea) return;

      const newWidth = Math.max(50, svgPoint.x - (workarea.coordinates?.x || 0));
      const newHeight = Math.max(30, svgPoint.y - (workarea.coordinates?.y || 0));

      const snappedWidth = snapToGridHelper(newWidth);
      const snappedHeight = snapToGridHelper(newHeight);

      onWorkareaResize(dragging.id, Math.round(snappedWidth), Math.round(snappedHeight));
    }
  };

  // Handle mouse up to stop dragging
  const handleMouseUp = () => {
    if (drawStart) { handleDrawEnd(); return; }
    setDragging(null);
  };

  // Left-click drag on empty background pans the map (non-edit, non-deploy, non-placing mode)
  const handleBackgroundMouseDown = (e: React.MouseEvent<SVGRectElement>) => {
    if (editable && onWorkareaCreate) { handleDrawStart(e); return; }
    if (!deployMode && !placingAsset) {
      pannedRef.current = false;
      startPanning(e);
    }
  };

  // Click minimap to jump the main viewport to that map position
  const handleMinimapClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = minimapRef.current;
    if (!svg) return;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const svgPt = pt.matrixTransform(svg.getScreenCTM()?.inverse());
    const w = viewBox.width / zoom;
    const h = viewBox.height / zoom;
    setViewBox(prev => ({ ...prev, x: svgPt.x - w / 2, y: svgPt.y - h / 2 }));
  };

  // Handle zoom
  const handleZoomIn = () => {
    setZoom((prev) => Math.min(prev * 1.2, 3));
  };

  const handleZoomOut = () => {
    setZoom((prev) => Math.max(prev / 1.2, 0.5));
  };

  const handleResetView = () => {
    setZoom(1);
    setViewBox({ x: 0, y: 0, width: 1000, height: 800 });
  };

  // Opacity control
  const handleOpacityIncrease = () => {
    setBackgroundOpacity((prev) => Math.min(prev + 0.1, 1));
  };

  const handleOpacityDecrease = () => {
    setBackgroundOpacity((prev) => Math.max(prev - 0.1, 0.1));
  };

  // Pan mode (spacebar or middle mouse)
  const startPanning = (e: React.MouseEvent) => {
    if (e.button === 1 || e.button === 0) { // Middle click or left click in pan mode
      e.preventDefault();
      const svg = svgRef.current;
      if (!svg) return;

      const point = svg.createSVGPoint();
      point.x = e.clientX;
      point.y = e.clientY;
      const svgPoint = point.matrixTransform(svg.getScreenCTM()?.inverse());

      setDragging({
        type: 'pan',
        id: '',
        offsetX: svgPoint.x,
        offsetY: svgPoint.y,
      });
    }
  };

  // Export as PNG
  const handleExportImage = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const svgData = new XMLSerializer().serializeToString(svg);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const img = new Image();

    canvas.width = 1000;
    canvas.height = 800;

    img.onload = () => {
      ctx?.drawImage(img, 0, 0);
      canvas.toBlob((blob) => {
        if (blob) {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = 'floor-plan.png';
          a.click();
          URL.revokeObjectURL(url);
        }
      });
    };

    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
  }, []);

  // Export as PDF (A4 landscape, with header)
  const handleExportPdf = useCallback(async () => {
    const svg = svgRef.current;
    if (!svg) return;

    const { default: jsPDF } = await import('jspdf');

    const W = 1200, H = 900;
    const svgData = new XMLSerializer().serializeToString(svg);
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    const img = new Image();

    img.onload = () => {
      if (ctx) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, W, H);
        ctx.drawImage(img, 0, 0, W, H);
      }
      const dataUrl = canvas.toDataURL('image/png');

      const pdf = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const title = floorName ?? 'Floor Plan';

      pdf.setFont('helvetica', 'bold');
      pdf.setFontSize(14);
      pdf.text(title, 14, 13);
      pdf.setFont('helvetica', 'normal');
      pdf.setFontSize(8);
      pdf.text(`Exported ${new Date().toLocaleString()}`, 14, 19);

      const imgY = 24;
      pdf.addImage(dataUrl, 'PNG', 14, imgY, pageW - 28, pageH - imgY - 8);
      pdf.save(`${title.replace(/\s+/g, '-').toLowerCase()}.pdf`);
    };

    img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
  }, [floorName]);

  // Print — opens a dedicated print window with just the map SVG
  const handlePrint = useCallback(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const svgData = new XMLSerializer().serializeToString(svg);
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;
    const scriptClose = '</script>';
    printWindow.document.write(
      '<!DOCTYPE html><html><head><title>Floor Map</title>' +
      '<style>body{margin:0;display:flex;justify-content:center;align-items:center;min-height:100vh;background:#fff}' +
      'svg{max-width:100%;height:auto}@media print{body{margin:0}}</style>' +
      '</head><body>' + svgData +
      '<script>window.onload=()=>{window.print();window.close()}' + scriptClose +
      '</body></html>'
    );
    printWindow.document.close();
  }, []);

  // Tooltip handlers
  const showTooltip = useCallback((e: React.MouseEvent, content: React.ReactNode) => {
    if (editable || draggingRef.current) return;
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    hoverTimeoutRef.current = setTimeout(() => {
      setTooltip({ visible: true, x: e.clientX, y: e.clientY, content });
    }, 500);
  }, [editable]);

  const hideTooltip = useCallback(() => {
    if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    setTooltip({ visible: false, x: 0, y: 0, content: null });
  }, []);

  const handleMapClick = (e: React.MouseEvent<SVGRectElement>) => {
    if (pannedRef.current) { pannedRef.current = false; return; }
    const svg = svgRef.current;
    if (!svg) return;

    const point = svg.createSVGPoint();
    point.x = e.clientX;
    point.y = e.clientY;
    const svgPoint = point.matrixTransform(svg.getScreenCTM()?.inverse());
    const x = Math.round(snapToGridHelper(svgPoint.x));
    const y = Math.round(snapToGridHelper(svgPoint.y));

    if (placingAsset) {
      onPlaceUnplaced?.(placingAsset._id, x, y);
      setPlacingAsset(null);
      return;
    }

    if (!deployMode || !onMapClick) return;
    const occupancy = getSpaceOccupancy(x, y);
    onMapClick(x, y, occupancy);
  };

  // Start dragging workarea
  const startDraggingWorkarea = (workarea: WorkArea, e: React.MouseEvent) => {
    if (!editable) return;
    e.stopPropagation();
    hideTooltip();

    const svg = svgRef.current;
    if (!svg) return;

    const point = svg.createSVGPoint();
    point.x = e.clientX;
    point.y = e.clientY;
    const svgPoint = point.matrixTransform(svg.getScreenCTM()?.inverse());

    setDragging({
      type: 'workarea',
      id: workarea._id,
      offsetX: svgPoint.x - (workarea.coordinates?.x || 0),
      offsetY: svgPoint.y - (workarea.coordinates?.y || 0),
    });
  };

  // Start resizing workarea
  const startResizingWorkarea = (workarea: WorkArea, e: React.MouseEvent) => {
    if (!editable) return;
    e.stopPropagation();
    hideTooltip();

    setDragging({
      type: 'resize',
      id: workarea._id,
      offsetX: 0,
      offsetY: 0,
      startWidth: workarea.dimensions?.width || 150,
      startHeight: workarea.dimensions?.height || 100,
    });
  };

  // Start dragging asset
  const startDraggingAsset = useCallback((asset: Asset, e: React.MouseEvent) => {
    if (!editable) return;
    e.stopPropagation();
    hideTooltip();
    const svg = svgRef.current;
    if (!svg) return;
    const point = svg.createSVGPoint();
    point.x = e.clientX;
    point.y = e.clientY;
    const svgPoint = point.matrixTransform(svg.getScreenCTM()?.inverse());
    setDragging({
      type: 'asset',
      id: asset._id,
      offsetX: svgPoint.x - asset.location.coordinates.x,
      offsetY: svgPoint.y - asset.location.coordinates.y,
    });
  }, [editable, hideTooltip]);

  const startDraggingWallPort = (wp: WallPort, e: React.MouseEvent) => {
    if (!editable) return;
    e.stopPropagation();
    hideTooltip();
    const svg = svgRef.current;
    if (!svg) return;
    const point = svg.createSVGPoint();
    point.x = e.clientX;
    point.y = e.clientY;
    const svgPoint = point.matrixTransform(svg.getScreenCTM()?.inverse());
    setDragging({ type: 'wallport', id: wp._id, offsetX: svgPoint.x - wp.pos_x, offsetY: svgPoint.y - wp.pos_y });
  };

  // Handle workarea click
  const handleWorkareaClickInternal = (workarea: WorkArea) => {
    if (editable) return;
    hideTooltip();
    onWorkareaClick?.(workarea);
  };

  // Handle asset click
  const handleAssetClickInternal = useCallback((asset: Asset, e: React.MouseEvent) => {
    if (connectionMode) {
      onAssetSelectForConnection?.(asset._id);
      return;
    }
    if (editable) return;
    hideTooltip();
    setPopover({ asset, screenX: e.clientX, screenY: e.clientY });
  }, [connectionMode, editable, hideTooltip, onAssetSelectForConnection]);

  // Get asset color based on status
  return (
    <>
    <div ref={containerRef} className={styles.mapContainer}>
      {/* Controls */}
      <div className={styles.controls}>
        <button onClick={handleZoomIn} className={styles.controlButton} title="Zoom In">
          ➕
        </button>
        <button onClick={handleZoomOut} className={styles.controlButton} title="Zoom Out">
          ➖
        </button>
        <button onClick={handleResetView} className={styles.controlButton} title="Reset View">
          🔄
        </button>
        <button
          onClick={() => setSnapToGrid(!snapToGrid)}
          className={`${styles.controlButton} ${snapToGrid ? styles.active : ''}`}
          title="Snap to Grid"
        >
          🧲
        </button>
        <button
          onClick={() => setShowMinimap(!showMinimap)}
          className={`${styles.controlButton} ${showMinimap ? styles.active : ''}`}
          title="Toggle Minimap"
        >
          🗺️
        </button>
        {backgroundImage && (
          <>
            <button
              onClick={handleOpacityDecrease}
              className={styles.controlButton}
              title="Decrease Background Opacity"
            >
              🌑
            </button>
            <button
              onClick={handleOpacityIncrease}
              className={styles.controlButton}
              title="Increase Background Opacity"
            >
              🌕
            </button>
            <button
              onClick={() => setBgFitMode(m => m === 'meet' ? 'slice' : 'meet')}
              className={`${styles.controlButton} ${bgFitMode === 'slice' ? styles.active : ''}`}
              title={bgFitMode === 'meet' ? 'Switch to Fill (slice)' : 'Switch to Fit (meet)'}
            >
              {bgFitMode === 'meet' ? '⬛' : '🔳'}
            </button>
          </>
        )}
        <button
          onClick={() => setShowLabels(s => !s)}
          className={`${styles.controlButton} ${showLabels ? styles.active : ''}`}
          title="Toggle Asset Labels"
        >
          🏷️
        </button>
        <button onClick={handleExportImage} className={styles.controlButton} title="Export as PNG">
          💾
        </button>
        <button onClick={handleExportPdf} className={styles.controlButton} title="Export as PDF">
          📄
        </button>
        <button onClick={handlePrint} className={styles.controlButton} title="Print">
          🖨️
        </button>
        {/* Layer Toggles */}
        <div className={styles.layerControls}>
          <button
            onClick={() => onLayerToggle?.('workareas')}
            className={`${styles.controlButton} ${layers.workareas ? styles.active : ''}`}
            title="Toggle Work Areas"
          >
            🏭
          </button>
          <button
            onClick={() => onLayerToggle?.('assets')}
            className={`${styles.controlButton} ${layers.assets ? styles.active : ''}`}
            title="Toggle Assets"
          >
            💻
          </button>
          <button
            onClick={() => onLayerToggle?.('connections')}
            className={`${styles.controlButton} ${layers.connections ? styles.active : ''}`}
            title="Toggle Connections"
          >
            🔗
          </button>
          <button
            onClick={() => onLayerToggle?.('grid')}
            className={`${styles.controlButton} ${layers.grid ? styles.active : ''}`}
            title="Toggle Grid"
          >
            #️⃣
          </button>
          <button
            onClick={() => onLayerToggle?.('wallports')}
            className={`${styles.controlButton} ${layers.wallports ? styles.active : ''}`}
            title="Toggle Wall Ports"
          >
            🔌
          </button>
        </div>
        {editable && (
          <div className={styles.editMode}>
            <span>✏️ Edit Mode</span>
          </div>
        )}
      </div>

      {/* SVG Canvas */}
      <svg
        ref={svgRef}
        className={styles.svg}
        style={{ cursor: (deployMode || placingAsset) ? 'crosshair' : undefined }}
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.width / zoom} ${viewBox.height / zoom}`}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseDown={(e) => {
          if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
            startPanning(e);
          }
        }}
        onMouseLeave={() => {
          handleMouseUp();
          hideTooltip();
        }}
      >
        {/* Background Image/SVG */}
        <rect
          x="0"
          y="0"
          width="1000"
          height="800"
          fill="transparent"
          onClick={handleMapClick}
          onMouseDown={handleBackgroundMouseDown}
          style={{ cursor: !editable && !deployMode && !placingAsset ? 'grab' : undefined }}
        />

        {/* Draw preview */}
        {drawRect && drawRect.w > 5 && drawRect.h > 5 && (
          <rect
            x={drawRect.x}
            y={drawRect.y}
            width={drawRect.w}
            height={drawRect.h}
            fill="#7c3aed"
            fillOpacity="0.15"
            stroke="#7c3aed"
            strokeWidth="2"
            strokeDasharray="6,3"
            pointerEvents="none"
          />
        )}

        {backgroundImage && (
          <image
            href={backgroundImage}
            x="0"
            y="0"
            width="1000"
            height="800"
            opacity={backgroundOpacity}
            preserveAspectRatio={`xMidYMid ${bgFitMode}`}
            pointerEvents="none"
          />
        )}

        {/* Grid Background - ALWAYS render if layers.grid is true */}
        <defs>
          <pattern id="grid" width={GRID_SIZE} height={GRID_SIZE} patternUnits="userSpaceOnUse">
            <path
              d={`M ${GRID_SIZE} 0 L 0 0 0 ${GRID_SIZE}`}
              fill="none"
              stroke="#4b5563"
              strokeWidth="1"
            />
          </pattern>
        </defs>
        {layers.grid && (
          <rect 
            width="1000" 
            height="800" 
            fill="url(#grid)" 
            opacity={backgroundImage ? "0.6" : "0.3"}
            pointerEvents="none"
          />
        )}

        {/* Work Areas */}
        {layers.workareas && workareas.map((workarea) => {
          const x = workarea.coordinates?.x || 100;
          const y = workarea.coordinates?.y || 100;
          const width = workarea.dimensions?.width || 150;
          const height = workarea.dimensions?.height || 100;
          const isDragging = dragging?.type === 'workarea' && dragging.id === workarea._id;
          const isResizing = dragging?.type === 'resize' && dragging.id === workarea._id;
          const assetsInArea = getAssetsInWorkarea(workarea);
          const capacity = workarea.metadata?.capacity || 0;
          const utilization = capacity > 0 ? Math.min(assetsInArea.length / capacity, 1) : 0;
          const utilizationColor = utilization > 0.8 ? '#ef4444' : utilization > 0.6 ? '#f59e0b' : '#10b981';

          return (
            <g key={workarea._id}>
              <rect
                x={x}
                y={y}
                width={width}
                height={height}
                fill="#ddd6fe"
                fillOpacity="0.7"
                stroke="#7c3aed"
                strokeWidth="3"
                rx="8"
                className={`${styles.workarea} ${isDragging ? styles.dragging : ''}`}
                onMouseDown={(e) => startDraggingWorkarea(workarea, e)}
                onClick={() => handleWorkareaClickInternal(workarea)}
                onMouseEnter={(e) =>
                  showTooltip(
                    e as any,
                    <div>
                      <h4>🏭 {workarea.name}</h4>
                      {workarea.type && <p><span className={styles.label}>Type:</span> {workarea.type}</p>}
                      {workarea.metadata?.supervisor && (
                        <p><span className={styles.label}>Supervisor:</span> {workarea.metadata.supervisor}</p>
                      )}
                      {capacity > 0 && (
                        <p><span className={styles.label}>Capacity:</span> {assetsInArea.length}/{capacity} ({Math.round(utilization * 100)}%)</p>
                      )}
                      <p><span className={styles.label}>Assets:</span> {assetsInArea.length}</p>
                      <p style={{ fontSize: '10px', marginTop: '4px', fontStyle: 'italic' }}>
                        Click to see details
                      </p>
                    </div>
                  )
                }
                onMouseLeave={hideTooltip}
                style={{ cursor: editable ? 'move' : 'pointer' }}
              />

              {/* Capacity indicator bar */}
              {capacity > 0 && (
                <rect
                  x={x + 5}
                  y={y + height - 8}
                  width={(width - 10) * utilization}
                  height="6"
                  fill={utilizationColor}
                  rx="3"
                  opacity="0.8"
                />
              )}

              {/* Header band — name stays at top so asset body is clear */}
              <rect
                x={x}
                y={y}
                width={width}
                height={26}
                fill="#7c3aed"
                fillOpacity="0.18"
                rx="8"
                pointerEvents="none"
              />

              {renamingId === workarea._id ? (
                <foreignObject x={x + 8} y={y + 4} width={width - 16} height={22}>
                  <input
                    // @ts-ignore
                    xmlns="http://www.w3.org/1999/xhtml"
                    autoFocus
                    value={renameValue}
                    onChange={e => setRenameValue(e.target.value)}
                    onBlur={() => {
                      if (renameValue.trim()) onWorkareaRename?.(workarea._id, renameValue.trim());
                      setRenamingId(null);
                    }}
                    onKeyDown={e => {
                      if (e.key === 'Enter') { if (renameValue.trim()) onWorkareaRename?.(workarea._id, renameValue.trim()); setRenamingId(null); }
                      if (e.key === 'Escape') setRenamingId(null);
                    }}
                    onClick={e => e.stopPropagation()}
                    style={{ width: '100%', fontSize: 12, fontWeight: 'bold', border: '2px solid #7c3aed', borderRadius: 4, padding: '2px 6px', boxSizing: 'border-box' }}
                  />
                </foreignObject>
              ) : (
                <text
                  x={x + 8}
                  y={y + 17}
                  textAnchor="start"
                  className={styles.workareaLabel}
                  style={{ fontWeight: 'bold', fontSize: '12px', cursor: editable ? 'text' : undefined }}
                  onDoubleClick={editable ? () => { setRenamingId(workarea._id); setRenameValue(workarea.name); } : undefined}
                  pointerEvents={editable ? 'all' : 'none'}
                  stroke="white"
                  strokeWidth="3"
                  paintOrder="stroke"
                >
                  {workarea.name.length > 22 ? workarea.name.slice(0, 20) + '…' : workarea.name}
                </text>
              )}

              {workarea.type && (
                <text
                  x={x + width - 8}
                  y={y + 17}
                  textAnchor="end"
                  className={styles.workareaType}
                  pointerEvents="none"
                  style={{ fontSize: '11px' }}
                  stroke="white"
                  strokeWidth="2"
                  paintOrder="stroke"
                >
                  {workarea.type}
                </text>
              )}

              {assetsInArea.length > 0 && (
                <g>
                  <circle
                    cx={x + width - 14}
                    cy={y + 13}
                    r="11"
                    fill="#7c3aed"
                    stroke="#fff"
                    strokeWidth="2"
                    pointerEvents="none"
                  />
                  <text
                    x={x + width - 14}
                    y={y + 17}
                    textAnchor="middle"
                    fill="#fff"
                    fontSize="10"
                    fontWeight="bold"
                    pointerEvents="none"
                  >
                    {assetsInArea.length}
                  </text>
                </g>
              )}

              {editable && (
                <circle
                  cx={x + width}
                  cy={y + height}
                  r="10"
                  fill="#7c3aed"
                  stroke="#fff"
                  strokeWidth="3"
                  className={`${styles.resizeHandle} ${isResizing ? styles.resizing : ''}`}
                  onMouseDown={(e) => startResizingWorkarea(workarea, e)}
                  style={{ cursor: 'nwse-resize' }}
                />
              )}
              {editable && onWorkareaDelete && (
                <g
                  style={{ cursor: 'pointer' }}
                  onClick={(e) => handleWorkareaDelete(workarea._id, e)}
                >
                  <circle cx={x + 14} cy={y + 14} r="11" fill="#ef4444" stroke="#fff" strokeWidth="2" />
                  <text x={x + 14} y={y + 19} textAnchor="middle" fill="#fff" fontSize="14" fontWeight="bold" pointerEvents="none">×</text>
                </g>
              )}
            </g>
          );
        })}

        {/* Connections */}
        {layers.connections && assets.map((asset) =>
          asset.connections?.map((connection, index) => {
            if (activeConnectionTypes && activeConnectionTypes.size > 0 && !activeConnectionTypes.has(connection.connection_type)) return null;
            const connectedAsset = assets.find(a => a._id === connection.connected_asset_id);
            const connectedWallPort = !connectedAsset ? wallPorts.find(wp => wp._id === connection.connected_asset_id) : null;
            if (!connectedAsset && !connectedWallPort) return null;

            const isWallPortConn = !!connectedWallPort;
            const x1 = asset.location.coordinates.x;
            const y1 = asset.location.coordinates.y;
            const x2 = connectedAsset ? connectedAsset.location.coordinates.x : connectedWallPort!.pos_x;
            const y2 = connectedAsset ? connectedAsset.location.coordinates.y : connectedWallPort!.pos_y;

            const color = getConnectionColor(connection.connection_type);
            const markerId = `arrow-${asset._id}-${connection.connected_asset_id}-${index}`;
            const arrowSize = isWallPortConn ? 6 : 8;
            const strokeWidth = isWallPortConn ? 1.5 : (connection.strength === 'strong' ? 3 : connection.strength === 'weak' ? 1 : 2);

            return (
              <g key={`${asset._id}-${connection.connected_asset_id}-${index}`}>
                <defs>
                  <marker
                    id={markerId}
                    markerWidth={arrowSize}
                    markerHeight={arrowSize}
                    refX={arrowSize}
                    refY={arrowSize / 2}
                    orient="auto"
                  >
                    <polygon
                      points={`0 0, ${arrowSize} ${arrowSize / 2}, 0 ${arrowSize}`}
                      fill={color}
                      opacity="0.8"
                    />
                  </marker>
                </defs>
                <line
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke={color}
                  strokeWidth={strokeWidth}
                  strokeDasharray={isWallPortConn ? '4,5' : (connection.bidirectional ? undefined : '6,3')}
                  opacity={isWallPortConn ? 0.5 : 0.75}
                  markerEnd={`url(#${markerId})`}
                />
                {/* Transparent hit area for clicking */}
                <line
                  x1={x1}
                  y1={y1}
                  x2={x2}
                  y2={y2}
                  stroke="transparent"
                  strokeWidth="12"
                  style={{ cursor: 'pointer' }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setConnPopover({
                      assetId: asset._id,
                      connectedAssetId: connection.connected_asset_id,
                      label: connection.label || `${connection.connection_type}`,
                      screenX: e.clientX,
                      screenY: e.clientY,
                    });
                  }}
                />
                {connection.label && (
                  <text
                    x={(x1 + x2) / 2}
                    y={(y1 + y2) / 2 - 6}
                    textAnchor="middle"
                    fontSize="10"
                    fill={color}
                    fontWeight="600"
                    stroke="white"
                    strokeWidth="3"
                    paintOrder="stroke"
                    pointerEvents="none"
                  >
                    {connection.label}
                  </text>
                )}
              </g>
            );
          })
        ).flat().filter(Boolean)}

        {/* Wall Ports */}
        {layers.wallports && wallPorts.map((wp) => {
          const wx = wp.pos_x;
          const wy = wp.pos_y;
          const hasPanel = !!wp.patch_panel_id;
          const fill = hasPanel ? '#f59e0b' : '#9ca3af';
          const stroke = hasPanel ? '#d97706' : '#6b7280';
          const isDraggingWp = dragging?.type === 'wallport' && dragging.id === wp._id;
          return (
            <g
              key={wp._id}
              style={{ cursor: editable ? 'move' : 'pointer' }}
              onMouseDown={editable ? (e) => startDraggingWallPort(wp, e) : undefined}
              onClick={editable ? undefined : (e) => {
                e.stopPropagation();
                setWallPortPopover({ port: wp, screenX: e.clientX, screenY: e.clientY });
              }}
              opacity={isDraggingWp ? 0.6 : 1}
              onMouseEnter={(e) => showTooltip(e as any,
                <div>
                  <h4>🔌 {wp.label}</h4>
                  {wp.patch_panel_name && <p><span className={styles.label}>Panel:</span> {wp.patch_panel_name}</p>}
                  {wp.patch_port != null && <p><span className={styles.label}>Port:</span> {wp.patch_port}</p>}
                  {wp.room_name && <p><span className={styles.label}>Room:</span> {wp.room_name} ({wp.room_type?.toUpperCase()})</p>}
                  {wp.rack_name && <p><span className={styles.label}>Rack:</span> {wp.rack_name}</p>}
                  {wp.switch_port && <p><span className={styles.label}>Switch port:</span> {wp.switch_port}</p>}
                  {!hasPanel && <p style={{ color: '#9ca3af', fontStyle: 'italic' }}>Not patched</p>}
                </div>
              )}
              onMouseLeave={hideTooltip}
            >
              <rect x={wx - 7} y={wy - 5} width={14} height={10} rx={2} fill={fill} stroke={stroke} strokeWidth={1.5} />
              <rect x={wx - 4} y={wy - 3} width={2} height={4} rx={0.5} fill={stroke} />
              <rect x={wx - 1} y={wy - 3} width={2} height={4} rx={0.5} fill={stroke} />
              <rect x={wx + 2} y={wy - 3} width={2} height={4} rx={0.5} fill={stroke} />
              {showLabels && (
                <text x={wx} y={wy + 16} textAnchor="middle" fontSize="9" fontWeight="600"
                  fill="#374151" stroke="white" strokeWidth="2" paintOrder="stroke" pointerEvents="none">
                  {wp.label.length > 8 ? wp.label.slice(0, 7) + '…' : wp.label}
                </text>
              )}
            </g>
          );
        })}

        {/* Assets — each rendered by a memoized AssetMarker so unrelated assets
              skip re-rendering during drags, highlights, and layer toggles.
              Viewport culling: skip assets outside the current viewBox (+100 px
              margin) so dense floors don't render off-screen SVG elements. */}
        {layers.assets && assets.filter((asset) => {
          if (dragging?.type === 'asset' && dragging.id === asset._id) return true;
          if (highlightedAssetId === asset._id) return true;
          if (selectedAssetsForConnection.includes(asset._id)) return true;
          const { x, y } = asset.location.coordinates;
          const M = 100;
          return x >= viewBox.x - M && x <= viewBox.x + viewBox.width + M &&
                 y >= viewBox.y - M && y <= viewBox.y + viewBox.height + M;
        }).map((asset) => (
          <AssetMarker
            key={asset._id}
            asset={asset}
            isDragging={dragging?.type === 'asset' && dragging.id === asset._id}
            isHighlighted={highlightedAssetId === asset._id}
            isSelectedForConnection={selectedAssetsForConnection.includes(asset._id)}
            isCrossFloor={crossFloorMap.has(asset._id)}
            showLabels={showLabels}
            editable={editable}
            onDragStart={startDraggingAsset}
            onClick={handleAssetClickInternal}
            onHover={showTooltip}
            onHoverEnd={hideTooltip}
          />
        ))}


      {deployMode && deployPosition && (
        <g pointerEvents="none">
          <circle
            cx={deployPosition.x}
            cy={deployPosition.y}
            r="24"
            fill="none"
            stroke="#f59e0b"
            strokeWidth="3"
            strokeDasharray="8 6"
          />
          <line
            x1={deployPosition.x - 18}
            y1={deployPosition.y}
            x2={deployPosition.x + 18}
            y2={deployPosition.y}
            stroke="#f59e0b"
            strokeWidth="2"
          />
          <line
            x1={deployPosition.x}
            y1={deployPosition.y - 18}
            x2={deployPosition.x}
            y2={deployPosition.y + 18}
            stroke="#f59e0b"
            strokeWidth="2"
          />
          <text
            x={deployPosition.x}
            y={deployPosition.y - 28}
            textAnchor="middle"
            fill="#f59e0b"
            fontSize="14px"
            fontWeight="bold"
          >
            Deploy point
          </text>
        </g>
      )}
      </svg>

      {/* Minimap */}
      {showMinimap && (
        <div className={styles.minimap}>
          <svg ref={minimapRef} viewBox="0 0 1000 800" className={styles.minimapSvg} onClick={handleMinimapClick} style={{ cursor: 'crosshair' }}>
            <rect width="1000" height="800" fill="#f3f4f6" />
            {workareas.map((wa) => (
              <rect
                key={wa._id}
                x={wa.coordinates?.x || 0}
                y={wa.coordinates?.y || 0}
                width={wa.dimensions?.width || 150}
                height={wa.dimensions?.height || 100}
                fill="#7c3aed"
                opacity="0.5"
              />
            ))}
            {assets.map((asset) => (
              <circle
                key={asset._id}
                cx={asset.location.coordinates.x}
                cy={asset.location.coordinates.y}
                r="3"
                fill={getAssetColor(asset)}
              />
            ))}
            <rect
              x={viewBox.x}
              y={viewBox.y}
              width={viewBox.width / zoom}
              height={viewBox.height / zoom}
              fill="none"
              stroke="#3b82f6"
              strokeWidth="3"
            />
          </svg>
        </div>
      )}

      {/* Tooltip */}
      <Tooltip x={tooltip.x} y={tooltip.y} visible={tooltip.visible}>
        {tooltip.content}
      </Tooltip>

      {/* Legend */}
      <div className={styles.legend}>
        <div className={styles.legendSection}>
          <div className={styles.legendTitle}>Assets</div>
          <div className={styles.legendItem}>
            <div className={styles.legendIcon} style={{ background: '#ddd6fe' }}></div>
            <span>Work Area</span>
          </div>
          <div className={styles.legendItem}>
            <div className={styles.legendIcon} style={{ background: '#10b981', borderRadius: '50%' }}></div>
            <span>Active</span>
          </div>
          <div className={styles.legendItem}>
            <div className={styles.legendIcon} style={{ background: '#f59e0b', borderRadius: '50%' }}></div>
            <span>Maintenance</span>
          </div>
          <div className={styles.legendItem}>
            <div className={styles.legendIcon} style={{ background: '#ef4444', borderRadius: '50%' }}></div>
            <span>Offline/Retired</span>
          </div>
          <div className={styles.legendItem}>
            <div className={styles.legendIcon} style={{ background: '#6b7280', borderRadius: '50%', border: '2px dashed #374151' }}></div>
            <span>Isolated</span>
          </div>
          <div className={styles.legendItem}>
            <div className={styles.legendIcon} style={{ background: '#9ca3af', borderRadius: '50%', opacity: 0.45 }}></div>
            <span>Decommissioned</span>
          </div>
          <div className={styles.legendItem}>
            <div className={styles.legendBadge} style={{ background: '#f59e0b' }}>!</div>
            <span>Win7 / EOL OS</span>
          </div>
          <div className={styles.legendItem}>
            <div className={styles.legendBadge} style={{ background: '#f97316', width: 10, height: 10 }}></div>
            <span>ITSM conflict</span>
          </div>
          <div className={styles.legendItem}>
            <div className={styles.legendBadge} style={{ background: '#06b6d4' }}>↕</div>
            <span>Cross-floor link</span>
          </div>
          {wallPorts.length > 0 && (
            <div className={styles.legendItem}>
              <div className={styles.legendIcon} style={{ background: '#f59e0b', borderRadius: 2 }}></div>
              <span>Wall port (patched)</span>
            </div>
          )}
        </div>

        {layers.connections && (
          <div className={styles.legendSection}>
            <div className={styles.legendTitle}>Connections</div>
            {Object.entries(ASSET_TYPE_MAP).length > 0 && [
              { color: '#3b82f6', label: 'Network/Ethernet' },
              { color: '#ef4444', label: 'Power' },
              { color: '#8b5cf6', label: 'Fiber' },
              { color: '#06b6d4', label: 'WiFi' },
              { color: '#6366f1', label: 'Bluetooth' },
              { color: '#f59e0b', label: 'USB' },
              { color: '#f97316', label: 'Dependency' },
              { color: '#9ca3af', label: 'Other' },
            ].map(({ color, label }) => (
              <div key={label} className={styles.legendItem}>
                <div className={styles.legendLine} style={{ background: color }}></div>
                <span>{label}</span>
              </div>
            ))}
          </div>
        )}

        {(backgroundImage || snapToGrid) && (
          <div className={styles.legendSection}>
            {backgroundImage && (
              <div className={styles.legendItem}>
                <span style={{ fontSize: '11px', color: '#6b7280' }}>BG: {Math.round(backgroundOpacity * 100)}%</span>
              </div>
            )}
            {snapToGrid && (
              <div className={styles.legendItem}>
                <span style={{ fontSize: '11px', color: '#6b7280' }}>🧲 {GRID_SIZE}px grid</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Instructions */}
      {editable && (
        <div className={styles.instructions}>
          <p>💡 Drag to move • Drag empty area to draw zone • Corner to resize • Shift+Drag to pan</p>
        </div>
      )}

      {/* Wall port popover */}
      {wallPortPopover && createPortal(
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 199 }} onClick={() => setWallPortPopover(null)} />
          <div
            className={styles.popover}
            style={{ position: 'fixed', left: wallPortPopover.screenX + 8, top: wallPortPopover.screenY - 8, zIndex: 200 }}
          >
            <div className={styles.popoverHeader}>
              <span>🔌 {wallPortPopover.port.label}</span>
              <button className={styles.popoverClose} onClick={() => setWallPortPopover(null)}>✕</button>
            </div>
            <div className={styles.popoverMeta}>
              {wallPortPopover.port.patch_panel_name && (
                <div className={styles.popoverMetaRow}>
                  <span className={styles.popoverMetaLabel}>Panel</span>
                  <span className={styles.popoverMetaValue}>{wallPortPopover.port.patch_panel_name}</span>
                </div>
              )}
              {wallPortPopover.port.patch_port != null && (
                <div className={styles.popoverMetaRow}>
                  <span className={styles.popoverMetaLabel}>Port #</span>
                  <span className={`${styles.popoverMetaValue} ${styles.popoverMetaMono}`}>{wallPortPopover.port.patch_port}</span>
                </div>
              )}
              {wallPortPopover.port.room_name && (
                <div className={styles.popoverMetaRow}>
                  <span className={styles.popoverMetaLabel}>Room</span>
                  <span className={styles.popoverMetaValue}>{wallPortPopover.port.room_name}{wallPortPopover.port.room_type ? ` (${wallPortPopover.port.room_type.toUpperCase()})` : ''}</span>
                </div>
              )}
              {wallPortPopover.port.rack_name && (
                <div className={styles.popoverMetaRow}>
                  <span className={styles.popoverMetaLabel}>Rack</span>
                  <span className={styles.popoverMetaValue}>{wallPortPopover.port.rack_name}</span>
                </div>
              )}
              {wallPortPopover.port.switch_port && (
                <div className={styles.popoverMetaRow}>
                  <span className={styles.popoverMetaLabel}>Switch port</span>
                  <span className={`${styles.popoverMetaValue} ${styles.popoverMetaMono}`}>{wallPortPopover.port.switch_port}</span>
                </div>
              )}
              {!wallPortPopover.port.patch_panel_id && (
                <div className={styles.popoverMetaRow}>
                  <span className={styles.popoverMetaValue} style={{ color: '#9ca3af', fontStyle: 'italic' }}>Not patched</span>
                </div>
              )}
            </div>
          </div>
        </>,
        document.body
      )}

      {/* Connection delete popover */}
      {connPopover && createPortal(
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 199 }} onClick={() => setConnPopover(null)} />
          <div
            className={styles.popover}
            style={{ position: 'fixed', left: connPopover.screenX + 8, top: connPopover.screenY - 8, zIndex: 200 }}
          >
            <div className={styles.popoverHeader}>
              <span>🔗 {connPopover.label}</span>
              <button className={styles.popoverClose} onClick={() => setConnPopover(null)}>✕</button>
            </div>
            <button
              className={styles.popoverAction}
              style={{ color: '#ef4444' }}
              onClick={() => {
                onConnectionDelete?.(connPopover.assetId, connPopover.connectedAssetId);
                setConnPopover(null);
              }}
            >
              🗑️ Remove Connection
            </button>
          </div>
        </>,
        document.body
      )}

      {/* Quick-action popover */}
      {popover && createPortal(
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 199 }}
            onClick={() => setPopover(null)}
          />
          <div
            className={styles.popover}
            style={{ position: 'fixed', left: popover.screenX + 8, top: popover.screenY - 8, zIndex: 200 }}
          >
            <div className={styles.popoverHeader}>
              <span>{getAssetIcon(popover.asset.basic_info.type)} {popover.asset.basic_info.display_name}</span>
              <button className={styles.popoverClose} onClick={() => setPopover(null)}>✕</button>
            </div>
            {/* Inline metadata */}
            <div className={styles.popoverMeta}>
              <div className={styles.popoverMetaRow}>
                <span className={styles.popoverMetaLabel}>Status</span>
                <span className={styles.popoverMetaValue}>
                  {popover.asset.basic_info.status === 'active' ? '🟢'
                    : popover.asset.basic_info.status === 'maintenance' ? '🟡'
                    : popover.asset.basic_info.status === 'inactive' ? '⚫' : '🔴'}{' '}
                  {popover.asset.basic_info.status}
                </span>
              </div>
              {popover.asset.network?.ip_address && (
                <div className={styles.popoverMetaRow}>
                  <span className={styles.popoverMetaLabel}>IP</span>
                  <span className={`${styles.popoverMetaValue} ${styles.popoverMetaMono}`}>{popover.asset.network.ip_address}</span>
                </div>
              )}
              {popover.asset.assigned_person?.full_name && (
                <div className={styles.popoverMetaRow}>
                  <span className={styles.popoverMetaLabel}>Person</span>
                  <span className={styles.popoverMetaValue}>{popover.asset.assigned_person.full_name}</span>
                </div>
              )}
              {popover.asset.maintenance?.next_date && (
                <div className={styles.popoverMetaRow}>
                  <span className={styles.popoverMetaLabel}>Next maint.</span>
                  <span className={`${styles.popoverMetaValue} ${
                    new Date(popover.asset.maintenance.next_date).getTime() < Date.now()
                      ? styles.popoverMetaOverdue
                      : new Date(popover.asset.maintenance.next_date).getTime() - Date.now() < 30 * 86400000
                        ? styles.popoverMetaUpcoming
                        : ''
                  }`}>
                    {new Date(popover.asset.maintenance.next_date).toLocaleDateString()}
                  </span>
                </div>
              )}
              {(popover.asset.connections?.length ?? 0) > 0 && (
                <div className={styles.popoverMetaRow}>
                  <span className={styles.popoverMetaLabel}>Connections</span>
                  <span className={styles.popoverMetaValue}>{popover.asset.connections!.length}</span>
                </div>
              )}
              {crossFloorMap.has(popover.asset._id) && (
                <div className={styles.popoverCrossFloor}>
                  <div className={styles.popoverDivider}>Cross-floor connections</div>
                  {crossFloorMap.get(popover.asset._id)!.map((cf, i) => (
                    <div key={i} className={styles.popoverMetaRow}>
                      <span className={styles.popoverMetaLabel} style={{ color: '#06b6d4' }}>↕ {cf.connectionType}</span>
                      <span className={styles.popoverMetaValue}>
                        {cf.connectedAsset ? (
                          onNavigateToAsset ? (
                            <button
                              style={{ background: 'none', border: 'none', color: '#06b6d4', cursor: 'pointer', padding: 0, fontSize: 'inherit', textDecoration: 'underline' }}
                              onClick={() => { onNavigateToAsset(cf.connectedAssetId, cf.connectedAsset!.hierarchy.floor_id ?? ''); setPopover(null); }}
                            >
                              {cf.connectedAsset.basic_info.display_name}
                            </button>
                          ) : cf.connectedAsset.basic_info.display_name
                        ) : (
                          <span style={{ color: 'var(--color-text-secondary)', fontStyle: 'italic' }}>another floor</span>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {onAssetTrace && (
              <button className={styles.popoverAction} onClick={() => { onAssetTrace(popover.asset); setPopover(null); }}>
                🔗 Trace Network
              </button>
            )}
            <button className={styles.popoverAction} onClick={() => { onAssetClick?.(popover.asset); setPopover(null); }}>
              🔍 View Details
            </button>
            <button className={styles.popoverAction} onClick={() => { onAssetEdit?.(popover.asset); setPopover(null); }}>
              ✏️ Edit
            </button>
            <button className={styles.popoverAction} onClick={() => { onAssetClone?.(popover.asset); setPopover(null); }}>
              📋 Clone
            </button>
            <div className={styles.popoverDivider}>Change Status</div>
            {(['active', 'maintenance', 'inactive', 'retired'] as const).map(s => (
              <button
                key={s}
                className={`${styles.popoverAction} ${popover.asset.basic_info.status === s ? styles.popoverActionActive : ''}`}
                onClick={() => { onAssetStatusChange?.(popover.asset._id, s); setPopover(null); }}
              >
                {s === 'active' ? '🟢' : s === 'maintenance' ? '🟡' : s === 'inactive' ? '⚫' : '🔴'} {s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>
        </>,
        document.body
      )}
      {/* Unplaced Assets Tray */}
      {unplacedAssets.length > 0 && !unplacedTrayOpen && (
        <button
          className={styles.unplacedToggle}
          onClick={() => setUnplacedTrayOpen(true)}
          title="Show unplaced assets"
        >
          📦 {unplacedAssets.length} unplaced
        </button>
      )}
      {unplacedAssets.length > 0 && unplacedTrayOpen && (
        <div className={styles.unplacedTray}>
          <div className={styles.unplacedTrayHeader}>
            📦 Unplaced ({unplacedAssets.length})
            <button className={styles.popoverClose} onClick={() => setUnplacedTrayOpen(false)}>✕</button>
          </div>
          <div className={styles.unplacedTrayList}>
            {unplacedAssets.map(asset => {
              const isPlacing = placingAsset?._id === asset._id;
              return (
                <button
                  key={asset._id}
                  className={`${styles.unplacedItem} ${isPlacing ? styles.unplacedItemPlacing : ''}`}
                  onClick={() => setPlacingAsset(isPlacing ? null : asset)}
                  title={isPlacing ? 'Click on the map to place this asset (Esc to cancel)' : 'Click to select for placement'}
                >
                  <span className={styles.unplacedItemIcon}>{getAssetIcon(asset.basic_info.type)}</span>
                  <span className={styles.unplacedItemInfo}>
                    <span className={styles.unplacedItemName}>
                      {asset.basic_info.display_name.length > 20
                        ? asset.basic_info.display_name.slice(0, 18) + '…'
                        : asset.basic_info.display_name}
                    </span>
                    {asset.custom_fields?.object_id && (
                      <span className={styles.unplacedItemId}>{asset.custom_fields.object_id}</span>
                    )}
                  </span>
                  {isPlacing && <span className={styles.unplacedItemPlacingBadge}>📍</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Placing mode banner */}
      {placingAsset && (
        <div className={styles.placingBanner}>
          📍 Click map to place: <strong>{placingAsset.basic_info.display_name}</strong>
          <button className={styles.placingBannerCancel} onClick={() => setPlacingAsset(null)}>Cancel (Esc)</button>
        </div>
      )}
    </div>

      <ConfirmDialog
        isOpen={pendingDeleteWorkareaId !== null}
        onClose={() => setPendingDeleteWorkareaId(null)}
        onConfirm={confirmWorkareaDelete}
        title="Delete Work Area"
        message="Are you sure you want to delete this work area? This action cannot be undone."
        confirmText="Delete"
        variant="danger"
      />
    </>
  );
};

export default FloorMap;