/**
 * InventoryImport.tsx — "Here is what I found walking the site." ("/inventory-import")
 *
 * The round this page serves: download the ITSM export, walk the site with the survey tool,
 * hand both to the app, and work from what disagrees. The export half is on the ITSM
 * Reconcile page; this is the survey half.
 *
 * Three decisions worth knowing about:
 *
 *  - **The file is read here and never uploaded.** Only the rows are posted. The survey
 *    records who uses which device, so it is Confidential; not putting it on the server's
 *    disk beats remembering to delete it.
 *  - **Preview, then apply.** An import re-places every device it matched and creates local
 *    assets for the ones ITSM has never heard of. Both are worth seeing first, so nothing
 *    is written until Apply.
 *  - **The unmatched names are fixable here.** That is the actual work of an import: "hr
 *    iroda" means "HR Iroda", "gorog tomi" is Görög Tamás. Each one has a box next to it,
 *    pre-filled with a suggestion where the app has a near-miss to offer, and saving it
 *    re-runs the preview so the list visibly shrinks. It used to mean editing a JSON file
 *    next to the export on whichever machine ran the importer.
 */
import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle, Check, FileJson, Trash2, Upload, Wand2,
} from 'lucide-react';
import Card from '../components/common/Card';
import Button from '../components/common/Button';
import Badge from '../components/common/Badge';
import { useToast } from '../contexts/ToastContext';
import { getApiErrorMessage } from '../utils/apiError';
import {
  inventoryService,
  CorrectionScope,
  NameCorrection,
  SurveyImportPlan,
  SurveyRow,
} from '../services/inventory.service';
import styles from '../styles/pages/InventoryImport.module.css';

const SCOPE_LABEL: Record<CorrectionScope, string> = {
  building: 'Building',
  floor: 'Floor',
  helyszin: 'Zone (helyszín)',
  work_area: 'Room (work area)',
  persons: 'Person',
};

/** Reads a file as text, tolerating the BOM the survey tool writes. */
function readText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? '').replace(/^﻿/, ''));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.readAsText(file);
  });
}

/**
 * Merges several exports, last file winning on a repeated row id — a re-export of the same
 * tablet overwriting an earlier partial one. Same rule as the CLI importer, on purpose:
 * two tools that dedupe differently would report different inventories.
 */
function mergeRows(batches: SurveyRow[][]): SurveyRow[] {
  const byKey = new Map<string, SurveyRow>();
  for (const batch of batches) {
    for (const row of batch) byKey.set(row.id ?? JSON.stringify(row), row);
  }
  return [...byKey.values()];
}

function rowsFromJson(text: string, fileName: string): SurveyRow[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${fileName} is not valid JSON. Is it a survey export?`);
  }
  const list = Array.isArray(parsed)
    ? parsed
    : (parsed as { eszkozok?: unknown }).eszkozok;
  if (!Array.isArray(list)) {
    throw new Error(`${fileName} holds no "eszkozok" list — that is what the survey tool writes.`);
  }
  return list as SurveyRow[];
}

/**
 * One unresolved name, with the box that resolves it.
 *
 * The suggestion is a proposal and is shown as one: it is pre-filled so confirming is a
 * click, and it is editable because a near-miss is not a match.
 */
const FixRow: React.FC<{
  scope: CorrectionScope;
  from: string;
  rows: number;
  suggestion: string | null;
  context?: string;
  onSaved: () => void;
}> = ({ scope, from, rows, suggestion, context, onSaved }) => {
  const [value, setValue] = useState(suggestion ?? '');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const save = async () => {
    const to = value.trim();
    if (!to) return;
    setBusy(true);
    try {
      await inventoryService.saveCorrection({ scope, from_value: from, to_value: to });
      toast.success(`“${from}” now reads as “${to}”`);
      onSaved();
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Could not save that correction'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className={styles.fixRow}>
      <span className={styles.fixFrom}>
        <strong>{from || '(blank)'}</strong>
        <span className={styles.fixMeta}>
          {rows} row(s){context ? ` · ${context}` : ''}
        </span>
      </span>
      <input
        className={styles.fixInput}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') save(); }}
        placeholder={suggestion ? '' : `what ${SCOPE_LABEL[scope].toLowerCase()} does this mean?`}
        aria-label={`What "${from}" should read as`}
      />
      <Button variant="outline" size="sm" disabled={busy || !value.trim()} onClick={save}>
        {suggestion && value === suggestion ? <><Check size={13} /> That one</> : 'Save'}
      </Button>
    </li>
  );
};

const InventoryImport: React.FC = () => {
  const [rows, setRows] = useState<SurveyRow[]>([]);
  const [fileNames, setFileNames] = useState<string[]>([]);
  const [plan, setPlan] = useState<SurveyImportPlan | null>(null);
  const [createRooms, setCreateRooms] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const corrections = useQuery({
    queryKey: ['inventory', 'corrections'],
    queryFn: inventoryService.getCorrections,
  });

  const byScope = useMemo(() => {
    const map = new Map<CorrectionScope, NameCorrection[]>();
    for (const c of corrections.data ?? []) {
      const list = map.get(c.scope) ?? [];
      list.push(c);
      map.set(c.scope, list);
    }
    return map;
  }, [corrections.data]);

  const pickFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    try {
      const batches: SurveyRow[][] = [];
      const names: string[] = [];
      for (const file of Array.from(files)) {
        batches.push(rowsFromJson(await readText(file), file.name));
        names.push(file.name);
      }
      setRows(mergeRows(batches));
      setFileNames(names);
      // Any earlier preview described different files.
      setPlan(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not read that file');
    }
  };

  const run = async (apply: boolean) => {
    if (rows.length === 0) return;
    setBusy(true);
    try {
      const result = await inventoryService.importSurvey({
        rows,
        create_missing_workareas: createRooms,
        apply,
      });
      setPlan(result);
      if (apply) {
        toast.success(`${result.to_update} asset(s) placed · ${result.to_create} created`);
      }
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'The import failed'));
    } finally {
      setBusy(false);
    }
  };

  /** After a correction is stored the preview is stale, so it is re-run rather than kept. */
  const afterFix = () => {
    corrections.refetch();
    if (plan && !plan.applied) run(false);
  };

  const removeCorrection = async (c: NameCorrection) => {
    try {
      await inventoryService.deleteCorrection(c._id);
      corrections.refetch();
      if (plan && !plan.applied) run(false);
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Could not remove that correction'));
    }
  };

  const unresolved = plan
    ? plan.unmatched_place.length + plan.missing_work_areas.length
      + plan.unmatched_persons.length + plan.unmatched_hwa.length
    : 0;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1>Inventory import</h1>
          <p className={styles.subtitle}>
            The physical walk-around, compared against what the app already holds. Nothing is
            written until you apply, so this doubles as the check: fix what did not match,
            preview again, and apply when the list is as clean as it is going to get.
          </p>
        </div>
      </div>

      <Card padding="lg">
        <label className={styles.fileDrop}>
          <FileJson size={18} />
          <span>
            <strong>{fileNames.length > 0 ? fileNames.join(', ') : 'Choose the survey export(s)'}</strong>
            <span className={styles.fileHint}>
              {rows.length > 0
                ? `${rows.length} entr${rows.length === 1 ? 'y' : 'ies'} across ${fileNames.length} file(s)`
                : 'The tool’s own JSON, including its .bak exports. Several files are merged; a repeated entry id takes the last one.'}
            </span>
          </span>
          {/* `.bak` is in the list because the survey tool writes exports under that
              extension too — same JSON inside, and filtering them out of the dialog left
              two of the five real files unselectable. The parser decides what a file is;
              the picker only decides what is easy to reach. */}
          <input
            type="file"
            accept=".json,.bak,application/json"
            multiple
            onChange={(e) => pickFiles(e.target.files)}
          />
        </label>

        <div className={styles.actions}>
          <Button variant="outline" onClick={() => run(false)} disabled={rows.length === 0 || busy} loading={busy && !plan}>
            <Upload size={15} /> What would this change?
          </Button>
          <Button variant="primary" onClick={() => run(true)} disabled={!plan || busy || plan.applied}>
            Apply — write the placements
          </Button>
          <label className={styles.checkbox}>
            <input type="checkbox" checked={createRooms} onChange={(e) => setCreateRooms(e.target.checked)} />
            Also create the rooms the survey names and the map lacks
            <span className={styles.checkboxHint}>
              default-size rectangles below what is already drawn — you still place them on the map
            </span>
          </label>
        </div>
      </Card>

      {plan && (
        <Card padding="lg">
          {plan.applied && (
            <p className={styles.applied}>
              <Check size={16} /> Applied. {plan.to_update} asset(s) re-placed, {plan.to_create} created
              as local-only records. Next: <Link to="/tasks">re-derive the task list</Link> so the
              new devices turn into “register in ITSM” tasks.
            </p>
          )}

          <ul className={styles.counts}>
            <li><strong>{plan.parsed}</strong> entries read · {plan.hwa_rows} with an HWA, {plan.other_rows} without</li>
            <li><strong>{plan.to_update}</strong> existing asset(s) would be re-placed</li>
            <li><strong>{plan.to_create}</strong> would be created as local-only — not in ITSM yet</li>
            <li><strong>{plan.no_room}</strong> would sit on a floor but in no room</li>
          </ul>

          {/* How the identifier column resolved. Worth stating rather than assuming: two of
              these rules exist only because the survey writes the same number three ways,
              and if they stop firing on a later export the tool has changed. */}
          <p className={styles.note}>
            Identified <strong>{plan.matched_by.hwa}</strong> by HWA number
            {plan.matched_by.hwa_prefixed > 0 && <>, <strong>{plan.matched_by.hwa_prefixed}</strong> after supplying the missing “HWA” prefix</>}
            {plan.matched_by.device_name > 0 && <>, <strong>{plan.matched_by.device_name}</strong> by the older name on the asset tag</>}
            {plan.matched_by.serial > 0 && <>, <strong>{plan.matched_by.serial}</strong> by serial</>}.
            {plan.placeholder_serials > 0 && (
              <> {plan.placeholder_serials} serial(s) were placeholders (“…”, “N/A”) and read as no serial.</>
            )}
            {plan.create_without_serial > 0 && (
              <> <strong>{plan.create_without_serial}</strong> of the new devices would have no
              number at all — nobody could reach or read one. Those come back as “read a number
              off it” tasks, which is the only honest thing to do with them.</>
            )}
          </p>

          {plan.duplicates.length > 0 && (
            <section className={styles.section}>
              <h2>The same device recorded twice</h2>
              <p className={styles.sectionHint}>
                Each of these appears on more than one survey row. Applying is safe — the
                later row wins — but if a pair is really two devices, one of them is about to
                lose its own record.
              </p>
              <ul className={styles.plainList}>
                {plan.duplicates.map((d) => (
                  <li key={`${d.kind}-${d.value}`}>
                    <strong>{d.value}</strong>{' '}
                    <span className={styles.fixMeta}>
                      {d.kind === 'identifier' ? 'identifier' : 'serial'} · {d.rows} rows
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {plan.created_areas && (
            <p className={styles.note}>
              Created {plan.created_areas.work_areas} room(s) and {plan.created_areas.zones} zone(s).
              They are stacked below whatever was already drawn on each floor — drag them into place
              on the <Link to="/map">map</Link>.
              {plan.created_areas.duplicate_names.length > 0 && (
                <> {plan.created_areas.duplicate_names.length} share a name with another room on the
                same floor: {plan.created_areas.duplicate_names.join(', ')}.</>
              )}
            </p>
          )}

          {unresolved === 0 ? (
            <p className={styles.clean}>
              <Check size={15} /> Every building, floor, room, person and HWA in the survey resolved.
            </p>
          ) : (
            <p className={styles.unresolvedHead}>
              <AlertTriangle size={15} /> {unresolved} thing(s) did not resolve. Fixing a name here
              stores it, so the next import reads it the same way.
            </p>
          )}

          {plan.unmatched_place.length > 0 && (
            <section className={styles.section}>
              <h2>No matching building or floor</h2>
              <p className={styles.sectionHint}>
                These rows are skipped entirely — a device with no floor cannot be placed. Fix the
                name, or add the building on the <Link to="/buildings">buildings page</Link>.
              </p>
              <ul className={styles.fixList}>
                {/* Only the side that actually failed gets a box. When the building is
                    unknown the floor name was never looked up, and offering to correct it
                    sends someone renaming a floor that is perfectly fine. */}
                {plan.unmatched_place.map((u) => (u.building_matched ? (
                  <FixRow
                    key={`floor|${u.building}|${u.floor}`}
                    scope="floor"
                    from={u.floor}
                    rows={u.rows}
                    suggestion={u.floor_suggestion}
                    context={`in “${u.building || '(blank)'}”`}
                    onSaved={afterFix}
                  />
                ) : (
                  <FixRow
                    key={`building|${u.building}|${u.floor}`}
                    scope="building"
                    from={u.building}
                    rows={u.rows}
                    suggestion={u.building_suggestion}
                    context={`floor “${u.floor || '(blank)'}” was not checked`}
                    onSaved={afterFix}
                  />
                )))}
              </ul>
            </section>
          )}

          {plan.missing_work_areas.length > 0 && (
            <section className={styles.section}>
              <h2>Rooms (work areas) the map does not have</h2>
              <p className={styles.sectionHint}>
                A room here is the survey’s <strong>work_area</strong> and the app’s{' '}
                <strong>work area</strong> — the rectangle on the floor plan. Its{' '}
                <strong>helyszín</strong> is the zone above it. The devices are still placed on
                their floor either way.
              </p>
              <p className={styles.sectionHint}>
                <strong>Most of these usually need creating, not correcting.</strong> Only type a
                fix where the same room already exists on the map under another spelling — tick
                the box above instead and they are all created on apply, with these names. There
                {plan.missing_work_areas.length === 1 ? ' is 1' : ` are ${plan.missing_work_areas.length}`}{' '}
                here, so correcting them one by one is a transcription job with no reward.
              </p>
              <ul className={styles.fixList}>
                {plan.missing_work_areas.map((m) => (
                  <FixRow
                    key={`${m.where}|${m.room_name}`}
                    scope="work_area"
                    from={m.raw_room_name}
                    rows={m.rows}
                    suggestion={m.suggestion}
                    context={`${m.where}${m.zone_name ? ` · zone ${m.zone_name}` : ''}`}
                    onSaved={afterFix}
                  />
                ))}
              </ul>
            </section>
          )}

          {plan.unmatched_persons.length > 0 && (
            <section className={styles.section}>
              <h2>People ITSM does not know by that name</h2>
              <p className={styles.sectionHint}>
                Kept as free text either way, so nothing is lost — but a name matched to ITSM also
                carries the person id, which is what makes “whose device is this” answerable.
              </p>
              <p className={styles.sectionHint}>
                A row that stays after you save a fix is saying something: the corrected name is
                not in the export either. Usually one of two things — the target is spelled
                differently there, or that person has no device in this export at all, in which
                case there is nothing to match and free text is the right answer. Technical
                accounts (MMHGEN…) belong in the second group: leave them empty.
              </p>
              <ul className={styles.fixList}>
                {plan.unmatched_persons.map((p) => (
                  <FixRow
                    key={p.name}
                    scope="persons"
                    from={p.name}
                    rows={p.rows}
                    suggestion={p.suggestion}
                    // Says the fix landed and still missed, so a saved correction is not
                    // mistaken for an unsaved one.
                    context={p.corrected_to
                      ? `already reads as “${p.corrected_to}”, which the export does not have`
                      : undefined}
                    onSaved={afterFix}
                  />
                ))}
              </ul>
            </section>
          )}

          {plan.unmatched_hwa.length > 0 && (
            <section className={styles.section}>
              <h2>Identifiers that resolved to nothing</h2>
              <p className={styles.sectionHint}>
                Not a naming problem, and two different problems at that. A{' '}
                <strong>number</strong> was either misread off the device or is in ITSM but not
                yet in the app — the <Link to="/itsm">ITSM Reconcile page</Link> creates those
                from the export. A <strong>name</strong> is an older device (MMHIPC…, MMH
                PRINTER…) that nothing has on record: it needs identifying, then registering.
              </p>
              <ul className={styles.plainList}>
                {plan.unmatched_hwa.slice(0, 50).map((h) => (
                  <li key={h.hwa}>
                    <strong>{h.hwa}</strong>{' '}
                    <span className={styles.fixMeta}>
                      {h.kind === 'number' ? 'a number nothing has' : 'an older device name'}
                      {h.note ? ` · ${h.note}` : ''}
                    </span>
                  </li>
                ))}
                {plan.unmatched_hwa.length > 50 && <li>…and {plan.unmatched_hwa.length - 50} more.</li>}
              </ul>
            </section>
          )}

          {plan.create_sample.length > 0 && (
            <details className={styles.details}>
              <summary>What would be created ({plan.to_create})</summary>
              <ul className={styles.plainList}>
                {plan.create_sample.map((c, i) => (
                  <li key={`${c.serial ?? c.display}-${i}`}>
                    <strong>{c.display}</strong> <Badge variant="neutral">{c.asset_type}</Badge>
                    {c.serial && <span className={styles.fixMeta}>serial {c.serial}</span>}
                  </li>
                ))}
                {plan.to_create > plan.create_sample.length && (
                  <li>…and {plan.to_create - plan.create_sample.length} more.</li>
                )}
              </ul>
            </details>
          )}
        </Card>
      )}

      <Card padding="lg">
        <h2 className={styles.storedHead}>
          <Wand2 size={16} /> Stored corrections
        </h2>
        <p className={styles.sectionHint}>
          How the app reads the survey’s free text. These apply to every import, and to the
          command-line importer too — one answer, not one per machine.
        </p>
        {corrections.isLoading && <p>Loading…</p>}
        {corrections.data && corrections.data.length === 0 && (
          <p className={styles.empty}>
            Nothing stored yet. Preview a survey above and fix what it flags — each fix lands here.
          </p>
        )}
        {[...byScope.entries()].map(([scope, list]) => (
          <div key={scope} className={styles.storedGroup}>
            <h3>{SCOPE_LABEL[scope]}</h3>
            <ul className={styles.plainList}>
              {list.map((c) => (
                <li key={c._id} className={styles.storedRow}>
                  <span>
                    <strong>{c.from_value}</strong> → {c.to_value}
                    {c.note && <span className={styles.fixMeta}>{c.note}</span>}
                    {c.created_by && <span className={styles.fixMeta}>by {c.created_by}</span>}
                  </span>
                  <Button variant="outline" size="sm" onClick={() => removeCorrection(c)} title="Remove this correction">
                    <Trash2 size={13} />
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </Card>
    </div>
  );
};

export default InventoryImport;
