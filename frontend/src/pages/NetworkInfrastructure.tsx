import React, { useEffect, useState, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import Card from '../components/common/Card';
import Button from '../components/common/Button';
import { networkService, NetworkRoom, NetworkRack, PatchPanel, WallPort } from '../services/network.service';
import { useToast } from '../contexts/ToastContext';
import { useBuildings } from '../hooks/queries/useBuildings';
import { useFloors } from '../hooks/queries/useFloors';
import { useNetworkRooms, networkKeys } from '../hooks/queries/useNetwork';
import styles from '../styles/pages/NetworkInfrastructure.module.css';

type ModalState =
  | { kind: 'none' }
  | { kind: 'room'; room?: NetworkRoom }
  | { kind: 'rack'; room: NetworkRoom; rack?: NetworkRack }
  | { kind: 'panel'; rack: NetworkRack; panel?: PatchPanel };

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
  const [portTooltip, setPortTooltip] = useState<PortTooltip | null>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const [modal, setModal] = useState<ModalState>({ kind: 'none' });
  const [form, setForm] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // Auto-select first building
  useEffect(() => {
    if (buildings.length > 0 && !selectedBuildingId) setSelectedBuildingId(buildings[0]._id);
  }, [buildings, selectedBuildingId]);

  const { data: rooms = [] } = useNetworkRooms(
    selectedBuildingId ? { building_id: selectedBuildingId } : undefined
  );

  const selectedRoom = rooms.find(r => r._id === selectedRoomId) ?? null;
  const selectedRack = selectedRoom?.racks.find(r => r._id === selectedRackId) ?? null;

  // Reset room/rack selection when building changes
  useEffect(() => { setSelectedRoomId(null); setSelectedRackId(null); setPanelPorts({}); }, [selectedBuildingId]);

  // Load wall ports for all panels in the selected rack
  useEffect(() => {
    if (!selectedRack || selectedRack.patch_panels.length === 0) { setPanelPorts({}); return; }
    Promise.all(
      selectedRack.patch_panels.map(p => networkService.getWallPorts({ patch_panel_id: p._id }))
    ).then(results => {
      const map: Record<string, WallPort[]> = {};
      selectedRack.patch_panels.forEach((p, i) => { map[p._id] = results[i]; });
      setPanelPorts(map);
    });
  }, [selectedRack]);

  const invalidateRooms = () => qc.invalidateQueries({ queryKey: networkKeys.rooms({ building_id: selectedBuildingId }) });

  const floorName = (floorId: string | null) => (floors as { _id: string; name: string }[]).find(f => f._id === floorId)?.name ?? '—';
  const buildingName = (bId: string) => buildings.find(b => b._id === bId)?.name ?? '—';

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
      }
      closeModal();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Save failed';
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteRoom = async (room: NetworkRoom) => {
    if (!window.confirm(`Delete "${room.name}" and all its racks and panels?`)) return;
    try {
      await networkService.deleteRoom(room._id);
      toast.success('Room deleted');
      if (selectedRoomId === room._id) { setSelectedRoomId(null); setSelectedRackId(null); }
      await invalidateRooms();
    } catch { toast.error('Delete failed'); }
  };

  const handleDeleteRack = async (rack: NetworkRack) => {
    if (!window.confirm(`Delete rack "${rack.name}" and all its patch panels?`)) return;
    try {
      await networkService.deleteRack(rack._id);
      toast.success('Rack deleted');
      if (selectedRackId === rack._id) setSelectedRackId(null);
      await invalidateRooms();
    } catch { toast.error('Delete failed'); }
  };

  const handleDeletePanel = async (panel: PatchPanel, rack: NetworkRack) => {
    if (!window.confirm(`Delete patch panel "${panel.name}" and unlink its ${panelPorts[panel._id]?.length ?? 0} wall ports?`)) return;
    try {
      await networkService.deletePatchPanel(panel._id);
      toast.success('Panel deleted');
      await invalidateRooms();
    } catch { toast.error('Delete failed'); }
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
                  <button className={styles.iconBtn} onClick={e => { e.stopPropagation(); handleDeleteRoom(room); }} title="Delete room">🗑️</button>
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
                        <button className={styles.iconBtn} onClick={e => { e.stopPropagation(); handleDeleteRack(rack); }} title="Delete rack">🗑️</button>
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
                          <button className={styles.iconBtn} onClick={() => handleDeletePanel(panel, selectedRack)} title="Delete panel">🗑️</button>
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
                              onMouseEnter={wp ? (e) => {
                                e.stopPropagation();
                                setPortTooltip({ port: wp, x: e.clientX, y: e.clientY });
                              } : undefined}
                              onMouseLeave={wp ? () => setPortTooltip(null) : undefined}
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
                  {modal.kind === 'room'  ? (modal.room  ? 'Edit Room'        : 'New Network Room') :
                   modal.kind === 'rack'  ? (modal.rack  ? 'Edit Rack'        : `New Rack in ${modal.room.name}`) :
                                            (modal.panel ? 'Edit Patch Panel' : `New Panel in ${modal.rack.name}`)}
                </h3>
                {modal.kind === 'panel' && !modal.panel && (
                  <p className={styles.modalSubtitle}>
                    {modal.rack.network_room_id ? `${selectedRoom?.name ?? ''} · ` : ''}
                    {modal.rack.u_count}U rack
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
            </div>
            <div className={styles.modalFooter}>
              <Button variant="secondary" onClick={closeModal} disabled={saving}>Cancel</Button>
              <Button variant="primary" onClick={handleSave} disabled={!form.name?.trim() || saving}>
                {saving ? 'Saving…' : (
                  modal.kind === 'room'  ? (modal.room  ? 'Update Room'  : 'Create Room') :
                  modal.kind === 'rack'  ? (modal.rack  ? 'Update Rack'  : 'Create Rack') :
                                           (modal.panel ? 'Update Panel' : 'Create Panel')
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default NetworkInfrastructure;
