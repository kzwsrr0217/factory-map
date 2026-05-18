/**
 * AssetCreationWizard.tsx — Multi-step wizard for creating a new asset.
 *
 * Steps:
 *   1. Identify   — name (required), type, status, hardware IDs
 *   2. Location   — building → floor → work area → section cascade + floor minimap
 *   3. Connections— wall port (filtered to selected floor) + device-to-device links
 *   4. Details    — OS, specs, network, person, maintenance, notes
 *   5. Review     — summary cards; click Edit to jump back to any step
 *
 * Every step after "Identify" has a Skip button. The asset is saved on the
 * final Review step (or when "Save now" is clicked from any step). Connections
 * are posted after the asset is created.
 */
import React, { useState, useEffect } from 'react';
import Modal from '../common/Modal';
import Button from '../common/Button';
import Input from '../common/Input';
import Textarea from '../common/Textarea';
import Select from '../common/Select';
import { assetService, Asset, AssetStatus } from '../../services/asset.service';
import { hierarchyService, Building } from '../../services/hierarchy.service';
import { floorService, Floor } from '../../services/floor.service';
import { workareaService, WorkArea } from '../../services/workarea.service';
import { sectionService, Section } from '../../services/section.service';
import { networkService, WallPort } from '../../services/network.service';
import { ASSET_TYPE_OPTIONS } from '../../utils/assetTypes';
import { ASSET_TEMPLATES } from '../../utils/assetTemplates';
import { usePersonSuggestions } from '../../hooks/usePersonSuggestions';
import { useAssetLookups, invalidateLookupCache } from '../../hooks/useAssetLookups';
import { useToast } from '../../contexts/ToastContext';
import styles from '../../styles/components/AssetCreationWizard.module.css';

// ── Local types ───────────────────────────────────────────────────────────────

interface ConnectionDraft {
  tempId: string;
  connected_asset_id: string;
  connected_asset_label: string;
  connection_type: string;
  label: string;
  bidirectional: boolean;
  source_port: string;
  target_port: string;
}

interface AssetOption {
  _id: string;
  label: string;
}

export interface AssetCreationWizardProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  defaultBuildingId?: string;
  defaultFloorId?: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const STEP_LABELS = ['Identify', 'Location', 'Connections', 'Details', 'Review'] as const;
type StepIndex = 0 | 1 | 2 | 3 | 4;

const STATUS_OPTIONS = [
  { value: 'active',       label: 'Active' },
  { value: 'inactive',     label: 'Inactive' },
  { value: 'maintenance',  label: 'Maintenance' },
  { value: 'retired',      label: 'Retired' },
];

const CONN_TYPE_OPTIONS = [
  { value: 'ethernet',    label: 'Ethernet' },
  { value: 'fiber',       label: 'Fiber' },
  { value: 'wifi',        label: 'WiFi' },
  { value: 'usb',         label: 'USB' },
  { value: 'power',       label: 'Power' },
  { value: 'serial',      label: 'Serial' },
  { value: 'network',     label: 'Network' },
  { value: 'dependency',  label: 'Dependency' },
  { value: 'peer',        label: 'Peer' },
  { value: 'other',       label: 'Other' },
];

const EMPTY_FORM = {
  display_name: '',
  manufacturer: '',
  model: '',
  serial_number: '',
  asset_tag: '',
  mac_address: '',
  asset_type: '',
  status: 'active' as AssetStatus,
  os_type: '',
  os_version: '',
  building_id: '',
  floor_id: '',
  workarea_id: '',
  section_id: '',
  coordinates_x: '',
  coordinates_y: '',
  location_description: '',
  person_full_name: '',
  person_id: '',
  cpu: '',
  ram: '',
  storage: '',
  gpu: '',
  ip_address: '',
  hostname: '',
  vlan: '',
  switch_port: '',
  dhcp_static: '',
  physical_condition: '',
  environment: '',
  notes: '',
  tags: '',
  maintenance_last_date: '',
  maintenance_next_date: '',
  maintenance_interval_days: '',
  maintenance_notes: '',
  object_id: '',
  serial_object: '',
  remote_access_tool: '',
  backup_tool: '',
  backup_status: '',
};

// ── Helper: normalise SVG background to a usable img src ─────────────────────

function toImgSrc(bg: string): string {
  if (!bg) return '';
  if (bg.startsWith('data:')) return bg;
  if (bg.trimStart().startsWith('<')) {
    // Raw SVG text → base64 data URL
    try {
      return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(bg)))}`;
    } catch {
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(bg)}`;
    }
  }
  // Assume bare base64 SVG
  return `data:image/svg+xml;base64,${bg}`;
}

// ── Component ─────────────────────────────────────────────────────────────────

const AssetCreationWizard: React.FC<AssetCreationWizardProps> = ({
  isOpen,
  onClose,
  onSuccess,
  defaultBuildingId,
  defaultFloorId,
}) => {
  // ── Wizard state ────────────────────────────────────────────────────────────
  const [step, setStep] = useState<StepIndex>(0);
  const [formData, setFormData] = useState({ ...EMPTY_FORM });
  const [wallPortId, setWallPortId] = useState('');
  const [connections, setConnections] = useState<ConnectionDraft[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  // ── Cascade data ────────────────────────────────────────────────────────────
  const [buildings, setBuildings]   = useState<Building[]>([]);
  const [floors, setFloors]         = useState<Floor[]>([]);
  const [floorSvg, setFloorSvg]     = useState('');
  const [workareas, setWorkareas]   = useState<WorkArea[]>([]);
  const [sections, setSections]     = useState<Section[]>([]);
  const [wallPorts, setWallPorts]   = useState<WallPort[]>([]);
  const [allAssets, setAllAssets]   = useState<AssetOption[]>([]);

  // ── Connection draft inputs ─────────────────────────────────────────────────
  const [connSearch,      setConnSearch]      = useState('');
  const [connType,        setConnType]        = useState('ethernet');
  const [connLabel,       setConnLabel]       = useState('');
  const [connBidi,        setConnBidi]        = useState(true);
  const [connSourcePort,  setConnSourcePort]  = useState('');
  const [connTargetPort,  setConnTargetPort]  = useState('');

  const personSuggestions = usePersonSuggestions();
  const lookups = useAssetLookups();
  const toast = useToast();

  // ── Reset on open ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isOpen) return;
    setStep(0);
    setFormData({ ...EMPTY_FORM, building_id: defaultBuildingId ?? '', floor_id: defaultFloorId ?? '' });
    setWallPortId('');
    setConnections([]);
    setErrors({});
    setFloors([]);
    setFloorSvg('');
    setWorkareas([]);
    setSections([]);
    setWallPorts([]);

    hierarchyService.getBuildings().then(setBuildings).catch(() => {});
    assetService.getAssets().then(assets =>
      setAllAssets(assets.map(a => ({
        _id: a._id,
        label: a.basic_info.display_name +
          (a.custom_fields?.object_id ? ` [${a.custom_fields.object_id}]` : ''),
      })))
    ).catch(() => {});

    // Pre-load floors if a default building is provided
    if (defaultBuildingId) {
      floorService.getFloors(defaultBuildingId).then(setFloors).catch(() => {});
    }
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Cascade: building → floors ──────────────────────────────────────────────
  useEffect(() => {
    if (!formData.building_id) { setFloors([]); return; }
    floorService.getFloors(formData.building_id).then(setFloors).catch(() => {});
  }, [formData.building_id]);

  // ── Cascade: floor → workareas + wall ports + SVG ──────────────────────────
  useEffect(() => {
    if (!formData.floor_id) {
      setWorkareas([]); setFloorSvg(''); setWallPorts([]);
      return;
    }
    workareaService.getWorkAreas(formData.floor_id).then(setWorkareas).catch(() => {});
    networkService.getWallPorts({ floor_id: formData.floor_id }).then(setWallPorts).catch(() => {});
    floorService.getFloor(formData.floor_id)
      .then(f => setFloorSvg(f.svg_background ?? ''))
      .catch(() => setFloorSvg(''));
  }, [formData.floor_id]);

  // ── Cascade: workarea → sections ────────────────────────────────────────────
  useEffect(() => {
    if (!formData.workarea_id) { setSections([]); return; }
    sectionService.getSections(formData.workarea_id).then(setSections).catch(() => {});
  }, [formData.workarea_id]);

  // ── Field helper ────────────────────────────────────────────────────────────
  const setField = (updates: Partial<typeof formData>) =>
    setFormData(prev => ({ ...prev, ...updates }));

  // ── Validation ──────────────────────────────────────────────────────────────
  const validateCurrent = (): boolean => {
    if (step === 0 && !formData.display_name.trim()) {
      setErrors({ display_name: 'Asset name is required' });
      return false;
    }
    setErrors({});
    return true;
  };

  // ── Navigation ──────────────────────────────────────────────────────────────
  const goTo = (target: StepIndex) => {
    if (!validateCurrent()) return;
    setStep(target);
  };
  const handleNext = () => { if (validateCurrent()) setStep(s => Math.min(s + 1, 4) as StepIndex); };
  const handleBack = () => setStep(s => Math.max(s - 1, 0) as StepIndex);
  const handleSkip = () => setStep(s => Math.min(s + 1, 4) as StepIndex);

  // ── Map click → coordinates ─────────────────────────────────────────────────
  const handleMapClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setField({
      coordinates_x: Math.round(((e.clientX - rect.left) / rect.width)  * 1000).toString(),
      coordinates_y: Math.round(((e.clientY - rect.top)  / rect.height) * 800).toString(),
    });
  };

  // ── Build payload ────────────────────────────────────────────────────────────
  const buildPayload = (): Partial<Asset> => {
    const p: Partial<Asset> = {
      basic_info: {
        display_name: formData.display_name,
        manufacturer:  formData.manufacturer  || undefined,
        model:         formData.model         || undefined,
        serial_number: formData.serial_number || undefined,
        asset_tag:     formData.asset_tag     || undefined,
        mac_address:   formData.mac_address   || undefined,
        type:          formData.asset_type    || undefined,
        status:        formData.status        || undefined,
        os_type:       formData.os_type       || undefined,
        os_version:    formData.os_version    || undefined,
      },
      hierarchy: {
        building_id:   formData.building_id   || null,
        floor_id:      formData.floor_id      || null,
        workarea_id:   formData.workarea_id   || null,
        section_id:    formData.section_id    || null,
        workstation_id: null,
      },
      location: {
        coordinates: {
          x: formData.coordinates_x !== '' ? Number(formData.coordinates_x) : 0,
          y: formData.coordinates_y !== '' ? Number(formData.coordinates_y) : 0,
        },
        description: formData.location_description || undefined,
      },
      itsm: {
        itsm_guid: null, hardware_asset_id: null, asset_class: null,
        itsm_modified_at: null, source_of_truth: 'local',
        is_managed: false, last_synced: null, sync_status: 'never',
      },
      wall_port_id: wallPortId || null,
    };

    if (formData.person_full_name && formData.person_id) {
      p.assigned_person = { full_name: formData.person_full_name, person_id: formData.person_id };
    }
    if (formData.cpu || formData.ram || formData.storage || formData.gpu) {
      p.technical_specs = {
        cpu: formData.cpu || undefined, ram: formData.ram || undefined,
        storage: formData.storage || undefined, gpu: formData.gpu || undefined,
      };
    }
    if (formData.ip_address || formData.hostname || formData.vlan || formData.switch_port || formData.dhcp_static) {
      p.network = {
        ip_address:  formData.ip_address  || undefined,
        hostname:    formData.hostname    || undefined,
        vlan:        formData.vlan        || undefined,
        switch_port: formData.switch_port || undefined,
        dhcp_static: (formData.dhcp_static as 'dhcp' | 'static' | 'unknown') || undefined,
      };
    }
    if (formData.maintenance_last_date || formData.maintenance_next_date || formData.maintenance_interval_days) {
      p.maintenance = {
        last_date:    formData.maintenance_last_date     || undefined,
        next_date:    formData.maintenance_next_date     || undefined,
        interval_days: formData.maintenance_interval_days
          ? Number(formData.maintenance_interval_days) : undefined,
        notes: formData.maintenance_notes || undefined,
      };
    }
    if (formData.notes || formData.tags || formData.object_id || formData.serial_object ||
        formData.environment || formData.physical_condition || formData.remote_access_tool ||
        formData.backup_tool || formData.backup_status) {
      p.custom_fields = {
        notes:            formData.notes            || undefined,
        tags:             formData.tags ? formData.tags.split(',').map(t => t.trim()).filter(Boolean) : undefined,
        object_id:        formData.object_id        || undefined,
        serial_object:    formData.serial_object    || undefined,
        environment:      formData.environment      || undefined,
        physical_condition: (formData.physical_condition as 'Good' | 'Fair' | 'Poor') || undefined,
        remote_access_tool: formData.remote_access_tool || undefined,
        backup_tool:      formData.backup_tool      || undefined,
        backup_status:    (formData.backup_status as 'active' | 'inactive' | 'error' | 'not_configured') || undefined,
      };
    }
    return p;
  };

  // ── Save ─────────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!formData.display_name.trim()) { setStep(0); setErrors({ display_name: 'Asset name is required' }); return; }
    setSubmitting(true);
    try {
      const created = await assetService.createAsset(buildPayload());
      for (const conn of connections) {
        await assetService.addConnection(created._id, {
          connected_asset_id: conn.connected_asset_id,
          connection_type:    conn.connection_type,
          label:              conn.label || undefined,
          bidirectional:      conn.bidirectional,
          source_port:        conn.source_port || null,
          target_port:        conn.target_port || null,
        }).catch(() => {});
      }
      invalidateLookupCache();
      onSuccess();
      onClose();
    } catch {
      toast.error('Failed to save asset. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  // ── Add connection draft ──────────────────────────────────────────────────
  const handleAddConnection = () => {
    const matched = allAssets.find(a => a.label === connSearch);
    if (!matched) { toast.error('Select an asset from the list first'); return; }
    setConnections(cs => [...cs, {
      tempId: Date.now().toString(),
      connected_asset_id:    matched._id,
      connected_asset_label: matched.label,
      connection_type: connType,
      label:       connLabel,
      bidirectional: connBidi,
      source_port: connSourcePort.trim(),
      target_port: connTargetPort.trim(),
    }]);
    setConnSearch(''); setConnLabel(''); setConnSourcePort(''); setConnTargetPort('');
  };

  // ── Step renderers ────────────────────────────────────────────────────────

  const renderIdentify = () => (
    <div className={styles.stepBody}>
      <datalist id="wiz-manufacturer">{lookups.manufacturer.map(v => <option key={v} value={v} />)}</datalist>
      <datalist id="wiz-model">{lookups.model.map(v => <option key={v} value={v} />)}</datalist>
      <datalist id="wiz-serial-object">{lookups.serial_object.map(v => <option key={v} value={v} />)}</datalist>

      <div className={styles.section}>
        <p className={styles.sectionLabel}>Quick Template</p>
        <div className={styles.templateGrid}>
          {ASSET_TEMPLATES.map(tpl => (
            <button key={tpl.id} type="button" className={styles.templateBtn}
              onClick={() => setField({
                asset_type:   tpl.defaults.asset_type,
                ...(tpl.defaults.manufacturer != null && { manufacturer: tpl.defaults.manufacturer }),
                ...(tpl.defaults.model        != null && { model:        tpl.defaults.model }),
                ...(tpl.defaults.os_type      != null && { os_type:      tpl.defaults.os_type }),
                ...(tpl.defaults.cpu          != null && { cpu:          tpl.defaults.cpu }),
                ...(tpl.defaults.ram          != null && { ram:          tpl.defaults.ram }),
                ...(tpl.defaults.storage      != null && { storage:      tpl.defaults.storage }),
              })}>
              <span>{tpl.icon}</span>
              <span>{tpl.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className={styles.section}>
        <Input label="Display Name *" placeholder="e.g., Assembly Line PC — Station 4"
          value={formData.display_name}
          onChange={e => { setField({ display_name: e.target.value }); if (errors.display_name) setErrors({}); }}
          error={errors.display_name} />

        <div className={styles.row}>
          <Select value={formData.asset_type} onChange={v => setField({ asset_type: v })}
            options={ASSET_TYPE_OPTIONS} placeholder="Asset Type" />
          <Select value={formData.status} onChange={v => setField({ status: v as AssetStatus })}
            options={STATUS_OPTIONS} placeholder="Status" />
        </div>

        <div className={styles.row}>
          <Input label="Manufacturer" value={formData.manufacturer}
            onChange={e => setField({ manufacturer: e.target.value })}
            list="wiz-manufacturer" placeholder="e.g., Dell" />
          <Input label="Model" value={formData.model}
            onChange={e => setField({ model: e.target.value })}
            list="wiz-model" placeholder="e.g., OptiPlex 7090" />
        </div>

        <div className={styles.row}>
          <Input label="Serial Number" value={formData.serial_number}
            onChange={e => setField({ serial_number: e.target.value })} />
          <Input label="Asset Tag" value={formData.asset_tag}
            onChange={e => setField({ asset_tag: e.target.value })} />
        </div>

        <div className={styles.row}>
          <Input label="Object ID" value={formData.object_id}
            onChange={e => setField({ object_id: e.target.value })}
            placeholder="Local station identifier" />
          <Input label="Serial Object" value={formData.serial_object}
            onChange={e => setField({ serial_object: e.target.value })}
            list="wiz-serial-object" />
        </div>
      </div>
    </div>
  );

  const renderLocation = () => {
    const imgSrc = toImgSrc(floorSvg);
    const hasPin = formData.coordinates_x !== '' && formData.coordinates_y !== '';

    return (
      <div className={styles.stepBody}>
        <div className={styles.section}>
          <Select value={formData.building_id}
            onChange={v => setField({ building_id: v, floor_id: '', workarea_id: '', section_id: '' })}
            options={buildings.map(b => ({ value: b._id, label: b.name }))}
            placeholder="Building" />

          {formData.building_id && (
            <Select value={formData.floor_id}
              onChange={v => setField({ floor_id: v, workarea_id: '', section_id: '' })}
              options={floors.map(f => ({ value: f._id, label: `${f.name} (Floor ${f.floor_number})` }))}
              placeholder="Floor" />
          )}

          {formData.floor_id && workareas.length > 0 && (
            <Select value={formData.workarea_id}
              onChange={v => setField({ workarea_id: v, section_id: '' })}
              options={[{ value: '', label: '— No work area —' }, ...workareas.map(w => ({ value: w._id, label: w.name }))]}
              placeholder="Work Area (optional)" />
          )}

          {formData.workarea_id && sections.length > 0 && (
            <Select value={formData.section_id}
              onChange={v => setField({ section_id: v })}
              options={[{ value: '', label: '— No section —' }, ...sections.map(s => ({ value: s._id, label: s.name }))]}
              placeholder="Section (optional)" />
          )}

          <Textarea label="Location Description" rows={2}
            value={formData.location_description}
            onChange={e => setField({ location_description: e.target.value })}
            placeholder="Additional placement details" />
        </div>

        {imgSrc ? (
          <div className={styles.section}>
            <p className={styles.sectionLabel}>
              Click the map to place the asset
              {hasPin && (
                <span className={styles.coordsBadge}> — ({formData.coordinates_x}, {formData.coordinates_y})</span>
              )}
            </p>
            <div className={styles.minimapWrap} onClick={handleMapClick}>
              <img src={imgSrc} alt="Floor plan" className={styles.minimapImg} draggable={false} />
              {hasPin && (
                <div className={styles.pin} style={{
                  left: `${(Number(formData.coordinates_x) / 1000) * 100}%`,
                  top:  `${(Number(formData.coordinates_y) / 800)  * 100}%`,
                }} />
              )}
            </div>
            <p className={styles.hint}>Or enter coordinates manually:</p>
            <div className={styles.row}>
              <Input label="X (0–1000)" type="number" value={formData.coordinates_x}
                onChange={e => setField({ coordinates_x: e.target.value })} placeholder="0" />
              <Input label="Y (0–800)" type="number" value={formData.coordinates_y}
                onChange={e => setField({ coordinates_y: e.target.value })} placeholder="0" />
            </div>
          </div>
        ) : formData.floor_id ? (
          <div className={styles.section}>
            <p className={styles.hint}>No floor map uploaded yet. You can place the asset on the Map view after saving.</p>
            <div className={styles.row}>
              <Input label="X (0–1000)" type="number" value={formData.coordinates_x}
                onChange={e => setField({ coordinates_x: e.target.value })} />
              <Input label="Y (0–800)" type="number" value={formData.coordinates_y}
                onChange={e => setField({ coordinates_y: e.target.value })} />
            </div>
          </div>
        ) : null}
      </div>
    );
  };

  const renderConnections = () => (
    <div className={styles.stepBody}>
      <div className={styles.section}>
        <p className={styles.sectionLabel}>Wall Port</p>
        {!formData.floor_id && (
          <p className={styles.hint}>Select a floor in the Location step to filter wall ports by floor.</p>
        )}
        {formData.floor_id && wallPorts.length === 0 && (
          <p className={styles.hint}>No wall ports found for this floor. Add them in Network Infrastructure first.</p>
        )}

        <Select value={wallPortId} onChange={setWallPortId}
          options={[
            { value: '', label: '— No wall port —' },
            ...wallPorts.map(wp => ({
              value: wp._id,
              label: `${wp.label}${wp.patch_panel_name ? ` → ${wp.patch_panel_name} port ${wp.patch_port}` : ''}${wp.switch_port ? ` (${wp.switch_port})` : ''}`,
            })),
          ]}
          placeholder="Select wall port (optional)" />

        {wallPortId && (() => {
          const wp = wallPorts.find(w => w._id === wallPortId);
          if (!wp) return null;
          return (
            <div className={styles.wallPortInfo}>
              {wp.patch_panel_name && <span>Panel <strong>{wp.patch_panel_name}</strong>, port {wp.patch_port}</span>}
              {wp.rack_name   && <span> · Rack <strong>{wp.rack_name}</strong></span>}
              {wp.room_name   && <span> · {wp.room_type?.toUpperCase()} <strong>{wp.room_name}</strong></span>}
              {wp.switch_port && <span> · Switch port <strong>{wp.switch_port}</strong></span>}
            </div>
          );
        })()}

        <p className={styles.hint}>
          Wall ports are filtered to the selected floor. The rack and patch panel they terminate at can be anywhere.
        </p>
      </div>

      <div className={styles.section}>
        <p className={styles.sectionLabel}>Device Connections</p>

        {connections.length > 0 && (
          <ul className={styles.connList}>
            {connections.map(c => (
              <li key={c.tempId} className={styles.connItem}>
                <span className={styles.connType}>{c.connection_type}</span>
                <span className={styles.connTarget}>{c.connected_asset_label}</span>
                {c.source_port && <span className={styles.connLabel}>{c.source_port} →</span>}
                {c.target_port && <span className={styles.connLabel}>→ {c.target_port}</span>}
                {c.label && <span className={styles.connLabel}>{c.label}</span>}
                {c.bidirectional && <span className={styles.badge}>↔</span>}
                <button type="button" className={styles.removeBtn}
                  onClick={() => setConnections(cs => cs.filter(x => x.tempId !== c.tempId))}>✕</button>
              </li>
            ))}
          </ul>
        )}

        <div className={styles.addConnRow}>
          <Select value={connType} onChange={setConnType} options={CONN_TYPE_OPTIONS} placeholder="Type" />
          <datalist id="wiz-asset-list">
            {allAssets.map(a => <option key={a._id} value={a.label} />)}
          </datalist>
          <input list="wiz-asset-list" className={styles.assetSearch}
            value={connSearch} onChange={e => setConnSearch(e.target.value)}
            placeholder="Search asset…" />
          <input className={styles.labelInput} value={connSourcePort}
            onChange={e => setConnSourcePort(e.target.value)} placeholder="My port (e.g. Gi0/1)" />
          <input className={styles.labelInput} value={connTargetPort}
            onChange={e => setConnTargetPort(e.target.value)} placeholder="Their port (e.g. eth0)" />
          <input className={styles.labelInput} value={connLabel}
            onChange={e => setConnLabel(e.target.value)} placeholder="Label (optional)" />
          <label className={styles.bidiLabel}>
            <input type="checkbox" checked={connBidi} onChange={e => setConnBidi(e.target.checked)} />
            <span>↔</span>
          </label>
          <Button variant="outline" onClick={handleAddConnection}>Add</Button>
        </div>
      </div>
    </div>
  );

  const renderDetails = () => (
    <div className={styles.stepBody}>
      <datalist id="wiz-os-type">{lookups.os_type.map(v => <option key={v} value={v} />)}</datalist>
      <datalist id="wiz-os-version">{lookups.os_version.map(v => <option key={v} value={v} />)}</datalist>
      <datalist id="wiz-vlan">{lookups.vlan.map(v => <option key={v} value={v} />)}</datalist>
      <datalist id="wiz-environment">{lookups.environment.map(v => <option key={v} value={v} />)}</datalist>
      <datalist id="wiz-remote-access">{lookups.remote_access_tool.map(v => <option key={v} value={v} />)}</datalist>
      <datalist id="wiz-backup-tool">{lookups.backup_tool.map(v => <option key={v} value={v} />)}</datalist>
      <datalist id="wiz-person-names">{personSuggestions.map(p => <option key={p.person_id} value={p.full_name} />)}</datalist>
      <datalist id="wiz-person-ids">{personSuggestions.map(p => <option key={p.person_id} value={p.person_id} />)}</datalist>

      <div className={styles.section}>
        <p className={styles.sectionLabel}>Operating System</p>
        <div className={styles.row}>
          <Input label="OS Type" value={formData.os_type}
            onChange={e => setField({ os_type: e.target.value })} list="wiz-os-type" placeholder="e.g., Windows" />
          <Input label="OS Version" value={formData.os_version}
            onChange={e => setField({ os_version: e.target.value })} list="wiz-os-version" placeholder="e.g., Windows 11 Pro" />
        </div>
      </div>

      <div className={styles.section}>
        <p className={styles.sectionLabel}>Technical Specs</p>
        <div className={styles.row}>
          <Input label="CPU" value={formData.cpu} onChange={e => setField({ cpu: e.target.value })} placeholder="e.g., Intel i7-12700" />
          <Input label="RAM" value={formData.ram} onChange={e => setField({ ram: e.target.value })} placeholder="e.g., 16 GB" />
        </div>
        <div className={styles.row}>
          <Input label="Storage" value={formData.storage} onChange={e => setField({ storage: e.target.value })} placeholder="e.g., 512 GB SSD" />
          <Input label="GPU" value={formData.gpu} onChange={e => setField({ gpu: e.target.value })} placeholder="e.g., Intel UHD 770" />
        </div>
      </div>

      <div className={styles.section}>
        <p className={styles.sectionLabel}>Network</p>
        <div className={styles.row}>
          <Input label="IP Address" value={formData.ip_address}
            onChange={e => setField({ ip_address: e.target.value })} placeholder="e.g., 192.168.1.100" />
          <Input label="Hostname" value={formData.hostname}
            onChange={e => setField({ hostname: e.target.value })} placeholder="e.g., PC-STN-004" />
        </div>
        <div className={styles.row}>
          <Input label="VLAN" value={formData.vlan}
            onChange={e => setField({ vlan: e.target.value })} list="wiz-vlan" placeholder="e.g., VLAN100" />
          <Input label="MAC Address" value={formData.mac_address}
            onChange={e => setField({ mac_address: e.target.value })} placeholder="e.g., AA:BB:CC:DD:EE:FF" />
        </div>
        <Select value={formData.dhcp_static} onChange={v => setField({ dhcp_static: v })}
          options={[{ value: 'dhcp', label: 'DHCP' }, { value: 'static', label: 'Static' }, { value: 'unknown', label: 'Unknown' }]}
          placeholder="IP Assignment" />
      </div>

      <div className={styles.section}>
        <p className={styles.sectionLabel}>Assigned Person</p>
        <div className={styles.row}>
          <Input label="Full Name" value={formData.person_full_name}
            onChange={e => setField({ person_full_name: e.target.value })}
            list="wiz-person-names" placeholder="e.g., János Kovács" />
          <Input label="Person ID" value={formData.person_id}
            onChange={e => setField({ person_id: e.target.value })}
            list="wiz-person-ids" placeholder="e.g., EMP-001" />
        </div>
      </div>

      <div className={styles.section}>
        <p className={styles.sectionLabel}>Maintenance</p>
        <div className={styles.row}>
          <Input label="Last Maintenance" type="date"
            value={formData.maintenance_last_date}
            onChange={e => setField({ maintenance_last_date: e.target.value })} />
          <Input label="Next Maintenance" type="date"
            value={formData.maintenance_next_date}
            onChange={e => setField({ maintenance_next_date: e.target.value })} />
        </div>
        <Input label="Interval (days)" type="number"
          value={formData.maintenance_interval_days}
          onChange={e => setField({ maintenance_interval_days: e.target.value })} placeholder="e.g., 90" />
        <Textarea label="Maintenance Notes" rows={2}
          value={formData.maintenance_notes}
          onChange={e => setField({ maintenance_notes: e.target.value })} />
      </div>

      <div className={styles.section}>
        <p className={styles.sectionLabel}>Additional</p>
        <div className={styles.row}>
          <Input label="Environment" value={formData.environment}
            onChange={e => setField({ environment: e.target.value })} list="wiz-environment" placeholder="e.g., Production" />
          <Select value={formData.physical_condition} onChange={v => setField({ physical_condition: v })}
            options={[{ value: 'Good', label: 'Good' }, { value: 'Fair', label: 'Fair' }, { value: 'Poor', label: 'Poor' }]}
            placeholder="Physical Condition" />
        </div>
        <div className={styles.row}>
          <Input label="Remote Access Tool" value={formData.remote_access_tool}
            onChange={e => setField({ remote_access_tool: e.target.value })} list="wiz-remote-access" />
          <Select value={formData.backup_status} onChange={v => setField({ backup_status: v })}
            options={[{ value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }, { value: 'error', label: 'Error' }, { value: 'not_configured', label: 'Not configured' }]}
            placeholder="Backup Status" />
        </div>
        <Input label="Tags" value={formData.tags}
          onChange={e => setField({ tags: e.target.value })} placeholder="Comma-separated (e.g., critical, line-1)" />
        <Textarea label="Notes" rows={3} value={formData.notes}
          onChange={e => setField({ notes: e.target.value })} />
      </div>
    </div>
  );

  const renderReview = () => {
    const bldg  = buildings.find(b => b._id === formData.building_id);
    const floor = floors.find(f => f._id === formData.floor_id);
    const wa    = workareas.find(w => w._id === formData.workarea_id);
    const sec   = sections.find(s => s._id === formData.section_id);
    const wp    = wallPorts.find(w => w._id === wallPortId);

    const card = (title: string, targetStep: StepIndex, children: React.ReactNode) => (
      <div className={styles.reviewCard}>
        <div className={styles.reviewCardHeader}>
          <span className={styles.reviewCardTitle}>{title}</span>
          <button type="button" className={styles.editLink} onClick={() => goTo(targetStep)}>Edit</button>
        </div>
        {children}
      </div>
    );

    const row = (label: string, value: string) => (
      <div key={label} className={styles.reviewRow}>
        <span className={styles.reviewLabel}>{label}</span>
        <span className={styles.reviewValue}>{value}</span>
      </div>
    );

    const empty = (msg: string) => <p className={styles.reviewEmpty}>{msg}</p>;

    return (
      <div className={styles.stepBody}>
        {card('Identity', 0, <>
          {row('Name', formData.display_name)}
          {formData.asset_type    && row('Type',         formData.asset_type)}
          {formData.status        && row('Status',       formData.status)}
          {formData.manufacturer  && row('Manufacturer', formData.manufacturer)}
          {formData.model         && row('Model',        formData.model)}
          {formData.serial_number && row('Serial',       formData.serial_number)}
          {formData.object_id     && row('Object ID',    formData.object_id)}
        </>)}

        {card('Location', 1, bldg ? <>
          {row('Building',  bldg.name)}
          {floor && row('Floor',     floor.name)}
          {wa    && row('Work Area', wa.name)}
          {sec   && row('Section',   sec.name)}
          {(formData.coordinates_x || formData.coordinates_y) &&
            row('Position', `(${formData.coordinates_x || 0}, ${formData.coordinates_y || 0})`)}
        </> : empty('No location set'))}

        {card('Connections', 2, <>
          {wp ? row('Wall Port', `${wp.label}${wp.patch_panel_name ? ` → ${wp.patch_panel_name}` : ''}${wp.rack_name ? ` / ${wp.rack_name}` : ''}`)
              : empty('No wall port selected')}
          {connections.length > 0
            ? connections.map(c => row(c.connection_type, c.connected_asset_label))
            : empty('No device connections')}
        </>)}

        {card('Details', 3, <>
          {formData.ip_address           && row('IP',               formData.ip_address)}
          {formData.hostname             && row('Hostname',          formData.hostname)}
          {formData.os_type              && row('OS',                `${formData.os_type} ${formData.os_version}`.trim())}
          {formData.person_full_name     && row('Assigned to',       formData.person_full_name)}
          {formData.maintenance_next_date && row('Next Maintenance', formData.maintenance_next_date)}
          {!formData.ip_address && !formData.hostname && !formData.os_type &&
           !formData.person_full_name && !formData.maintenance_next_date &&
            empty('No details added')}
        </>)}
      </div>
    );
  };

  // ── Step progress bar ─────────────────────────────────────────────────────

  const renderStepper = () => (
    <div className={styles.stepper}>
      {STEP_LABELS.map((label, i) => {
        const done   = i < step;
        const active = i === step;
        const reachable = i <= step || (i === step + 1);
        return (
          <button key={i} type="button"
            className={`${styles.stepBtn} ${active ? styles.active : ''} ${done ? styles.done : ''}`}
            onClick={() => { if (reachable) goTo(i as StepIndex); }}
            disabled={!reachable}>
            <span className={styles.stepCircle}>{done ? '✓' : i + 1}</span>
            <span className={styles.stepLabel}>{label}</span>
          </button>
        );
      })}
      <div className={styles.stepTrack}>
        <div className={styles.stepFill} style={{ width: `${(step / 4) * 100}%` }} />
      </div>
    </div>
  );

  // ── Footer ────────────────────────────────────────────────────────────────

  const renderFooter = () => (
    <div className={styles.wizFooter}>
      <div>
        {step > 0 && (
          <Button variant="outline" onClick={handleBack} disabled={submitting}>Back</Button>
        )}
      </div>
      <div className={styles.footerRight}>
        <Button variant="secondary" onClick={onClose} disabled={submitting}>Cancel</Button>
        {step > 0 && step < 4 && (
          <Button variant="outline" onClick={handleSkip} disabled={submitting}>Skip</Button>
        )}
        {step < 4 ? (
          <Button variant="primary" onClick={handleNext} disabled={submitting}>Next</Button>
        ) : (
          <Button variant="primary" onClick={handleSave} loading={submitting}>Create Asset</Button>
        )}
      </div>
    </div>
  );

  // ── Render ────────────────────────────────────────────────────────────────

  const stepContent: Record<StepIndex, () => React.ReactNode> = {
    0: renderIdentify,
    1: renderLocation,
    2: renderConnections,
    3: renderDetails,
    4: renderReview,
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`New Asset — ${STEP_LABELS[step]}`}
      width="lg"
      footer={renderFooter()}
    >
      {renderStepper()}
      {stepContent[step]()}
    </Modal>
  );
};

export default AssetCreationWizard;
