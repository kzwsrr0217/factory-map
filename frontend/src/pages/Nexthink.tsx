/**
 * Nexthink.tsx — the third source, and the questions it raises.
 *
 * Until this page existed the whole Nexthink round was command-line: the import and all five reports
 * were scripts, so one person could run it and nobody else could. "Run this in a terminal" is not a
 * process; it is an instruction to whoever happens to have one.
 *
 * ── What is deliberately NOT here ───────────────────────────────────────────────
 * The findings that are ACTIONS. A machine on the network that no register holds, a replaced machine
 * still reporting, a person the logons disagree about — those become tasks and belong on the Tasks
 * page, where they can be assigned, dismissed with a reason, and closed by the data. Repeating them
 * here would create a second list to reconcile with the first.
 *
 * What is here is the state of the source and the questions it raises: how much it covers, which
 * machines it can see that the map cannot, which have gone quiet, and where the logon record and the
 * map name different people.
 *
 * ── Why every section says what it cannot know ──────────────────────────────────
 * Nexthink only sees machines carrying its agent — never a monitor, dock or phone. Every number here
 * would be read as a gap in the estate rather than a limit of the source unless the page says so, and
 * the most expensive mistake this data can cause is treating "no agent" as "missing".
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  Upload, RefreshCw, AlertTriangle, Radio, HelpCircle, MapPinOff, UserX, Clock,
} from 'lucide-react';
import Card from '../components/common/Card';
import Button from '../components/common/Button';
import Breadcrumb from '../components/common/Breadcrumb';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { getApiErrorMessage } from '../utils/apiError';
import {
  nexthinkService, readText, NexthinkOverview, NexthinkImportPlan,
} from '../services/nexthink.service';
import styles from '../styles/pages/Nexthink.module.css';

function asDate(value: string | null): string {
  return value ? new Date(value).toISOString().slice(0, 10) : '—';
}

const Nexthink: React.FC = () => {
  const [overview, setOverview] = useState<NexthinkOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState<NexthinkImportPlan | null>(null);
  const [devicesCsv, setDevicesCsv] = useState<{ name: string; text: string } | null>(null);
  const [loginsCsv, setLoginsCsv] = useState<{ name: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const { user } = useAuth();
  const toast = useToast();
  const isOperator = user?.role === 'admin' || user?.role === 'operator';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setOverview(await nexthinkService.getOverview());
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Could not read the Nexthink snapshot.'));
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const pick = async (
    file: File | undefined,
    set: (v: { name: string; text: string } | null) => void,
  ) => {
    if (!file) return;
    try {
      set({ name: file.name, text: await readText(file) });
      // A new file invalidates the previous dry run; leaving it on screen would invite applying
      // the numbers from one export with the contents of another.
      setPlan(null);
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Could not read that file.'));
    }
  };

  const run = async (apply: boolean) => {
    setBusy(true);
    try {
      const result = await nexthinkService.import({
        devicesCsv: devicesCsv?.text,
        loginsCsv: loginsCsv?.text,
        apply,
      });
      setPlan(result);
      if (apply) {
        toast.success('Snapshot replaced.');
        await load();
      }
    } catch (err) {
      toast.error(getApiErrorMessage(err, apply ? 'Import failed.' : 'Could not check those files.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={styles.page}>
      <Breadcrumb items={[{ label: 'Nexthink' }]} />

      <div className={styles.header}>
        <div>
          <h1>Nexthink</h1>
          <p className={styles.subtitle}>
            What the machines report about themselves — the only source here that is not something a
            person typed. It is evidence, never a system of record: nothing in this app writes to
            Nexthink, and nothing here changes an asset on its own.
          </p>
        </div>
        <Button variant="secondary" onClick={load} loading={loading}>
          <RefreshCw size={15} /> Refresh
        </Button>
      </div>

      {/* ── Load an export ─────────────────────────────────────────────────── */}
      {isOperator && (
        <Card padding="lg">
          <h3><Upload size={16} /> Load an export</h3>
          <p className={styles.hint}>
            Both come from <strong>Investigations → NQL editor → Run → export the grid</strong>. Scope
            both to the same entities, or the two files describe different populations and every
            comparison between them is quietly wrong. The IPCs live in the Industry entities, so an
            export scoped to Veszprem-Client alone silently omits every shop-floor machine.
          </p>

          <div className={styles.pickers}>
            <label className={styles.picker}>
              <span>Devices</span>
              <input type="file" accept=".csv" onChange={(e) => pick(e.target.files?.[0], setDevicesCsv)} />
              <em>{devicesCsv ? devicesCsv.name : 'no file chosen'}</em>
            </label>
            <label className={styles.picker}>
              <span>Logons</span>
              <input type="file" accept=".csv" onChange={(e) => pick(e.target.files?.[0], setLoginsCsv)} />
              <em>{loginsCsv ? loginsCsv.name : 'no file chosen'}</em>
            </label>
          </div>

          <div className={styles.actions}>
            <Button
              variant="secondary"
              disabled={!devicesCsv && !loginsCsv}
              loading={busy && !plan}
              onClick={() => run(false)}
            >
              Check without importing
            </Button>
            <Button
              variant="primary"
              disabled={!plan}
              loading={busy}
              onClick={() => run(true)}
              title={plan ? undefined : 'Check the files first'}
            >
              Replace the snapshot
            </Button>
          </div>
          <p className={styles.hint}>
            The check writes nothing and is where the numbers worth reading are. Importing replaces
            both tables wholesale — that is on purpose, so the tables always mean “what Nexthink
            reported as of the last export” rather than a merged cache nobody can reason about.
          </p>

          {plan && (
            <div className={styles.plan}>
              <h4>{plan.applied ? 'Imported' : 'Would import'}</h4>
              <ul>
                <li>{plan.devices.parsed} device(s), {plan.logins.parsed} logon row(s)</li>
                <li>
                  {plan.join.matched} of {plan.devices.parsed} matched an asset in the map
                  {plan.join.unknown_to_map.length > 0
                    && ` · ${plan.join.unknown_to_map.length} the map has never heard of`}
                </li>
                <li>
                  {plan.join.never_seen_by_nexthink} of {plan.join.visible_type_assets} agent-carrying
                  assets are absent from this export — inactive, or outside the exported entities. A
                  question, not a verdict.
                </li>
                {plan.logins.near_ties > 0 && (
                  <li>
                    {plan.logins.near_ties} device(s) have their top two users within one logon of each
                    other — shared machines, where “whose is this” has no single answer
                  </li>
                )}
                {plan.gone_since_last_import === null ? (
                  <li>No earlier import on record, so nothing can be said about what disappeared.</li>
                ) : plan.gone_since_last_import.device_names.length === 0 ? (
                  <li>Nothing has dropped out since {asDate(plan.gone_since_last_import.previous_run_at)}.</li>
                ) : (
                  <li>
                    <strong>{plan.gone_since_last_import.device_names.length} device(s)</strong> present
                    in the import of {asDate(plan.gone_since_last_import.previous_run_at)} and absent
                    now: {plan.gone_since_last_import.device_names.slice(0, 12).join(', ')}
                  </li>
                )}
              </ul>
            </div>
          )}
        </Card>
      )}

      {loading && !overview && <Card padding="lg">Reading the snapshot…</Card>}

      {overview && !overview.loaded && (
        <Card padding="lg">
          <p>
            No Nexthink export has been loaded, so none of this source&apos;s questions can be asked
            yet. {isOperator ? 'Load one above.' : 'Ask an operator to load one.'}
          </p>
        </Card>
      )}

      {overview?.loaded && (
        <>
          {/* ── Coverage ─────────────────────────────────────────────────── */}
          <Card padding="lg">
            <h3><Radio size={16} /> What this snapshot covers</h3>
            <p className={styles.hint}>
              {overview.device_count} device(s) and {overview.login_count} logon row(s), imported{' '}
              {asDate(overview.imported_at)}
              {overview.taken_at && <> · newest sighting in the export {asDate(overview.taken_at)}</>}.
            </p>
            <table className={styles.table}>
              <thead>
                <tr><th>Nexthink entity</th><th>Devices</th><th>On Windows 11</th></tr>
              </thead>
              <tbody>
                {overview.by_entity.map((e) => (
                  <tr key={e.entity}>
                    <td>{e.entity}</td>
                    <td>{e.total}</td>
                    <td>
                      {e.windows_11}
                      {e.windows_11 === 0 && e.total > 0 && (
                        <span className={styles.note}> none</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className={styles.caveat}>
              <HelpCircle size={13} /> {overview.never_seen.count} of{' '}
              {overview.never_seen.of_visible_type} assets of a type Nexthink <em>could</em> see are
              absent from this export. Most of that is not a gap: a machine has to carry the agent to
              report at all, and no monitor, dock or phone ever does.
            </p>
          </Card>

          {/* ── On the network, not in the map ───────────────────────────── */}
          <Card padding="lg">
            <h3><MapPinOff size={16} /> On the network, not in the map — {overview.unknown_to_map.length}</h3>
            <p className={styles.hint}>
              The strongest thing this source contributes. A machine cannot report without existing and
              being switched on, so there is no “maybe it was decommissioned” reading of these.
            </p>
            {overview.unknown_to_map.length === 0 ? (
              <p>Every machine Nexthink can see is in the map.</p>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Device</th><th>Known to ITSM?</th><th>What it is</th>
                    <th>Last seen</th><th>Heaviest user</th>
                  </tr>
                </thead>
                <tbody>
                  {overview.unknown_to_map.map((d) => (
                    <tr key={d.device_name}>
                      <td><strong>{d.device_name}</strong></td>
                      <td>
                        {d.itsm ? (
                          <span className={styles.ok}>yes — can be created from the export</span>
                        ) : d.newer_than_itsm_export ? (
                          /* Not a finding: the export simply predates the device, and sending
                             somebody to create a CI that may exist is how a duplicate is made. */
                          <span className={styles.note}>newer than the loaded ITSM export</span>
                        ) : (
                          <span className={styles.bad}>no — in no register at all</span>
                        )}
                      </td>
                      <td>{d.hardware}<span className={styles.note}> {d.os_name}</span></td>
                      <td>{asDate(d.last_seen)}</td>
                      <td>
                        {d.top_person ?? <span className={styles.note}>no named logon</span>}
                        {d.person_rooms.length === 1 && (
                          <span className={styles.note}> · their kit is in {d.person_rooms[0]}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className={styles.caveat}>
              <HelpCircle size={13} /> The ones ITSM knows can be created from the{' '}
              <strong>ITSM Reconcile → Unlinked MMH assets</strong> list. The ones in no register need
              a CI in Alemba first — this app never invents a device Alemba has not confirmed.
            </p>
          </Card>

          {/* ── Quiet ────────────────────────────────────────────────────── */}
          <Card padding="lg">
            <h3><Clock size={16} /> Stopped reporting — {overview.quiet.quiet.length}</h3>
            <p className={styles.hint}>
              Counted back from the newest sighting in the export, not from today: against a
              three-week-old export, today&apos;s date would add three weeks of imaginary silence to
              every device.
            </p>
            <div className={styles.buckets}>
              {overview.quiet.buckets.map((b) => (
                <span key={b.label}><strong>{b.count}</strong> {b.label}</span>
              ))}
            </div>
            {overview.quiet.holiday_season && (
              <p className={styles.warn}>
                <AlertTriangle size={13} /> This export falls in the holiday season, when several weeks
                of silence is far more often leave than a dead machine. Check the person before the
                device.
              </p>
            )}
            {overview.quiet.quiet.length > 0 && (
              <table className={styles.table}>
                <thead>
                  <tr><th>Device</th><th>Quiet</th><th>In the map</th><th>Person</th><th>Room</th></tr>
                </thead>
                <tbody>
                  {overview.quiet.quiet.map((q) => (
                    <tr key={q.device_name}>
                      <td><strong>{q.device_name}</strong></td>
                      <td>{q.days_quiet} days</td>
                      <td>
                        {q.map_state === 'replaced'
                          /* Expected to be quiet. The interesting case is the opposite, and that one
                             is already a task. */
                          ? <span className={styles.note}>already replaced — expected</span>
                          : q.map_state === 'absent'
                            ? <span className={styles.note}>not in the map</span>
                            : 'live'}
                      </td>
                      <td>{q.person ?? '—'}</td>
                      <td>{q.room ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className={styles.caveat}>
              <HelpCircle size={13} /> This is the shallow end by construction. Nexthink drops
              long-inactive devices from the export entirely, so a machine switched off months ago does
              not appear here with an old date — it disappears, and only a comparison against the
              previous import can see that.
              {overview.disappeared_since_last_import === null
                ? ' There is no earlier import on record yet, so that comparison is not available.'
                : overview.disappeared_since_last_import.device_names.length === 0
                  ? ` Nothing has dropped out since ${asDate(overview.disappeared_since_last_import.previous_run_at)}.`
                  : ` Since ${asDate(overview.disappeared_since_last_import.previous_run_at)}: ${overview.disappeared_since_last_import.device_names.join(', ')}.`}
            </p>
          </Card>

          {/* ── Who uses it ──────────────────────────────────────────────── */}
          <Card padding="lg">
            <h3><UserX size={16} /> The logons name a different person — {overview.person_mismatches.length}</h3>
            <p className={styles.hint}>
              Only the clear cases. Shared machines and devices with too few logons to mean anything are
              left out rather than listed: a person who changed desks looks exactly like this, so
              neither side is assumed wrong.
            </p>
            {overview.person_mismatches.length === 0 ? (
              <p>Nowhere the logon record and the map disagree clearly.</p>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr><th>Device</th><th>The map says</th><th>The logons say</th></tr>
                </thead>
                <tbody>
                  {overview.person_mismatches.map((m) => (
                    <tr key={m.device_name}>
                      <td>
                        <a href={`/assets/${m.asset_id}`}>{m.asset_display_name}</a>
                      </td>
                      <td>{m.asset_person ?? '—'}</td>
                      <td>
                        {m.nexthink?.full_name}
                        <span className={styles.note}> {m.nexthink?.logins}×</span>
                        {m.nexthink?.runner_up && (
                          <span className={styles.note}>
                            {' '}· then {m.nexthink.runner_up.full_name ?? '(no AD name)'}{' '}
                            {m.nexthink.runner_up.logins}×
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className={styles.caveat}>
              <HelpCircle size={13} /> These are also on the <strong>Tasks</strong> page as
              “confirm who uses it”, which is where one can be assigned or dismissed with a reason. The
              asset page shows all four sources side by side for a single device.
            </p>
          </Card>
        </>
      )}
    </div>
  );
};

export default Nexthink;
