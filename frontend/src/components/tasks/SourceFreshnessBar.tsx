/**
 * SourceFreshnessBar.tsx — how old each source is, above the list of what is left.
 *
 * The task list answers "what is outstanding" and says nothing about whether the data behind it is
 * worth acting on. "7 devices quiet for 30+ days" means one thing against yesterday's export and
 * another against one taken three weeks ago.
 *
 * Three rows of numbers, deliberately not a grid of the sources against each other: they do not
 * have opinions on the same fields and their grain differs, so a matrix would be mostly empty cells
 * that read as disagreements. Per-device comparison lives on the asset page instead.
 *
 * Loaded with the page — it is four counts and one lookup per source, and it is the context for
 * everything below it, so hiding it behind a click would defeat the point.
 */
import React, { useEffect, useState } from 'react';
import { AlertTriangle, Database } from 'lucide-react';
import { taskService, SourceStatus } from '../../services/task.service';
import styles from '../../styles/components/SourceFreshnessBar.module.css';

/**
 * In words, because "0d ago" reads worse than "today".
 *
 * "Today" and "yesterday" are decided on the CALENDAR DATE, not on elapsed hours. The service's
 * `age_days` floors the elapsed time, so an import at 14:28 yesterday afternoon read as 0 days at
 * 05:52 this morning — and the bar said "imported today" about yesterday's data. Fifteen hours is
 * not a rounding error when the whole point of the line is how old the data is.
 *
 * Anything older than yesterday falls back to `age_days`, where floored elapsed days and calendar
 * days agree closely enough that the difference cannot mislead.
 */
function age(status: SourceStatus): string {
  if (!status.loaded) return 'nothing loaded';
  if (!status.imported_at) return 'import date unknown';
  const day = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  const at = new Date(status.imported_at);
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (day(at) === day(now)) return 'imported today';
  if (day(at) === day(yesterday)) return 'imported yesterday';
  return `imported ${status.age_days ?? '?'} days ago`;
}

const SourceFreshnessBar: React.FC = () => {
  const [sources, setSources] = useState<SourceStatus[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    taskService.getSourceFreshness()
      .then(setSources)
      /* Silent but visible: the bar is context, and a toast about it would interrupt the work the
         page is actually for. It says it could not load rather than rendering nothing. */
      .catch(() => setFailed(true));
  }, []);

  if (failed) {
    return <p className={styles.failed}>Could not read how fresh the sources are.</p>;
  }
  if (!sources) return <div className={styles.loading} aria-busy="true" />;

  return (
    <div className={styles.bar}>
      <h3 className={styles.heading}>
        <Database size={14} /> Where the data comes from
      </h3>
      <ul className={styles.list}>
        {sources.map((s) => (
          <li key={s.source} className={s.loaded ? styles.row : styles.rowEmpty}>
            <div className={styles.top}>
              <strong className={styles.label}>{s.label}</strong>
              <span className={styles.rows}>{s.rows.toLocaleString()} rows</span>
              <span className={styles.age}>{age(s)}</span>
              {/* Only shown when the source states it. Most exports carry no date of their own,
                  and a guessed one would be inherited by every count built on it. */}
              {s.taken_at && (
                <span className={styles.taken}>
                  data as of {new Date(s.taken_at).toISOString().slice(0, 10)}
                </span>
              )}
            </div>
            <div className={styles.coverage}>{s.coverage}</div>
            {s.counts && (s.counts.created || s.counts.gone || s.counts.changed) ? (
              <div className={styles.delta}>
                since the previous import:
                {s.counts.created ? ` ${s.counts.created} new` : ''}
                {s.counts.changed ? ` ${s.counts.changed} changed` : ''}
                {s.counts.gone ? ` ${s.counts.gone} gone` : ''}
              </div>
            ) : null}
            {s.attention && (
              <div className={styles.attention}>
                <AlertTriangle size={12} /> {s.attention}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
};

export default SourceFreshnessBar;
