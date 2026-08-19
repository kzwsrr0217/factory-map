/**
 * CompletenessPanel.tsx — what is still missing from this record, and what could never be there.
 *
 * ── Why this is a checklist and not a percentage ────────────────────────────────
 * "68% complete" cannot be acted on. The person reading it wants to know WHICH thing is missing, and a
 * single number hides exactly that while inviting people to collect the cheap ticks. So: one line per
 * check, each with a reason, and a satisfied/applicable count for the shape.
 *
 * ── Three states, not two ───────────────────────────────────────────────────────
 * A check is satisfied, unsatisfied, or NOT APPLICABLE — and the third has to look nothing like the
 * second. A monitor carries no Nexthink agent; if that renders as a red cross, all 405 monitors sit
 * permanently incomplete for lacking data they cannot have, and within a fortnight nobody reads the
 * panel. Inapplicable lines are dimmed, carry a dash, and are pushed below the rest.
 *
 * ── Why an unsatisfied check is not automatically this asset's problem ──────────
 * Measured on 2026-08-19: 1 of 1197 assets that belong on a floor plan is drawn on one, and 1 of 434
 * that plug into a wall have a socket recorded. Those are project stages nobody has started, not 1196
 * individual mistakes — so an estate-wide figure sits next to the local one, and a check almost nothing
 * in the estate satisfies is labelled as such rather than blamed on whatever asset happens to be open.
 * The summary loads on demand: it assesses every live asset, which is not a per-page-view cost.
 */
import React, { useState } from 'react';
import { AlertCircle, Check, ClipboardCheck, Minus } from 'lucide-react';
import Button from '../common/Button';
import {
  assetService,
  AssetCompleteness,
  CompletenessCheck,
  CompletenessSummary,
} from '../../services/asset.service';
import { useToast } from '../../contexts/ToastContext';
import { getApiErrorMessage } from '../../utils/apiError';
import styles from '../../styles/components/CompletenessPanel.module.css';

interface CompletenessPanelProps {
  assetId: string;
}

/** Applicable checks first — an inapplicable line is background, not a to-do. */
function ordered(checks: CompletenessCheck[]): CompletenessCheck[] {
  const rank = (c: CompletenessCheck) => (!c.applicable ? 2 : c.satisfied ? 1 : 0);
  return [...checks].sort((a, b) => rank(a) - rank(b));
}

const CompletenessPanel: React.FC<CompletenessPanelProps> = ({ assetId }) => {
  const [data, setData] = useState<AssetCompleteness | null>(null);
  const [summary, setSummary] = useState<CompletenessSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingSummary, setLoadingSummary] = useState(false);
  const toast = useToast();

  const load = async () => {
    setLoading(true);
    try {
      setData(await assetService.getCompleteness(assetId));
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Could not check what is missing.'));
    } finally {
      setLoading(false);
    }
  };

  const loadSummary = async () => {
    setLoadingSummary(true);
    try {
      setSummary(await assetService.getCompletenessSummary());
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Could not load the estate figures.'));
    } finally {
      setLoadingSummary(false);
    }
  };

  if (!data) {
    return (
      <div className={styles.prompt}>
        <Button size="sm" variant="secondary" onClick={load} loading={loading}>
          <ClipboardCheck size={14} /> Check what is missing
        </Button>
        <span className={styles.promptHint}>
          Which of the things a complete record needs are recorded, and which cannot apply here.
        </span>
      </div>
    );
  }

  /* A device out of service is measured against nothing, and saying so is the whole answer. */
  if (!data.tracked) {
    return (
      <p className={styles.untracked}>
        This device is out of service, so nothing is expected of its record.
      </p>
    );
  }

  const missing = data.checks.filter((c) => c.applicable && !c.satisfied);

  return (
    <div className={styles.panel}>
      <div className={styles.score}>
        <strong>{data.satisfied} of {data.applicable}</strong>
        <span className={styles.scoreHint}>
          {/* Of the checks that apply to THIS asset. Naming the denominator matters: "4 of 7" and
              "4 of 8" are different statements about the same record. */}
          {missing.length === 0
            ? 'recorded — everything that applies to this asset is in place.'
            : `recorded. ${missing.length} left, of the checks that apply to this asset.`}
        </span>
      </div>

      <ul className={styles.list}>
        {ordered(data.checks).map((c) => {
          const estate = summary?.by_check.find((b) => b.key === c.key);
          return (
            <li
              key={c.key}
              className={!c.applicable ? styles.na : c.satisfied ? styles.ok : styles.missing}
            >
              <span className={styles.icon} aria-hidden="true">
                {!c.applicable ? <Minus size={14} /> : c.satisfied ? <Check size={14} /> : <AlertCircle size={14} />}
              </span>
              <span className={styles.body}>
                <span className={styles.label}>
                  {c.label}
                  <span className={styles.srOnly}>
                    {!c.applicable ? ' — does not apply' : c.satisfied ? ' — recorded' : ' — missing'}
                  </span>
                </span>
                {c.detail && <span className={styles.detail}>{c.detail}</span>}
                {/* Context, only where it changes the reading: a gap nobody in the estate has filled
                    is a stage not yet begun, and blaming this asset for it would be wrong. */}
                {estate && c.applicable && !c.satisfied && (
                  <span className={styles.estate}>
                    {estate.unstarted
                      ? `Almost nothing in the estate satisfies this yet (${estate.satisfied} of ${estate.applicable}) — this is a stage nobody has started, not a fault of this asset.`
                      : `Across the estate: ${estate.satisfied} of ${estate.applicable} where it applies.`}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>

      {!summary && (
        <div className={styles.footer}>
          <Button size="sm" variant="outline" onClick={loadSummary} loading={loadingSummary}>
            Compare with the rest of the estate
          </Button>
        </div>
      )}
      {summary && (
        <p className={styles.footerNote}>
          {summary.complete} of {summary.total} live assets are complete against everything that
          applies to them.
        </p>
      )}
    </div>
  );
};

export default CompletenessPanel;
