/**
 * SnapshotImportModal.tsx — Hand the app a fresh ITSM export.
 *
 * The reconciliation round is export → load → compare → tasks → act in Alemba → next
 * export. Until now the load step needed a terminal on the VM, which is how a monthly job
 * becomes a quarterly one.
 *
 * Two decisions worth knowing about:
 *
 *  - **The file is parsed here and never uploaded.** Rows are posted as JSON, exactly as
 *    the asset CSV import already works. An ITSM export is Confidential; not putting it on
 *    the server's disk beats remembering to delete it.
 *  - **Preview, then apply.** Loading an export REPLACES the snapshot — an export is a
 *    point in time, and whatever is absent from it is absent from ITSM. That is right, and
 *    destructive enough that nobody should do it blind. The preview names what would
 *    appear, disappear and change, and a large "would disappear" count is called out as
 *    the likeliest explanation of a partial export rather than shown as a bare number.
 */
import React, { useRef, useState } from 'react';
import { AlertTriangle, FileJson, FileSpreadsheet, Upload } from 'lucide-react';
import Modal from '../common/Modal';
import Button from '../common/Button';
import { useToast } from '../../contexts/ToastContext';
import { getApiErrorMessage } from '../../utils/apiError';
import { itsmService, SnapshotImportPlan } from '../../services/itsm.service';
import styles from '../../styles/components/SnapshotImportModal.module.css';

interface SnapshotImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called after a successful apply, so the page behind can refresh its counts. */
  onApplied: () => void;
}

/**
 * The share of the current snapshot that may disappear before it is treated as a sign of a
 * partial file rather than a real change. A tenth is generous: a month of genuine
 * decommissioning is a handful of records, not a hundred.
 */
const SUSPICIOUS_REMOVAL_SHARE = 0.1;

/** Reads a file as text, tolerating the BOM PowerShell writes. */
function readText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? '').replace(/^﻿/, ''));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.readAsText(file);
  });
}

/**
 * Accepts a bare array or Alemba's own `{ items: [...] }` wrapper, which the PowerShell
 * export may pass through untouched — the same shapes the CLI importer accepts.
 */
function rowsFromJson(text: string, fileName: string): Array<Record<string, unknown>> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${fileName} is not valid JSON. Is it the Hardware Asset export?`);
  }
  if (Array.isArray(parsed)) return parsed as Array<Record<string, unknown>>;
  const wrapped = (parsed as { items?: unknown; Items?: unknown }).items
    ?? (parsed as { Items?: unknown }).Items;
  if (Array.isArray(wrapped)) return wrapped as Array<Record<string, unknown>>;
  throw new Error(`${fileName} holds neither an array nor an { items: [...] } wrapper.`);
}

const SnapshotImportModal: React.FC<SnapshotImportModalProps> = ({ isOpen, onClose, onApplied }) => {
  const [hardware, setHardware] = useState<Array<Record<string, unknown>> | null>(null);
  /** Set instead of `hardware` when the chosen file is the portal's CSV export. */
  const [hardwareCsv, setHardwareCsv] = useState<string | null>(null);
  const [hardwareName, setHardwareName] = useState('');
  const [catalogCsv, setCatalogCsv] = useState<string | null>(null);
  const [catalogName, setCatalogName] = useState('');
  const [personsCsv, setPersonsCsv] = useState<string | null>(null);
  const [personsName, setPersonsName] = useState('');
  const [plan, setPlan] = useState<SnapshotImportPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const hardwareInput = useRef<HTMLInputElement>(null);
  const toast = useToast();

  const reset = () => {
    setHardware(null); setHardwareCsv(null); setHardwareName('');
    setCatalogCsv(null); setCatalogName('');
    setPersonsCsv(null); setPersonsName('');
    setPlan(null);
  };

  const pickHardware = async (file?: File) => {
    if (!file) return;
    try {
      const text = await readText(file);
      // A CSV is the portal's own export; the server maps its columns. Detected by content
      // rather than by extension, since either can be renamed and the content cannot lie.
      const looksJson = text.trimStart().startsWith('{') || text.trimStart().startsWith('[');
      if (looksJson) {
        const rows = rowsFromJson(text, file.name);
        setHardware(rows);
        setHardwareCsv(null);
        setHardwareName(`${file.name} — ${rows.length} row(s)`);
      } else {
        const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
        if (!/#?id/i.test(lines[0] ?? '')) {
          throw new Error(`${file.name} is neither the JSON export nor a CSV with an "#ID" column.`);
        }
        setHardware(null);
        setHardwareCsv(text);
        setHardwareName(`${file.name} — ${lines.length - 1} row(s)`);
      }
      // Any previous preview described a different file.
      setPlan(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not read that file');
    }
  };

  const run = async (apply: boolean) => {
    if (!hardware && !hardwareCsv) return;
    setBusy(true);
    try {
      const result = await itsmService.importSnapshot({
        ...(hardware ? { hardware } : { hardwareCsv }),
        catalogItemsCsv: catalogCsv, personsCsv: personsCsv, apply,
      });
      setPlan(result);
      if (apply) {
        toast.success(`Snapshot replaced: ${result.parsed - result.skipped} row(s) loaded`);
        onApplied();
      }
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'The import failed'));
    } finally {
      setBusy(false);
    }
  };

  const loaded = plan ? plan.parsed - plan.skipped : 0;
  const currentSnapshotSize = plan ? plan.removed.length + plan.changed.length + plan.unchanged : 0;
  const removalLooksWrong = !!plan
    && currentSnapshotSize > 0
    && plan.removed.length > currentSnapshotSize * SUSPICIOUS_REMOVAL_SHARE;

  return (
    <Modal isOpen={isOpen} onClose={() => { reset(); onClose(); }} title="Load an ITSM export">
      <div className={styles.body}>
        <p className={styles.intro}>
          The files are read here in the browser and only the rows are sent — the export
          itself never lands on the server. Nothing is written until you press Apply.
        </p>

        <div className={styles.files}>
          <label className={styles.file}>
            <FileJson size={16} />
            <span className={styles.fileLabel}>
              Hardware Assets <em>(required)</em>
              <span className={styles.fileName}>
                {hardwareName || 'itsm-mmh-hardware.json, or the portal’s Export to CSV'}
              </span>
            </span>
            <input
              ref={hardwareInput}
              type="file"
              accept=".json,application/json"
              onChange={(e) => pickHardware(e.target.files?.[0])}
            />
          </label>

          <label className={styles.file}>
            <FileSpreadsheet size={16} />
            <span className={styles.fileLabel}>
              Catalog Items CSV <em>(optional)</em>
              <span className={styles.fileName}>{catalogName || 'without it, type and make stay empty'}</span>
            </span>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setCatalogCsv(await readText(file));
                setCatalogName(file.name);
                setPlan(null);
              }}
            />
          </label>

          <label className={styles.file}>
            <FileSpreadsheet size={16} />
            <span className={styles.fileLabel}>
              Persons CSV <em>(optional)</em>
              <span className={styles.fileName}>{personsName || 'without it, person ids stay unresolved'}</span>
            </span>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                setPersonsCsv(await readText(file));
                setPersonsName(file.name);
                setPlan(null);
              }}
            />
          </label>
        </div>

        <div className={styles.actions}>
          <Button variant="outline" onClick={() => run(false)} disabled={(!hardware && !hardwareCsv) || busy} loading={busy && !plan}>
            <Upload size={15} /> What would this change?
          </Button>
          <Button variant="primary" onClick={() => run(true)} disabled={!plan || busy || plan.applied}>
            Apply — replace the snapshot
          </Button>
        </div>

        {plan && (
          <div className={styles.plan}>
            {plan.applied && <p className={styles.applied}>Applied. The snapshot now holds {loaded} row(s).</p>}

            {removalLooksWrong && (
              // The case worth catching before it happens: a filtered or half-finished
              // export looks exactly like an estate that vanished.
              <p className={styles.warn}>
                <AlertTriangle size={15} />
                <span>
                  This export drops <strong>{plan.removed.length}</strong> of the{' '}
                  {currentSnapshotSize} records currently held. That is usually a partial
                  export rather than that many devices leaving ITSM — worth checking the
                  file before applying.
                </span>
              </p>
            )}

            <ul className={styles.counts}>
              <li><strong>{loaded}</strong> row(s) would be loaded{plan.skipped > 0 && <> · {plan.skipped} unusable (no HardwareAssetID)</>}</li>
              <li><strong>{plan.added.length}</strong> new to the app</li>
              <li><strong>{plan.removed.length}</strong> would disappear — these become “confirm or retire” tasks</li>
              <li><strong>{plan.changed.length}</strong> changed · {plan.unchanged} unchanged</li>
            </ul>

            <p className={styles.enrichment}>
              Type classified for {plan.enrichment.classified}, make for {plan.enrichment.manufacturer},
              person id for {plan.enrichment.person_id_resolved} of {plan.enrichment.with_person_name} with a name.
              {(plan.enrichment.catalog_malformed > 0 || plan.enrichment.persons_malformed > 0) && (
                <> {plan.enrichment.catalog_malformed + plan.enrichment.persons_malformed} CSV row(s) had an
                unexpected column count and were skipped.</>
              )}
            </p>

            {plan.changed.length > 0 && (
              <details className={styles.details}>
                <summary>What changed ({plan.changed.length})</summary>
                <ul>
                  {plan.changed.slice(0, 50).map((c) => (
                    <li key={c.itsm_id}>
                      <strong>{c.itsm_id}</strong> {c.display_name ?? ''}
                      <ul>{c.changes.map((line) => <li key={line}>{line}</li>)}</ul>
                    </li>
                  ))}
                </ul>
                {plan.changed.length > 50 && <p>…and {plan.changed.length - 50} more.</p>}
              </details>
            )}

            {plan.removed.length > 0 && (
              <details className={styles.details}>
                <summary>What would disappear ({plan.removed.length})</summary>
                <ul>
                  {plan.removed.slice(0, 50).map((r) => (
                    <li key={r.itsm_id}><strong>{r.itsm_id}</strong> {r.display_name ?? ''}</li>
                  ))}
                </ul>
                {plan.removed.length > 50 && <p>…and {plan.removed.length - 50} more.</p>}
              </details>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
};

export default SnapshotImportModal;
