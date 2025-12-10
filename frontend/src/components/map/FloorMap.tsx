import React, { useState, useRef, useCallback } from 'react';
import { WorkArea } from '../../services/workarea.service';
import { Asset } from '../../services/asset.service';
import Tooltip from '../common/Tooltip';
import styles from '../../styles/components/FloorMap.module.css';

interface FloorMapProps {
  workareas: WorkArea[];
  assets: Asset[];
  onWorkareaClick?: (workarea: WorkArea) => void;
  onAssetClick?: (asset: Asset) => void;
  onWorkareaMove?: (workareaId: string, x: number, y: number) => void;
  onWorkareaResize?: (workareaId: string, width: number, height: number) => void;
  onAssetMove?: (assetId: string, x: number, y: number) => void;
  editable?: boolean;
  backgroundImage?: string;
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
  editable = false,
  backgroundImage,
}) => {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  const [dragging, setDragging] = useState<{
    type: 'workarea' | 'asset' | 'resize' | 'pan';
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
  const [showGrid, setShowGrid] = useState(true);
  const [showMinimap, setShowMinimap] = useState(true);

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

  // Snap to grid helper
  const snapToGridHelper = (value: number): number => {
    if (!snapToGrid) return value;
    return Math.round(value / GRID_SIZE) * GRID_SIZE;
  };

  // Handle mouse move for dragging
  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
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
    setDragging(null);
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

  // Print
  const handlePrint = () => {
    window.print();
  };

  // Tooltip handlers
  const showTooltip = (e: React.MouseEvent, content: React.ReactNode) => {
    if (editable || dragging) return;

    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }

    hoverTimeoutRef.current = setTimeout(() => {
      setTooltip({
        visible: true,
        x: e.clientX,
        y: e.clientY,
        content,
      });
    }, 500);
  };

  const hideTooltip = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
    }
    setTooltip({ visible: false, x: 0, y: 0, content: null });
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
  const startDraggingAsset = (asset: Asset, e: React.MouseEvent) => {
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
  };

  // Handle workarea click
  const handleWorkareaClickInternal = (workarea: WorkArea) => {
    if (editable) return;
    hideTooltip();
    onWorkareaClick?.(workarea);
  };

  // Handle asset click
  const handleAssetClickInternal = (asset: Asset) => {
    if (editable) return;
    hideTooltip();
    onAssetClick?.(asset);
  };

  // Get assets in workarea
  const getAssetsInWorkarea = (workarea: WorkArea): Asset[] => {
    const waX = workarea.coordinates?.x || 0;
    const waY = workarea.coordinates?.y || 0;
    const waWidth = workarea.dimensions?.width || 150;
    const waHeight = workarea.dimensions?.height || 100;

    return assets.filter((asset) => {
      const x = asset.location.coordinates.x;
      const y = asset.location.coordinates.y;
      return x >= waX && x <= waX + waWidth && y >= waY && y <= waY + waHeight;
    });
  };

  return (
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
          onClick={() => setShowGrid(!showGrid)}
          className={`${styles.controlButton} ${showGrid ? styles.active : ''}`}
          title="Toggle Grid"
        >
          #️⃣
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
          </>
        )}
        <button onClick={handleExportImage} className={styles.controlButton} title="Export as PNG">
          💾
        </button>
        <button onClick={handlePrint} className={styles.controlButton} title="Print">
          🖨️
        </button>
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
        {backgroundImage && (
          <image
            href={backgroundImage}
            x="0"
            y="0"
            width="1000"
            height="800"
            opacity={backgroundOpacity}
            preserveAspectRatio="xMidYMid slice"
            pointerEvents="none"
          />
        )}

{/* Background Image/SVG */}
        {backgroundImage && (
          <image
            href={backgroundImage}
            x="0"
            y="0"
            width="1000"
            height="800"
            opacity={backgroundOpacity}
            preserveAspectRatio="xMidYMid slice"
            pointerEvents="none"
          />
        )}

        {/* Grid Background - ALWAYS render if showGrid is true */}
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
        {showGrid && (
          <rect 
            width="1000" 
            height="800" 
            fill="url(#grid)" 
            opacity={backgroundImage ? "0.6" : "0.3"}
            pointerEvents="none"
          />
        )}

        {/* Work Areas */}
        {workareas.map((workarea) => {
          const x = workarea.coordinates?.x || 100;
          const y = workarea.coordinates?.y || 100;
          const width = workarea.dimensions?.width || 150;
          const height = workarea.dimensions?.height || 100;
          const isDragging = dragging?.type === 'workarea' && dragging.id === workarea._id;
          const isResizing = dragging?.type === 'resize' && dragging.id === workarea._id;
          const assetsInArea = getAssetsInWorkarea(workarea);

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
                      {workarea.metadata?.capacity && (
                        <p><span className={styles.label}>Capacity:</span> {workarea.metadata.capacity} people</p>
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

              <text
                x={x + width / 2}
                y={y + height / 2 - 5}
                textAnchor="middle"
                className={styles.workareaLabel}
                pointerEvents="none"
                style={{ fontWeight: 'bold', fontSize: '14px' }}
              >
                {workarea.name}
              </text>

              {workarea.type && (
                <text
                  x={x + width / 2}
                  y={y + height / 2 + 15}
                  textAnchor="middle"
                  className={styles.workareaType}
                  pointerEvents="none"
                  style={{ fontSize: '12px' }}
                >
                  {workarea.type}
                </text>
              )}

              {assetsInArea.length > 0 && (
                <g>
                  <circle
                    cx={x + width - 15}
                    cy={y + 15}
                    r="12"
                    fill="#7c3aed"
                    stroke="#fff"
                    strokeWidth="2"
                  />
                  <text
                    x={x + width - 15}
                    y={y + 20}
                    textAnchor="middle"
                    fill="#fff"
                    fontSize="11"
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
            </g>
          );
        })}

        {/* Assets */}
        {assets.map((asset) => {
          const x = asset.location.coordinates.x;
          const y = asset.location.coordinates.y;
          const isDragging = dragging?.type === 'asset' && dragging.id === asset._id;

          return (
            <g key={asset._id}>
              <circle
                cx={x}
                cy={y}
                r="15"
                fill={asset.itsm.is_managed ? '#10b981' : '#6b7280'}
                stroke="#fff"
                strokeWidth="3"
                className={`${styles.asset} ${isDragging ? styles.dragging : ''}`}
                onMouseDown={(e) => startDraggingAsset(asset, e)}
                onClick={() => handleAssetClickInternal(asset)}
                onMouseEnter={(e) =>
                  showTooltip(
                    e as any,
                    <div>
                      <h4>💻 {asset.basic_info.display_name}</h4>
                      {asset.basic_info.manufacturer && asset.basic_info.model && (
                        <p>
                          <span className={styles.label}>Model:</span>{' '}
                          {asset.basic_info.manufacturer} {asset.basic_info.model}
                        </p>
                      )}
                      {asset.basic_info.serial_number && (
                        <p><span className={styles.label}>S/N:</span> {asset.basic_info.serial_number}</p>
                      )}
                      {asset.assigned_person && (
                        <p><span className={styles.label}>Assigned:</span> {asset.assigned_person.full_name}</p>
                      )}
                      <p>
                        <span className={styles.label}>Status:</span>{' '}
                        {asset.itsm.is_managed ? '✅ ITSM Managed' : '📝 Manual'}
                      </p>
                      <p style={{ fontSize: '10px', marginTop: '4px', fontStyle: 'italic' }}>
                        Click for full details
                      </p>
                    </div>
                  )
                }
                onMouseLeave={hideTooltip}
                style={{ cursor: editable ? 'move' : 'pointer' }}
              />

              <text
                x={x}
                y={y + 5}
                textAnchor="middle"
                className={styles.assetIcon}
                pointerEvents="none"
                style={{ fontSize: '14px' }}
              >
                💻
              </text>

              <text
                x={x}
                y={y + 35}
                textAnchor="middle"
                className={styles.assetLabel}
                pointerEvents="none"
                style={{
                  fontSize: '12px',
                  fontWeight: 'bold',
                  fill: '#1f2937',
                  textShadow: '0 0 3px white',
                }}
              >
                {asset.basic_info.display_name}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Minimap */}
      {showMinimap && (
        <div className={styles.minimap}>
          <svg viewBox="0 0 1000 800" className={styles.minimapSvg}>
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
                r="5"
                fill={asset.itsm.is_managed ? '#10b981' : '#6b7280'}
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
        <div className={styles.legendItem}>
          <div className={styles.legendIcon} style={{ background: '#ddd6fe' }}></div>
          <span>Work Area</span>
        </div>
        <div className={styles.legendItem}>
          <div
            className={styles.legendIcon}
            style={{ background: '#10b981', borderRadius: '50%' }}
          ></div>
          <span>ITSM Asset</span>
        </div>
        <div className={styles.legendItem}>
          <div
            className={styles.legendIcon}
            style={{ background: '#6b7280', borderRadius: '50%' }}
          ></div>
          <span>Manual Asset</span>
        </div>
        {backgroundImage && (
          <div className={styles.legendItem}>
            <span style={{ fontSize: '12px', color: '#6b7280' }}>
              BG: {Math.round(backgroundOpacity * 100)}%
            </span>
          </div>
        )}
        {snapToGrid && (
          <div className={styles.legendItem}>
            <span style={{ fontSize: '12px', color: '#6b7280' }}>
              🧲 Grid: {GRID_SIZE}px
            </span>
          </div>
        )}
      </div>

      {/* Instructions */}
      {editable && (
        <div className={styles.instructions}>
          <p>💡 Drag items • Resize corners • Shift+Drag to pan</p>
        </div>
      )}
    </div>
  );
};

export default FloorMap;