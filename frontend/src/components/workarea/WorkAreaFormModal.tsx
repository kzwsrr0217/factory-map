/**
 * WorkAreaFormModal.tsx — Create / edit form for work areas (rooms) on a floor.
 *
 * Hierarchy: Building > Floor > Zone > **WorkArea**. The zone is picked from
 * this floor's existing zones, with an inline "New zone…" option so the user
 * doesn't have to leave the dialog to create one. It is a real `<select>` over
 * real zone records rather than the free text it used to be — free text let
 * "HR" and "hr" become two groups.
 *
 * Colour belongs to the ZONE, not the room, so every room in a zone matches by
 * construction. Changing the swatch here edits the selected zone and so recolours
 * its other rooms too; that's stated in the helper text.
 *
 * Position and size are managed on the FloorMap canvas, not here.
 */
import React, { useState, useEffect, useMemo } from 'react';
import Modal from '../common/Modal';
import Button from '../common/Button';
import Input from '../common/Input';
import Select from '../common/Select';
import { workareaService, WorkArea } from '../../services/workarea.service';
import { useZones, useCreateZone, useUpdateZone } from '../../hooks/queries/useZones';
import { WORKAREA_COLORS } from '../../utils/workareaColors';
import { useToast } from '../../contexts/ToastContext';
import styles from '../../styles/components/WorkAreaFormModal.module.css';

interface WorkAreaFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  floorId: string;
  workarea?: WorkArea | null;
}

/** Sentinel `<select>` value that reveals the inline new-zone fields. */
const NEW_ZONE = '__new__';

const WorkAreaFormModal: React.FC<WorkAreaFormModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  floorId,
  workarea,
}) => {
  const [formData, setFormData] = useState({
    name: '',
    supervisor: '',
    capacity: '',
  });
  // '' = no zone, NEW_ZONE = creating one, otherwise a zone id.
  const [zoneChoice, setZoneChoice] = useState('');
  const [newZoneName, setNewZoneName] = useState('');
  /** Colour for the new zone, or the pending change to the selected one. */
  const [zoneColor, setZoneColor] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const toast = useToast();

  const { data: zones = [] } = useZones(floorId);
  const createZone = useCreateZone();
  const updateZone = useUpdateZone();

  const zoneOptions = useMemo(
    () => [
      ...[...zones]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((z) => ({ value: z._id, label: z.name })),
      { value: NEW_ZONE, label: '+ New zone…' },
    ],
    [zones],
  );

  const selectedZone = zones.find((z) => z._id === zoneChoice) ?? null;

  useEffect(() => {
    if (workarea) {
      setFormData({
        name: workarea.name || '',
        supervisor: workarea.metadata?.supervisor || '',
        capacity: workarea.metadata?.capacity?.toString() || '',
      });
      setZoneChoice(workarea.zone_id || '');
      // Pre-fill with the zone's own colour, not the rendered one: '' here means
      // "automatic", and pre-filling the auto-assigned colour would silently pin it.
      setZoneColor(workarea.zone?.color || '');
    } else {
      setFormData({ name: '', supervisor: '', capacity: '' });
      setZoneChoice('');
      setZoneColor('');
    }
    setNewZoneName('');
    setErrors({});
  }, [workarea, isOpen]);

  const handleZoneChange = (value: string) => {
    setZoneChoice(value);
    setNewZoneName('');
    // Track the colour of whatever is now selected so the swatches reflect it.
    setZoneColor(value === NEW_ZONE ? '' : zones.find((z) => z._id === value)?.color || '');
    setErrors((prev) => ({ ...prev, zone: '' }));
  };

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.name.trim()) {
      newErrors.name = 'Work area name is required';
    }

    if (zoneChoice === NEW_ZONE && !newZoneName.trim()) {
      newErrors.zone = 'Zone name is required';
    }

    if (formData.capacity && isNaN(Number(formData.capacity))) {
      newErrors.capacity = 'Must be a number';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  /**
   * Resolves the zone the room should point at, creating it first if the user
   * chose "New zone…". Returns null for "no zone".
   */
  const resolveZoneId = async (): Promise<string | null> => {
    if (zoneChoice === '') return null;

    if (zoneChoice === NEW_ZONE) {
      const zone = await createZone.mutateAsync({
        floor_id: floorId,
        name: newZoneName.trim(),
        color: zoneColor || null,
      });
      return zone._id;
    }

    // Existing zone: push a colour change if the user picked a different swatch.
    if (selectedZone && (selectedZone.color || '') !== zoneColor) {
      await updateZone.mutateAsync({ id: selectedZone._id, data: { color: zoneColor || null } });
    }
    return zoneChoice;
  };

  const handleSubmit = async () => {
    if (!validate()) return;

    setSubmitting(true);
    try {
      const zoneId = await resolveZoneId();

      const payload: Partial<WorkArea> = {
        floor_id: floorId,
        name: formData.name,
        zone_id: zoneId,
        coordinates: workarea?.coordinates || { x: 0, y: 0 }, // Keep existing or default
        metadata: {
          // Preserve any metadata keys this form doesn't manage.
          ...(workarea?.metadata ?? {}),
          supervisor: formData.supervisor || undefined,
          capacity: formData.capacity ? Number(formData.capacity) : undefined,
        },
      };

      if (workarea) {
        await workareaService.updateWorkArea(workarea._id, payload);
      } else {
        await workareaService.createWorkArea(payload);
      }

      onSuccess();
      onClose();
    } catch (err: any) {
      console.error('Error saving work area:', err);
      toast.error(err.response?.data?.error || 'Failed to save work area. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const footer = (
    <>
      <Button variant="outline" onClick={onClose} disabled={submitting}>
        Cancel
      </Button>
      <Button variant="primary" onClick={handleSubmit} loading={submitting}>
        {workarea ? 'Update' : 'Create'} Work Area
      </Button>
    </>
  );

  const showColorPicker = zoneChoice !== '';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={workarea ? 'Edit Work Area' : 'Add New Work Area'}
      width="md"
      footer={footer}
    >
      <div className={styles.form}>
        <Input
          label="Work Area Name *"
          placeholder="e.g., HR Office, Reception, Assembly Line 1"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          error={errors.name}
        />

        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="workarea-zone">
            Zone
          </label>
          <Select
            id="workarea-zone"
            value={zoneChoice}
            onChange={handleZoneChange}
            options={zoneOptions}
            placeholder="— No zone —"
          />
          <p className={styles.fieldHelper}>
            The bigger named area this room sits in — e.g. several offices all
            under <strong>HR</strong>. Rooms in one zone share a map colour and a
            zone outline. Matches the physical survey's <em>helyszín</em> level.
          </p>
        </div>

        {zoneChoice === NEW_ZONE && (
          <Input
            label="New Zone Name *"
            placeholder="e.g., HR, Cummins, Maintenance"
            value={newZoneName}
            onChange={(e) => setNewZoneName(e.target.value)}
            error={errors.zone}
          />
        )}

        {showColorPicker && (
          <div className={styles.colorField}>
            <span className={styles.colorLabel}>Zone Colour</span>
            <div className={styles.colorSwatches}>
              <button
                type="button"
                title="Automatic — the map picks a colour for this zone"
                aria-label="Automatic colour"
                aria-pressed={zoneColor === ''}
                className={`${styles.colorSwatchAuto} ${zoneColor === '' ? styles.colorSwatchActive : ''}`}
                onClick={() => setZoneColor('')}
              >
                Auto
              </button>
              {WORKAREA_COLORS.map((c) => (
                <button
                  key={c.fill}
                  type="button"
                  title={c.label}
                  aria-label={c.label}
                  aria-pressed={zoneColor === c.fill}
                  className={`${styles.colorSwatch} ${zoneColor === c.fill ? styles.colorSwatchActive : ''}`}
                  style={{ background: c.fill, borderColor: c.stroke }}
                  onClick={() => setZoneColor(c.fill)}
                />
              ))}
            </div>
            <p className={styles.colorHelper}>
              {selectedZone ? (
                <>
                  Applies to the whole <strong>{selectedZone.name}</strong> zone —
                  every room in it changes colour, not just this one.
                </>
              ) : (
                <>Applies to the whole new zone. On <strong>Auto</strong> the map picks a free colour.</>
              )}
            </p>
          </div>
        )}

        <div className={styles.row}>
          <Input
            label="Supervisor"
            placeholder="e.g., John Smith"
            value={formData.supervisor}
            onChange={(e) => setFormData({ ...formData, supervisor: e.target.value })}
          />

          <Input
            label="Capacity (people)"
            type="number"
            placeholder="e.g., 20"
            value={formData.capacity}
            onChange={(e) => setFormData({ ...formData, capacity: e.target.value })}
            error={errors.capacity}
          />
        </div>

        <div className={styles.note}>
          <p>Position this work area on the floor plan in the Map View after creating it.</p>
        </div>
      </div>
    </Modal>
  );
};

export default WorkAreaFormModal;
