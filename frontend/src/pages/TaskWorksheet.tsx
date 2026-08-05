/**
 * TaskWorksheet.tsx — The task list as something you can carry. ("/tasks/worksheet")
 *
 * The Tasks page is for deciding. This is for doing, and the two jobs it serves are
 * physical:
 *
 *  - **Walking the site with a label gun.** "Put a label on it" is only actionable if you
 *    know which room to walk into. Grouped by floor and room, in walking order, with a box
 *    to tick — because the person doing it is holding paper, not a laptop.
 *  - **Registering devices in Alemba by hand.** That is typing, and typing wants a
 *    spreadsheet: the CSV carries the serial, the type, the person and the evidence.
 *
 * A sheet is a snapshot and says when it was taken, printed at the top. Someone finding a
 * sheet on a desk needs to know whether it is from this round or the last one.
 *
 * Nothing here writes. Ticking happens on paper, and the boxes are closed on the Tasks page
 * or by the next re-derive — a page that let you tick a hundred tasks in one pass would make
 * "I walked past it" indistinguishable from "it is done".
 */
import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Download, Printer } from 'lucide-react';
import Card from '../components/common/Card';
import Button from '../components/common/Button';
import { useToast } from '../contexts/ToastContext';
import {
  taskService,
  NormalisationTaskKind,
  NormalisationTaskState,
  WorksheetRow,
} from '../services/task.service';
import styles from '../styles/pages/TaskWorksheet.module.css';

/**
 * The label round is the reason this page exists, so it is what opens by default — but the
 * same sheet is useful for any kind, and "everything open" is what you want when handing the
 * round to somebody else.
 */
const KINDS: Array<{ value: NormalisationTaskKind | ''; label: string }> = [
  { value: 'label-device', label: 'Put a label on it' },
  { value: '', label: 'Every kind' },
  { value: 'register-in-itsm', label: 'Register in ITSM' },
  { value: 'identify-device', label: 'Identify the device' },
  { value: 'link-to-itsm', label: 'Link to ITSM' },
  { value: 'decide-match', label: 'Decide the match' },
  { value: 'check-hwa', label: 'Check an HWA' },
  { value: 'resolve-field-differences', label: 'Resolve differences' },
  { value: 'verify-disposal', label: 'Confirm or retire' },
];

const CSV_COLUMNS: Array<[string, (r: WorksheetRow) => string]> = [
  ['Kind', (r) => r.kind],
  ['Device', (r) => r.device ?? ''],
  ['HWA', (r) => r.hardware_asset_id ?? ''],
  ['ITSM record', (r) => r.itsm_id ?? ''],
  ['Type', (r) => r.asset_type ?? ''],
  ['Serial', (r) => r.serial_number ?? ''],
  ['Person', (r) => r.person ?? ''],
  ['Building', (r) => r.building ?? ''],
  ['Floor', (r) => r.floor ?? ''],
  ['Zone', (r) => r.zone ?? ''],
  ['Room', (r) => r.room ?? ''],
  ['Assigned to', (r) => r.assigned_to ?? ''],
  ['Days open', (r) => String(r.age_days)],
  ['What to do', (r) => r.summary],
  ['Why', (r) => (r.evidence ?? '').replace(/\n/g, ' · ')],
];

/** A room's worth of rows, in the order they should be walked. */
interface Group {
  key: string;
  where: string;
  room: string;
  rows: WorksheetRow[];
}

function group(rows: WorksheetRow[]): Group[] {
  const byKey = new Map<string, Group>();
  for (const r of rows) {
    const where = [r.building, r.floor].filter(Boolean).join(' / ') || 'No building or floor recorded';
    // Rooms are grouped, and everything without one is collected under a single heading
    // rather than scattered — those need a different kind of hunt.
    const room = r.room ?? 'No room recorded';
    const key = `${where}|${r.zone ?? ''}|${room}`;
    const existing = byKey.get(key);
    if (existing) existing.rows.push(r);
    else byKey.set(key, { key, where, room: r.zone ? `${r.zone} / ${room}` : room, rows: [r] });
  }
  return [...byKey.values()];
}

const TaskWorksheet: React.FC = () => {
  const [kind, setKind] = useState<NormalisationTaskKind | ''>('label-device');
  const [state, setState] = useState<NormalisationTaskState>('open');
  const toast = useToast();

  const sheet = useQuery({
    queryKey: ['tasks', 'worksheet', { kind, state }] as const,
    queryFn: () => taskService.getWorksheet({ state, kind: kind || undefined }),
    placeholderData: (previous) => previous,
  });

  const groups = useMemo(() => group(sheet.data?.rows ?? []), [sheet.data]);

  const exportCsv = () => {
    const rows = sheet.data?.rows ?? [];
    if (rows.length === 0) return;
    const lines = [
      CSV_COLUMNS.map(([header]) => header),
      ...rows.map((r) => CSV_COLUMNS.map(([, read]) => read(r))),
    ];
    // UTF-8 BOM so Excel opens the Hungarian names correctly, same as the asset export.
    const csv = '﻿' + lines
      .map((line) => line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `tasks-${kind || 'all'}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${rows.length} task(s)`);
  };

  const total = sheet.data?.total ?? 0;

  return (
    <div className={styles.page}>
      <div className={styles.controls}>
        <div>
          <h1>Worksheet</h1>
          <p className={styles.subtitle}>
            The task list grouped by room, for taking with you. Print it for the walk, or
            export the CSV for the typing. Ticks are closed back on the{' '}
            <Link to="/tasks">Tasks page</Link>.
          </p>
        </div>
        <div className={styles.controlRow}>
          <label>
            Kind
            <select value={kind} onChange={(e) => setKind(e.target.value as NormalisationTaskKind | '')}>
              {KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
            </select>
          </label>
          <label>
            State
            <select value={state} onChange={(e) => setState(e.target.value as NormalisationTaskState)}>
              <option value="open">open</option>
              <option value="done">done</option>
              <option value="dismissed">dismissed</option>
            </select>
          </label>
          <Button variant="outline" onClick={exportCsv} disabled={total === 0}>
            <Download size={15} /> CSV
          </Button>
          <Button variant="primary" onClick={() => window.print()} disabled={total === 0}>
            <Printer size={15} /> Print
          </Button>
        </div>
      </div>

      {sheet.isLoading && <Card padding="lg"><p>Loading…</p></Card>}

      {sheet.data && (
        <div className={styles.sheet}>
          <div className={styles.sheetHead}>
            <h2>
              {KINDS.find((k) => k.value === kind)?.label ?? 'Tasks'} · {state}
            </h2>
            <p className={styles.taken}>
              {total} task(s) · taken {new Date(sheet.data.generated_at).toLocaleString()}
            </p>
          </div>

          {sheet.data.truncated && (
            <p className={styles.warn}>
              <AlertTriangle size={15} />
              Only the first {sheet.data.rows.length} of {total} are on this sheet. Narrow it
              by kind before walking, or the rest will look done.
            </p>
          )}

          {sheet.data.without_place > 0 && (
            <p className={styles.note}>
              {sheet.data.without_place} of these have no room recorded — they are at the end,
              under “No room recorded”, and need finding rather than walking to.
            </p>
          )}

          {total === 0 && (
            <p className={styles.empty}>
              Nothing {state} of this kind. If a new ITSM export or survey has landed since,
              re-derive on the <Link to="/tasks">Tasks page</Link> first.
            </p>
          )}

          {groups.map((g) => (
            <section key={g.key} className={styles.group}>
              <h3>
                <span className={styles.room}>{g.room}</span>
                <span className={styles.where}>{g.where}</span>
                <span className={styles.count}>{g.rows.length}</span>
              </h3>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th className={styles.tick} aria-label="Done" />
                    <th>Device</th>
                    <th>HWA</th>
                    <th>Type</th>
                    <th>Person</th>
                    <th>What to do</th>
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map((r) => (
                    <tr key={r.task_id}>
                      {/* A drawn box, not a checkbox input: this row is for a pen. */}
                      <td className={styles.tick}><span className={styles.box} /></td>
                      <td>
                        {r.asset_id
                          ? <Link to={`/assets/${r.asset_id}`}>{r.device ?? '(no name)'}</Link>
                          : (r.device ?? r.itsm_id ?? '(no device)')}
                      </td>
                      <td className={styles.mono}>{r.hardware_asset_id ?? r.itsm_id ?? '—'}</td>
                      <td>{r.asset_type ?? '—'}</td>
                      <td>{r.person ?? '—'}</td>
                      <td className={styles.what}>{r.summary}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      )}
    </div>
  );
};

export default TaskWorksheet;
