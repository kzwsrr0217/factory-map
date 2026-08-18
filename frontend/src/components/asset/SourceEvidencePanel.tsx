/**
 * SourceEvidencePanel.tsx — what each source says about this one device.
 *
 * The answer to "why does the app think this, and who disagrees?" at the moment you are looking at
 * the device. Four columns: the map's own record, ITSM, Nexthink, the physical survey.
 *
 * Loaded on demand, like SwitchImpactPanel: it is several extra queries and most visits to an
 * asset page are not about reconciling it.
 *
 * ── Two things this renders carefully, because getting them wrong invents problems ──
 * A cell where the source CANNOT know the field shows an em dash, not a blank — Nexthink has no
 * opinion on who a device is assigned to, and a blank there reads as "nobody", which is a
 * different claim. And a cell whose value is in another vocabulary (Nexthink's desktop/laptop
 * against the app's workstation/monitor; ITSM's site-level location against a room) is shown with
 * its reason and never counted as a disagreement. The backend decides both; this only renders them.
 */
import React, { useState } from 'react';
import { AlertTriangle, Layers } from 'lucide-react';
import Button from '../common/Button';
import { assetService, AssetEvidence, EvidenceCell } from '../../services/asset.service';
import { useToast } from '../../contexts/ToastContext';
import { getApiErrorMessage } from '../../utils/apiError';
import styles from '../../styles/components/SourceEvidencePanel.module.css';

interface SourceEvidencePanelProps {
  assetId: string;
}

const SOURCES: Array<{ key: 'itsm' | 'nexthink' | 'survey'; label: string }> = [
  { key: 'itsm', label: 'ITSM' },
  { key: 'nexthink', label: 'Nexthink' },
  { key: 'survey', label: 'Survey' },
];

function asDate(value: string | null): string {
  return value ? new Date(value).toISOString().slice(0, 10) : '—';
}

/** One cell. The three states are deliberately visually distinct. */
const Cell: React.FC<{ cell: EvidenceCell }> = ({ cell }) => {
  if (!cell.has_opinion) {
    return <td className={styles.noOpinion} title="This source cannot know this field">—</td>;
  }
  return (
    <td className={cell.comparable === false ? styles.notCompared : undefined}>
      {cell.value ?? <span className={styles.empty}>(empty)</span>}
      {cell.qualifier && <span className={styles.qualifier}>{cell.qualifier}</span>}
    </td>
  );
};

const SourceEvidencePanel: React.FC<SourceEvidencePanelProps> = ({ assetId }) => {
  const [evidence, setEvidence] = useState<AssetEvidence | null>(null);
  const [loading, setLoading] = useState(false);
  const toast = useToast();

  const load = async () => {
    setLoading(true);
    try {
      setEvidence(await assetService.getEvidence(assetId));
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Could not load the source comparison.'));
    } finally {
      setLoading(false);
    }
  };

  if (!evidence) {
    return (
      <div className={styles.prompt}>
        <Button size="sm" variant="secondary" onClick={load} loading={loading}>
          <Layers size={14} /> Compare the sources
        </Button>
        <span className={styles.promptHint}>
          What ITSM, Nexthink and the physical survey each say about this device.
        </span>
      </div>
    );
  }

  const flagged = evidence.fields.filter((f) => f.disagrees).length;

  return (
    <div className={styles.panel}>
      <div className={styles.sourceBar}>
        {SOURCES.map(({ key, label }) => {
          const s = evidence.sources[key];
          return (
            <div key={key} className={s.present ? styles.sourceOn : styles.sourceOff}>
              <strong>{label}</strong>
              {s.present
                ? <span> as of {asDate(s.as_of)}</span>
                /* The reason matters more than the fact: a monitor missing from Nexthink is
                   expected, a workstation missing from it is a question. */
                : <span className={styles.absent} title={s.absent_reason}>nothing here</span>}
            </div>
          );
        })}
      </div>

      {flagged === 0 ? (
        <p className={styles.agree}>
          Every field the sources can compare agrees.
        </p>
      ) : (
        <p className={styles.disagreeCount}>
          <AlertTriangle size={14} /> {flagged} field(s) where the sources disagree.
        </p>
      )}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Field</th>
              <th>The map</th>
              <th>ITSM</th>
              <th>Nexthink</th>
              <th>Survey</th>
            </tr>
          </thead>
          <tbody>
            {evidence.fields.map((f) => (
              <tr key={f.field} className={f.disagrees ? styles.rowDisagrees : undefined}>
                <th scope="row">
                  {f.disagrees && <AlertTriangle size={12} className={styles.rowIcon} />}
                  {f.label}
                </th>
                <Cell cell={f.map} />
                <Cell cell={f.itsm} />
                <Cell cell={f.nexthink} />
                <Cell cell={f.survey} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {evidence.activity && (
        <div className={styles.block}>
          <h4>Who signs in</h4>
          <p className={styles.blockHint}>
            From Nexthink, last seen {asDate(evidence.activity.last_seen)}
            {evidence.activity.entity ? ` · ${evidence.activity.entity}` : ''}. A shared or admin
            account says nothing about whose device this is.
          </p>
          <ul className={styles.logons}>
            {evidence.activity.logons.slice(0, 8).map((l) => (
              <li key={l.user_name}>
                <span>{l.full_name ?? l.user_name}</span>
                <span className={styles.logonMeta}>{l.logins}× · {l.account_kind}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {evidence.suppressed_by_import.length > 0 && (
        <div className={styles.block}>
          <h4>The survey said otherwise, and the import kept the record</h4>
          <p className={styles.blockHint}>
            An automated import must not overwrite a value that may have come from ITSM, so it
            filled gaps only. These are the differences it left for a person.
          </p>
          <ul className={styles.suppressed}>
            {evidence.suppressed_by_import.map((s) => (
              <li key={s.field}>
                <strong>{s.field}</strong>: the record says “{s.app_value ?? '(empty)'}”, the survey
                read “{s.survey_value ?? '(empty)'}”
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default SourceEvidencePanel;
