import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import Card from '../components/common/Card';
import Button from '../components/common/Button';
import ConfirmDialog from '../components/common/ConfirmDialog';
import { networkService, NetworkRoom, NetworkRack, PatchPanel, WallPort } from '../services/network.service';
import { assetService, Asset } from '../services/asset.service';
import { RackDiagram } from '../components/network/RackDiagram';
import AutoPatchModal from '../components/network/AutoPatchModal';
import { useToast } from '../contexts/ToastContext';
import { useBuildings } from '../hooks/queries/useBuildings';
import { useFloors } from '../hooks/queries/useFloors';
import { useNetworkRooms, networkKeys } from '../hooks/queries/useNetwork';
import { getApiErrorMessage } from '../utils/apiError';
import styles from '../styles/pages/NetworkInfrastructure.module.css';

type ModalState =
  | { kind: 'none' }
  | { kind: 'room';     room?: NetworkRoom }
  | { kind: 'rack';     room: NetworkRoom; rack?: NetworkRack }
  | { kind: 'panel';    rack: NetworkRack; panel?: PatchPanel }
  | { kind: 'wallport'; panel: PatchPanel; portNum: number; existing?: WallPort }
  | { kind: 'replaceRack';  room: NetworkRoom; rack: NetworkRack }
  | { kind: 'replacePanel'; rack: NetworkRack; panel: PatchPanel };

interface PortTooltip {
  port: WallPort;
  x: number;
  y: number;
}

const EMPTY_ROOMS: NetworkRoom[] = [];

const NetworkInfrastructure: React.FC = () => {
  const toast = useToast();
  const qc = useQueryClient();

  const { data: buildings = [], isLoading: loadingBuildings } = useBuildings();
  const { data: floors = [] } = useFloors();

  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedBuildingId, setSelectedBuildingId] = useState('');
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [selectedRackId, setSelectedRackId] = useState<string | null>(null);
  const [panelPorts, setPanelPorts] = useState<Record<string, WallPort[]>>({});
  const [buildingAssets, setBuildingAssets] = useState<Asset[]>([]);
  const [rackAssets,     setRackAssets]     = useState<Asset[]>([]);

  interface PortSearchResult {
    wallPort: WallPort;
    panel: PatchPanel;
    rack: NetworkRack;
    room: NetworkRoom;
  }
  const [allBuildingPorts, setAllBuildingPorts] = useState<PortSearchResult[]>([]);
  const [portSearch, setPortSearch] = useState('');
  const [portSearchFocused, setPortSearchFocused] = useState(false);
  const portSearchRef = useRef<HTMLInputElement>(null);
  const [portTooltip, setPortTooltip] = useState<PortTooltip | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [modal, setModal] = useState<ModalState>({ kind: 'none' });
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  type DeleteTarget =
    | { kind: 'room';   room: NetworkRoom }
    | { kind: 'rack';   rack: NetworkRack }
    | { kind: 'panel';  panel: PatchPanel; rack: NetworkRack }
    | { kind: 'wp';     wp: WallPort; panelId: string };
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);

  /**
   * Sockets in this building that aren't wired to a panel port yet, offered when
   * assigning a panel port. This is the normal Phase C flow: the socket was
   * created when the floor was surveyed, and standing at the rack you now record
   * which panel port it lands on. Creating a socket from here stays available as
   * the fallback for one that was missed. See docs/CONNECTIONS_WORKFLOW.md.
   */
  const [unpatchedSockets, setUnpatchedSockets] = useState<WallPort[]>([]);

  /** Rack whose sockets are being patched from their labels in bulk. */
  const [autoPatchRack, setAutoPatchRack] = useState<NetworkRack | null>(null);

  const [splitPct, setSplitPct] = useState<number>(() => {
    const saved = localStorage.getItem('infra-split-pct');
    return saved ? Math.max(20, Math.min(80, Number(saved))) : 55;
  });
  const splitContainerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const handleDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    const onMouseMove = (ev: MouseEvent) => {
      if (!isDragging.current || !splitContainerRef.current) return;
      const rect = splitContainerRef.current.getBoundingClientRect();
      const pct = Math.round(((ev.clientY - rect.top) / rect.height) * 100);
      const clamped = Math.max(20, Math.min(80, pct));
      setSplitPct(clamped);
      localStorage.setItem('infra-split-pct', String(clamped));
    };
    const onMouseUp = () => {
      isDragging.current = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);

  const handleSnapPct = useCallback((pct: number) => {
    setSplitPct(pct);
    localStorage.setItem('infra-split-pct', String(pct));
  }, []);

  // Auto-select first building
  useEffect(() => {
    if (buildings.length > 0 && !selectedBuildingId) setSelectedBuildingId(buildings[0]._id);
  }, [buildings, selectedBuildingId]);

  const { data: rooms = EMPTY_ROOMS } = useNetworkRooms(
    selectedBuildingId ? { building_id: selectedBuildingId } : undefined
  );

  const selectedRoom = rooms.find(r => r._id === selectedRoomId) ?? null;
  const selectedRack = selectedRoom?.racks.find(r => r._id === selectedRackId) ?? null;

  /**
   * Deep link from an asset's network path ("Patch it at the rack"). Patching is only
   * possible here, so the link has to land on the right cabinet rather than on the
   * page's first building — otherwise the action tells you where to go and then
   * leaves you to find it.
   *
   * The rack id alone identifies the room, once this building's rooms have loaded;
   * `building` comes along because the rooms query is scoped to a building.
   */
  const requestedBuildingId = searchParams.get('building');
  const requestedRackId = searchParams.get('rack');

  useEffect(() => {
    if (requestedBuildingId) setSelectedBuildingId(requestedBuildingId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedBuildingId]);

  useEffect(() => {
    if (!requestedRackId || rooms.length === 0) return;
    const room = rooms.find(r => r.racks.some(rk => rk._id === requestedRackId));
    if (!room) return;
    setSelectedRoomId(room._id);
    setSelectedRackId(requestedRackId);
    // Consume the params: from here on the selection is the page's own state, and a
    // stale ?rack= would fight every click.
    setSearchParams(new URLSearchParams(), { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedRackId, rooms]);

  // Reset room/rack selection when building changes; load assets for switch picker
  useEffect(() => {
    setSelectedRoomId(null);
    setSelectedRackId(null);
    setPanelPorts({});
    setAllBuildingPorts([]);
    setPortSearch('');
    if (selectedBuildingId) {
      // Server-filtered; this used to fetch every asset and keep the ones in this
      // building, for a switch picker that only ever shows one building's devices.
      assetService.getAssetsByBuilding(selectedBuildingId)
        .then(setBuildingAssets)
        .catch(() => {});
    }
  }, [selectedBuildingId]);

  // Load all wall ports for the building when rooms data changes
  useEffect(() => {
    if (rooms.length === 0) { setAllBuildingPorts([]); return; }
    const tasks: Array<{ panelId: string; panel: PatchPanel; rack: NetworkRack; room: NetworkRoom }> = [];
    rooms.forEach(room => {
      room.racks.forEach(rack => {
        rack.patch_panels.forEach(panel => {
          tasks.push({ panelId: panel._id, panel, rack, room });
        });
      });
    });
    if (tasks.length === 0) { setAllBuildingPorts([]); return; }
    Promise.all(tasks.map(t => networkService.getWallPorts({ patch_panel_id: t.panelId }))).then(results => {
      const collected: PortSearchResult[] = [];
      results.forEach((ports, i) => {
        ports.forEach(wp => collected.push({ wallPort: wp, panel: tasks[i].panel, rack: tasks[i].rack, room: tasks[i].room }));
      });
      setAllBuildingPorts(collected);
    }).catch(() => {});
  }, [rooms]);

  // Load wall ports and rack assets when selected rack changes
  useEffect(() => {
    if (!selectedRack) { setPanelPorts({}); setRackAssets([]); return; }
    if (selectedRack.patch_panels.length > 0) {
      Promise.all(
        selectedRack.patch_panels.map(p => networkService.getWallPorts({ patch_panel_id: p._id }))
      ).then(results => {
        const map: Record<string, WallPort[]> = {};
        selectedRack.patch_panels.forEach((p, i) => { map[p._id] = results[i]; });
        setPanelPorts(map);
      });
    }
    loadRackAssets(selectedRack._id);
  }, [selectedRack]);

  const portSearchResults = portSearch.trim().length >= 2
    ? allBuildingPorts.filter(r =>
        r.wallPort.label.toLowerCase().includes(portSearch.toLowerCase()) ||
        r.panel.name.toLowerCase().includes(portSearch.toLowerCase()) ||
        r.rack.name.toLowerCase().includes(portSearch.toLowerCase()) ||
        (r.wallPort.switch_port ?? '').toLowerCase().includes(portSearch.toLowerCase()) ||
        (buildingAssets.find(a => a._id === r.wallPort.switch_asset_id)?.basic_info?.display_name ?? '').toLowerCase().includes(portSearch.toLowerCase())
      ).slice(0, 12)
    : [];

  const invalidateRooms = () => qc.invalidateQueries({ queryKey: networkKeys.rooms({ building_id: selectedBuildingId }) });

  const floorName = (floorId: string | null) => (floors as { _id: string; name: string }[]).find(f => f._id === floorId)?.name ?? '—';
  const buildingName = (bId: string) => buildings.find(b => b._id === bId)?.name ?? '—';

  const reloadPanelPorts = async (panelId: string) => {
    const ports = await networkService.getWallPorts({ patch_panel_id: panelId });
    setPanelPorts(prev => ({ ...prev, [panelId]: ports }));
  };

  const loadRackAssets = async (rackId: string) => {
    setRackAssets(await assetService.getAssetsByRack(rackId));
  };

  const openModal = (state: ModalState) => {
    const defaults: Record<string, string> = {};
    if (state.kind === 'room') {
      defaults.name = state.room?.name ?? '';
      defaults.type = state.room?.type ?? 'idf';
      defaults.floor_id = state.room?.floor_id ?? '';
      defaults.description = state.room?.description ?? '';
      defaults.redundant_pair_id = state.room?.redundant_pair_id ?? '';
    } else if (state.kind === 'rack') {
      defaults.name = state.rack?.name ?? '';
      defaults.u_count = String(state.rack?.u_count ?? 42);
      defaults.description = state.rack?.description ?? '';
    } else if (state.kind === 'panel') {
      defaults.name = state.panel?.name ?? '';
      defaults.u_position = String(state.panel?.u_position ?? '');
      defaults.port_count = String(state.panel?.port_count ?? 24);
      defaults.cable_type = state.panel?.cable_type ?? 'copper';
      defaults.description = state.panel?.description ?? '';
    } else if (state.kind === 'wallport') {
      defaults.label            = state.existing?.label ?? '';
      defaults.floor_id         = state.existing?.floor_id ?? '';
      defaults.switch_asset_id  = state.existing?.switch_asset_id ?? '';
      defaults.switch_port      = state.existing?.switch_port ?? '';
      defaults.description      = state.existing?.description ?? '';
      defaults.attach_socket_id = '';
      if (!state.existing) {
        // Fire-and-forget: the picker fills in when it arrives, and an empty
        // list just means "none unpatched", which the UI says out loud.
        const floorIds = new Set(
          (floors as { _id: string; building_id: string }[])
            .filter(f => f.building_id === selectedBuildingId)
            .map(f => f._id),
        );
        networkService.getWallPorts()
          .then(all => setUnpatchedSockets(all.filter(wp => !wp.patch_panel_id && floorIds.has(wp.floor_id))))
          .catch(() => setUnpatchedSockets([]));
      }
    } else if (state.kind === 'replaceRack' || state.kind === 'replacePanel') {
      defaults.replacement_id = '';
    }
    setForm(defaults);
    setModal(state);
  };

  const closeModal = () => { setModal({ kind: 'none' }); setSaving(false); };

  const handleSave = async () => {
    if (saving) return;
    setSaving(true);
    try {
      if (modal.kind === 'room') {
        const payload = {
          name: form.name.trim(),
          type: form.type as 'idf' | 'mdf',
          building_id: selectedBuildingId,
          floor_id: form.floor_id || null,
          description: form.description?.trim() || null,
          redundant_pair_id: form.redundant_pair_id || null,
        };
        if (modal.room) await networkService.updateRoom(modal.room._id, payload);
        else await networkService.createRoom(payload);
        toast.success(modal.room ? 'Room updated' : 'Room created');
        await invalidateRooms();
      } else if (modal.kind === 'rack') {
        const payload = {
          name: form.name.trim(),
          network_room_id: modal.room._id,
          u_count: parseInt(form.u_count) || 42,
          description: form.description?.trim() || null,
        };
        if (modal.rack) await networkService.updateRack(modal.rack._id, payload);
        else await networkService.createRack(payload);
        toast.success(modal.rack ? 'Rack updated' : 'Rack created');
        await invalidateRooms();
      } else if (modal.kind === 'panel') {
        const rackId = modal.rack._id;
        const payload = {
          name: form.name.trim(),
          rack_id: rackId,
          u_position: parseInt(form.u_position) || null,
          port_count: parseInt(form.port_count) || 24,
          cable_type: form.cable_type as 'copper' | 'fiber' | 'mixed',
          description: form.description?.trim() || null,
        };
        if (modal.panel) await networkService.updatePatchPanel(modal.panel._id, payload);
        else await networkService.createPatchPanel(payload);
        toast.success(modal.panel ? 'Patch panel updated' : 'Patch panel created');
        await invalidateRooms();
      } else if (modal.kind === 'wallport') {
        // Patching an already-surveyed socket onto this panel port — the usual
        // case. Only the panel/switch side is touched; the socket's label, floor
        // and room were established when the floor was walked.
        if (!modal.existing && form.attach_socket_id) {
          await networkService.updateWallPort(form.attach_socket_id, {
            patch_panel_id:  modal.panel._id,
            patch_port:      modal.portNum,
            switch_asset_id: form.switch_asset_id || null,
            switch_port:     form.switch_port?.trim() || null,
          });
          toast.success('Socket patched to this port');
          await reloadPanelPorts(modal.panel._id);
          closeModal();
          return;
        }

        if (!form.label?.trim()) { toast.error('Label is required'); setSaving(false); return; }
        if (!form.floor_id)      { toast.error('Floor is required'); setSaving(false); return; }
        const payload = {
          label:           form.label.trim(),
          floor_id:        form.floor_id,
          patch_panel_id:  modal.panel._id,
          patch_port:      modal.portNum,
          switch_asset_id: form.switch_asset_id || null,
          switch_port:     form.switch_port?.trim() || null,
          description:     form.description?.trim() || null,
        };
        if (modal.existing) {
          await networkService.updateWallPort(modal.existing._id, payload);
          toast.success('Wall port updated');
        } else {
          await networkService.createWallPort(payload);
          toast.success('Wall port created');
        }
        await reloadPanelPorts(modal.panel._id);
      } else if (modal.kind === 'replaceRack') {
        if (!form.replacement_id) { toast.error('Select a replacement rack'); setSaving(false); return; }
        await networkService.replaceRack(modal.rack._id, form.replacement_id);
        toast.success(`Rack replaced — patch panels and mounted assets moved to the replacement`);
        if (selectedRackId === modal.rack._id) setSelectedRackId(form.replacement_id);
        await invalidateRooms();
      } else if (modal.kind === 'replacePanel') {
        if (!form.replacement_id) { toast.error('Select a replacement patch panel'); setSaving(false); return; }
        await networkService.replacePatchPanel(modal.panel._id, form.replacement_id);
        toast.success(`Patch panel replaced — wall ports moved to the replacement`);
        await invalidateRooms();
      }
      closeModal();
    } catch (err: unknown) {
      toast.error(getApiErrorMessage(err, 'Save failed'));
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleteLoading(true);
    try {
      if (deleteTarget.kind === 'room') {
        await networkService.deleteRoom(deleteTarget.room._id);
        toast.success('Room deleted');
        if (selectedRoomId === deleteTarget.room._id) { setSelectedRoomId(null); setSelectedRackId(null); }
        await invalidateRooms();
      } else if (deleteTarget.kind === 'rack') {
        await networkService.deleteRack(deleteTarget.rack._id);
        toast.success('Rack deleted');
        if (selectedRackId === deleteTarget.rack._id) setSelectedRackId(null);
        await invalidateRooms();
      } else if (deleteTarget.kind === 'panel') {
        await networkService.deletePatchPanel(deleteTarget.panel._id);
        toast.success('Panel deleted');
        await invalidateRooms();
      } else if (deleteTarget.kind === 'wp') {
        await networkService.deleteWallPort(deleteTarget.wp._id);
        toast.success('Wall port removed');
        await reloadPanelPorts(deleteTarget.panelId);
      }
    } catch (err: unknown) { toast.error(getApiErrorMessage(err, 'Delete failed')); }
    finally { setDeleteLoading(false); setDeleteTarget(null); }
  };

  const deleteMessage = () => {
    if (!deleteTarget) return '';
    if (deleteTarget.kind === 'room')  return `Delete "${deleteTarget.room.name}" and all its racks and panels?`;
    if (deleteTarget.kind === 'rack')  return `Delete rack "${deleteTarget.rack.name}" and all its patch panels?`;
    if (deleteTarget.kind === 'panel') return `Delete patch panel "${deleteTarget.panel.name}" and unlink its ${panelPorts[deleteTarget.panel._id]?.length ?? 0} wall ports?`;
    if (deleteTarget.kind === 'wp')    return `Remove wall port "${deleteTarget.wp.label}" (port ${deleteTarget.wp.patch_port})?`;
    return '';
  };

  const buildingFloors = (floors as { _id: string; name: string; building_id: string }[]).filter(f => f.building_id === selectedBuildingId);

  if (loadingBuildings) return <div className={styles.loading}><div className={styles.spinner} /><p>Loading…</p></div>;

  return (
    <div className={styles.page} onClick={() => setPortTooltip(null)}>
      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>🔌 Network Infrastructure</h1>
          <p className={styles.subtitle}>Manage IDF closets, server rooms, racks, and patch panels</p>
        </div>
        <div className={styles.headerActions}>
          <select className={styles.buildingSelect} value={selectedBuildingId} onChange={e => setSelectedBuildingId(e.target.value)}>
            {buildings.map(b => <option key={b._id} value={b._id}>{b.name}</option>)}
          </select>
          <div className={styles.portSearchWrap}>
            <input
              ref={portSearchRef}
              className={styles.portSearchInput}
              placeholder="Search wall port…"
              value={portSearch}
              onChange={e => setPortSearch(e.target.value)}
              onFocus={() => setPortSearchFocused(true)}
              onBlur={() => setTimeout(() => setPortSearchFocused(false), 150)}
            />
            {portSearch && (
              <button className={styles.portSearchClear} onClick={() => { setPortSearch(''); portSearchRef.current?.focus(); }}>✕</button>
            )}
            {portSearchFocused && portSearchResults.length > 0 && (
              <div className={styles.portSearchDropdown}>
                {portSearchResults.map(r => {
                  const switchAsset = buildingAssets.find(a => a._id === r.wallPort.switch_asset_id);
                  return (
                    <button
                      key={r.wallPort._id}
                      className={styles.portSearchItem}
                      onMouseDown={() => {
                        setSelectedRoomId(r.room._id);
                        setSelectedRackId(r.rack._id);
                        setPortSearch('');
                      }}
                    >
                      <span className={styles.portSearchLabel}>{r.wallPort.label}</span>
                      <span className={styles.portSearchPath}>
                        {r.panel.name} port {r.wallPort.patch_port}
                        {switchAsset ? ` → ${switchAsset.basic_info?.display_name}${r.wallPort.switch_port ? ` ${r.wallPort.switch_port}` : ''}` : ''}
                        {' · '}{r.room.name}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <Button variant="primary" onClick={() => openModal({ kind: 'room' })}>+ Add Room</Button>
        </div>
      </div>

      <div className={styles.layout}>
        {/* Room list */}
        <div className={styles.roomList}>
          {rooms.length === 0 && (
            <div className={styles.empty}>
              <p>No network rooms in this building.</p>
              <Button variant="secondary" size="sm" onClick={() => openModal({ kind: 'room' })}>Add first room</Button>
            </div>
          )}
          {rooms.map(room => (
            <div
              key={room._id}
              className={`${styles.roomCard} ${selectedRoom?._id === room._id ? styles.roomCardActive : ''}`}
              onClick={() => { setSelectedRoomId(room._id); setSelectedRackId(null); }}
            >
              <div className={styles.roomCardHeader}>
                <span className={`${styles.roomBadge} ${room.type === 'mdf' ? styles.roomBadgeMdf : styles.roomBadgeIdf}`}>
                  {room.type.toUpperCase()}
                </span>
                <span className={styles.roomName}>{room.name}</span>
                <div className={styles.roomCardActions}>
                  <button className={styles.iconBtn} onClick={e => { e.stopPropagation(); openModal({ kind: 'room', room }); }} title="Edit room">✏️</button>
                  <button className={styles.iconBtn} onClick={e => { e.stopPropagation(); setDeleteTarget({ kind: 'room', room }); }} title="Delete room">🗑️</button>
                </div>
              </div>
              <div className={styles.roomMeta}>
                {room.floor_id ? `Floor: ${floorName(room.floor_id)}` : buildingName(room.building_id)}
                {' · '}{room.racks.length} rack{room.racks.length !== 1 ? 's' : ''}
              </div>
            </div>
          ))}
        </div>

        {/* Rack view */}
        <div className={styles.rackView}>
          {!selectedRoom ? (
            <div className={styles.empty}>Select a room to view its racks</div>
          ) : (
            <>
              <div className={styles.panelHeader}>
                <h2>{selectedRoom.name}</h2>
                <Button variant="secondary" size="sm" onClick={() => openModal({ kind: 'rack', room: selectedRoom })}>+ Add Rack</Button>
              </div>
              {selectedRoom.racks.length === 0 && (
                <div className={styles.empty}>
                  <p>No racks in this room yet.</p>
                  <Button variant="secondary" size="sm" onClick={() => openModal({ kind: 'rack', room: selectedRoom })}>
                    + Add the first rack
                  </Button>
                </div>
              )}
              <div className={styles.racks}>
                {selectedRoom.racks.map(rack => (
                  <div
                    key={rack._id}
                    className={`${styles.rack} ${selectedRack?._id === rack._id ? styles.rackActive : ''}`}
                    onClick={() => setSelectedRackId(rack._id)}
                  >
                    <div className={styles.rackHeader}>
                      <span className={styles.rackIcon}>🗄️</span>
                      <span className={styles.rackName}>{rack.name}</span>
                      <span className={styles.rackU}>{rack.u_count}U</span>
                      <div className={styles.rackActions}>
                        <button className={styles.iconBtn} onClick={e => { e.stopPropagation(); setAutoPatchRack(rack); }} title="Patch this rack's sockets from their labels (R1/001 → first panel, port 1)">🪄</button>
                        <button className={styles.iconBtn} onClick={e => { e.stopPropagation(); openModal({ kind: 'rack', room: selectedRoom, rack }); }} title="Edit rack">✏️</button>
                        {selectedRoom.racks.length > 1 && (
                          <button className={styles.iconBtn} onClick={e => { e.stopPropagation(); openModal({ kind: 'replaceRack', room: selectedRoom, rack }); }} title="Replace rack (moves patch panels and mounted assets to a replacement cabinet)">🔁</button>
                        )}
                        <button className={styles.iconBtn} onClick={e => { e.stopPropagation(); setDeleteTarget({ kind: 'rack', rack }); }} title="Delete rack">🗑️</button>
                      </div>
                    </div>
                    <div className={styles.rackMeta}>
                      {rack.patch_panels.length} patch panel{rack.patch_panels.length !== 1 ? 's' : ''}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Patch panel detail view */}
        <div className={styles.detailView} ref={splitContainerRef}>
          {!selectedRack ? (
            <div className={styles.empty}>Select a rack to view patch panels</div>
          ) : (
            <>
              {/* Top pane: Patch Panels */}
              <div className={styles.splitTop} style={{ flex: splitPct }}>
                <div className={styles.panelHeader}>
                  <h2>{selectedRack.name} — Patch Panels</h2>
                  <Button variant="secondary" size="sm" onClick={() => openModal({ kind: 'panel', rack: selectedRack })}>+ Add Panel</Button>
                </div>
                {selectedRack.patch_panels.length === 0 && (
                  <div className={styles.empty}>
                    <p>No patch panels in this rack yet — sockets are patched onto panel ports.</p>
                    <Button variant="secondary" size="sm" onClick={() => openModal({ kind: 'panel', rack: selectedRack })}>
                      + Add the first panel
                    </Button>
                  </div>
                )}
                <div className={styles.panelList}>
                  {selectedRack.patch_panels.map(panel => {
                    const ports = panelPorts[panel._id] ?? [];
                    const usedCount = ports.filter(w => w.patch_port != null).length;
                    return (
                      <Card key={panel._id} className={styles.panelCard}>
                        <div className={styles.panelCardHeader}>
                          <div className={styles.panelCardMeta}>
                            <strong>{panel.name}</strong>
                            {panel.u_position != null && <span className={styles.uLabel}>U{panel.u_position}</span>}
                            <span className={`${styles.cableTag} ${styles[panel.cable_type]}`}>
                              {panel.cable_type}
                            </span>
                            <span className={styles.portUsage}>
                              {usedCount}/{panel.port_count} used
                            </span>
                          </div>
                          <div className={styles.panelCardActions}>
                            <button className={styles.iconBtn} onClick={() => openModal({ kind: 'panel', rack: selectedRack, panel })} title="Edit panel">✏️</button>
                            {selectedRack.patch_panels.length > 1 && (
                              <button className={styles.iconBtn} onClick={() => openModal({ kind: 'replacePanel', rack: selectedRack, panel })} title="Replace patch panel (moves its wall ports to a replacement panel)">🔁</button>
                            )}
                            <button className={styles.iconBtn} onClick={() => setDeleteTarget({ kind: 'panel', panel, rack: selectedRack })} title="Delete panel">🗑️</button>
                          </div>
                        </div>

                        {panel.description && (
                          <p className={styles.panelDesc}>{panel.description}</p>
                        )}

                        <div className={styles.portGrid}>
                          {Array.from({ length: panel.port_count }, (_, i) => {
                            const portNum = i + 1;
                            const wp = ports.find(w => w.patch_port === portNum);
                            return (
                              <div
                                key={portNum}
                                className={`${styles.port} ${wp ? styles.portUsed : styles.portFree}`}
                                title={wp ? `${wp.label} — click to edit` : `Port ${portNum} — click to assign wall port`}
                                onMouseEnter={wp ? (e) => {
                                  e.stopPropagation();
                                  setPortTooltip({ port: wp, x: e.clientX, y: e.clientY });
                                } : undefined}
                                onMouseLeave={wp ? () => setPortTooltip(null) : undefined}
                                onClick={e => {
                                  e.stopPropagation();
                                  setPortTooltip(null);
                                  openModal({ kind: 'wallport', panel, portNum, existing: wp });
                                }}
                              >
                                {portNum}
                              </div>
                            );
                          })}
                        </div>

                        <div className={styles.portLegend}>
                          <span className={`${styles.legendDot} ${styles.legendUsed}`} /> Connected
                          <span className={`${styles.legendDot} ${styles.legendFree}`} /> Free
                        </div>
                      </Card>
                    );
                  })}
                </div>
              </div>

              {/* Draggable divider */}
              <div className={styles.splitDivider} onMouseDown={handleDividerMouseDown}>
                <div className={styles.splitGrip} />
                <div className={styles.snapButtons}>
                  {[25, 50, 75].map(p => (
                    <button key={p} onMouseDown={e => e.stopPropagation()} onClick={() => handleSnapPct(p)}>
                      {p}%
                    </button>
                  ))}
                </div>
              </div>

              {/* Bottom pane: Rack Devices */}
              <div className={styles.splitBottom} style={{ flex: 100 - splitPct }}>
                <div className={styles.panelHeader}>
                  <h2>{selectedRack.name} — Rack Devices</h2>
                </div>
                <div className={styles.rackDiagramWrap}>
                  {rackAssets.length === 0 ? (
                    <div className={styles.empty}>
                      {/* Named the database column and the page it is not on. The form
                          now has a Rack mount section, so this can point at it. */}
                      No devices mounted in this rack yet. Open a device, edit it, and
                      pick this rack under <strong>Rack mount</strong>.
                    </div>
                  ) : (
                    <RackDiagram
                      rack={selectedRack}
                      assets={rackAssets}
                      onRefresh={() => loadRackAssets(selectedRack._id)}
                    />
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Port tooltip */}
      {portTooltip && (
        <div
          ref={tooltipRef}
          className={styles.portTooltip}
          style={{ left: portTooltip.x + 12, top: portTooltip.y - 8 }}
          onClick={e => e.stopPropagation()}
        >
          <div className={styles.tooltipLabel}>🔌 {portTooltip.port.label}</div>
          <div className={styles.tooltipRow}><span>Panel port</span><strong>#{portTooltip.port.patch_port}</strong></div>
          {portTooltip.port.switch_asset_id && (
            <div className={styles.tooltipRow}>
              <span>Switch</span>
              <strong>{buildingAssets.find(a => a._id === portTooltip.port.switch_asset_id)?.basic_info?.display_name ?? portTooltip.port.switch_asset_id}</strong>
            </div>
          )}
          {portTooltip.port.switch_port && (
            <div className={styles.tooltipRow}><span>Switch port</span><strong>{portTooltip.port.switch_port}</strong></div>
          )}
          {portTooltip.port.room_name && (
            <div className={styles.tooltipRow}><span>Room</span><strong>{portTooltip.port.room_name}</strong></div>
          )}
          {portTooltip.port.description && (
            <div className={styles.tooltipDesc}>{portTooltip.port.description}</div>
          )}
        </div>
      )}

      {/* Modal */}
      {modal.kind !== 'none' && (
        <div className={styles.modalOverlay} onClick={closeModal}>
          <div className={styles.modal} onClick={e => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <div>
                <h3>
                  {modal.kind === 'room'         ? (modal.room     ? 'Edit Room'        : 'New Network Room') :
                   modal.kind === 'rack'         ? (modal.rack     ? 'Edit Rack'        : `New Rack in ${modal.room.name}`) :
                   modal.kind === 'wallport'     ? (modal.existing  ? 'Edit Wall Port'  : `Assign Wall Port — Port ${modal.portNum}`) :
                   modal.kind === 'replaceRack'  ? `Replace Rack "${modal.rack.name}"` :
                   modal.kind === 'replacePanel' ? `Replace Patch Panel "${modal.panel.name}"` :
                                                   (modal.panel    ? 'Edit Patch Panel' : `New Panel in ${modal.rack.name}`)}
                </h3>
                {modal.kind === 'panel' && !modal.panel && (
                  <p className={styles.modalSubtitle}>
                    {modal.rack.network_room_id ? `${selectedRoom?.name ?? ''} · ` : ''}
                    {modal.rack.u_count}U rack
                  </p>
                )}
                {modal.kind === 'wallport' && (
                  <p className={styles.modalSubtitle}>
                    {modal.panel.name} · patch port {modal.portNum}
                  </p>
                )}
              </div>
              <button className={styles.modalClose} onClick={closeModal}>✕</button>
            </div>
            <div className={styles.modalBody}>
              {modal.kind !== 'replaceRack' && modal.kind !== 'replacePanel' && (
                <>
                  <label className={styles.formLabel}>Name *</label>
                  <input
                    className={styles.formInput}
                    value={form.name ?? ''}
                    onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                    placeholder={
                      modal.kind === 'room'  ? 'e.g. IDF-Floor2, MDF-W1' :
                      modal.kind === 'rack'  ? 'e.g. RACK-GF-01' :
                                              'e.g. PP-GF-PROD-01'
                    }
                    autoFocus
                  />
                </>
              )}

              {modal.kind === 'replaceRack' && (
                <>
                  <p className={styles.formHint}>
                    Every patch panel and mounted asset currently in <strong>{modal.rack.name}</strong> will
                    be moved to the replacement rack, keeping their U-positions. The old rack is then removed.
                  </p>
                  <label className={styles.formLabel}>Replacement rack *</label>
                  <select className={styles.formInput} value={form.replacement_id ?? ''} onChange={e => setForm(p => ({ ...p, replacement_id: e.target.value }))} autoFocus>
                    <option value="">— Select replacement rack —</option>
                    {modal.room.racks.filter(r => r._id !== modal.rack._id).map(r => (
                      <option key={r._id} value={r._id}>{r.name} ({r.u_count}U)</option>
                    ))}
                  </select>
                </>
              )}

              {modal.kind === 'replacePanel' && (
                <>
                  <p className={styles.formHint}>
                    Every wall port wired into <strong>{modal.panel.name}</strong> will be moved to the
                    replacement panel, keeping their port numbers. The old panel is then removed.
                  </p>
                  <label className={styles.formLabel}>Replacement patch panel *</label>
                  <select className={styles.formInput} value={form.replacement_id ?? ''} onChange={e => setForm(p => ({ ...p, replacement_id: e.target.value }))} autoFocus>
                    <option value="">— Select replacement panel —</option>
                    {modal.rack.patch_panels.filter(p => p._id !== modal.panel._id).map(p => (
                      <option key={p._id} value={p._id}>{p.name}{p.u_position != null ? ` (U${p.u_position})` : ''}</option>
                    ))}
                  </select>
                </>
              )}

              {modal.kind === 'room' && (
                <>
                  <label className={styles.formLabel}>Type</label>
                  <select className={styles.formInput} value={form.type ?? 'idf'} onChange={e => setForm(p => ({ ...p, type: e.target.value }))}>
                    <option value="idf">IDF — Floor network closet</option>
                    <option value="mdf">MDF — Main distribution / server room</option>
                  </select>
                  <label className={styles.formLabel}>Floor (where this room is physically located)</label>
                  <select className={styles.formInput} value={form.floor_id ?? ''} onChange={e => setForm(p => ({ ...p, floor_id: e.target.value }))}>
                    <option value="">— Building-level / unspecified —</option>
                    {buildingFloors.map(f => <option key={f._id} value={f._id}>{f.name}</option>)}
                  </select>
                  <label className={styles.formLabel}>Redundant pair (optional MDF ↔ MDF)</label>
                  <select className={styles.formInput} value={form.redundant_pair_id ?? ''} onChange={e => setForm(p => ({ ...p, redundant_pair_id: e.target.value }))}>
                    <option value="">— None —</option>
                    {rooms.filter(r => r.type === 'mdf' && r._id !== modal.room?._id).map(r => <option key={r._id} value={r._id}>{r.name}</option>)}
                  </select>
                  <label className={styles.formLabel}>Description</label>
                  <input className={styles.formInput} value={form.description ?? ''} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} placeholder="Optional description" />
                </>
              )}

              {modal.kind === 'rack' && (
                <>
                  <label className={styles.formLabel}>U Count (rack height)</label>
                  <input className={styles.formInput} type="number" min={1} max={100} value={form.u_count ?? '42'} onChange={e => setForm(p => ({ ...p, u_count: e.target.value }))} />
                  <label className={styles.formLabel}>Description</label>
                  <input className={styles.formInput} value={form.description ?? ''} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} placeholder="Optional description" />
                </>
              )}

              {modal.kind === 'panel' && (
                <>
                  <label className={styles.formLabel}>U Position in rack (1 = top)</label>
                  <input
                    className={styles.formInput}
                    type="number"
                    min={1}
                    max={modal.rack.u_count}
                    value={form.u_position ?? ''}
                    onChange={e => setForm(p => ({ ...p, u_position: e.target.value }))}
                    placeholder={`1 – ${modal.rack.u_count}`}
                  />
                  <label className={styles.formLabel}>Port count</label>
                  <select className={styles.formInput} value={form.port_count ?? '24'} onChange={e => setForm(p => ({ ...p, port_count: e.target.value }))}>
                    {[6, 12, 16, 24, 48, 96].map(n => <option key={n} value={n}>{n} ports</option>)}
                  </select>
                  <label className={styles.formLabel}>Cable type</label>
                  <select className={styles.formInput} value={form.cable_type ?? 'copper'} onChange={e => setForm(p => ({ ...p, cable_type: e.target.value }))}>
                    <option value="copper">Copper — RJ45 / Cat5e / Cat6</option>
                    <option value="fiber">Fiber — LC / SC duplex</option>
                    <option value="mixed">Mixed — copper + fiber ports</option>
                  </select>
                  <label className={styles.formLabel}>Description</label>
                  <input className={styles.formInput} value={form.description ?? ''} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} placeholder="e.g. Production floor drops, Gi0/1–24" />
                </>
              )}

              {modal.kind === 'wallport' && (
                <>
                  {!modal.existing && (
                    <>
                      <label className={styles.formLabel}>Which socket lands on this port?</label>
                      <select
                        className={styles.formInput}
                        value={form.attach_socket_id ?? ''}
                        onChange={e => setForm(p => ({ ...p, attach_socket_id: e.target.value }))}
                        autoFocus
                      >
                        <option value="">— Create a new socket —</option>
                        {unpatchedSockets.map(wp => (
                          <option key={wp._id} value={wp._id}>
                            {wp.label}{wp.workarea ? ` · ${wp.workarea.name}` : ''}
                          </option>
                        ))}
                      </select>
                      <p className={styles.formHint} style={{ marginTop: '-8px' }}>
                        {unpatchedSockets.length > 0
                          ? 'Sockets already surveyed on this building’s floors that aren’t patched yet.'
                          : 'No unpatched sockets recorded in this building — add them from the floor page, or create one here.'}
                      </p>
                    </>
                  )}

                  {(modal.existing || !form.attach_socket_id) && (
                    <>
                      <label className={styles.formLabel}>Label *  <span className={styles.formHint}>(identifier printed on the wall socket)</span></label>
                      <input
                        className={styles.formInput}
                        value={form.label ?? ''}
                        onChange={e => setForm(p => ({ ...p, label: e.target.value }))}
                        placeholder="e.g. R1/001"
                      />
                      <label className={styles.formLabel}>Floor where this socket is physically located *</label>
                      <select className={styles.formInput} value={form.floor_id ?? ''} onChange={e => setForm(p => ({ ...p, floor_id: e.target.value }))}>
                        <option value="">— Select floor —</option>
                        {(floors as { _id: string; name: string; building_id: string }[]).map(f => (
                          <option key={f._id} value={f._id}>{f.name}</option>
                        ))}
                      </select>
                      <p className={styles.formHint} style={{ marginTop: '-8px' }}>
                        The rack and patch panel can be on a different floor — that is fine.
                      </p>
                    </>
                  )}
                  <label className={styles.formLabel}>Switch / uplink device (optional)</label>
                  <select
                    className={styles.formInput}
                    value={form.switch_asset_id ?? ''}
                    onChange={e => setForm(p => ({ ...p, switch_asset_id: e.target.value }))}
                  >
                    <option value="">— None —</option>
                    {buildingAssets.map(a => (
                      <option key={a._id} value={a._id}>{a.basic_info?.display_name ?? a._id}</option>
                    ))}
                  </select>
                  <label className={styles.formLabel}>Switch port identifier (optional)</label>
                  <input
                    className={styles.formInput}
                    value={form.switch_port ?? ''}
                    onChange={e => setForm(p => ({ ...p, switch_port: e.target.value }))}
                    placeholder="e.g. Gi1/0/5, Fa0/12"
                  />
                  <label className={styles.formLabel}>Description (optional)</label>
                  <input
                    className={styles.formInput}
                    value={form.description ?? ''}
                    onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                    placeholder="e.g. Assembly line row A, station 1"
                  />
                  {!modal.existing && !form.attach_socket_id && (
                    <p className={styles.formHint}>
                      Sockets aren’t drawn on the floor map — assign this one to a room
                      from the floor page so “find a free socket in this room” works.
                    </p>
                  )}
                </>
              )}
            </div>
            <div className={styles.modalFooter}>
              {modal.kind === 'wallport' && modal.existing && (
                <Button variant="danger" onClick={() => { closeModal(); setDeleteTarget({ kind: 'wp', wp: modal.existing!, panelId: (modal as { panel: PatchPanel }).panel._id }); }} disabled={saving}>
                  Remove
                </Button>
              )}
              <Button variant="secondary" onClick={closeModal} disabled={saving}>Cancel</Button>
              <Button variant="primary" onClick={handleSave}
                disabled={saving || (
                  modal.kind === 'wallport' ? (!form.attach_socket_id && (!form.label?.trim() || !form.floor_id)) :
                  modal.kind === 'replaceRack' || modal.kind === 'replacePanel' ? !form.replacement_id :
                  !form.name?.trim()
                )}>
                {saving ? 'Saving…' : (
                  modal.kind === 'room'         ? (modal.room     ? 'Update Room'     : 'Create Room') :
                  modal.kind === 'rack'         ? (modal.rack     ? 'Update Rack'     : 'Create Rack') :
                  modal.kind === 'wallport'     ? (modal.existing ? 'Update Wall Port' : form.attach_socket_id ? 'Patch Socket' : 'Create Wall Port') :
                  modal.kind === 'replaceRack'  ? 'Replace Rack' :
                  modal.kind === 'replacePanel' ? 'Replace Panel' :
                                                  (modal.panel    ? 'Update Panel'    : 'Create Panel')
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      {autoPatchRack && (
        <AutoPatchModal
          isOpen
          onClose={() => setAutoPatchRack(null)}
          onSuccess={async () => {
            // Reload every panel of this rack — the patching touched several.
            await Promise.all((autoPatchRack.patch_panels ?? []).map(panel => reloadPanelPorts(panel._id)));
            await invalidateRooms();
          }}
          rackId={autoPatchRack._id}
          rackName={autoPatchRack.name}
        />
      )}

      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleConfirmDelete}
        title="Confirm Delete"
        message={deleteMessage()}
        confirmText="Delete"
        loading={deleteLoading}
      />
    </div>
  );
};

export default NetworkInfrastructure;
