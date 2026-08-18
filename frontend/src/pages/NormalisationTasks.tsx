/**
 * NormalisationTasks.tsx — "What is left before the inventory, the app and ITSM agree?" ("/tasks")
 *
 * The list is derived by the server on every generation, not maintained here, so this page
 * has no "add task" and never will: something that needs doing and is not derivable is a
 * sign the generator is missing a rule, not that the list needs a manual entry.
 *
 * What a person can do to a task is deliberately narrow — take it, note something, tick it,
 * or dismiss it with a reason — because those are the only four things that are true about
 * a derived list. Everything else is done in the app or in Alemba, and the next generation
 * notices.
 *
 * Two things the UI says out loud rather than hiding:
 *   - Ticking a task the data checks will not stick if the cause is still there. The server
 *     says so in its response and that message is shown, because someone believing a tick
 *     settled it would stop chasing the actual cause.
 *   - Only `label-device` can be closed on a person's word. Nothing in any export records
 *     that a sticker was applied, so for every other kind the data is the authority.
 */
import React, { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Printer, RefreshCw, XCircle, User, Clock } from 'lucide-react';
import Card from '../components/common/Card';
import Button from '../components/common/Button';
import Badge from '../components/common/Badge';
import { useToast } from '../contexts/ToastContext';
import { getApiErrorMessage } from '../utils/apiError';
import {
  taskService,
  NormalisationTask,
  NormalisationTaskKind,
  NormalisationTaskState,
} from '../services/task.service';
import styles from '../styles/pages/NormalisationTasks.module.css';
import SourceFreshnessBar from '../components/tasks/SourceFreshnessBar';

/**
 * The kinds in the order the work actually happens: find out what a device is, get it into
 * ITSM, link it, then label it. Keeping the order here rather than sorting alphabetically
 * means the list reads as a sequence rather than a bag.
 */
const KINDS: Array<{ kind: NormalisationTaskKind; label: string; hint: string }> = [
  { kind: 'check-hwa', label: 'Check an HWA', hint: 'The label names a record the ITSM export does not contain.' },
  { kind: 'decide-match', label: 'Decide the match', hint: 'Several candidates, or a contradiction. A person has to choose.' },
  { kind: 'identify-device', label: 'Identify the device', hint: 'Nothing to match on. Read a serial off it.' },
  { kind: 'register-in-itsm', label: 'Register in ITSM', hint: 'Not in ITSM. Add it in Alemba, then re-import the export.' },
  { kind: 'link-to-itsm', label: 'Link to ITSM', hint: 'ITSM already knows it. Link the record on the asset page.' },
  { kind: 'label-device', label: 'Put a label on it', hint: 'Only a person can confirm this one.' },
  { kind: 'resolve-field-differences', label: 'Resolve differences', hint: 'Fields disagree with ITSM. Resolve them on the reconcile page.' },
  { kind: 'correct-in-itsm', label: 'Correct it in ITSM', hint: 'The map is right and Alemba is stale. Closes itself when a later export carries the app value.' },
  { kind: 'confirm-primary-user', label: 'Confirm who uses it', hint: 'The logon record and the map name different people. Someone may simply have changed desks.' },
  { kind: 'create-in-map', label: 'Add it to the map', hint: 'ITSM has it and Nexthink saw it running, so it exists. No need to go and look for it.' },
  { kind: 'verify-disposal', label: 'Confirm or retire', hint: 'ITSM has it, the survey never found it, and Nexthink has not seen it either.' },
  { kind: 'dispose-replaced-machine', label: 'Reuse or set aside', hint: 'A replaced machine is still switched on. Reinstall it into service, or shut it down for decommission.' },
];

const KIND_LABEL = new Map(KINDS.map((k) => [k.kind, k.label]));

/** Days since a task was first raised — the number that says what is being ignored. */
function ageInDays(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

const TaskRow: React.FC<{
  task: NormalisationTask;
  onChanged: () => void;
}> = ({ task, onChanged }) => {
  const [busy, setBusy] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const [reason, setReason] = useState(task.note ?? '');
  const [assignee, setAssignee] = useState(task.assigned_to ?? '');
  /**
   * What the server last accepted for this field. Compared against instead of the prop,
   * which lags behind by a refetch — so pressing Enter and then clicking away sent the
   * same name twice.
   */
  const savedAssignee = useRef(task.assigned_to ?? '');
  const toast = useToast();

  const save = async (changes: Parameters<typeof taskService.updateTask>[1]) => {
    setBusy(true);
    try {
      const { note } = await taskService.updateTask(task._id, changes);
      // The server's caveat is worth more than a success tick: it says the tick will be
      // undone if the cause is still in the data.
      if (note) toast.info(note);
      else toast.success('Saved');
      onChanged();
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Could not update the task'));
    } finally {
      setBusy(false);
      setDismissing(false);
    }
  };

  /** Sends the assignee once, and only when it actually changed. */
  const saveAssignee = (value: string) => {
    if (value === savedAssignee.current) return;
    savedAssignee.current = value;
    save({ assigned_to: value });
  };

  const age = ageInDays(task.first_seen_at);

  return (
    <div className={styles.task}>
      <div className={styles.taskHead}>
        <Badge variant="neutral">{KIND_LABEL.get(task.kind) ?? task.kind}</Badge>
        {task.asset_id
          ? <Link to={`/assets/${task.asset_id}`} className={styles.taskSummary}>{task.summary}</Link>
          : <span className={styles.taskSummary}>{task.summary}</span>}
        {age >= 7 && (
          <span className={styles.age} title={`First raised ${new Date(task.first_seen_at).toLocaleDateString()}`}>
            <Clock size={12} /> {age} days
          </span>
        )}
      </div>

      {task.evidence && <pre className={styles.evidence}>{task.evidence}</pre>}

      <div className={styles.taskActions}>
        <label className={styles.assign}>
          <User size={13} />
          {/* Saves on blur AND on Enter. Blur alone was a trap: typing a name and pressing
              Enter did nothing, and the name was gone on the next refresh — pressing
              Enter in a single field is the one gesture everybody expects to commit it.
              Escape puts back what was stored. */}
          <input
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
            onBlur={() => saveAssignee(assignee)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                // Saved directly rather than by blurring the field: going through blur
                // meant nothing happened unless the field held focus, which is true of a
                // person typing but leaves the behaviour resting on where the caret is.
                saveAssignee(assignee);
                e.currentTarget.blur();
              } else if (e.key === 'Escape') {
                setAssignee(savedAssignee.current);
                e.currentTarget.blur();
              }
            }}
            placeholder="nobody yet"
            aria-label="Assign this task to someone"
          />
        </label>

        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => save({ state: 'done' })}
          title={task.machine_verifiable
            ? 'The data decides this one — if the cause is still there, the next generation reopens it'
            : 'Nothing in any export records a label, so your word is the evidence'}
        >
          <CheckCircle2 size={14} /> Done
        </Button>

        {!dismissing ? (
          <Button variant="outline" size="sm" disabled={busy} onClick={() => setDismissing(true)}>
            <XCircle size={14} /> Dismiss
          </Button>
        ) : (
          <span className={styles.dismissRow}>
            {/* The reason is required by the server, not just asked for here: a decision
                nobody can review is indistinguishable from having forgotten. */}
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this not going to be done?"
              aria-label="Reason for dismissing"
              autoFocus
            />
            <Button
              variant="outline"
              size="sm"
              disabled={busy || !reason.trim()}
              onClick={() => save({ note: reason, state: 'dismissed' })}
            >
              Confirm
            </Button>
            <Button variant="outline" size="sm" onClick={() => setDismissing(false)}>Cancel</Button>
          </span>
        )}

        {!task.machine_verifiable && (
          <span className={styles.humanOnly} title="Nothing in any data source shows a label was applied">
            needs a person
          </span>
        )}
      </div>

      {task.note && task.state !== 'open' && (
        <p className={styles.closedNote}>
          {task.state === 'dismissed' ? 'Dismissed' : 'Closed'} by {task.closed_by ?? 'someone'}: {task.note}
        </p>
      )}
    </div>
  );
};

const NormalisationTasks: React.FC = () => {
  const qc = useQueryClient();
  const toast = useToast();
  const [state, setState] = useState<NormalisationTaskState>('open');
  const [kind, setKind] = useState<NormalisationTaskKind | ''>('');
  const [page, setPage] = useState(1);
  const [generating, setGenerating] = useState(false);

  const summary = useQuery({ queryKey: ['tasks', 'summary'], queryFn: taskService.getSummary });
  const list = useQuery({
    queryKey: ['tasks', 'list', { state, kind, page }] as const,
    queryFn: () => taskService.getTasks({ state, kind: kind || undefined, page, limit: 25 }),
    placeholderData: (previous) => previous,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['tasks'] });
  };

  const regenerate = async () => {
    setGenerating(true);
    try {
      const result = await taskService.generate();
      toast.success(
        `${result.created} new · ${result.reopened} reopened · ${result.closed} closed by the data`
        + (result.awaiting_human > 0 ? ` · ${result.awaiting_human} waiting for a person` : ''),
      );
      refresh();
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Could not re-derive the list'));
    } finally {
      setGenerating(false);
    }
  };

  const openCount = summary.data?.by_state.open ?? 0;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1>Normalisation tasks</h1>
          <p className={styles.subtitle}>
            Derived from the ITSM export, the physical survey, Nexthink and the app — not kept by hand.
            Re-derive after every new export; the list closes what the data proves done by itself.
          </p>
        </div>
        <div className={styles.headerActions}>
          {/* The list is for deciding; the worksheet is for carrying. Linked rather than
              built in, because printing wants a page with no controls on it. */}
          <Link to="/tasks/worksheet" className={styles.worksheetLink}>
            <Printer size={15} /> Worksheet to print or export
          </Link>
          <Button variant="primary" onClick={regenerate} loading={generating} disabled={generating}>
            <RefreshCw size={15} /> Re-derive from the data
          </Button>
        </div>
      </div>

      {/* Context before content: the list below is only as trustworthy as the exports it was
          derived from, and until the import ledger existed nothing recorded their age. */}
      <SourceFreshnessBar />

      {summary.data && (
        summary.data.consistent ? (
          <Card padding="lg" className={styles.doneBanner}>
            <CheckCircle2 size={18} />
            <div>
              <strong>Nothing outstanding.</strong> The inventory, the app and ITSM agree — as far as
              the data can show. {summary.data.by_state.dismissed > 0 && (
                <>{summary.data.by_state.dismissed} task(s) were dismissed with a reason; those are
                decisions, not evidence.</>
              )}
            </div>
          </Card>
        ) : (
          <Card padding="lg" className={styles.countBanner}>
            <div>
              <strong>{openCount}</strong> open task(s)
              {summary.data.open_unassigned > 0 && <> · {summary.data.open_unassigned} nobody has taken</>}
            </div>
          </Card>
        )
      )}

      <Card padding="lg">
        <div className={styles.filters}>
          <div className={styles.stateTabs} role="group" aria-label="Task state">
            {(['open', 'done', 'dismissed'] as NormalisationTaskState[]).map((s) => (
              <button
                key={s}
                className={`${styles.stateTab} ${state === s ? styles.stateTabActive : ''}`}
                onClick={() => { setState(s); setPage(1); }}
              >
                {s} {summary.data ? `(${summary.data.by_state[s] ?? 0})` : ''}
              </button>
            ))}
          </div>
          <select
            className={styles.kindSelect}
            value={kind}
            onChange={(e) => { setKind(e.target.value as NormalisationTaskKind | ''); setPage(1); }}
            aria-label="Filter by kind"
          >
            <option value="">Every kind</option>
            {KINDS.map((k) => {
              const n = summary.data?.by_kind[k.kind]?.[state] ?? 0;
              return <option key={k.kind} value={k.kind}>{k.label} ({n})</option>;
            })}
          </select>
        </div>

        {kind && (
          <p className={styles.kindHint}>{KINDS.find((k) => k.kind === kind)?.hint}</p>
        )}

        {list.isLoading && <p>Loading…</p>}
        {list.data && list.data.tasks.length === 0 && (
          <p className={styles.empty}>
            {state === 'open'
              ? 'Nothing open here. Re-derive if a new ITSM export has been imported since.'
              : `No ${state} tasks.`}
          </p>
        )}

        <div className={styles.list}>
          {list.data?.tasks.map((task) => (
            <TaskRow key={task._id} task={task} onChanged={refresh} />
          ))}
        </div>

        {list.data && list.data.totalPages > 1 && (
          <div className={styles.pagination}>
            <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>← Prev</Button>
            <span>Page {page} of {list.data.totalPages} · {list.data.total} task(s)</span>
            <Button variant="outline" size="sm" disabled={page >= list.data.totalPages} onClick={() => setPage((p) => p + 1)}>Next →</Button>
          </div>
        )}
      </Card>
    </div>
  );
};

export default NormalisationTasks;
