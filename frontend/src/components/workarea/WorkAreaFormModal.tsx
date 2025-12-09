import React, { useState, useEffect } from 'react';
import Modal from '../common/Modal';
import Button from '../common/Button';
import Input from '../common/Input';
import { workareaService, WorkArea } from '../../services/workarea.service';
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
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (workarea) {
      setFormData({
        name: workarea.name || '',
        type: workarea.type || '',
        supervisor: workarea.metadata?.supervisor || '',
        capacity: workarea.metadata?.capacity?.toString() || '',
      });
    } else {
      setFormData({
        name: '',
        type: '',
        supervisor: '',
        capacity: '',
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
          supervisor: formData.supervisor || undefined,
          capacity: formData.capacity ? Number(formData.capacity) : undefined,
        },
      };

      console.log('Submitting work area payload:', payload); // Debug log

      if (workarea) {
        await workareaService.updateWorkArea(workarea._id, payload);
      } else {
        await workareaService.createWorkArea(payload);
      }

      onSuccess();
      onClose();
    } catch (error: any) {
      console.error('Error saving work area:', error);
      const errorMessage =
        error.response?.data?.error || 'Failed to save work area. Please try again.';
      alert(errorMessage);
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
          label="Type"
          placeholder="e.g., Production, Storage, Testing"
          value={formData.type}
          onChange={(e) => setFormData({ ...formData, type: e.target.value })}
          helperText="Category or function of this work area"
        />

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
          <p>💡 Position this work area on the floor plan in the Map View</p>
        </div>
      </div>
    </Modal>
  );
};

export default WorkAreaFormModal;