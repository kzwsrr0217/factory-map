/**
 * SurveyProgress.tsx — "How far has the survey got, and where did it stop?" ("/progress")
 *
 * Recording a factory takes weeks and several people walking different floors. The
 * dashboard's estate-wide totals cannot answer the question that comes up every
 * morning — which floor is finished, which was left half-done — so this page shows
 * one row per floor with the three things that make a floor "recorded": its rooms,
 * its devices standing on the plan, and its sockets patched through to a switch.
 *
 * Everything is counted server-side (GET /floors/progress); nothing is derived from
 * a downloaded list, because the socket counts alone run to thousands of rows.
 *
 * The backlog of devices assigned to no floor at all is shown first and deliberately
 * loudly: a per-floor table on its own reads as "nearly done" while most of the
 * estate is still sitting outside the building.
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { MapPin, LayoutGrid, Plug, AlertTriangle } from 'lucide-react';
import Card from '../components/common/Card';
import Button from '../components/common/Button';
import { floorService, FloorProgress } from '../services/floor.service';
import styles from '../styles/pages/SurveyProgress.module.css';

/** A count over a total, with the bar showing the same thing for scanning down a column. */
const Meter: React.FC<{ done: number; total: number; label: string }> = ({ done, total, label }) => {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className={styles.meter}>
      <span className={styles.meterText}>
        {total > 0 ? <><strong>{done}</strong> / {total}</> : <span className={styles.meterNone}>none yet</span>}
      </span>
      <span className={styles.meterTrack} role="presentation">
        <span
          className={`${styles.meterFill} ${pct === 100 ? styles.meterFillDone : ''}`}
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className={styles.meterLabel}>{label}{total > 0 ? ` · ${pct}%` : ''}</span>
    </div>
  );
};

const SurveyProgress: React.FC = () => {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['floors', 'progress'] as const,
    queryFn: floorService.getProgress,
  });

  const floors = data?.floors ?? [];
  const byBuilding = React.useMemo(() => {
    const map = new Map<string, { name: string; floors: FloorProgress[] }>();
    for (const f of floors) {
      const key = f.building_id;
      const group = map.get(key) ?? { name: f.building_name ?? 'Unnamed building', floors: [] };
      group.floors.push(f);
      map.set(key, group);
    }
    return [...map.values()];
  }, [floors]);

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1>Survey progress</h1>
          <p className={styles.subtitle}>
            Counted from the database, floor by floor. A floor is recorded once its rooms exist,
            its devices stand on the plan, and its sockets are patched through to a switch.
          </p>
        </div>
        <Button variant="outline" onClick={() => refetch()} loading={isLoading}>Refresh</Button>
      </div>

      {isError && (
        <Card padding="lg">
          <p>Could not load the progress figures. <Button variant="outline" size="sm" onClick={() => refetch()}>Try again</Button></p>
        </Card>
      )}

      {data && data.unassigned_assets > 0 && (
        <Card padding="lg" className={styles.backlog}>
          <AlertTriangle size={18} />
          <div>
            <strong>{data.unassigned_assets}</strong> devices are on no floor yet — they exist in the
            database (from ITSM or an import) but nobody has said where they are.
          </div>
          <Link to="/unplaced" className={styles.backlogLink}>Open the backlog</Link>
        </Card>
      )}

      {isLoading && <Card padding="lg"><p>Loading…</p></Card>}

      {!isLoading && floors.length === 0 && (
        <Card padding="lg">
          <p>No floors recorded yet — a survey needs somewhere to put things first.</p>
          <Link to="/buildings"><Button variant="primary">Add a building and its floors</Button></Link>
        </Card>
      )}

      {byBuilding.map((building) => (
        <Card key={building.name} padding="lg">
          <h2 className={styles.buildingName}>{building.name}</h2>
          <div className={styles.floorList}>
            {building.floors.map((f) => (
              <div key={f.floor_id} className={styles.floorRow}>
                <div className={styles.floorHead}>
                  <Link to={`/floors/${f.floor_id}`} className={styles.floorName}>{f.floor_name}</Link>
                  <span className={styles.floorLevel}>Level {f.floor_number}</span>
                  {!f.has_floor_plan && (
                    <span className={styles.warnTag} title="Devices can be assigned to this floor, but not positioned">
                      no floor plan uploaded
                    </span>
                  )}
                </div>
                <div className={styles.floorMetrics}>
                  <div className={styles.metric}>
                    <span className={styles.metricHead}><LayoutGrid size={14} /> Rooms</span>
                    <span className={styles.metricValue}>{f.work_areas}</span>
                  </div>
                  <div className={styles.metric}>
                    <span className={styles.metricHead}><MapPin size={14} /> Devices on the plan</span>
                    <Meter done={f.assets.placed} total={f.assets.total} label="placed" />
                  </div>
                  <div className={styles.metric}>
                    <span className={styles.metricHead}><Plug size={14} /> Sockets live</span>
                    {/* Patched and live are separate states on purpose: a socket that
                        reaches a panel but no switch has no network, which is the
                        mistake the whole workflow exists to catch. */}
                    <Meter done={f.sockets.live} total={f.sockets.total} label="live" />
                    {f.sockets.total > 0 && (
                      <span className={styles.socketDetail}>
                        {f.sockets.patched} patched · {f.sockets.occupied} in use
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
};

export default SurveyProgress;
