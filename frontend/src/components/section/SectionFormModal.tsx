/**
 * SectionFormModal.tsx — Create / edit form for sections within a work area.
 *
 * Fields: name (required), capacity (optional integer), and shift_schedule
 * (optional free-text, e.g. "08:00-16:00"). Requires `workareaId` to link
 * the section to its parent. Supports both create and edit modes.
 */
import React, { useState, useEffect } from 'react';
import Modal from '../common/Modal';
import Button from '../common/Button';
import Input from '../common/Input';
import { sectionService, Section } from '../../services/section.service';
import { useToast } from '../../contexts/ToastContext';
import styles from '../../styles/components/SectionFormModal.module.css';

interface SectionFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  workareaId: string;
  section?: Section | null;
}

const SectionFormModal: React.FC<SectionFormModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  workareaId,
  section,
}) => {
  const [formData, setFormData] = useState({
    name: '',
    shift_schedule: '',
    capacity: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (section) {
      setFormData({
        name: section.name || '',
        shift_schedule: section.shift_schedule || '',
        capacity: section.capacity?.toString() || '',
      });
    } else {
      setFormData({
        name: '',
        shift_schedule: '',
        capacity: '',
      });
    }
    setErrors({});
  }, [section, isOpen]);

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.name.trim()) {
      newErrors.name = 'Section name is required';
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
      const payload: Partial<Section> = {
        workarea_id: workareaId,
        name: formData.name,
        shift_schedule: formData.shift_schedule || undefined,
        capacity: formData.capacity ? Number(formData.capacity) : undefined,
        coordinates: section?.coordinates || { x: 0, y: 0 },
      };

      if (section) {
        await sectionService.updateSection(section._id, payload);
      } else {
        await sectionService.createSection(payload);
      }

      onSuccess();
      onClose();
    } catch (err: any) {
      console.error('Error saving section:', err);
      toast.error(err.response?.data?.error || 'Failed to save section. Please try again.');
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
        {section ? 'Update' : 'Create'} Section
      </Button>
    </>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={section ? 'Edit Section' : 'Add New Section'}
      width="md"
      footer={footer}
    >
      <div className={styles.form}>
        <Input
          label="Section Name *"
          placeholder="e.g., Motor Assembly, Quality Control"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          error={errors.name}
        />

        <Input
          label="Shift Schedule"
          placeholder="e.g., 3-shift, Day shift, 24/7"
          value={formData.shift_schedule}
          onChange={(e) => setFormData({ ...formData, shift_schedule: e.target.value })}
          helperText="Operating schedule for this section"
        />

        <Input
          label="Capacity (people)"
          type="number"
          placeholder="e.g., 8"
          value={formData.capacity}
          onChange={(e) => setFormData({ ...formData, capacity: e.target.value })}
          error={errors.capacity}
          helperText="Number of workers in this section"
        />

        <div className={styles.note}>
          <p>Position this section on the floor plan in the Map View after creating it.</p>
        </div>
      </div>
    </Modal>
  );
};

export default SectionFormModal;