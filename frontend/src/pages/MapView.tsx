/**
 * MapView.tsx — Cross-building floor map browser ("/map").
 *
 * Provides a single page to browse any floor's map without navigating through
 * the Buildings > BuildingDetails > FloorDetails hierarchy. Useful for
 * operators who primarily work from the map.
 *
 * UI:
 *   Building + Floor selectors — cascade dropdowns; selecting a building
 *     populates the floor dropdown, then loads the selected floor's work areas
 *     and assets into FloorMap.
 *   Search / highlight — the search input highlights a matching asset on the
 *     map (via `highlightedAssetId` prop) and scrolls it into view.
 *   Deploy mode        — toggled from the toolbar; clicking the canvas opens
 *     AssetFormModal with the clicked coordinates.
 *   Floor plan upload  — FloorPlanUploadModal for updating the background image.
 *
 * Memoised floor/building lookup maps prevent unnecessary recalculations when
 * only the selection changes.
 */
import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Card from '../components/common/Card';
import Button from '../components/common/Button';
import Select from '../components/common/Select';
import Input from '../components/common/Input';
import FloorMap from '../components/map/FloorMap';
import FloorPlanUploadModal from '../components/floor/FloorPlanUploadModal';
import AssetFormModal from '../components/asset/AssetFormModal';
import { hierarchyService, Building } from '../services/hierarchy.service';
import { floorService, Floor } from '../services/floor.service';
import { workareaService, WorkArea } from '../services/workarea.service';
import { assetService, Asset } from '../services/asset.service';
import { networkService, WallPort } from '../services/network.service';
import { getAssetIcon } from '../utils/assetTypes';
import styles from '../styles/pages/MapView.module.css';

const MapView: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [floors, setFloors] = useState<Floor[]>([]);
  const [selectedBuildingId, setSelectedBuildingId] = useState<string>('');
  const [selectedFloorId, setSelectedFloorId] = useState<string>('');
  const [selectedFloor, setSelectedFloor] = useState<Floor | null>(null);
  const [workareas, setWorkareas] = useState<WorkArea[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [allAssets, setAllAssets] = useState<Asset[]>([]);
  const [wallPorts, setWallPorts] = useState<WallPort[]>([]);
  const [loading, setLoading] = useState(true);
  const [metaLoading, setMetaLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [fullScreen, setFullScreen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [workareaFilter, setWorkareaFilter] = useState<string>('all');
  const [deployMode, setDeployMode] = useState(false);
  const [deployPosition, setDeployPosition] = useState<{ x: number; y: number } | null>(null);
  const [createAssetModalOpen, setCreateAssetModalOpen] = useState(false);
  const [connectionMode, setConnectionMode] = useState(false);
  const [selectedAssetsForConnection, setSelectedAssetsForConnection] = useState<string[]>([]);
  const [newConnectionType, setNewConnectionType] = useState('network');
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [occupancyWarning, setOccupancyWarning] = useState<string | null>(null);
  const [sidePanelOpen, setSidePanelOpen] = useState(true);
  const [highlightedAssetId, setHighlightedAssetId] = useState<string | null>(null);
  const [focusAsset, setFocusAsset] = useState<{ id: string; tick: number } | null>(null);
  const [editAsset, setEditAsset] = useState<Asset | null>(null);
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [activeConnectionTypes, setActiveConnectionTypes] = useState<Set<string>>(new Set());
  const [pendingZone, setPendingZone] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [zoneName, setZoneName] = useState('');
  const [zoneType, setZoneType] = useState('');
  const [layers, setLayers] = useState({
    workareas: true,
    assets: true,
    connections: true,
    grid: true,
    wallports: false,
  });
  const [tracingAsset, setTracingAsset] = useState<Asset | null>(null);
  const assetUpdateTimer = useRef<NodeJS.Timeout | null>(null);
  const workareaUpdateTimer = useRef<NodeJS.Timeout | null>(null);
  const workareaResizeTimer = useRef<NodeJS.Timeout | null>(null);
  const wallPortUpdateTimer = useRef<NodeJS.Timeout | null>(null);

  const buildingOptions = useMemo(
    () => buildings.map((building) => ({ value: building._id, label: building.name })),
    [buildings]
  );

  const floorOptions = useMemo(
    () => floors
      .filter((floor) => floor.building_id === selectedBuildingId)
      .map((floor) => {
        const count = assets.filter(a => a.hierarchy.floor_id === floor._id).length;
        return {
          value: floor._id,
          label: `Floor ${floor.floor_number} — ${floor.name}${count > 0 ? ` (${count})` : ''}`,
        };
      }),
    [floors, selectedBuildingId, assets]
  );

  const selectedBuilding = useMemo(
    () => buildings.find((building) => building._id === selectedBuildingId) || null,
    [buildings, selectedBuildingId]
  );

  const filteredAssets = useMemo(() => {
    return assets.filter((asset) => {
      // Rack-mounted assets live in a rack, not on the floor map
      if (asset.hierarchy?.rack_id) return false;

      // Search filter
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesSearch =
          asset.basic_info?.display_name?.toLowerCase().includes(query) ||
          asset.basic_info?.manufacturer?.toLowerCase().includes(query) ||
          asset.basic_info?.model?.toLowerCase().includes(query) ||
          asset.basic_info?.serial_number?.toLowerCase().includes(query) ||
          asset.assigned_person?.full_name?.toLowerCase().includes(query);
        if (!matchesSearch) return false;
      }

      // Status filter
      if (statusFilter !== 'all' && asset.basic_info?.status !== statusFilter) {
        return false;
      }

      // Type filter
      if (typeFilter !== 'all' && asset.basic_info?.type !== typeFilter) {
        return false;
      }

      // Work area filter
      if (workareaFilter !== 'all') {
        const assetX = asset.location.coordinates.x;
        const assetY = asset.location.coordinates.y;
        const inWorkarea = workareas.some((wa) => {
          const waX = wa.coordinates?.x || 0;
          const waY = wa.coordinates?.y || 0;
          const waWidth = wa.dimensions?.width || 150;
          const waHeight = wa.dimensions?.height || 100;
          return assetX >= waX && assetX <= waX + waWidth && assetY >= waY && assetY <= waY + waHeight;
        });
        if (workareaFilter === 'none' && inWorkarea) return false;
        if (workareaFilter !== 'none' && !inWorkarea) return false;
      }

      return true;
    });
  }, [assets, searchQuery, statusFilter, typeFilter, workareaFilter, workareas]);

  const statusOptions = useMemo(() => [
    { value: 'all', label: 'All Statuses' },
    { value: 'active', label: 'Active' },
    { value: 'maintenance', label: 'Maintenance' },
    { value: 'offline', label: 'Offline' },
    { value: 'retired', label: 'Retired' },
  ], []);

  const typeOptions = useMemo(() => {
    const types = new Set(
      assets
        .map(asset => asset.basic_info?.type)
        .filter((type): type is string => Boolean(type))
    );
    return [
      { value: 'all', label: 'All Types' },
      ...Array.from(types).map((type) => ({ value: type, label: type })),
    ];
  }, [assets]);

  const workareaOptions = useMemo(() => [
    { value: 'all', label: 'All Areas' },
    { value: 'none', label: 'No Work Area' },
    ...workareas.map(wa => ({ value: wa._id, label: wa.name })),
  ], [workareas]);

  const loadMetadata = useCallback(async () => {
    try {
      setMetaLoading(true);
      setError(null);
      const [buildingsData, floorsData, allAssetsData] = await Promise.all([
        hierarchyService.getBuildings(),
        floorService.getFloors(),
        assetService.getAssetsWithConnections(),
      ]);
      setBuildings(buildingsData);
      setFloors(floorsData);
      setAllAssets(allAssetsData);

      // Honour ?building=<id>&floor=<id> deep-link params (e.g. from Dashboard "Show on map")
      const paramBuilding = searchParams.get('building');
      const paramFloor    = searchParams.get('floor');
      const targetBuilding = buildingsData.find(b => b._id === paramBuilding) ?? buildingsData[0];
      const targetFloor    = paramFloor
        ? floorsData.find(f => f._id === paramFloor)
        : floorsData.find(f => f.building_id === targetBuilding?._id);
      if (targetBuilding) setSelectedBuildingId(targetBuilding._id);
      if (targetFloor)    setSelectedFloorId(targetFloor._id);
    } catch (error) {
      console.error('Error loading map metadata:', error);
      setError('Failed to load map data. Please check your connection and try again.');
    } finally {
      setMetaLoading(false);
    }
  }, [setMetaLoading, setError, setBuildings, setFloors, setSelectedBuildingId, setSelectedFloorId]);

  useEffect(() => {
    if (selectedBuildingId) {
      return;
    }
    loadMetadata();
  }, [selectedBuildingId, loadMetadata]);

  useEffect(() => {
    if (!selectedBuildingId && buildings.length > 0) {
      setSelectedBuildingId(buildings[0]._id);
    }
  }, [buildings, selectedBuildingId]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && fullScreen) {
        setFullScreen(false);
      }
    };

    if (fullScreen) {
      document.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [fullScreen]);

  useEffect(() => {
    if (!successMessage) return;
    const timer = setTimeout(() => setSuccessMessage(null), 4000);
    return () => clearTimeout(timer);
  }, [successMessage]);

  const loadMapData = useCallback(async (floorId: string) => {
    if (!floorId) {
      setSelectedFloor(null);
      setWorkareas([]);
      setAssets([]);
      return;
    }

    try {
      setLoading(true);
      setError(null);
      const [floorData, workareasData, floorAssets, floorWallPorts] = await Promise.all([
        floorService.getFloor(floorId),
        workareaService.getWorkAreas(floorId),
        assetService.getAssetsByFloor(floorId),
        networkService.getWallPorts({ floor_id: floorId }),
      ]);

      setSelectedFloor(floorData);
      setWorkareas(workareasData);
      setAssets(floorAssets);
      setWallPorts(floorWallPorts);
    } catch (error) {
      console.error('Error loading map data:', error);
      setError('Failed to load floor data. Please try selecting a different floor.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMapData(selectedFloorId);
    setTracingAsset(null);
  }, [selectedFloorId, loadMapData]);

  const handleBuildingChange = (value: string) => {
    setSelectedBuildingId(value);
    const floorInBuilding = floors.find((floor) => floor.building_id === value);
    setSelectedFloorId(floorInBuilding?._id || '');
  };

  const handleFloorChange = (value: string) => {
    setSelectedFloorId(value);
  };

  const handleDeployToggle = () => {
    setDeployMode((prev) => {
      if (prev) {
        setDeployPosition(null);
      }
      return !prev;
    });
  };

  const handleCancelDeploy = () => {
    setDeployMode(false);
    setDeployPosition(null);
  };

  const handleMapClick = (x: number, y: number, occupancy?: { occupied: boolean; reason?: string }) => {
    if (!deployMode) return;

    if (occupancy?.occupied) {
      setOccupancyWarning(occupancy.reason || 'Space is occupied');
      setTimeout(() => setOccupancyWarning(null), 4000);
      return;
    }

    setOccupancyWarning(null);
    setDeployPosition({ x, y });
    setCreateAssetModalOpen(true);
  };

  const handleDeploySuccess = () => {
    if (selectedFloorId) {
      loadMapData(selectedFloorId);
    }
    setSuccessMessage('Asset deployed successfully.');
    setCreateAssetModalOpen(false);
    setDeployMode(false);
    setDeployPosition(null);
  };

  const handleLayerToggle = useCallback((layer: keyof typeof layers) => {
    setLayers(prev => ({ ...prev, [layer]: !prev[layer] }));
  }, []);

  const handleNavigateToAsset = useCallback((assetId: string, floorId: string) => {
    const targetFloor = floors.find(f => f._id === floorId);
    if (targetFloor) {
      setSelectedBuildingId(targetFloor.building_id);
      setSelectedFloorId(floorId);
      setTimeout(() => setFocusAsset({ id: assetId, tick: Date.now() }), 300);
    }
  }, [floors]);

  const handleAssetSelectForConnection = useCallback((assetId: string) => {
    setSelectedAssetsForConnection(prev => {
      if (prev.includes(assetId)) {
        return prev.filter(id => id !== assetId);
      } else if (prev.length < 2) {
        return [...prev, assetId];
      } else {
        return [prev[1], assetId]; // Keep last one and add new
      }
    });
  }, []);

  const handleCreateConnection = useCallback(async () => {
    if (selectedAssetsForConnection.length !== 2) return;

    const [asset1Id, asset2Id] = selectedAssetsForConnection;
    try {
      await assetService.addConnection(asset1Id, {
        connected_asset_id: asset2Id,
        connection_type: newConnectionType,
        bidirectional: true,
        strength: 'normal',
      });
      await assetService.addConnection(asset2Id, {
        connected_asset_id: asset1Id,
        connection_type: newConnectionType,
        bidirectional: true,
        strength: 'normal',
      });

      if (selectedFloorId) {
        loadMapData(selectedFloorId);
      }
      setSuccessMessage('Connection created successfully.');
      setSelectedAssetsForConnection([]);
      setConnectionMode(false);
    } catch (error) {
      console.error('Error creating connection:', error);
      setError('Failed to create connection.');
    }
  }, [selectedAssetsForConnection, selectedFloorId, loadMapData, newConnectionType]);

  const handleWorkareaMove = useCallback((workareaId: string, x: number, y: number) => {
    setWorkareas((prev) =>
      prev.map((wa) =>
        wa._id === workareaId ? { ...wa, coordinates: { x, y } } : wa
      )
    );

    if (workareaUpdateTimer.current) {
      clearTimeout(workareaUpdateTimer.current);
    }

    workareaUpdateTimer.current = setTimeout(async () => {
      try {
        await workareaService.updateWorkArea(workareaId, { coordinates: { x, y } });
      } catch (error) {
        console.error('Error updating work area position:', error);
      }
    }, 500);
  }, []);

  const handleWorkareaResize = useCallback((workareaId: string, width: number, height: number) => {
    setWorkareas((prev) =>
      prev.map((wa) =>
        wa._id === workareaId ? { ...wa, dimensions: { width, height } } : wa
      )
    );

    if (workareaResizeTimer.current) {
      clearTimeout(workareaResizeTimer.current);
    }

    workareaResizeTimer.current = setTimeout(async () => {
      try {
        await workareaService.updateWorkArea(workareaId, { dimensions: { width, height } });
      } catch (error) {
        console.error('Error updating work area dimensions:', error);
      }
    }, 500);
  }, []);

  const handleAssetMove = useCallback((assetId: string, x: number, y: number) => {
    const asset = assets.find((a) => a._id === assetId);
    if (!asset) return;

    setAssets((prev) =>
      prev.map((a) =>
        a._id === assetId
          ? {
              ...a,
              location: {
                ...a.location,
                coordinates: { x, y },
              },
            }
          : a
      )
    );

    if (assetUpdateTimer.current) {
      clearTimeout(assetUpdateTimer.current);
    }

    assetUpdateTimer.current = setTimeout(async () => {
      try {
        await assetService.updateAsset(assetId, {
          location: {
            ...asset.location,
            coordinates: { x, y },
            icon_type: asset.location.icon_type || 'computer',
          },
        });
      } catch (error) {
        console.error('Error updating asset position:', error);
      }
    }, 500);
  }, [assets]);

  const handleUploadSuccess = () => {
    if (selectedFloorId) {
      loadMapData(selectedFloorId);
    }
  };

  const handleWorkareaCreate = useCallback((x: number, y: number, width: number, height: number) => {
    setZoneName('');
    setZoneType('');
    setPendingZone({ x, y, w: width, h: height });
  }, []);

  const handleZoneFormSubmit = useCallback(async () => {
    if (!pendingZone || !selectedFloorId) return;
    try {
      const created = await workareaService.createWorkArea({
        floor_id: selectedFloorId,
        name: zoneName.trim() || 'New Zone',
        type: zoneType.trim() || undefined,
        coordinates: { x: pendingZone.x, y: pendingZone.y },
        dimensions: { width: pendingZone.w, height: pendingZone.h },
      });
      setWorkareas(prev => [...prev, created]);
    } catch (error) {
      console.error('Error creating work area:', error);
    }
    setPendingZone(null);
  }, [pendingZone, selectedFloorId, zoneName, zoneType]);

  const handleWorkareaDelete = useCallback(async (workareaId: string) => {
    try {
      await workareaService.deleteWorkArea(workareaId);
      setWorkareas(prev => prev.filter(w => w._id !== workareaId));
    } catch (error) {
      console.error('Error deleting work area:', error);
    }
  }, []);

  const handleWorkareaRename = useCallback(async (workareaId: string, name: string) => {
    setWorkareas(prev => prev.map(w => w._id === workareaId ? { ...w, name } : w));
    try {
      await workareaService.updateWorkArea(workareaId, { name });
    } catch (error) {
      console.error('Error renaming work area:', error);
    }
  }, []);

  const handleAssetStatusChange = useCallback(async (assetId: string, status: string) => {
    try {
      await assetService.updateAsset(assetId, { 'basic_info.status': status } as any);
      setAssets(prev => prev.map(a =>
        a._id === assetId ? { ...a, basic_info: { ...a.basic_info, status: status as any } } : a
      ));
    } catch (error) {
      console.error('Error updating asset status:', error);
    }
  }, []);

  const handleWorkareaClick = useCallback((workarea: WorkArea) => {
    setSelectedZoneId(prev => prev === workarea._id ? null : workarea._id);
  }, []);

  const handleConnectionDelete = useCallback(async (assetId: string, connectedAssetId: string) => {
    try {
      await assetService.removeConnection(assetId, connectedAssetId);
      // Best-effort removal of reverse direction
      try { await assetService.removeConnection(connectedAssetId, assetId); } catch {}
      setAssets(prev => prev.map(a => {
        if (a._id === assetId)
          return { ...a, connections: (a.connections || []).filter(c => c.connected_asset_id !== connectedAssetId) };
        if (a._id === connectedAssetId)
          return { ...a, connections: (a.connections || []).filter(c => c.connected_asset_id !== assetId) };
        return a;
      }));
      setSuccessMessage('Connection removed.');
    } catch (error) {
      console.error('Error removing connection:', error);
    }
  }, []);

  const handleWallPortMove = useCallback((portId: string, x: number, y: number) => {
    setWallPorts(prev => prev.map(wp => wp._id === portId ? { ...wp, pos_x: x, pos_y: y } : wp));
    if (wallPortUpdateTimer.current) clearTimeout(wallPortUpdateTimer.current);
    wallPortUpdateTimer.current = setTimeout(async () => {
      try {
        await networkService.updateWallPort(portId, { pos_x: x, pos_y: y } as any);
      } catch (error) {
        console.error('Error updating wall port position:', error);
      }
    }, 500);
  }, []);

  const handleAssetTrace = useCallback((asset: Asset) => {
    setTracingAsset(asset);
    setSidePanelOpen(true);
  }, []);

  const CONN_COLORS: Record<string, string> = {
    power: '#ef4444', network: '#3b82f6', ethernet: '#3b82f6',
    fiber: '#8b5cf6', wifi: '#06b6d4', bluetooth: '#6366f1',
    usb: '#f59e0b', serial: '#78716c', parallel: '#78716c',
    dependency: '#f97316', 'parent-child': '#84cc16', peer: '#14b8a6',
  };

  const handleConnectionTypeToggle = useCallback((type: string) => {
    setActiveConnectionTypes(prev => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  }, []);

  const handleAssetClone = useCallback(async (asset: Asset) => {
    try {
      const clone = await assetService.createAsset({
        basic_info: {
          ...asset.basic_info,
          display_name: `${asset.basic_info?.display_name} (copy)`,
          serial_number: undefined,
          asset_tag: undefined,
        },
        hierarchy: { ...asset.hierarchy },
        location: {
          ...asset.location,
          coordinates: {
            x: Math.min(asset.location.coordinates.x + 60, 970),
            y: Math.min(asset.location.coordinates.y + 60, 770),
          },
        },
        technical_specs: asset.technical_specs,
        network: asset.network,
        custom_fields: asset.custom_fields,
        itsm: { hardware_asset_id: null, is_managed: false, last_synced: null, sync_status: 'never' },
      });
      setAssets(prev => [...prev, clone]);
      setSuccessMessage(`Cloned as "${clone.basic_info.display_name}"`);
      setTimeout(() => setSuccessMessage(null), 3000);
    } catch (error) {
      console.error('Error cloning asset:', error);
    }
  }, []);

  const mapTitle = selectedFloor
    ? `${selectedBuilding?.name || 'Building'} — Floor ${selectedFloor.floor_number} (${selectedFloor.name})`
    : 'Map View';

  return (
    <div className={styles.page}>
      {!fullScreen && (
        <>
          <div className={styles.header}>
            <div>
              <h1>Map View</h1>
              <p>Place assets on a floor plan and manage work areas by floor.</p>
            </div>
            <div className={styles.actions}>
              <Button variant={editMode ? 'danger' : 'primary'} onClick={() => setEditMode((prev) => !prev)}>
                {editMode ? 'Exit Edit Mode' : 'Enter Edit Mode'}
              </Button>
              <Button
                variant={deployMode ? 'success' : 'outline'}
                onClick={handleDeployToggle}
                disabled={!selectedFloorId}
              >
                {deployMode ? '✓ Deploy Mode Active' : '+ Deploy Device'}
              </Button>
              {deployMode && (
                <Button variant="danger" onClick={handleCancelDeploy}>
                  Cancel Deploy
                </Button>
              )}
              <Button
                variant={connectionMode ? 'success' : 'outline'}
                onClick={() => {
                  setConnectionMode(prev => !prev);
                  if (connectionMode) {
                    setSelectedAssetsForConnection([]);
                  }
                }}
                disabled={!selectedFloorId || !editMode}
              >
                {connectionMode ? '✓ Connection Mode' : '🔗 Connect Assets'}
              </Button>
              {connectionMode && selectedAssetsForConnection.length === 2 && (
                <>
                  <Select
                    value={newConnectionType}
                    onChange={setNewConnectionType}
                    options={[
                      { value: 'network',     label: 'Network' },
                      { value: 'ethernet',    label: 'Ethernet' },
                      { value: 'fiber',       label: 'Fiber' },
                      { value: 'wifi',        label: 'WiFi' },
                      { value: 'power',       label: 'Power' },
                      { value: 'usb',         label: 'USB' },
                      { value: 'bluetooth',   label: 'Bluetooth' },
                      { value: 'serial',      label: 'Serial' },
                      { value: 'parallel',    label: 'Parallel' },
                      { value: 'dependency',  label: 'Dependency' },
                      { value: 'parent-child',label: 'Parent-Child' },
                      { value: 'peer',        label: 'Peer' },
                    ]}
                  />
                  <Button variant="primary" onClick={handleCreateConnection}>
                    Create Connection
                  </Button>
                </>
              )}
              <Button
                variant="outline"
                onClick={() => setUploadModalOpen(true)}
                disabled={!selectedFloorId}
              >
                Upload Floor Plan
              </Button>
              <Button
                variant="outline"
                onClick={() => setFullScreen((prev) => !prev)}
                disabled={!selectedFloor}
              >
                {fullScreen ? 'Exit Full Screen' : 'Full Screen'}
              </Button>
            </div>
          </div>
          {successMessage && <div className={styles.toast}>{successMessage}</div>}
          {occupancyWarning && <div className={styles.occupancyWarning}>{occupancyWarning}</div>}
          {deployMode && (
            <div className={styles.deployBanner}>
              Click an empty area on the floor plan to place a new asset. The marker will appear once you select a position.
            </div>
          )}
          {connectionMode && (
            <div className={styles.deployBanner}>
              Select two assets to create a connection between them. Selected: {selectedAssetsForConnection.length}/2
            </div>
          )}
          <Card padding="lg" className={styles.selectorCard}>
            <div className={styles.selectorRow}>
              <label htmlFor="building-select">Building</label>
              <Select
                id="building-select"
                value={selectedBuildingId}
                onChange={handleBuildingChange}
                options={buildingOptions}
                disabled={metaLoading}
              />
            </div>
            <div className={styles.selectorRow}>
              <label htmlFor="floor-select">Floor</label>
              <Select
                id="floor-select"
                value={selectedFloorId}
                onChange={handleFloorChange}
                options={floorOptions}
                disabled={metaLoading || floorOptions.length === 0}
              />
            </div>
          </Card>

          {/* Floor utilization summary */}
          {selectedFloor && (
            <div className={styles.utilizationBar}>
              <span className={styles.utilizationLabel}>
                Floor {selectedFloor.floor_number} — {assets.length} asset{assets.length !== 1 ? 's' : ''}
                {workareas.length > 0 && `, ${workareas.length} zone${workareas.length !== 1 ? 's' : ''}`}
                {wallPorts.length > 0
                  ? `, ${wallPorts.length} wall port${wallPorts.length !== 1 ? 's' : ''}`
                  : ' · no wall ports'}
              </span>
              <div className={styles.utilizationStatuses}>
                {(['active','maintenance','offline','retired'] as const).map(s => {
                  const count = assets.filter(a => a.basic_info?.status === s).length;
                  if (count === 0) return null;
                  const color = s === 'active' ? '#10b981' : s === 'maintenance' ? '#f59e0b' : '#ef4444';
                  return (
                    <span key={s} className={styles.utilizationChip} style={{ borderColor: color, color }}>
                      {count} {s}
                    </span>
                  );
                })}
                {assets.filter(a => !a.basic_info?.status || !['active','maintenance','offline','retired'].includes(a.basic_info?.status)).length > 0 && (
                  <span className={styles.utilizationChip} style={{ borderColor: '#9ca3af', color: '#9ca3af' }}>
                    {assets.filter(a => !a.basic_info?.status || !['active','maintenance','offline','retired'].includes(a.basic_info?.status)).length} unknown
                  </span>
                )}
              </div>
            </div>
          )}

          <Card padding="lg" className={styles.filterCard}>
            <div className={styles.filterRow}>
              <div className={styles.searchBox}>
                <Input
                  type="text"
                  placeholder="Search assets by name, model, serial, or person..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
              <div className={styles.filterSelect}>
                <Select
                  value={statusFilter}
                  onChange={setStatusFilter}
                  options={statusOptions}
                  placeholder="Status"
                />
              </div>
              <div className={styles.filterSelect}>
                <Select
                  value={typeFilter}
                  onChange={setTypeFilter}
                  options={typeOptions}
                  placeholder="Type"
                />
              </div>
              <div className={styles.filterSelect}>
                <Select
                  value={workareaFilter}
                  onChange={setWorkareaFilter}
                  options={workareaOptions}
                  placeholder="Work Area"
                />
              </div>
              {(searchQuery || statusFilter !== 'all' || typeFilter !== 'all' || workareaFilter !== 'all') && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSearchQuery('');
                    setStatusFilter('all');
                    setTypeFilter('all');
                    setWorkareaFilter('all');
                  }}
                >
                  Clear Filters
                </Button>
              )}
            </div>
            <div className={styles.filterSummary}>
              Showing {filteredAssets.length} of {assets.length} assets
            </div>
          </Card>
        </>
      )}

      {loading ? (
        <Card padding="lg">
          <div className={styles.loadingState}>
            <p>Loading map data...</p>
          </div>
        </Card>
      ) : error ? (
        <Card padding="lg">
          <div className={styles.errorState}>
            <h3>Error</h3>
            <p>{error}</p>
            <Button onClick={() => {
              setError(null);
              if (selectedFloorId) {
                loadMapData(selectedFloorId);
              } else {
                loadMetadata();
              }
            }}>
              Retry
            </Button>
          </div>
        </Card>
      ) : selectedFloor ? (
        <div className={`${styles.mapSection} ${fullScreen ? styles.fullScreen : ''}`}>
          <div className={styles.mapInfo}>
            <h2 className={styles.mapTitle}>{mapTitle}</h2>
            <p className={styles.mapStats}>{filteredAssets.length} assets · {workareas.length} work areas</p>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {fullScreen && (
                <div className={styles.fullScreenActions}>
                  <Button variant={editMode ? 'danger' : 'primary'} onClick={() => setEditMode((prev) => !prev)}>
                    {editMode ? 'Exit Edit Mode' : 'Enter Edit Mode'}
                  </Button>
                  <Button variant="outline" onClick={() => setFullScreen(false)}>
                    Exit Full Screen
                  </Button>
                </div>
              )}
              <button
                className={styles.sidePanelToggle}
                onClick={() => setSidePanelOpen(p => !p)}
                title="Toggle asset list panel"
              >
                {sidePanelOpen ? '▶ Hide List' : '◀ Show List'}
              </button>
            </div>
          </div>

          <div className={sidePanelOpen ? styles.mapWithPanel : undefined}>
            <FloorMap
              workareas={workareas}
              assets={filteredAssets}
              editable={editMode}
              backgroundImage={selectedFloor.svg_background}
              onWorkareaMove={handleWorkareaMove}
              onWorkareaResize={handleWorkareaResize}
              onAssetMove={handleAssetMove}
              deployMode={deployMode}
              deployPosition={deployPosition}
              onMapClick={handleMapClick}
              layers={layers}
              onLayerToggle={handleLayerToggle}
              connectionMode={connectionMode}
              selectedAssetsForConnection={selectedAssetsForConnection}
              onAssetSelectForConnection={handleAssetSelectForConnection}
              highlightedAssetId={highlightedAssetId}
              focusAsset={focusAsset}
              onWorkareaCreate={editMode ? handleWorkareaCreate : undefined}
              onWorkareaDelete={editMode ? handleWorkareaDelete : undefined}
              onWorkareaRename={editMode ? handleWorkareaRename : undefined}
              onAssetStatusChange={handleAssetStatusChange}
              onAssetClick={(asset) => navigate(`/assets/${asset._id}`)}
              onAssetTrace={handleAssetTrace}
              onAssetEdit={(asset) => setEditAsset(asset)}
              onAssetClone={handleAssetClone}
              onWorkareaClick={handleWorkareaClick}
              onConnectionDelete={handleConnectionDelete}
              activeConnectionTypes={activeConnectionTypes.size > 0 ? activeConnectionTypes : undefined}
              allAssets={allAssets}
              onNavigateToAsset={handleNavigateToAsset}
              wallPorts={wallPorts}
              onWallPortMove={editMode ? handleWallPortMove : undefined}
              floorName={selectedFloor.name}
            />

            {sidePanelOpen && (
              <div className={styles.sidePanel}>
                {tracingAsset ? (
                  /* ── Network Trace panel ── */
                  <>
                    <div className={styles.sidePanelHeader}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                        <button className={styles.traceBack} onClick={() => setTracingAsset(null)}>← Back to list</button>
                        <h4 style={{ margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          🔗 {tracingAsset.basic_info.display_name}
                        </h4>
                        <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
                          {tracingAsset.basic_info.type} · {tracingAsset.basic_info.status}
                        </span>
                      </div>
                      <button className={styles.sidePanelClose} onClick={() => setTracingAsset(null)}>✕</button>
                    </div>
                    <div className={styles.sidePanelList}>
                      {/* ── Physical connection ─────────────────────────── */}
                      <div style={{ padding: '6px 12px 4px', fontSize: 10, fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: '1px solid var(--color-gray-100)' }}>
                        Physical Connection
                      </div>
                      {tracingAsset.wall_port ? (
                        <div className={styles.traceConnection}>
                          <div className={styles.traceEndpoint}>
                            <div className={styles.traceEndpointName}>🔌 {tracingAsset.wall_port.label}
                              {tracingAsset.wall_port.description && (
                                <span style={{ fontWeight: 400, color: 'var(--color-text-secondary)', fontSize: 11 }}> — {tracingAsset.wall_port.description}</span>
                              )}
                            </div>
                            {tracingAsset.wall_port.patch_panel_name && (
                              <div className={styles.traceStep}>
                                📋 {tracingAsset.wall_port.patch_panel_name}
                                {tracingAsset.wall_port.patch_port != null && <span className={styles.traceStepBadge}>port {tracingAsset.wall_port.patch_port}</span>}
                              </div>
                            )}
                            {tracingAsset.wall_port.rack_name && (
                              <div className={styles.traceStep}>🗄️ {tracingAsset.wall_port.rack_name}</div>
                            )}
                            {tracingAsset.wall_port.room_name && (
                              <div className={styles.traceStep}>
                                🏠 {tracingAsset.wall_port.room_name}
                                {tracingAsset.wall_port.room_type && <span className={styles.traceStepBadge}>{tracingAsset.wall_port.room_type.toUpperCase()}</span>}
                              </div>
                            )}
                            {tracingAsset.wall_port.switch_port && (
                              <div className={styles.traceStep}>🔀 switch port <span className={styles.traceStepMono}>{tracingAsset.wall_port.switch_port}</span></div>
                            )}
                            {tracingAsset.wall_port.switch_asset_id && (() => {
                              const sw = allAssets.find(a => a._id === tracingAsset.wall_port!.switch_asset_id);
                              return sw ? (
                                <div className={styles.traceStep}>🖧 <span className={styles.traceStepMono}>{sw.basic_info.display_name}</span> <span className={styles.traceStepBadge}>{sw.basic_info.type}</span></div>
                              ) : null;
                            })()}
                            {!tracingAsset.wall_port.patch_panel_id && (
                              <div className={styles.traceUnpatched}>Not patched to a panel</div>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className={styles.traceUnpatched} style={{ padding: '8px 12px' }}>
                          No wall port assigned — edit asset to set one
                        </div>
                      )}

                      {/* ── Logical connections ─────────────────────────── */}
                      <div style={{ padding: '6px 12px 4px', fontSize: 10, fontWeight: 600, color: 'var(--color-text-secondary)', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: '1px solid var(--color-gray-100)', borderTop: '1px solid var(--color-gray-100)', marginTop: 4 }}>
                        Logical Connections
                      </div>
                      {(() => {
                        type TraceEdge = {
                          peer_id: string;
                          connection_type: string;
                          bidirectional: boolean | undefined;
                          label: string | undefined;
                          direction: 'out' | 'in';
                          patch_panel?: { panel_name?: string; panel_port?: string; switch_name?: string; switch_port?: string } | null;
                          source_port?: string | null;
                          target_port?: string | null;
                        };
                        const outgoing: TraceEdge[] = (tracingAsset.connections ?? []).map(c => ({
                          peer_id: c.connected_asset_id,
                          connection_type: c.connection_type,
                          bidirectional: c.bidirectional,
                          label: c.label,
                          direction: 'out',
                          patch_panel: c.patch_panel,
                          source_port: (c as any).source_port ?? null,
                          target_port: (c as any).target_port ?? null,
                        }));
                        const incoming: TraceEdge[] = [];
                        for (const a of allAssets) {
                          if (a._id === tracingAsset._id) continue;
                          for (const c of a.connections ?? []) {
                            if (c.connected_asset_id !== tracingAsset._id) continue;
                            if (outgoing.some(o => o.peer_id === a._id && o.connection_type === c.connection_type)) continue;
                            incoming.push({
                              peer_id: a._id,
                              connection_type: c.connection_type,
                              bidirectional: c.bidirectional,
                              label: c.label,
                              direction: 'in',
                              patch_panel: c.patch_panel,
                              source_port: (c as any).target_port ?? null,
                              target_port: (c as any).source_port ?? null,
                            });
                          }
                        }
                        const allEdges = [...outgoing, ...incoming];
                        if (allEdges.length === 0) {
                          return <div className={styles.traceEmpty}>No logical connections.</div>;
                        }
                        return allEdges.map((edge, i) => {
                          const connectedPort = wallPorts.find(wp => wp._id === edge.peer_id);
                          const connectedAsset = allAssets.find(a => a._id === edge.peer_id);
                          const isRackMounted = !!connectedAsset?.hierarchy?.rack_id;
                          const isOnFloor = !isRackMounted && filteredAssets.some(a => a._id === edge.peer_id);
                          const lineColor = CONN_COLORS[edge.connection_type] ?? '#9ca3af';
                          const dirLabel = edge.direction === 'in' ? ' ←' : edge.bidirectional ? ' ↔' : ' →';
                          const portLabel = edge.source_port && edge.target_port
                            ? ` ${edge.source_port} → ${edge.target_port}`
                            : edge.source_port ? ` ${edge.source_port} →`
                            : edge.target_port ? ` → ${edge.target_port}` : '';
                          return (
                            <div key={i} className={styles.traceConnection}>
                              <div className={styles.traceConnType}>
                                <span className={styles.traceConnDot} style={{ background: lineColor }} />
                                <span>{edge.connection_type}{dirLabel}{portLabel}{edge.label ? ` · ${edge.label}` : ''}</span>
                              </div>
                              {connectedPort ? (
                                <div className={styles.traceEndpoint}>
                                  <div className={styles.traceEndpointName}>🔌 {connectedPort.label}</div>
                                  {connectedPort.patch_panel_name && (
                                    <div className={styles.traceStep}>
                                      📋 {connectedPort.patch_panel_name}
                                      {connectedPort.patch_port != null ? <span className={styles.traceStepBadge}>port {connectedPort.patch_port}</span> : null}
                                    </div>
                                  )}
                                  {connectedPort.rack_name && (
                                    <div className={styles.traceStep}>🗄️ {connectedPort.rack_name}</div>
                                  )}
                                  {connectedPort.room_name && (
                                    <div className={styles.traceStep}>
                                      🏠 {connectedPort.room_name}
                                      {connectedPort.room_type && <span className={styles.traceStepBadge}>{connectedPort.room_type.toUpperCase()}</span>}
                                    </div>
                                  )}
                                  {connectedPort.switch_port && (
                                    <div className={styles.traceStep}>🔀 switch port <span className={styles.traceStepMono}>{connectedPort.switch_port}</span></div>
                                  )}
                                  {connectedPort.switch_asset_id && (() => {
                                    const sw = allAssets.find(a => a._id === connectedPort.switch_asset_id);
                                    return sw ? (
                                      <div className={styles.traceStep}>🖧 <span className={styles.traceStepMono}>{sw.basic_info.display_name}</span> <span className={styles.traceStepBadge}>{sw.basic_info.type}</span></div>
                                    ) : null;
                                  })()}
                                  {!connectedPort.patch_panel_id && (
                                    <div className={styles.traceUnpatched}>Not patched to a panel</div>
                                  )}
                                </div>
                              ) : connectedAsset ? (
                                <div className={styles.traceEndpoint}>
                                  <div className={styles.traceEndpointName}>
                                    {isRackMounted ? '🗄️' : '💻'} {connectedAsset.basic_info.display_name}
                                    {isRackMounted
                                      ? <span className={styles.traceFloorBadge}>in rack</span>
                                      : !isOnFloor
                                        ? <span className={styles.traceFloorBadge}>↕ diff. floor</span>
                                        : null}
                                  </div>
                                  <div className={styles.traceEndpointSub}>
                                    {connectedAsset.basic_info.type}
                                    {connectedAsset.basic_info.status && ` · ${connectedAsset.basic_info.status}`}
                                  </div>
                                  {edge.patch_panel && (edge.patch_panel.panel_name || edge.patch_panel.switch_port) && (
                                    <>
                                      {edge.patch_panel.panel_name && (
                                        <div className={styles.traceStep}>
                                          📋 {edge.patch_panel.panel_name}
                                          {edge.patch_panel.panel_port ? <span className={styles.traceStepBadge}>port {edge.patch_panel.panel_port}</span> : null}
                                        </div>
                                      )}
                                      {edge.patch_panel.switch_name && (
                                        <div className={styles.traceStep}>🖧 <span className={styles.traceStepMono}>{edge.patch_panel.switch_name}</span></div>
                                      )}
                                      {edge.patch_panel.switch_port && (
                                        <div className={styles.traceStep}>🔀 switch port <span className={styles.traceStepMono}>{edge.patch_panel.switch_port}</span></div>
                                      )}
                                    </>
                                  )}
                                </div>
                              ) : (
                                <div className={styles.traceUnknown}>Unknown · {edge.peer_id.slice(0, 8)}…</div>
                              )}
                            </div>
                          );
                        });
                      })()}
                    </div>
                  </>
                ) : selectedZoneId ? (() => {
                  /* ── Zone detail panel ── */
                  const zone = workareas.find(w => w._id === selectedZoneId);
                  const zoneAssets = zone ? filteredAssets.filter(a => {
                    if (a.hierarchy.workarea_id === zone._id) return true;
                    const wx = zone.coordinates?.x || 0, wy = zone.coordinates?.y || 0;
                    const ww = zone.dimensions?.width || 150, wh = zone.dimensions?.height || 100;
                    return a.location.coordinates.x >= wx && a.location.coordinates.x <= wx + ww &&
                           a.location.coordinates.y >= wy && a.location.coordinates.y <= wy + wh;
                  }) : [];
                  return (
                    <>
                      <div className={styles.sidePanelHeader}>
                        <div>
                          <h4>🏭 {zone?.name}</h4>
                          {zone?.type && <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>{zone.type}</span>}
                        </div>
                        <button className={styles.sidePanelClose} onClick={() => setSelectedZoneId(null)}>✕</button>
                      </div>
                      {zone?.metadata?.supervisor && (
                        <div style={{ padding: '4px 12px', fontSize: 12, color: 'var(--color-text-secondary)' }}>
                          Supervisor: {zone.metadata.supervisor}
                        </div>
                      )}
                      <div style={{ padding: '4px 12px 8px', fontSize: 12, color: 'var(--color-text-secondary)', borderBottom: '1px solid var(--color-border)' }}>
                        {zoneAssets.length} asset{zoneAssets.length !== 1 ? 's' : ''}
                        {zone?.metadata?.capacity ? ` / ${zone.metadata.capacity} capacity` : ''}
                      </div>
                      <div className={styles.sidePanelList}>
                        {zoneAssets.length === 0 ? (
                          <div style={{ padding: 16, color: 'var(--color-text-secondary)', fontSize: 13 }}>No assets in this zone</div>
                        ) : zoneAssets.map(asset => {
                          const statusColor =
                            asset.basic_info?.status === 'active' ? '#10b981' :
                            asset.basic_info?.status === 'maintenance' ? '#f59e0b' :
                            asset.basic_info?.status === 'retired' || asset.basic_info?.status === 'inactive' ? '#ef4444' :
                            '#6b7280';
                          return (
                            <div key={asset._id} className={styles.sidePanelItem}
                              onClick={() => { setHighlightedAssetId(asset._id); setFocusAsset(prev => ({ id: asset._id, tick: (prev?.tick ?? 0) + 1 })); }}
                            >
                              <span className={styles.sidePanelItemIcon}>{getAssetIcon(asset.basic_info?.type)}</span>
                              <div className={styles.sidePanelItemInfo}>
                                <div className={styles.sidePanelItemName}>{asset.basic_info?.display_name}</div>
                                <div className={styles.sidePanelItemSub}>{asset.assigned_person?.full_name || asset.basic_info?.model || '—'}</div>
                              </div>
                              <div className={styles.sidePanelStatus} style={{ background: statusColor }} />
                            </div>
                          );
                        })}
                      </div>
                    </>
                  );
                })() : (
                  /* ── Default asset list panel ── */
                  <>
                    <div className={styles.sidePanelHeader}>
                      <h4>Assets ({filteredAssets.length})</h4>
                      <button className={styles.sidePanelClose} onClick={() => setSidePanelOpen(false)}>✕</button>
                    </div>
                    {layers.connections && (
                      <div style={{ padding: '6px 12px', borderBottom: '1px solid var(--color-border)' }}>
                        <div style={{ fontSize: 11, color: 'var(--color-text-secondary)', marginBottom: 4 }}>Filter connections:</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          {['ethernet','fiber','wifi','power','usb','serial','dependency','peer'].map(type => {
                            const active = activeConnectionTypes.has(type);
                            return (
                              <button key={type}
                                onClick={() => handleConnectionTypeToggle(type)}
                                style={{
                                  fontSize: 10, padding: '2px 6px', borderRadius: 10, border: '1px solid #d1d5db',
                                  background: active ? '#3b82f6' : 'transparent', color: active ? '#fff' : 'var(--color-text-secondary)',
                                  cursor: 'pointer', fontFamily: 'inherit',
                                }}
                              >
                                {type}
                              </button>
                            );
                          })}
                          {activeConnectionTypes.size > 0 && (
                            <button onClick={() => setActiveConnectionTypes(new Set())}
                              style={{ fontSize: 10, padding: '2px 6px', borderRadius: 10, border: '1px solid #ef4444', color: '#ef4444', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit' }}
                            >
                              clear
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                    <div className={styles.sidePanelList}>
                      {filteredAssets.length === 0 ? (
                        <div style={{ padding: 16, color: 'var(--color-text-secondary)', fontSize: 13 }}>
                          No assets on this floor
                        </div>
                      ) : (
                        filteredAssets.map(asset => {
                          const statusColor =
                            asset.basic_info?.status === 'active' ? '#10b981' :
                            asset.basic_info?.status === 'maintenance' ? '#f59e0b' :
                            asset.basic_info?.status === 'retired' || asset.basic_info?.status === 'inactive' ? '#ef4444' :
                            '#6b7280';
                          const isHighlighted = highlightedAssetId === asset._id;
                          return (
                            <div
                              key={asset._id}
                              className={`${styles.sidePanelItem} ${isHighlighted ? styles.highlighted : ''}`}
                              onClick={() => {
                                const next = isHighlighted ? null : asset._id;
                                setHighlightedAssetId(next);
                                if (next) setFocusAsset(prev => ({ id: next, tick: (prev?.tick ?? 0) + 1 }));
                              }}
                            >
                              <span className={styles.sidePanelItemIcon}>{getAssetIcon(asset.basic_info?.type)}</span>
                              <div className={styles.sidePanelItemInfo}>
                                <div className={styles.sidePanelItemName}>{asset.basic_info?.display_name}</div>
                                <div className={styles.sidePanelItemSub}>
                                  {asset.assigned_person?.full_name || asset.basic_info?.model || '—'}
                                </div>
                              </div>
                              <div className={styles.sidePanelStatus} style={{ background: statusColor }} />
                            </div>
                          );
                        })
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      ) : (
        <Card padding="lg">
          <div className={styles.emptyState}>
            <h3>No floor selected</h3>
            <p>Select a building and floor to display the map.</p>
          </div>
        </Card>
      )}

      {selectedFloorId && (
        <FloorPlanUploadModal
          isOpen={uploadModalOpen}
          onClose={() => setUploadModalOpen(false)}
          onSuccess={handleUploadSuccess}
          floorId={selectedFloorId}
        />
      )}

      <AssetFormModal
        isOpen={createAssetModalOpen}
        onClose={() => {
          setCreateAssetModalOpen(false);
          setDeployMode(false);
          setDeployPosition(null);
        }}
        onSuccess={handleDeploySuccess}
        defaultBuildingId={selectedBuildingId}
        defaultFloorId={selectedFloorId}
        defaultCoordinates={deployPosition ?? { x: 0, y: 0 }}
      />

      <AssetFormModal
        isOpen={!!editAsset}
        onClose={() => setEditAsset(null)}
        onSuccess={() => {
          setEditAsset(null);
          if (selectedFloorId) loadMapData(selectedFloorId);
        }}
        asset={editAsset}
        defaultBuildingId={selectedBuildingId}
        defaultFloorId={selectedFloorId}
      />

      {/* Zone creation dialog */}
      {pendingZone && (
        <div className={styles.zoneDialogOverlay} onClick={() => setPendingZone(null)}>
          <div className={styles.zoneDialog} onClick={e => e.stopPropagation()}>
            <h3 className={styles.zoneDialogTitle}>Create Zone</h3>
            <div className={styles.zoneDialogField}>
              <label>Zone Name</label>
              <input
                className={styles.zoneDialogInput}
                autoFocus
                placeholder="e.g. Server Room A"
                value={zoneName}
                onChange={e => setZoneName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleZoneFormSubmit(); if (e.key === 'Escape') setPendingZone(null); }}
              />
            </div>
            <div className={styles.zoneDialogField}>
              <label>Zone Type</label>
              <select
                className={styles.zoneDialogInput}
                value={zoneType}
                onChange={e => setZoneType(e.target.value)}
              >
                <option value="">— Select type —</option>
                <option value="workspace">Workspace</option>
                <option value="server room">Server Room</option>
                <option value="storage">Storage</option>
                <option value="lab">Lab</option>
                <option value="reception">Reception</option>
                <option value="production">Production</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div className={styles.zoneDialogActions}>
              <button className={styles.zoneDialogCancel} onClick={() => setPendingZone(null)}>Cancel</button>
              <button className={styles.zoneDialogCreate} onClick={handleZoneFormSubmit}>Create Zone</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MapView;
