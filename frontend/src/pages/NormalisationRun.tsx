/**
 * NormalisationRun.tsx — "Where are we in this round?" ("/normalisation")
 *
 * A round is: export from ITSM → walk the site → hand both to the app → work the task list
 * → act in Alemba → export again. Every step of that already had a page. What none of them
 * could say is which step is next, or — the one that actually misleads people — that the
 * answer on screen was computed before the newest data arrived.
 *
 * So this page is four steps with their times, and one warning that no single page could
 * give: when the task list is older than the newest export or survey, it says so and puts
 * the re-derive button next to the sentence. A list claiming "nothing outstanding" because
 * it ran before the survey landed is worse than no list at all.
 *
 * It deliberately does not do the steps itself. Loading an export and importing a survey
 * both need the file in front of you and a preview you actually read; a run page that
 * offered a one-click "do everything" would be inviting people to skip exactly the part
 * that catches a partial export.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle, ArrowRight, CheckCircle2, Circle, RefreshCw,
} from 'lucide-react';
import Card from '../components/common/Card';
import Button from '../components/common/Button';
import { useToast } from '../contexts/ToastContext';
import { getApiErrorMessage } from '../utils/apiError';
import { inventoryService, NormalisationStatus } from '../services/inventory.service';
import { taskService } from '../services/task.service';
import styles from '../styles/pages/NormalisationRun.module.css';

/**
 * "3 days ago", and "just now" under a minute.
 *
 * Ages are what matter here rather than dates: nobody remembers whether the export they
 * loaded was the 12th or the 19th, but "27 days ago" is immediately a problem. The exact
 * timestamp stays in the `title`.
 */
function ago(iso: string | null): string {
  if (!iso) return 'never';
  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'} ago`;
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return plural(minutes, 'minute');
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return plural(hours, 'hour');
  const days = Math.floor(hours / 24);
  if (days < 31) return plural(days, 'day');
  return plural(Math.floor(days / 30), 'month');
}

const when = (iso: string | null) => (
  <span className={styles.when} title={iso ? new Date(iso).toLocaleString() : undefined}>
    {ago(iso)}
  </span>
);

const Step: React.FC<{
  index: number;
  title: string;
  done: boolean;
  children: React.ReactNode;
  action: React.ReactNode;
}> = ({ index, title, done, children, action }) => (
  <li className={styles.step}>
    <span className={`${styles.marker} ${done ? styles.markerDone : ''}`} aria-hidden="true">
      {done ? <CheckCircle2 size={18} /> : <Circle size={18} />}
    </span>
    <div className={styles.stepBody}>
      <h2>
        <span className={styles.stepIndex}>{index}</span> {title}
      </h2>
      <div className={styles.stepFacts}>{children}</div>
    </div>
    <div className={styles.stepAction}>{action}</div>
  </li>
);

const NormalisationRun: React.FC = () => {
  const qc = useQueryClient();
  const toast = useToast();
  const [deriving, setDeriving] = React.useState(false);

  const status = useQuery<NormalisationStatus>({
    queryKey: ['inventory', 'status'],
    queryFn: inventoryService.getStatus,
  });

  const rederive = async () => {
    setDeriving(true);
    try {
      const result = await taskService.generate();
      toast.success(
        `${result.created} new · ${result.reopened} reopened · ${result.closed} closed by the data`,
      );
      qc.invalidateQueries({ queryKey: ['inventory', 'status'] });
      qc.invalidateQueries({ queryKey: ['tasks'] });
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Could not re-derive the list'));
    } finally {
      setDeriving(false);
    }
  };

  const s = status.data;

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1>Normalisation run</h1>
          <p className={styles.subtitle}>
            One round: load the ITSM export, hand over the physical survey, look at what
            disagrees, then work the list until nothing is left. Each step is on its own page —
            this says where the round has got to, and what is out of date.
          </p>
        </div>
      </div>

      {status.isLoading && <Card padding="lg"><p>Loading…</p></Card>}
      {status.isError && (
        <Card padding="lg">
          <p className={styles.warn}>
            <AlertTriangle size={15} /> Could not read the round’s state. The pages for each
            step still work on their own.
          </p>
        </Card>
      )}

      {s && (
        <>
          {s.tasks.stale && (
            <Card padding="lg" className={styles.staleBanner}>
              <AlertTriangle size={18} />
              <div>
                <strong>The task list is older than the data.</strong> It was derived{' '}
                {ago(s.tasks.derived_at)}, and newer data has arrived since. Whatever it says
                now describes a situation that has already changed.
              </div>
              <Button variant="primary" onClick={rederive} loading={deriving} disabled={deriving}>
                <RefreshCw size={15} /> Re-derive
              </Button>
            </Card>
          )}

          {!s.tasks.stale && s.tasks.consistent && (
            <Card padding="lg" className={styles.doneBanner}>
              <CheckCircle2 size={18} />
              <div>
                <strong>This round is closed.</strong> Nothing is outstanding and the list was
                derived from the current data. The next round starts with a fresh ITSM export.
              </div>
            </Card>
          )}

          <Card padding="lg">
            <ol className={styles.steps}>
              <Step
                index={1}
                title="Load the ITSM export"
                done={s.itsm_export.records > 0}
                action={<Link className={styles.link} to="/itsm">ITSM Reconcile <ArrowRight size={14} /></Link>}
              >
                {s.itsm_export.records > 0 ? (
                  <p>
                    <strong>{s.itsm_export.records}</strong> record(s) held, loaded {when(s.itsm_export.loaded_at)}.
                  </p>
                ) : (
                  <p>Nothing loaded yet. Export the Hardware Assets from Alemba and load the file.</p>
                )}
              </Step>

              <Step
                index={2}
                title="Hand over the physical survey"
                done={!!s.survey.applied_at}
                action={<Link className={styles.link} to="/inventory-import">Inventory import <ArrowRight size={14} /></Link>}
              >
                {s.survey.applied_at ? (
                  <p>
                    Last applied {when(s.survey.applied_at)} —{' '}
                    <strong>{s.survey.assets_updated ?? 0}</strong> re-placed,{' '}
                    <strong>{s.survey.assets_created ?? 0}</strong> created as local-only.
                  </p>
                ) : (
                  <p>
                    No survey has been applied through the app yet. Preview it first — nothing
                    is written until you apply.
                  </p>
                )}
              </Step>

              <Step
                index={3}
                title="Look at what disagrees"
                done={s.app.linked > 0}
                action={<Link className={styles.link} to="/itsm">Field differences <ArrowRight size={14} /></Link>}
              >
                <p>
                  <strong>{s.app.linked}</strong> asset(s) linked to ITSM ·{' '}
                  <strong>{s.app.local_only}</strong> local-only, still to register in Alemba ·{' '}
                  <strong>{s.app.placed}</strong> of {s.app.total} on a floor plan.
                </p>
                {s.app.placed < s.app.total && (
                  <p className={styles.hint}>
                    The rest are findable by list but not on the map —{' '}
                    <Link to="/unplaced">Unplaced assets</Link> and{' '}
                    <Link to="/progress">Survey progress</Link> show where the gap is.
                  </p>
                )}
              </Step>

              <Step
                index={4}
                title="Work the list until nothing is left"
                done={s.tasks.consistent && !s.tasks.stale}
                action={<Link className={styles.link} to="/tasks">Tasks <ArrowRight size={14} /></Link>}
              >
                {s.tasks.derived_at ? (
                  <p>
                    <strong>{s.tasks.open}</strong> open · {s.tasks.done} closed ·{' '}
                    {s.tasks.dismissed} dismissed with a reason. Derived {when(s.tasks.derived_at)}.
                  </p>
                ) : (
                  <p>The list has never been derived. It is computed from the data — nothing to fill in by hand.</p>
                )}
                <Button variant="outline" size="sm" onClick={rederive} loading={deriving} disabled={deriving}>
                  <RefreshCw size={14} /> Re-derive from the data
                </Button>
              </Step>
            </ol>
          </Card>
        </>
      )}
    </div>
  );
};

export default NormalisationRun;
