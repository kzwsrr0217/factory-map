/**
 * SwitchImpactPanel.tsx — "What goes dark if we take this switch down?"
 *
 * Shown on a switch's asset page. Lists every socket hanging off it with the
 * device, person and room behind each — the list you need before a maintenance
 * window, and the one nobody can produce by hand once a floor has a few hundred
 * sockets.
 *
 * Loaded on demand rather than with the page: it is one extra query, and it is
 * only interesting for switches, which are a handful of the assets in the system.
 */
import React, { useState } from 'react';
import Button from '../common/Button';
import Badge from '../common/Badge';
import { networkService, SwitchImpact } from '../../services/network.service';
import { useToast } from '../../contexts/ToastContext';
import { getApiErrorMessage } from '../../utils/apiError';
import styles from '../../styles/components/SwitchImpactPanel.module.css';

interface SwitchImpactPanelProps {
  assetId: string;
}

const SwitchImpactPanel: React.FC<SwitchImpactPanelProps> = ({ assetId }) => {
  const toast = useToast();
  const [impact, setImpact] = useState<SwitchImpact | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      setImpact(await networkService.getSwitchImpact(assetId));
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to work out the impact'));
    } finally {
      setLoading(false);
    }
  };

  if (!impact) {
    return (
      <div className={styles.prompt}>
        <Button variant="outline" size="sm" onClick={load} loading={loading}>
          Show what depends on this switch
        </Button>
      </div>
    );
  }

  if (impact.socket_count === 0) {
    return (
      <p className={styles.empty}>
        No sockets are recorded against this switch. Either nothing is patched to it,
        or its switch ports have not been surveyed yet — those look the same from
        here, so check the rack before assuming a window is safe.
      </p>
    );
  }

  return (
    <div>
      <div className={styles.summary}>
        <span><strong>{impact.socket_count}</strong> socket{impact.socket_count === 1 ? '' : 's'}</span>
        <span><strong>{impact.device_count}</strong> device{impact.device_count === 1 ? '' : 's'}</span>
        {impact.rooms.length > 0 && <span><strong>{impact.rooms.length}</strong> room{impact.rooms.length === 1 ? '' : 's'}</span>}
        {impact.people.length > 0 && <span><strong>{impact.people.length}</strong> {impact.people.length === 1 ? 'person' : 'people'}</span>}
      </div>

      {impact.rooms.length > 0 && (
        <p className={styles.rooms}><strong>Rooms:</strong> {impact.rooms.join(', ')}</p>
      )}
      {impact.people.length > 0 && (
        <p className={styles.rooms}><strong>People:</strong> {impact.people.join(', ')}</p>
      )}

      <div className={styles.list}>
        {impact.sockets.map((s) => (
          <div key={s.wall_port_id} className={styles.row}>
            <span className={styles.label}>{s.label}</span>
            <span className={styles.port}>{s.switch_port ?? '—'}</span>
            <span className={styles.device}>
              {s.device ? s.device.display_name : <em className={styles.free}>nothing plugged in</em>}
            </span>
            <span className={styles.person}>{s.device?.person_full_name ?? ''}</span>
            {s.room_name && <Badge variant="neutral">{s.room_name}</Badge>}
          </div>
        ))}
      </div>
    </div>
  );
};

export default SwitchImpactPanel;
