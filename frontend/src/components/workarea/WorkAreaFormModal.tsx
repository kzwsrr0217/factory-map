/**
 * WorkAreaFormModal.tsx — Create / edit form for work areas on a floor.
 *
 * Fields: name (required) and type (optional free-text, e.g. "Assembly",
 * "Storage"). Position and size are managed on the FloorMap canvas, not here.
 * Requires `floorId` to associate the work area with its parent floor.
 */
import React, { useState, useEffect, useMemo } from 'react';
import Modal from '../common/Modal';
import Button from '../common/Button';
import Input from '../common/Input';
import { workareaService, WorkArea } from '../../services/workarea.service';
import { useWorkareas } from '../../hooks/queries/useWorkareas';
import { WORKAREA_COLORS, distinctZones } from '../../utils/workareaColors';
import { useToast } from '../../contexts/ToastContext';
import styles from '../../styles/components/WorkAreaFormModal.module.css';

interface WorkAreaFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  floorId: string;
  workarea?: WorkArea | null;
}

const WorkAreaFormModal: React.FC<WorkAreaFormModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  floorId,
  workarea,
}) => {
  const [formData, setFormData] = useState({
    name: '',
    type: '',
    supervisor: '',
    capacity: '',
    color: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const toast = useToast();

  // Zone names from EVERY work area, not just this floor's — zones span floors
  // ("HR" exists on the ground floor, "Cummins" on another), and the whole
  // point of suggesting them is that a new room joins an existing zone rather
  // than spawning "hr" beside "HR". A floor-scoped list would be empty on a
  // brand-new floor, exactly when the guard matters most. The shared query
  // hook keeps this to one cached request app-wide, and its create/update
  // mutations invalidate it, so new zones appear without a manual refetch.
  const { data: allWorkareas = [] } = useWorkareas();
  const zoneSuggestions = useMemo(() => distinctZones(allWorkareas), [allWorkareas]);

  useEffect(() => {
    if (workarea) {
      setFormData({
        name: workarea.name || '',
        type: workarea.type || '',
        supervisor: workarea.metadata?.supervisor || '',
        capacity: workarea.metadata?.capacity?.toString() || '',
        // '' means "auto" (derive from the zone) — deliberately NOT pre-filled
        // with the currently-rendered colour, or simply reopening and saving
        // would silently pin that colour forever.
        color: workarea.metadata?.color || '',
      });
    } else {
      setFormData({
        name: '',
        type: '',
        supervisor: '',
        capacity: '',
        color: '',
      });
    }
    setErrors({});
  }, [workarea, isOpen]);

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.name.trim()) {
      newErrors.name = 'Work area name is required';
    }

    if (formData.capacity && isNaN(Number(formData.capacity))) {
      newErrors.capacity = 'Must be a number';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;

    setSubmitting(true);
    try {
      const payload: Partial<WorkArea> = {
        floor_id: floorId,
        name: formData.name,
        type: formData.type || undefined,
        coordinates: workarea?.coordinates || { x: 0, y: 0 }, // Keep existing or default
        metadata: {
          // Preserve any metadata keys this form doesn't manage.
          ...(workarea?.metadata ?? {}),
          supervisor: formData.supervisor || undefined,
          capacity: formData.capacity ? Number(formData.capacity) : undefined,
          color: formData.color || undefined,
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
          placeholder="e.g., Assembly Line 1, Quality Control"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          error={errors.name}
        />

        <Input
          label="Zone / Group"
          placeholder="e.g., HR, Cummins, Maintenance"
          value={formData.type}
          onChange={(e) => setFormData({ ...formData, type: e.target.value })}
          list="workarea-zone-suggestions"
          helperText="Areas sharing a zone get the same map colour and read as one group — e.g. several offices all under HR. Matches the physical survey's 'helyszín' level."
        />
        <datalist id="workarea-zone-suggestions">
          {zoneSuggestions.map((z) => (
            <option key={z} value={z} />
          ))}
        </datalist>

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

        <div className={styles.colorField}>
          <span className={styles.colorLabel}>Map Colour</span>
          <div className={styles.colorSwatches}>
            <button
              type="button"
              title="Automatic — derived from the zone"
              aria-label="Automatic colour"
              aria-pressed={formData.color === ''}
              className={`${styles.colorSwatchAuto} ${formData.color === '' ? styles.colorSwatchActive : ''}`}
              onClick={() => setFormData({ ...formData, color: '' })}
            >
              Auto
            </button>
            {WORKAREA_COLORS.map((c) => (
              <button
                key={c.fill}
                type="button"
                title={c.label}
                aria-label={c.label}
                aria-pressed={formData.color === c.fill}
                className={`${styles.colorSwatch} ${formData.color === c.fill ? styles.colorSwatchActive : ''}`}
                style={{ background: c.fill, borderColor: c.stroke }}
                onClick={() => setFormData({ ...formData, color: c.fill })}
              />
            ))}
          </div>
          <p className={styles.colorHelper}>
            On <strong>Auto</strong> the colour comes from the Zone / Group above,
            so every room in one zone matches. Pick a swatch to override it for
            this area only.
          </p>
        </div>

        <div className={styles.note}>
          <p>Position this work area on the floor plan in the Map View after creating it.</p>
        </div>
      </div>
    </Modal>
  );
};

export default WorkAreaFormModal;