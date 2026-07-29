/**
 * WorkAreaFormModal.tsx — Create / edit form for work areas on a floor.
 *
 * Fields: name (required) and type (optional free-text, e.g. "Assembly",
 * "Storage"). Position and size are managed on the FloorMap canvas, not here.
 * Requires `floorId` to associate the work area with its parent floor.
 */
import React, { useState, useEffect } from 'react';
import Modal from '../common/Modal';
import Button from '../common/Button';
import Input from '../common/Input';
import { workareaService, WorkArea } from '../../services/workarea.service';
import { WORKAREA_COLORS, resolveWorkareaColor } from '../../utils/workareaColors';
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
  // Existing zone names across all work areas, so a new room can be typed into
  // an existing zone instead of accidentally creating "hr" next to "HR".
  const [zoneSuggestions, setZoneSuggestions] = useState<string[]>([]);
  const toast = useToast();

  useEffect(() => {
    if (!isOpen) return;
    workareaService
      .getWorkAreas()
      .then((areas) => {
        const seen = new Map<string, string>();
        for (const a of areas) {
          const z = (a.type ?? '').trim();
          if (z && !seen.has(z.toLowerCase())) seen.set(z.toLowerCase(), z);
        }
        setZoneSuggestions([...seen.values()].sort((a, b) => a.localeCompare(b)));
      })
      .catch(() => {});
  }, [isOpen]);

  useEffect(() => {
    if (workarea) {
      setFormData({
        name: workarea.name || '',
        type: workarea.type || '',
        supervisor: workarea.metadata?.supervisor || '',
        capacity: workarea.metadata?.capacity?.toString() || '',
        // Show the colour it currently renders with (auto-derived when unset),
        // so opening the form doesn't look like "no colour chosen".
        color: workarea.metadata?.color || resolveWorkareaColor(workarea).fill,
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
            Distinguishes neighbouring areas on the floor plan. Leave unset and a
            colour is assigned automatically.
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