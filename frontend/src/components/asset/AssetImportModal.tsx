/**
 * AssetImportModal.tsx — User-friendly 3-step bulk CSV import for assets.
 *
 * Steps:
 *   1. Upload  — drag-and-drop or file picker; download template
 *   2. Preview — per-row validation table; hierarchy name resolution; errors inline
 *   3. Done    — success/failure summary with per-row details
 *
 * Hierarchy columns (building, floor, workarea, section, workstation) are
 * resolved by name against the live API so users never have to deal with UUIDs.
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Upload, Download, CheckCircle2, AlertTriangle, XCircle, FileText,
} from 'lucide-react';
import Modal from '../common/Modal';
import Button from '../common/Button';
import Badge from '../common/Badge';
import { assetService } from '../../services/asset.service';
import { hierarchyService } from '../../services/hierarchy.service';
import api from '../../services/api';
import styles from '../../styles/components/AssetImportModal.module.css';

// ─── types ──────────────────────────────────────────────────────────────────

interface AssetImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  defaultBuildingId?: string;
  defaultFloorId?: string;
}

interface HierarchyMaps {
  buildings: Map<string, string>;  // name.toLowerCase() → id
  floors:    Map<string, string>;
  workareas: Map<string, string>;
  sections:  Map<string, string>;
  workstations: Map<string, string>;
}

type RowStatus = 'valid' | 'warning' | 'error';

interface ParsedRow {
  // raw CSV values
  display_name: string;
  asset_tag: string;
  serial_number: string;
  model: string;
  manufacturer: string;
  status: string;
  asset_type: string;
  os_type: string;
  os_version: string;
  ip_address: string;
  hostname: string;
  mac_address: string;
  vlan: string;
  person_full_name: string;
  building: string;
  floor: string;
  workarea: string;
  section: string;
  workstation: string;
  maint_last_date: string;
  maint_next_date: string;
  maint_interval_days: string;
  notes: string;
  tags: string;
  // resolved
  _building_id: string | null;
  _floor_id: string | null;
  _workarea_id: string | null;
  _section_id: string | null;
  _workstation_id: string | null;
  // validation outcome
  _status: RowStatus;
  _errors: string[];
  _warnings: string[];
}

// ─── constants ───────────────────────────────────────────────────────────────

const VALID_STATUSES = ['active', 'maintenance', 'inactive', 'retired'];
const VALID_OS_TYPES = ['windows', 'linux', 'macos', 'ios', 'android', 'other'];

const COLUMN_ALIASES: Record<string, string> = {
  name: 'display_name',
  asset_name: 'display_name',
  type: 'asset_type',
  serial: 'serial_number',
  tag: 'asset_tag',
  asset_id: 'asset_tag',
  ip: 'ip_address',
  mac: 'mac_address',
  person: 'person_full_name',
  assigned_to: 'person_full_name',
  floor_name: 'floor',
  workarea_name: 'workarea',
  work_area: 'workarea',
  work_area_name: 'workarea',
  section_name: 'section',
  workstation_name: 'workstation',
  maint_last: 'maint_last_date',
  last_maintenance: 'maint_last_date',
  maint_next: 'maint_next_date',
  next_maintenance: 'maint_next_date',
  maint_interval: 'maint_interval_days',
  maintenance_interval: 'maint_interval_days',
};

const TEMPLATE_HEADERS = [
  'display_name', 'asset_tag', 'serial_number', 'manufacturer', 'model',
  'asset_type', 'status', 'os_type', 'os_version',
  'ip_address', 'hostname', 'mac_address', 'vlan',
  'building', 'floor', 'workarea', 'section', 'workstation',
  'person_full_name',
  'maint_last_date', 'maint_next_date', 'maint_interval_days',
  'notes', 'tags',
];

const TEMPLATE_HINTS = [
  '# Required. Friendly display name',
  '# Optional. Barcode / asset tag',
  '# Optional. Hardware serial number',
  '# Optional.',
  '# Optional.',
  '# Optional. E.g. computer, server, printer, switch',
  `# Optional. One of: ${VALID_STATUSES.join(', ')}`,
  `# Optional. One of: ${VALID_OS_TYPES.join(', ')}`,
  '# Optional. E.g. Windows 11 23H2',
  '# Optional. IPv4 address',
  '# Optional.',
  '# Optional. E.g. AA:BB:CC:DD:EE:FF',
  '# Optional.',
  '# Optional. Exact building name',
  '# Optional. Exact floor name',
  '# Optional. Exact work-area name',
  '# Optional. Exact section name',
  '# Optional. Exact workstation name',
  '# Optional. Full name of assigned person',
  '# Optional. YYYY-MM-DD',
  '# Optional. YYYY-MM-DD',
  '# Optional. Days between maintenance',
  '# Optional. Free text notes',
  '# Optional. Comma-separated tags',
];

const TEMPLATE_EXAMPLE = [
  'Workstation-01', 'ASSET-0001', 'SN-XYZ-123', 'Dell', 'OptiPlex 7090',
  'computer', 'active', 'windows', 'Windows 11 23H2',
  '10.0.1.101', 'ws-01', 'AA:BB:CC:DD:EE:01', 'VLAN-100',
  'Factory A', 'Ground Floor', 'Assembly Area', 'Zone 1', 'WS-01',
  'Jane Smith',
  '2025-01-15', '2025-07-15', '180',
  'Primary workstation near assembly line', 'critical,production',
];

// ─── helpers ─────────────────────────────────────────────────────────────────

function buildTemplateCSV(): string {
  const header = TEMPLATE_HEADERS.join(',');
  const example = TEMPLATE_EXAMPLE.map(v => v.includes(',') ? `"${v}"` : v).join(',');
  const hintLines = TEMPLATE_HEADERS.map((h, i) => `# ${h}: ${TEMPLATE_HINTS[i].replace('# ', '')}`).join('\n');
  return `${hintLines}\n${header}\n${example}\n`;
}

function normaliseHeader(raw: string): string {
  const clean = raw.trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
  return COLUMN_ALIASES[clean] ?? clean;
}

function parseCSVLine(line: string): string[] {
  const values: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQuotes = !inQuotes; }
    else if (ch === ',' && !inQuotes) { values.push(cur.trim()); cur = ''; }
    else { cur += ch; }
  }
  values.push(cur.trim());
  return values;
}

function col(row: Record<string, string>, key: string): string {
  return (row[key] ?? '').trim();
}

const reIPv4 = /^(\d{1,3}\.){3}\d{1,3}$/;
const reMAC  = /^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/;
const reDate = /^\d{4}-\d{2}-\d{2}$/;

function validateAndBuild(
  raw: Record<string, string>,
  maps: HierarchyMaps,
  defaultBuildingId?: string,
  defaultFloorId?: string,
): ParsedRow {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Required
  const display_name = col(raw, 'display_name');
  if (!display_name) errors.push('display_name is required');

  // Status normalisation + validation
  const rawStatus = col(raw, 'status');
  const status = rawStatus.toLowerCase();
  if (rawStatus && !VALID_STATUSES.includes(status)) {
    errors.push(`status "${rawStatus}" is invalid — must be one of: ${VALID_STATUSES.join(', ')}`);
  }

  // OS type
  const rawOsType = col(raw, 'os_type');
  const os_type = rawOsType.toLowerCase();
  if (rawOsType && !VALID_OS_TYPES.includes(os_type)) {
    warnings.push(`os_type "${rawOsType}" is unrecognised — accepted values: ${VALID_OS_TYPES.join(', ')}`);
  }

  // IP address
  const ip_address = col(raw, 'ip_address');
  if (ip_address && !reIPv4.test(ip_address)) {
    errors.push(`ip_address "${ip_address}" is not a valid IPv4 address`);
  }

  // MAC address
  const mac_address = col(raw, 'mac_address');
  if (mac_address && !reMAC.test(mac_address)) {
    errors.push(`mac_address "${mac_address}" is not in a valid format (e.g. AA:BB:CC:DD:EE:FF)`);
  }

  // Dates
  const maint_last_date = col(raw, 'maint_last_date');
  if (maint_last_date && !reDate.test(maint_last_date)) {
    errors.push(`maint_last_date "${maint_last_date}" must be YYYY-MM-DD`);
  }
  const maint_next_date = col(raw, 'maint_next_date');
  if (maint_next_date && !reDate.test(maint_next_date)) {
    errors.push(`maint_next_date "${maint_next_date}" must be YYYY-MM-DD`);
  }

  // Maintenance interval
  const maint_interval_days = col(raw, 'maint_interval_days');
  if (maint_interval_days && (!/^\d+$/.test(maint_interval_days) || parseInt(maint_interval_days) < 1)) {
    errors.push(`maint_interval_days "${maint_interval_days}" must be a positive whole number`);
  }

  // Hierarchy resolution
  const buildingName = col(raw, 'building');
  const floorName    = col(raw, 'floor');
  const workareaName = col(raw, 'workarea');
  const sectionName  = col(raw, 'section');
  const wsName       = col(raw, 'workstation');

  let building_id = defaultBuildingId ?? null;
  let floor_id    = defaultFloorId ?? null;
  let workarea_id: string | null = null;
  let section_id:  string | null = null;
  let workstation_id: string | null = null;

  if (buildingName) {
    const resolved = maps.buildings.get(buildingName.toLowerCase()) ?? null;
    if (resolved) { building_id = resolved; }
    else { warnings.push(`Building "${buildingName}" not found — asset will be saved without a building`); }
  }
  if (floorName) {
    const resolved = maps.floors.get(floorName.toLowerCase()) ?? null;
    if (resolved) { floor_id = resolved; }
    else { warnings.push(`Floor "${floorName}" not found — asset will be saved without a floor`); }
  }
  if (workareaName) {
    const resolved = maps.workareas.get(workareaName.toLowerCase()) ?? null;
    if (resolved) { workarea_id = resolved; }
    else { warnings.push(`Work area "${workareaName}" not found`); }
  }
  if (sectionName) {
    const resolved = maps.sections.get(sectionName.toLowerCase()) ?? null;
    if (resolved) { section_id = resolved; }
    else { warnings.push(`Section "${sectionName}" not found`); }
  }
  if (wsName) {
    const resolved = maps.workstations.get(wsName.toLowerCase()) ?? null;
    if (resolved) { workstation_id = resolved; }
    else { warnings.push(`Workstation "${wsName}" not found`); }
  }

  const _status: RowStatus =
    errors.length > 0 ? 'error' : warnings.length > 0 ? 'warning' : 'valid';

  return {
    display_name,
    asset_tag:          col(raw, 'asset_tag'),
    serial_number:      col(raw, 'serial_number'),
    model:              col(raw, 'model'),
    manufacturer:       col(raw, 'manufacturer'),
    status,
    asset_type:         col(raw, 'asset_type'),
    os_type,
    os_version:         col(raw, 'os_version'),
    ip_address,
    hostname:           col(raw, 'hostname'),
    mac_address,
    vlan:               col(raw, 'vlan'),
    person_full_name:   col(raw, 'person_full_name'),
    building:           buildingName,
    floor:              floorName,
    workarea:           workareaName,
    section:            sectionName,
    workstation:        wsName,
    maint_last_date,
    maint_next_date,
    maint_interval_days,
    notes:              col(raw, 'notes'),
    tags:               col(raw, 'tags'),
    _building_id:       building_id,
    _floor_id:          floor_id,
    _workarea_id:       workarea_id,
    _section_id:        section_id,
    _workstation_id:    workstation_id,
    _status,
    _errors:   errors,
    _warnings: warnings,
  };
}

function rowToApiAsset(row: ParsedRow) {
  return {
    basic_info: {
      display_name:  row.display_name,
      asset_tag:     row.asset_tag     || undefined,
      serial_number: row.serial_number || undefined,
      model:         row.model         || undefined,
      manufacturer:  row.manufacturer  || undefined,
      type:          row.asset_type    || undefined,
      status:        (row.status as any) || 'active',
      os_type:       row.os_type       || undefined,
      os_version:    row.os_version    || undefined,
    },
    hierarchy: {
      building_id:    row._building_id    || '',
      floor_id:       row._floor_id       || '',
      workarea_id:    row._workarea_id    || '',
      section_id:     row._section_id     || '',
      workstation_id: row._workstation_id || '',
    },
    location: { coordinates: { x: 0, y: 0 } },
    itsm: { hardware_asset_id: null, is_managed: false, last_synced: null, sync_status: 'never' as const },
    ...(row.ip_address || row.hostname || row.mac_address || row.vlan ? {
      network: {
        ip_address:  row.ip_address  || undefined,
        hostname:    row.hostname    || undefined,
        mac_address: row.mac_address || undefined,
        vlan:        row.vlan        || undefined,
      },
    } : {}),
    ...(row.person_full_name ? {
      assigned_person: { person_id: '', full_name: row.person_full_name },
    } : {}),
    ...(row.maint_last_date || row.maint_next_date || row.maint_interval_days ? {
      maintenance: {
        last_date:     row.maint_last_date     || undefined,
        next_date:     row.maint_next_date     || undefined,
        interval_days: row.maint_interval_days ? parseInt(row.maint_interval_days) : undefined,
      },
    } : {}),
    ...(row.notes || row.tags ? {
      custom_fields: {
        notes: row.notes || undefined,
        tags:  row.tags ? row.tags.split(',').map(t => t.trim()).filter(Boolean) : undefined,
      },
    } : {}),
  };
}

// ─── component ───────────────────────────────────────────────────────────────

type Step = 'upload' | 'preview' | 'done';

interface ImportResult {
  succeeded: number;
  failed: number;
  results: Array<{ index: number; success: boolean; error?: string }>;
}

const AssetImportModal: React.FC<AssetImportModalProps> = ({
  isOpen, onClose, onSuccess, defaultBuildingId, defaultFloorId,
}) => {
  const [step, setStep]           = useState<Step>('upload');
  const [rows, setRows]           = useState<ParsedRow[]>([]);
  const [maps, setMaps]           = useState<HierarchyMaps | null>(null);
  const [mapsLoading, setMapsLoading] = useState(false);
  const [dragOver, setDragOver]   = useState(false);
  const [fileName, setFileName]   = useState('');
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const [skipErrors, setSkipErrors] = useState(true);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress]   = useState(0);
  const [result, setResult]       = useState<ImportResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Load hierarchy maps when modal opens
  useEffect(() => {
    if (!isOpen || maps) return;
    setMapsLoading(true);
    Promise.all([
      hierarchyService.getBuildings(),
      api.get('/floors').then(r => r.data.data as Array<{ _id: string; name: string }>),
      api.get('/workareas').then(r => r.data.data as Array<{ _id: string; name: string }>),
      api.get('/sections').then(r => r.data.data as Array<{ _id: string; name: string }>),
      api.get('/workstations').then(r => r.data.data as Array<{ _id: string; name: string }>),
    ]).then(([buildings, floors, workareas, sections, workstations]) => {
      const toMap = (arr: Array<{ _id: string; name: string }>) =>
        new Map(arr.map(x => [x.name.toLowerCase(), x._id]));
      setMaps({
        buildings:   toMap(buildings.map(b => ({ _id: b._id, name: b.name }))),
        floors:      toMap(floors),
        workareas:   toMap(workareas),
        sections:    toMap(sections),
        workstations: toMap(workstations),
      });
    }).catch(() => {
      // Hierarchy lookup failed — imports still work, just without name resolution
      setMaps({
        buildings: new Map(), floors: new Map(), workareas: new Map(),
        sections: new Map(), workstations: new Map(),
      });
    }).finally(() => setMapsLoading(false));
  }, [isOpen, maps]);

  const parseFile = useCallback((text: string, name: string) => {
    const lines = text.split('\n')
      .map(l => l.trimEnd())
      .filter(l => l && !l.startsWith('#'));

    if (lines.length < 2) { alert('File must have a header row and at least one data row.'); return; }

    const headers = parseCSVLine(lines[0]).map(normaliseHeader);
    if (!headers.includes('display_name')) {
      alert(`Missing required column "display_name". Found headers: ${headers.join(', ')}`);
      return;
    }

    const parsed = lines.slice(1).map(line => {
      const values = parseCSVLine(line);
      const raw: Record<string, string> = {};
      headers.forEach((h, i) => { raw[h] = values[i] ?? ''; });
      return validateAndBuild(raw, maps ?? {
        buildings: new Map(), floors: new Map(), workareas: new Map(),
        sections: new Map(), workstations: new Map(),
      }, defaultBuildingId, defaultFloorId);
    });

    setRows(parsed);
    setFileName(name);
    setExpandedRows(new Set());
    setStep('preview');
  }, [maps, defaultBuildingId, defaultFloorId]);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => parseFile(ev.target?.result as string, file.name);
    reader.readAsText(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => parseFile(ev.target?.result as string, file.name);
    reader.readAsText(file);
  };

  const downloadTemplate = () => {
    const blob = new Blob([buildTemplateCSV()], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = 'asset-import-template.csv'; a.click();
    URL.revokeObjectURL(url);
  };

  const toggleRow = (i: number) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      next.has(i) ? next.delete(i) : next.add(i);
      return next;
    });
  };

  const handleImport = async () => {
    const importable = skipErrors
      ? rows.filter(r => r._status !== 'error')
      : rows;
    if (importable.length === 0) return;

    setImporting(true);
    setProgress(0);

    const assets = importable.map(rowToApiAsset);

    // Simulate progress updates during import
    const progressTimer = setInterval(() => {
      setProgress(p => Math.min(p + 5, 90));
    }, 150);

    try {
      const res = await assetService.bulkCreateAssets(assets);
      clearInterval(progressTimer);
      setProgress(100);
      setResult(res);
      if (res.succeeded > 0) onSuccess();
    } catch {
      clearInterval(progressTimer);
      setResult({ succeeded: 0, failed: importable.length, results: [] });
    }

    setImporting(false);
    setStep('done');
  };

  const handleClose = () => {
    setStep('upload');
    setRows([]);
    setFileName('');
    setResult(null);
    setProgress(0);
    setExpandedRows(new Set());
    if (fileInputRef.current) fileInputRef.current.value = '';
    onClose();
  };

  const counts = {
    total:   rows.length,
    valid:   rows.filter(r => r._status === 'valid').length,
    warning: rows.filter(r => r._status === 'warning').length,
    error:   rows.filter(r => r._status === 'error').length,
  };
  const importableCount = skipErrors ? counts.valid + counts.warning : counts.total;

  // ── render ──

  const footer = (
    <>
      {step === 'upload' && (
        <>
          <Button variant="outline" onClick={downloadTemplate}>
            <Download size={14} /> Download Template
          </Button>
          <Button variant="outline" onClick={handleClose}>Cancel</Button>
        </>
      )}
      {step === 'preview' && (
        <>
          <Button variant="outline" onClick={() => { setStep('upload'); setRows([]); setFileName(''); }}>
            ← Back
          </Button>
          <Button variant="outline" onClick={handleClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={handleImport}
            disabled={importableCount === 0 || importing}
            loading={importing}
          >
            Import {importableCount} Asset{importableCount !== 1 ? 's' : ''}
          </Button>
        </>
      )}
      {step === 'done' && (
        <Button variant="primary" onClick={handleClose}>Close</Button>
      )}
    </>
  );

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Bulk Import Assets" width="xl" footer={footer}>
      <div className={styles.container}>

        {/* ── Step indicator ── */}
        <div className={styles.steps}>
          {(['upload', 'preview', 'done'] as Step[]).map((s, i) => (
            <div key={s} className={`${styles.step} ${step === s ? styles.stepActive : ''} ${
              (step === 'preview' && s === 'upload') || step === 'done' ? styles.stepDone : ''
            }`}>
              <span className={styles.stepNum}>{i + 1}</span>
              <span className={styles.stepLabel}>{s === 'upload' ? 'Upload' : s === 'preview' ? 'Preview' : 'Done'}</span>
            </div>
          ))}
        </div>

        {/* ── Step 1: Upload ── */}
        {step === 'upload' && (
          <>
            <div className={styles.templateHint}>
              <FileText size={16} />
              <span>
                Download the <button className={styles.linkBtn} onClick={downloadTemplate}>CSV template</button>{' '}
                to see all supported columns and an example row. Lines starting with <code>#</code> are ignored.
              </span>
            </div>

            <div
              className={`${styles.dropZone} ${dragOver ? styles.dropZoneActive : ''} ${mapsLoading ? styles.dropZoneLoading : ''}`}
              onDragOver={e => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input ref={fileInputRef} type="file" accept=".csv,text/csv" onChange={handleFileInput} className={styles.fileInput} />
              <Upload size={32} className={styles.dropIcon} />
              {mapsLoading
                ? <p>Loading hierarchy data…</p>
                : <><p className={styles.dropPrimary}>Drop CSV file here or <span>browse</span></p>
                    <p className={styles.dropHint}>Only .csv files · max 500 rows</p></>
              }
            </div>

            <div className={styles.fieldGuide}>
              <h4>Supported columns</h4>
              <div className={styles.fieldGrid}>
                <div><strong>Required</strong><ul><li>display_name</li></ul></div>
                <div><strong>Identification</strong><ul><li>asset_tag</li><li>serial_number</li><li>manufacturer</li><li>model</li></ul></div>
                <div><strong>Classification</strong><ul><li>asset_type</li><li>status</li><li>os_type</li><li>os_version</li></ul></div>
                <div><strong>Network</strong><ul><li>ip_address</li><li>hostname</li><li>mac_address</li><li>vlan</li></ul></div>
                <div><strong>Location</strong><ul><li>building</li><li>floor</li><li>workarea</li><li>section</li><li>workstation</li></ul></div>
                <div><strong>Other</strong><ul><li>person_full_name</li><li>maint_last_date</li><li>maint_next_date</li><li>maint_interval_days</li><li>notes</li><li>tags</li></ul></div>
              </div>
            </div>
          </>
        )}

        {/* ── Step 2: Preview ── */}
        {step === 'preview' && (
          <>
            <div className={styles.previewBar}>
              <span className={styles.fileName}>{fileName}</span>
              <div className={styles.badges}>
                <Badge variant="success">{counts.valid} valid</Badge>
                {counts.warning > 0 && <Badge variant="warning">{counts.warning} warning{counts.warning !== 1 ? 's' : ''}</Badge>}
                {counts.error   > 0 && <Badge variant="error">{counts.error} error{counts.error !== 1 ? 's' : ''}</Badge>}
              </div>
            </div>

            {counts.error > 0 && (
              <label className={styles.skipToggle}>
                <input type="checkbox" checked={skipErrors} onChange={e => setSkipErrors(e.target.checked)} />
                Skip rows with errors and import {counts.valid + counts.warning} valid/warning row{counts.valid + counts.warning !== 1 ? 's' : ''}
              </label>
            )}

            <div className={styles.tableWrapper}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th style={{ width: 32 }}></th>
                    <th>#</th>
                    <th>Name</th>
                    <th>Type</th>
                    <th>Status</th>
                    <th>Serial / Tag</th>
                    <th>IP / Host</th>
                    <th>Location</th>
                    <th>Person</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) => {
                    const dimmed = skipErrors && row._status === 'error';
                    const expanded = expandedRows.has(i);
                    const hasMessages = row._errors.length > 0 || row._warnings.length > 0;
                    return (
                      <React.Fragment key={i}>
                        <tr
                          className={`${styles.tableRow} ${styles[`row_${row._status}`]} ${dimmed ? styles.rowDimmed : ''}`}
                          onClick={() => hasMessages && toggleRow(i)}
                          style={{ cursor: hasMessages ? 'pointer' : 'default' }}
                        >
                          <td className={styles.statusCell}>
                            {row._status === 'valid'   && <CheckCircle2  size={14} className={styles.iconValid}   />}
                            {row._status === 'warning' && <AlertTriangle size={14} className={styles.iconWarning} />}
                            {row._status === 'error'   && <XCircle       size={14} className={styles.iconError}   />}
                          </td>
                          <td className={styles.rowNum}>{i + 1}</td>
                          <td className={styles.cellName}>{row.display_name || <em>—</em>}</td>
                          <td>{row.asset_type || '—'}</td>
                          <td>{row.status     || '—'}</td>
                          <td className={styles.cellMono}>{row.serial_number || row.asset_tag || '—'}</td>
                          <td className={styles.cellMono}>{row.ip_address    || row.hostname  || '—'}</td>
                          <td>{[row.building, row.floor, row.workarea].filter(Boolean).join(' › ') || '—'}</td>
                          <td>{row.person_full_name || '—'}</td>
                        </tr>
                        {expanded && hasMessages && (
                          <tr className={styles.expandedRow}>
                            <td colSpan={9}>
                              <div className={styles.messages}>
                                {row._errors.map((e, ei) => (
                                  <div key={ei} className={styles.msgError}>
                                    <XCircle size={12} /> {e}
                                  </div>
                                ))}
                                {row._warnings.map((w, wi) => (
                                  <div key={wi} className={styles.msgWarning}>
                                    <AlertTriangle size={12} /> {w}
                                  </div>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {counts.error > 0 && (
              <p className={styles.hint}>
                Click a row to see its validation details.
              </p>
            )}
          </>
        )}

        {/* ── Importing progress ── */}
        {importing && (
          <div className={styles.progressWrap}>
            <div className={styles.progressBar}>
              <div className={styles.progressFill} style={{ width: `${progress}%` }} />
            </div>
            <p>Importing… {progress}%</p>
          </div>
        )}

        {/* ── Step 3: Done ── */}
        {step === 'done' && result && (
          <div className={styles.result}>
            <div className={styles.resultIcon}>
              {result.failed === 0
                ? <CheckCircle2 size={48} className={styles.iconValid} />
                : <AlertTriangle size={48} className={styles.iconWarning} />
              }
            </div>
            <h3>{result.succeeded} asset{result.succeeded !== 1 ? 's' : ''} imported successfully</h3>
            {result.failed > 0 && (
              <p className={styles.resultFailed}>{result.failed} row{result.failed !== 1 ? 's' : ''} failed</p>
            )}
            {result.results.some(r => !r.success) && (
              <ul className={styles.resultErrors}>
                {result.results.filter(r => !r.success).map(r => (
                  <li key={r.index}><strong>Row {r.index + 1}:</strong> {r.error}</li>
                ))}
              </ul>
            )}
          </div>
        )}

      </div>
    </Modal>
  );
};

export default AssetImportModal;
