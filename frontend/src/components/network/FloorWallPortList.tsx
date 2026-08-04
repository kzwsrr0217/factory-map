/**
 * FloorWallPortList.tsx — "Which network sockets exist on this floor", grouped
 * by room.
 *
 * This is the answer the map used to be asked for by drawing socket dots on the
 * floor plan. A list is both cheaper to maintain and more useful: it can show
 * each socket's *state*, which a dot cannot.
 *
 * Two independent axes are shown per socket, because either one alone misleads:
 *   - `patch_status` — how far along the cabling chain it is;
 *   - `occupied_by`  — whether a device already holds it.
 * A socket that is free but unpatched has no network at all; assigning a device
 * to it looks like the job is done. See docs/CONNECTIONS_WORKFLOW.md.
 */
import React, { useMemo, useState } from 'react';
import Badge from '../common/Badge';
import Button from '../common/Button';
import { WallPort, WallPortPatchStatus } from '../../services/network.service';
import styles from '../../styles/components/FloorWallPortList.module.css';

interface FloorWallPortListProps {
  ports: WallPort[];
  onPortClick?: (port: WallPort) => void;
  /**
   * Label to start filtered on, from the global search box's `?socket=` link. A
   * search hit that dropped you on a floor with 500 sockets and no hint which one it
   * meant answered the question with a haystack.
   */
  initialFilter?: string;
}

const STATUS_LABEL: Record<WallPortPatchStatus, string> = {
  unpatched: 'Not patched',
  patched: 'Patched, no switch',
  live: 'Live',
};

const STATUS_VARIANT: Record<WallPortPatchStatus, 'neutral' | 'warning' | 'success'> = {
  unpatched: 'neutral',
  patched: 'warning',
  live: 'success',
};

/** Rooms first (A→Z), then the not-yet-assigned bucket last. */
const UNASSIGNED = '__unassigned__';

interface RoomGroup {
  key: string;
  name: string;
  ports: WallPort[];
}

function groupByRoom(ports: WallPort[]): RoomGroup[] {
  const groups = new Map<string, RoomGroup>();
  for (const port of ports) {
    const key = port.workarea?._id ?? UNASSIGNED;
    const name = port.workarea?.name ?? 'No room assigned';
    const group = groups.get(key) ?? { key, name, ports: [] };
    group.ports.push(port);
    groups.set(key, group);
  }
  return [...groups.values()].sort((a, b) => {
    if (a.key === UNASSIGNED) return 1;
    if (b.key === UNASSIGNED) return -1;
    return a.name.localeCompare(b.name);
  });
}

const FloorWallPortList: React.FC<FloorWallPortListProps> = ({ ports, onPortClick, initialFilter = '' }) => {
  // Default off: on a fully surveyed floor the live-and-occupied sockets are the
  // bulk of the list and the interesting ones are the gaps.
  const [onlyFree, setOnlyFree] = useState(false);
  const [labelFilter, setLabelFilter] = useState(initialFilter);

  const visible = useMemo(() => {
    const needle = labelFilter.trim().toLowerCase();
    return ports.filter((p) => {
      if (onlyFree && p.occupied_by) return false;
      if (needle && !p.label.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [ports, onlyFree, labelFilter]);
  const groups = useMemo(() => groupByRoom(visible), [visible]);

  const counts = useMemo(() => ({
    total: ports.length,
    free: ports.filter((p) => !p.occupied_by).length,
    live: ports.filter((p) => p.patch_status === 'live').length,
    unpatched: ports.filter((p) => p.patch_status === 'unpatched').length,
  }), [ports]);

  if (ports.length === 0) {
    return (
      <div className={styles.empty}>
        <p>No network sockets recorded on this floor yet.</p>
      </div>
    );
  }

  return (
    <div>
      <div className={styles.summary}>
        <input
          className={styles.filterInput}
          value={labelFilter}
          onChange={(e) => setLabelFilter(e.target.value)}
          placeholder="Find a label, e.g. R1/001"
          aria-label="Filter sockets by label"
        />
        <span><strong>{counts.total}</strong> sockets</span>
        <span><strong>{counts.free}</strong> free</span>
        <span><strong>{counts.live}</strong> live</span>
        {counts.unpatched > 0 && (
          <span className={styles.summaryWarn}><strong>{counts.unpatched}</strong> not patched</span>
        )}
        <Button variant="outline" size="sm" onClick={() => setOnlyFree((v) => !v)}>
          {onlyFree ? 'Show all' : 'Only free'}
        </Button>
      </div>

      {groups.map((group) => (
        <div key={group.key} className={styles.group}>
          <h4 className={styles.groupName}>
            {group.name}
            <span className={styles.groupCount}>{group.ports.length}</span>
          </h4>
          <div className={styles.portGrid}>
            {group.ports.map((port) => {
              const status = port.patch_status ?? 'unpatched';
              return (
                <button
                  key={port._id}
                  type="button"
                  className={styles.port}
                  onClick={() => onPortClick?.(port)}
                  title={
                    port.patch_panel_name
                      ? `${port.patch_panel_name} port ${port.patch_port ?? '?'}${port.rack_name ? ` · rack ${port.rack_name}` : ''}`
                      : 'Not patched to a panel yet'
                  }
                >
                  <span className={styles.portLabel}>{port.label}</span>
                  <Badge variant={STATUS_VARIANT[status]}>{STATUS_LABEL[status]}</Badge>
                  <span className={styles.portOccupant}>
                    {port.occupied_by ? port.occupied_by.display_name : 'free'}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {visible.length === 0 && (
        <div className={styles.empty}>
          {/* Which of the two filters emptied the list matters: one is a dead end, the
              other just needs different text. */}
          <p>
            {labelFilter.trim()
              ? `No socket on this floor matches “${labelFilter.trim()}”.`
              : 'Every socket on this floor is in use.'}
          </p>
          {labelFilter.trim() && (
            <Button variant="outline" size="sm" onClick={() => setLabelFilter('')}>Clear the label filter</Button>
          )}
        </div>
      )}
    </div>
  );
};

export default FloorWallPortList;
