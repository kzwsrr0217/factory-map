import React, { useState, useEffect } from 'react';
import Modal from '../common/Modal';
import Button from '../common/Button';
import Input from '../common/Input';
import Select from '../common/Select';
import { workstationService, Workstation } from '../../services/workstation.service';
import styles from '../../styles/components/WorkstationFormModal.module.css';

interface WorkstationFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  sectionId: string;
  workstation?: Workstation | null;
}

const WorkstationFormModal: React.FC<WorkstationFormModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  sectionId,
  workstation,
}) => {
  const [formData, setFormData] = useState({
    name: '',
    type: '',
    status: 'active',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (workstation) {
      setFormData({
        name: workstation.name || '',
        type: workstation.type || '',
        status: workstation.status || 'active',
      });
    } else {
      setFormData({
        name: '',
        type: '',
        status: 'active',
      });
    }
    setErrors({});
  }, [workstation, isOpen]);

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.name.trim()) {
      newErrors.name = 'Workstation name is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;

    setSubmitting(true);
    try {
      const payload: Partial<Workstation> = {
        section_id: sectionId,
        name: formData.name,
        type: formData.type || undefined,
        status: formData.status,
        coordinates: workstation?.coordinates || { x: 0, y: 0 },
        rotation: workstation?.rotation || 0,
      };

      if (workstation) {
        await workstationService.updateWorkstation(workstation._id, payload);
      } else {
        await workstationService.createWorkstation(payload);
      }

      onSuccess();
      onClose();
    } catch (error: any) {
      console.error('Error saving workstation:', error);
      const errorMessage =
        error.response?.data?.error || 'Failed to save workstation. Please try again.';
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
        {workstation ? 'Update' : 'Create'} Workstation
      </Button>
    </>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={workstation ? 'Edit Workstation' : 'Add New Workstation'}
      width="md"
      footer={footer}
    >
      <div className={styles.form}>
        <Input
          label="Workstation Name *"
          placeholder="e.g., WS-01, Assembly Desk A"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          error={errors.name}
        />

        <Input
          label="Type"
          placeholder="e.g., Workbench, Desk, Station"
          value={formData.type}
          onChange={(e) => setFormData({ ...formData, type: e.target.value })}
          helperText="Type or category of workstation"
        />

        <Select
          label="Status"
          value={formData.status}
          onChange={(e) => setFormData({ ...formData, status: e.target.value })}
          options={[
            { value: 'active', label: 'Active' },
            { value: 'inactive', label: 'Inactive' },
            { value: 'maintenance', label: 'Maintenance' },
          ]}
        />

        <div className={styles.note}>
          <p>💡 Position this workstation on the floor plan in the Map View</p>
        </div>
      </div>
    </Modal>
  );
};

export default WorkstationFormModal;