import React, { useEffect, useState, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import Card from '../components/common/Card';
import Button from '../components/common/Button';
import ConfirmDialog from '../components/common/ConfirmDialog';
import { networkService, NetworkRoom, NetworkRack, PatchPanel, WallPort } from '../services/network.service';
import { assetService, Asset } from '../services/asset.service';
import { RackDiagram } from '../components/network/RackDiagram';
import { useToast } from '../contexts/ToastContext';
import { useBuildings } from '../hooks/queries/useBuildings';
import { useFloors } from '../hooks/queries/useFloors';
import { useNetworkRooms, networkKeys } from '../hooks/queries/useNetwork';
import styles from '../styles/pages/NetworkInfrastructure.module.css';

type ModalState =
  | { kind: 'none' }
  | { kind: 'room';     room?: NetworkRoom }
  | { kind: 'rack';     room: NetworkRoom; rack?: NetworkRack }
  | { kind: 'panel';    rack: NetworkRack; panel?: PatchPanel }
  | { kind: 'wallport'; panel: PatchPanel; portNum: number; existing?: WallPort };

interface PortTooltip {
  port: WallPort;
  x: number;
  y: number;
}

const NetworkInfrastructure: React.FC = () => {
  const toast = useToast();
  const qc = useQueryClient();

  const { data: buildings = [], isLoading: loadingBuildings } = useBuildings();
  const { data: floors = [] } = useFloors();

  const [selectedBuildingId, setSelectedBuildingId] = useState('');
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [selectedRackId, setSelectedRackId] = useState<string | null>(null);
  const [panelPorts, setPanelPorts] = useState<Record<string, WallPort[]>>({});
  const [buildingAssets, setBuildingAssets] = useState<Asset[]>([]);
  const [rackAssets,     setRackAssets]     = useState<Asset[]>([]);
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

  // Auto-select first building
  useEffect(() => {
    if (buildings.length > 0 && !selectedBuildingId) setSelectedBuildingId(buildings[0]._id);
  }, [buildings, selectedBuildingId]);

  const { data: rooms = [] } = useNetworkRooms(
    selectedBuildingId ? { building_id: selectedBuildingId } : undefined
  );

  const selectedRoom = rooms.find(r => r._id === selectedRoomId) ?? null;
  const selectedRack = selectedRoom?.racks.find(r => r._id === selectedRackId) ?? null;

  // Reset room/rack selection when building changes; load assets for switch picker
  useEffect(() => {
    setSelectedRoomId(null);
    setSelectedRackId(null);
    setPanelPorts({});
    if (selectedBuildingId) {
      assetService.getAssets().then(all => {
        setBuildingAssets(all.filter(a => a.hierarchy?.building_id === selectedBuildingId));
      }).catch(() => {});
    }
  }, [selectedBuildingId]);

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

  const invalidateRooms = () => qc.invalidateQueries({ queryKey: networkKeys.rooms({ building_id: selectedBuildingId }) });

  const floorName = (floorId: string | null) => (floors as { _id: string; name: string }[]).find(f => f._id === floorId)?.name ?? '—';
  const buildingName = (bId: string) => buildings.find(b => b._id === bId)?.name ?? '—';

  const reloadPanelPorts = async (panelId: string) => {
    const ports = await networkService.getWallPorts({ patch_panel_id: panelId });
    setPanelPorts(prev => ({ ...prev, [panelId]: ports }));
  };

  const loadRackAssets = async (rackId: string) => {
    const all = await assetService.getAssetsWithConnections();
    setRackAssets(all.filter(a => a.hierarchy?.rack_id === rackId));
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
          pos_x: modal.existing?.pos_x ?? 500,
          pos_y: modal.existing?.pos_y ?? 400,
        };
        if (modal.existing) {
          await networkService.updateWallPort(modal.existing._id, payload);
          toast.success('Wall port updated');
        } else {
          await networkService.createWallPort(payload);
          toast.success('Wall port created');
        }
        await reloadPanelPorts(modal.panel._id);
      }
      closeModal();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Save failed';
      toast.error(msg);
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
    } catch { toast.error('Delete failed'); }
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
              {selectedRoom.racks.length === 0 && <div className={styles.empty}>No racks. Add the first rack.</div>}
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
                        <button className={styles.iconBtn} onClick={e => { e.stopPropagation(); openModal({ kind: 'rack', room: selectedRoom, rack }); }} title="Edit rack">✏️</button>
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
        <div className={styles.detailView}>
          {!selectedRack ? (
            <div className={styles.empty}>Select a rack to view patch panels</div>
          ) : (
            <>
              <div className={styles.panelHeader}>
                <h2>{selectedRack.name} — Patch Panels</h2>
                <Button variant="secondary" size="sm" onClick={() => openModal({ kind: 'panel', rack: selectedRack })}>+ Add Panel</Button>
              </div>
              {selectedRack.patch_panels.length === 0 && <div className={styles.empty}>No patch panels in this rack.</div>}
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

                      {/* Port legend */}
                      <div className={styles.portLegend}>
                        <span className={`${styles.legendDot} ${styles.legendUsed}`} /> Connected
                        <span className={`${styles.legendDot} ${styles.legendFree}`} /> Free
                      </div>
                    </Card>
                  );
                })}
              </div>

              {/* Rack devices diagram */}
              <div className={styles.panelHeader} style={{ marginTop: 'var(--spacing-xl)' }}>
                <h2>{selectedRack.name} — Rack Devices</h2>
              </div>
              {rackAssets.length === 0 ? (
                <div className={styles.empty}>
                  No rack-mounted assets yet. Set <strong>rack_id</strong> on an asset to place it here.
                </div>
              ) : (
                <RackDiagram
                  rack={selectedRack}
                  assets={rackAssets}
                  onRefresh={() => loadRackAssets(selectedRack._id)}
                />
              )}
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
                  {modal.kind === 'room'     ? (modal.room     ? 'Edit Room'        : 'New Network Room') :
                   modal.kind === 'rack'     ? (modal.rack     ? 'Edit Rack'        : `New Rack in ${modal.room.name}`) :
                   modal.kind === 'wallport' ? (modal.existing  ? 'Edit Wall Port'  : `Assign Wall Port — Port ${modal.portNum}`) :
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
                  <label className={styles.formLabel}>Label *  <span className={styles.formHint}>(identifier printed on the wall socket)</span></label>
                  <input
                    className={styles.formInput}
                    value={form.label ?? ''}
                    onChange={e => setForm(p => ({ ...p, label: e.target.value }))}
                    placeholder="e.g. WP-F1-A01, Drop-12"
                    autoFocus
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
                  {!modal.existing && (
                    <p className={styles.formHint}>
                      The wall port will appear in the centre of the floor map. Drag it to the exact location in Map View.
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
                disabled={saving || (modal.kind === 'wallport' ? !form.label?.trim() || !form.floor_id : !form.name?.trim())}>
                {saving ? 'Saving…' : (
                  modal.kind === 'room'     ? (modal.room     ? 'Update Room'     : 'Create Room') :
                  modal.kind === 'rack'     ? (modal.rack     ? 'Update Rack'     : 'Create Rack') :
                  modal.kind === 'wallport' ? (modal.existing  ? 'Update Wall Port' : 'Create Wall Port') :
                                              (modal.panel    ? 'Update Panel'    : 'Create Panel')
                )}
              </Button>
            </div>
          </div>
        </div>
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
