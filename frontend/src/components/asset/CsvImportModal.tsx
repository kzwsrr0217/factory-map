/**
 * CsvImportModal.tsx — CSV-only bulk asset import variant.
 *
 * Accepts a `.csv` file with a header row. Each data row is parsed client-side
 * into a `ParsedRow` object and previewed in a table. Rows with a missing
 * `display_name` are flagged invalid and skipped during submission.
 *
 * On confirm, valid rows are sent to `assetService.bulkCreate()`. Difference
 * from AssetImportModal: this modal is CSV-only and maps ITSM-style column
 * names (e.g. `hardware_asset_id`, `os_version`, `object_id`).
 */
import React, { useState, useRef } from 'react';
import { FolderOpen, CheckCircle2, AlertTriangle } from 'lucide-react';
import Modal from '../common/Modal';
import Button from '../common/Button';
import Badge from '../common/Badge';
import { assetService } from '../../services/asset.service';
import styles from '../../styles/components/AssetImportModal.module.css';

interface CsvImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  defaultFloorId?: string;
  defaultBuildingId?: string;
}

interface ParsedRow {
  display_name: string;
  manufacturer?: string;
  model?: string;
  serial_number?: string;
  hardware_asset_id?: string;
  os_version?: string;
  os_type?: string;
  ip_address?: string;
  vlan?: string;
  remote_access_tool?: string;
  backup_tool?: string;
  backup_status?: string;
  object_id?: string;
  serial_object?: string;
  environment?: string;
  notes?: string;
  fortiedr_active?: boolean;
  winupdate_date?: string;
  _valid: boolean;
  _errors: string[];
  _raw: Record<string, string>;
}

const COLUMN_MAP: Record<string, string> = {
  'objektum id': 'object_id',
  'object id': 'object_id',
  'object_id': 'object_id',
  'station id': 'object_id',
  'állomás id': 'object_id',
  'id': 'hardware_asset_id',
  'hwa id': 'hardware_asset_id',
  'hardware_asset_id': 'hardware_asset_id',
  'hw asset id': 'hardware_asset_id',
  'os': 'os_version',
  'os version': 'os_version',
  'operating system': 'os_version',
  'os_version': 'os_version',
  'rendszer': 'os_version',
  'manufacturer': 'manufacturer',
  'gyártó': 'manufacturer',
  'gyarto': 'manufacturer',
  'modell': 'model',
  'model': 'model',
  'típus': 'model',
  'tipus': 'model',
  'serial number': 'serial_number',
  'serial_number': 'serial_number',
  'serialnumber': 'serial_number',
  's/n': 'serial_number',
  'sn': 'serial_number',
  'sorozatszám': 'serial_number',
  'network': 'ip_address',
  'ip': 'ip_address',
  'ip address': 'ip_address',
  'ip_address': 'ip_address',
  'hálózat': 'ip_address',
  'vlan': 'vlan',
  'remote access': 'remote_access_tool',
  'remote': 'remote_access_tool',
  'remote_access': 'remote_access_tool',
  'remote_access_tool': 'remote_access_tool',
  'távelérés': 'remote_access_tool',
  'backup': 'backup_tool',
  'backup tool': 'backup_tool',
  'backup_tool': 'backup_tool',
  'mentés': 'backup_tool',
  'hw': 'catalog_item',
  'hw spec': 'catalog_item',
  'hw specs': 'catalog_item',
  'area': 'environment',
  'area/function': 'environment',
  'function': 'environment',
  'területi funkció': 'environment',
  'teruleti funkcio': 'environment',
  'serial object': 'serial_object',
  'serial_object': 'serial_object',
  'serialobject': 'serial_object',
  'notes': 'notes',
  'megjegyzés': 'notes',
  'megjegyzes': 'notes',
  'note': 'notes',
  'comment': 'notes',
  'megjegyzések': 'notes',
  'fortiedr': 'fortiedr_active',
  'fortiedr active': 'fortiedr_active',
  'fortiedr_active': 'fortiedr_active',
  'edr': 'fortiedr_active',
  'winupdate': 'winupdate_date',
  'win update': 'winupdate_date',
  'windows update': 'winupdate_date',
  'winupdate_date': 'winupdate_date',
  'win_update': 'winupdate_date',
  'name': 'display_name',
  'display name': 'display_name',
  'display_name': 'display_name',
  'asset name': 'display_name',
  'asset_name': 'display_name',
  'sw': 'sw',
};

const detectSeparator = (text: string): string => {
  const firstLine = text.split('\n')[0];
  const tabCount = (firstLine.match(/\t/g) || []).length;
  const commaCount = (firstLine.match(/,/g) || []).length;
  return tabCount >= commaCount ? '\t' : ',';
};

const parseLine = (line: string, sep: string): string[] => {
  if (sep === '\t') return line.split('\t').map(v => v.trim().replace(/^"|"$/g, ''));
  const values: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') { inQuotes = !inQuotes; }
    else if (line[i] === ',' && !inQuotes) { values.push(current.trim()); current = ''; }
    else { current += line[i]; }
  }
  values.push(current.trim());
  return values;
};

const normalizeOsType = (ver: string): string => {
  if (/windows/i.test(ver)) return 'Windows';
  if (/linux/i.test(ver)) return 'Linux';
  if (/macos|mac os/i.test(ver)) return 'macOS';
  return '';
};

const normalizeFortiedr = (val: string): boolean | undefined => {
  const v = val.trim().toLowerCase();
  if (['yes', 'true', 'active', 'igen', '1', 'x', 'aktív', 'aktiv'].includes(v)) return true;
  if (['no', 'false', 'inactive', 'nem', '0', '-', 'inaktív', 'inaktiv'].includes(v)) return false;
  return undefined;
};

const parseFile = (text: string): ParsedRow[] => {
  const sep = detectSeparator(text);
  const lines = text.trim().split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];

  const rawHeaders = parseLine(lines[0], sep).map(h => h.toLowerCase().trim());
  const fieldMap: Record<number, string> = {};
  rawHeaders.forEach((h, i) => {
    const mapped = COLUMN_MAP[h];
    if (mapped) fieldMap[i] = mapped;
  });

  const get = (values: string[], field: string): string => {
    const entry = Object.entries(fieldMap).find(([, v]) => v === field);
    return entry ? (values[Number(entry[0])] || '') : '';
  };

  return lines.slice(1).map(line => {
    const values = parseLine(line, sep);
    if (values.every(v => !v)) return null;

    const raw: Record<string, string> = {};
    rawHeaders.forEach((h, i) => { raw[h] = values[i] || ''; });

    const objectId = get(values, 'object_id');
    const model = get(values, 'model');
    const manufacturer = get(values, 'manufacturer');
    const osVersion = get(values, 'os_version');
    const area = get(values, 'environment');

    let displayName = get(values, 'display_name');
    if (!displayName) {
      if (objectId) displayName = objectId;
      else if (manufacturer && model) displayName = `${manufacturer} ${model}`;
      else if (model) displayName = model;
    }

    const fortiedrRaw = get(values, 'fortiedr_active');
    const fortiedr = fortiedrRaw ? normalizeFortiedr(fortiedrRaw) : undefined;

    const errors: string[] = [];
    if (!displayName) errors.push('Cannot determine display name (no name, object_id, or model)');

    return {
      display_name: displayName || `Asset_${Math.random().toString(36).slice(2, 7)}`,
      manufacturer: manufacturer || undefined,
      model: model || undefined,
      serial_number: get(values, 'serial_number') || undefined,
      hardware_asset_id: get(values, 'hardware_asset_id') || undefined,
      os_version: osVersion || undefined,
      os_type: osVersion ? normalizeOsType(osVersion) : undefined,
      ip_address: get(values, 'ip_address') || undefined,
      vlan: get(values, 'vlan') || undefined,
      remote_access_tool: get(values, 'remote_access_tool') || undefined,
      backup_tool: get(values, 'backup_tool') || undefined,
      backup_status: undefined,
      object_id: objectId || undefined,
      serial_object: get(values, 'serial_object') || undefined,
      environment: area || undefined,
      notes: get(values, 'notes') || undefined,
      fortiedr_active: fortiedr,
      winupdate_date: get(values, 'winupdate_date') || undefined,
      _valid: errors.length === 0,
      _errors: errors,
      _raw: raw,
    } as ParsedRow;
  }).filter((r): r is ParsedRow => r !== null);
};

const CsvImportModal: React.FC<CsvImportModalProps> = ({
  isOpen, onClose, onSuccess, defaultFloorId, defaultBuildingId,
}) => {
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [succeeded, setSucceeded] = useState(0);
  const [failed, setFailed] = useState(0);
  const [rowResults, setRowResults] = useState<Array<{ index: number; success: boolean; error?: string }>>([]);
  const [done, setDone] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const text = ev.target?.result as string;
      setRows(parseFile(text));
      setDone(false);
      setSucceeded(0);
      setFailed(0);
      setRowResults([]);
    };
    reader.readAsText(file, 'UTF-8');
  };

  const handleImport = async () => {
    const validRows = rows.filter(r => r._valid);
    if (validRows.length === 0) return;
    setImporting(true);

    const assets = validRows.map(row => ({
      basic_info: {
        display_name: row.display_name,
        manufacturer: row.manufacturer,
        model: row.model,
        serial_number: row.serial_number,
        type: 'computer',
        status: 'active' as const,
        os_type: row.os_type,
        os_version: row.os_version,
      },
      hierarchy: {
        building_id: defaultBuildingId || '',
        floor_id: defaultFloorId || '',
        workarea_id: '',
        section_id: '',
        workstation_id: '',
      },
      location: { coordinates: { x: 0, y: 0 } },
      itsm: {
        hardware_asset_id: row.hardware_asset_id || null,
        is_managed: !!row.hardware_asset_id,
        last_synced: null,
        sync_status: 'never' as const,
      },
      ...(row.ip_address || row.vlan ? {
        network: { ip_address: row.ip_address, vlan: row.vlan },
      } : {}),
      custom_fields: {
        object_id: row.object_id,
        serial_object: row.serial_object,
        environment: row.environment,
        notes: row.notes,
        remote_access_tool: row.remote_access_tool,
        backup_tool: row.backup_tool,
        winupdate_date: row.winupdate_date,
        fortiedr_active: row.fortiedr_active,
      },
    }));

    try {
      const result = await assetService.bulkCreateAssets(assets);
      setSucceeded(result.succeeded);
      setFailed(result.failed);
      setRowResults(result.results);
      if (result.succeeded > 0) onSuccess();
    } catch {
      setSucceeded(0);
      setFailed(validRows.length);
      setRowResults([]);
    }
    setDone(true);
    setImporting(false);
  };

  const handleClose = () => {
    setRows([]);
    setDone(false);
    setSucceeded(0);
    setFailed(0);
    setRowResults([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
    onClose();
  };

  const validCount = rows.filter(r => r._valid).length;
  const invalidCount = rows.filter(r => !r._valid).length;

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Import IPC / Asset Data"
      width="xl"
      footer={
        <>
          <Button variant="outline" onClick={handleClose} disabled={importing}>Cancel</Button>
          {!done && (
            <Button
              variant="primary"
              onClick={handleImport}
              disabled={validCount === 0 || importing}
              loading={importing}
            >
              Import {validCount} Assets
            </Button>
          )}
          {done && <Button variant="success" onClick={handleClose}>Done</Button>}
        </>
      }
    >
      <div className={styles.container}>
        {!done ? (
          <>
            <div className={styles.instructions}>
              <p>Upload a tab-separated export from Excel (.txt / .tsv) or a standard CSV. Column headers are detected automatically.</p>
              <p>Recognized columns: <strong>Objektum ID</strong>, <strong>ID</strong> (HWA), <strong>OS</strong>, <strong>Manufacturer</strong>, <strong>Modell</strong>, <strong>Serial number</strong>, <strong>Network</strong>, <strong>Remote Access</strong>, <strong>Backup</strong>, <strong>Area</strong>, <strong>Serial Object</strong>, <strong>Notes</strong>, <strong>FortiEDR</strong>, <strong>Winupdate</strong>.</p>
            </div>

            <div className={styles.uploadArea}>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.tsv,.txt,text/csv,text/plain,text/tab-separated-values"
                onChange={handleFileSelect}
                className={styles.fileInput}
                id="ipc-import"
              />
              <label htmlFor="ipc-import" className={styles.uploadLabel}>
                <FolderOpen size={20} />
                <span>Click to select file (.csv, .tsv, .txt from Excel)</span>
              </label>
            </div>

            {rows.length > 0 && (
              <div className={styles.preview}>
                <div className={styles.previewHeader}>
                  <h4>Preview ({rows.length} rows)</h4>
                  <div className={styles.badges}>
                    <Badge variant="success">{validCount} valid</Badge>
                    {invalidCount > 0 && <Badge variant="error">{invalidCount} invalid</Badge>}
                  </div>
                </div>

                <div className={styles.tableWrapper}>
                  <table className={styles.table}>
                    <thead>
                      <tr>
                        <th>Status</th>
                        <th>Station ID</th>
                        <th>HWA ID</th>
                        <th>Name / Display</th>
                        <th>Manufacturer / Model</th>
                        <th>OS</th>
                        <th>Area</th>
                        <th>Remote</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, i) => (
                        <tr key={i} className={row._valid ? styles.validRow : styles.invalidRow}>
                          <td>
                            {row._valid
                              ? <Badge variant="success">OK</Badge>
                              : <span title={row._errors.join(', ')}><Badge variant="error">Error</Badge></span>
                            }
                          </td>
                          <td style={{ fontFamily: 'monospace', fontSize: '0.8em' }}>{row.object_id || '—'}</td>
                          <td style={{ fontFamily: 'monospace', fontSize: '0.8em' }}>{row.hardware_asset_id || '—'}</td>
                          <td>{row.display_name}</td>
                          <td>{[row.manufacturer, row.model].filter(Boolean).join(' ') || '—'}</td>
                          <td style={{ fontSize: '0.85em' }}>{row.os_version || '—'}</td>
                          <td>{row.environment || '—'}</td>
                          <td>{row.remote_access_tool || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className={styles.result}>
            <div className={styles.resultIcon}>
              {failed === 0
                ? <CheckCircle2 size={40} className={styles.resultIconSuccess} />
                : <AlertTriangle size={40} className={styles.resultIconWarning} />
              }
            </div>
            <h3>Import Complete</h3>
            <p><strong>{succeeded}</strong> assets imported successfully. They will appear in the Unplaced Assets tray on the floor map.</p>
            {failed > 0 && <p className={styles.failText}><strong>{failed}</strong> failed to import.</p>}
            {rowResults.some(r => !r.success) && (
              <ul className={styles.errorList}>
                {rowResults.filter(r => !r.success).map(r => (
                  <li key={r.index}>Row {r.index + 1}: {r.error}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
};

export default CsvImportModal;
