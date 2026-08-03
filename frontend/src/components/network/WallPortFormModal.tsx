/**
 * WallPortFormModal.tsx — Adds network sockets to a floor.
 *
 * Two modes, because sockets arrive both ways in practice:
 *   - **Range** (default): a rack's sockets are a contiguous run, so
 *     `R1/001`…`R1/048` is generated in one call rather than typed 48 times.
 *     Labels that already exist in the building come back as `skipped`, so
 *     re-running a range after adding a few by hand is safe.
 *   - **Single**: the one socket that was missed, or a non-conforming label.
 *
 * The patch panel and switch are deliberately absent: a socket starts life
 * unpatched, and both are recorded later at the rack, where you can actually see
 * which panel port it lands on. See docs/CONNECTIONS_WORKFLOW.md.
 */
import React, { useMemo, useState } from 'react';
import Modal from '../common/Modal';
import Button from '../common/Button';
import Input from '../common/Input';
import Select from '../common/Select';
import { networkService } from '../../services/network.service';
import { WorkArea } from '../../services/workarea.service';
import { useToast } from '../../contexts/ToastContext';
import { getApiErrorMessage } from '../../utils/apiError';
import styles from '../../styles/components/WallPortFormModal.module.css';

interface WallPortFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  floorId: string;
  /** This floor's rooms, for the (optional) room assignment. */
  workareas: WorkArea[];
}

/** Zero-padding width of the number in a label — "R1/001" is 3. */
const DEFAULT_PAD = 3;
/** Mirrors MAX_BULK_WALL_PORTS in network.controller.ts. */
const MAX_RANGE = 512;
/** How many generated labels to show back before eliding. */
const PREVIEW_LIMIT = 3;

const WallPortFormModal: React.FC<WallPortFormModalProps> = ({
  isOpen, onClose, onSuccess, floorId, workareas,
}) => {
  const toast = useToast();
  const [mode, setMode] = useState<'range' | 'single'>('range');
  const [prefix, setPrefix] = useState('R1/');
  const [from, setFrom] = useState('1');
  const [to, setTo] = useState('24');
  const [pad, setPad] = useState(String(DEFAULT_PAD));
  const [label, setLabel] = useState('');
  const [workareaId, setWorkareaId] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const workareaOptions = useMemo(
    () => [...workareas]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((w) => ({ value: w._id, label: w.zone?.name ? `${w.name} (${w.zone.name})` : w.name })),
    [workareas],
  );

  const padWidth = Number(pad) > 0 ? Number(pad) : DEFAULT_PAD;
  const fromNum = Number(from);
  const toNum = Number(to);
  const rangeValid =
    Number.isInteger(fromNum) && Number.isInteger(toNum) && fromNum >= 0 && toNum >= fromNum;
  const rangeCount = rangeValid ? toNum - fromNum + 1 : 0;

  // Shown live so it's obvious what will be created before committing to 48 rows.
  const preview = useMemo(() => {
    if (!rangeValid || !prefix.trim()) return '';
    const make = (n: number) => `${prefix.trim()}${String(n).padStart(padWidth, '0')}`;
    if (rangeCount <= PREVIEW_LIMIT + 1) {
      return Array.from({ length: rangeCount }, (_, i) => make(fromNum + i)).join(', ');
    }
    const head = Array.from({ length: PREVIEW_LIMIT }, (_, i) => make(fromNum + i));
    return `${head.join(', ')}, …, ${make(toNum)}`;
  }, [rangeValid, rangeCount, prefix, padWidth, fromNum, toNum]);

  const reset = () => {
    setMode('range');
    setPrefix('R1/');
    setFrom('1');
    setTo('24');
    setPad(String(DEFAULT_PAD));
    setLabel('');
    setWorkareaId('');
    setErrors({});
  };

  const handleClose = () => { reset(); onClose(); };

  const validate = (): boolean => {
    const next: Record<string, string> = {};
    if (mode === 'single') {
      if (!label.trim()) next.label = 'Label is required, e.g. R1/001';
    } else {
      if (!prefix.trim()) next.prefix = 'Prefix is required, e.g. "R1/"';
      if (!rangeValid) next.range = 'From and to must be whole numbers, with from ≤ to';
      else if (rangeCount > MAX_RANGE) next.range = `That is ${rangeCount} sockets; the maximum per request is ${MAX_RANGE}`;
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSave = async () => {
    if (!validate()) return;
    setSaving(true);
    try {
      if (mode === 'single') {
        await networkService.createWallPort({
          label: label.trim(),
          floor_id: floorId,
          workarea_id: workareaId || null,
        });
        toast.success(`Socket ${label.trim()} added`);
      } else {
        const res = await networkService.createWallPortRange({
          floor_id: floorId,
          workarea_id: workareaId || null,
          prefix: prefix.trim(),
          from: fromNum,
          to: toNum,
          pad: padWidth,
        });
        // Skipped labels are reported rather than swallowed: silently creating
        // fewer sockets than asked for reads as "done" when it isn't.
        const skipped = res.skipped.length;
        toast.success(
          skipped === 0
            ? `${res.created.length} socket(s) added`
            : `${res.created.length} socket(s) added, ${skipped} already existed and were skipped`,
        );
      }
      onSuccess();
      handleClose();
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to add sockets. Please try again.'));
    } finally {
      setSaving(false);
    }
  };

  const footer = (
    <>
      <Button variant="outline" onClick={handleClose} disabled={saving}>Cancel</Button>
      <Button variant="primary" onClick={handleSave} loading={saving}>
        {mode === 'range' ? `Add ${rangeCount || ''} Socket${rangeCount === 1 ? '' : 's'}` : 'Add Socket'}
      </Button>
    </>
  );

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Add Network Sockets" width="md" footer={footer}>
      <div className={styles.form}>
        <div className={styles.modeToggle} role="group" aria-label="How many sockets to add">
          <button
            type="button"
            className={`${styles.modeButton} ${mode === 'range' ? styles.modeActive : ''}`}
            aria-pressed={mode === 'range'}
            onClick={() => setMode('range')}
          >
            A whole range
          </button>
          <button
            type="button"
            className={`${styles.modeButton} ${mode === 'single' ? styles.modeActive : ''}`}
            aria-pressed={mode === 'single'}
            onClick={() => setMode('single')}
          >
            One socket
          </button>
        </div>

        {mode === 'range' ? (
          <>
            <div className={styles.rangeRow}>
              <Input
                label="Label prefix *"
                placeholder="R1/"
                value={prefix}
                onChange={(e) => setPrefix(e.target.value)}
                error={errors.prefix}
                helperText="Rack and separator, e.g. R1/"
              />
              <Input label="From *" type="number" value={from} onChange={(e) => setFrom(e.target.value)} />
              <Input label="To *" type="number" value={to} onChange={(e) => setTo(e.target.value)} />
              <Input
                label="Digits"
                type="number"
                value={pad}
                onChange={(e) => setPad(e.target.value)}
                helperText="001 = 3"
              />
            </div>
            {errors.range && <span className={styles.error}>{errors.range}</span>}
            {preview && <p className={styles.preview}>Will create: <code>{preview}</code></p>}
          </>
        ) : (
          <Input
            label="Socket label *"
            placeholder="e.g. R1/001"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            error={errors.label}
            helperText="Exactly what is printed on the faceplate. Must be unique within the building."
          />
        )}

        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="wallport-room">Room</label>
          <Select
            id="wallport-room"
            value={workareaId}
            onChange={setWorkareaId}
            options={workareaOptions}
            placeholder="— Not assigned yet —"
          />
          <p className={styles.fieldHelper}>
            Which work area these sockets are in. Optional now — assigning it later
            from the socket list is fine — but it is what makes “find a free socket
            in this room” work.
          </p>
        </div>

        <div className={styles.note}>
          <p>
            The patch panel and switch are recorded later, at the rack: that is where
            you can see which panel port a socket lands on and which switch port its
            patch cord goes to.
          </p>
        </div>
      </div>
    </Modal>
  );
};

export default WallPortFormModal;
