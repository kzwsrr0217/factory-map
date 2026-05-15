/**
 * FloorFormModal.tsx — Create / edit form for floors within a building.
 *
 * Requires `buildingId` to associate the new floor. Validates that `name` is
 * non-empty and `floor_number` is a valid integer before submitting. The
 * backend also enforces uniqueness of `floor_number` within a building; the
 * form surfaces that error via the toast if the API rejects it.
 */
import React, { useState, useEffect, useCallback } from 'react';
import Modal from '../common/Modal';
import Button from '../common/Button';
import Input from '../common/Input';
import { floorService, Floor } from '../../services/floor.service';
import { useToast } from '../../contexts/ToastContext';
import styles from '../../styles/components/FloorFormModal.module.css';

interface FloorFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  buildingId: string;
  floor?: Floor | null;
}

const FloorFormModal: React.FC<FloorFormModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  buildingId,
  floor,
}) => {
  const [formData, setFormData] = useState({
    name: '',
    floor_number: '',
    area: '',
    ceiling_height: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [existingFloorNumbers, setExistingFloorNumbers] = useState<number[]>([]);
  const toast = useToast();

  const loadExistingFloors = useCallback(async () => {
    try {
      const floors = await floorService.getFloors(buildingId);
      const numbers = floors
        .filter(f => !floor || f._id !== floor._id) // Exclude current floor if editing
        .map(f => f.floor_number);
      setExistingFloorNumbers(numbers);
    } catch (error) {
      console.error('Error loading floors:', error);
    }
  }, [buildingId, floor]);

  useEffect(() => {
    if (floor) {
      setFormData({
        name: floor.name || '',
        floor_number: floor.floor_number.toString(),
        area: floor.metadata?.area?.toString() || '',
        ceiling_height: floor.metadata?.ceiling_height?.toString() || '',
      });
    } else {
      setFormData({
        name: '',
        floor_number: '0',
        area: '',
        ceiling_height: '',
      });
    }
    setErrors({});
  }, [floor, isOpen]);

  // Load existing floor numbers for validation
  useEffect(() => {
    if (isOpen && buildingId) {
      loadExistingFloors();
    }
  }, [isOpen, buildingId, loadExistingFloors]);

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.name.trim()) {
      newErrors.name = 'Floor name is required';
    }

    if (!formData.floor_number) {
      newErrors.floor_number = 'Floor number is required';
    } else if (isNaN(Number(formData.floor_number))) {
      newErrors.floor_number = 'Must be a number';
    } else {
      // Check for duplicate floor number
      const floorNum = Number(formData.floor_number);
      if (existingFloorNumbers.includes(floorNum)) {
        newErrors.floor_number = `Floor number ${floorNum} already exists in this building`;
      }
    }

    if (formData.area && isNaN(Number(formData.area))) {
      newErrors.area = 'Must be a number';
    }

    if (formData.ceiling_height && isNaN(Number(formData.ceiling_height))) {
      newErrors.ceiling_height = 'Must be a number';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;

    setSubmitting(true);
    try {
      const payload: Partial<Floor> = {
        building_id: buildingId,
        name: formData.name,
        floor_number: Number(formData.floor_number),
        metadata: {
          area: formData.area ? Number(formData.area) : undefined,
          ceiling_height: formData.ceiling_height
            ? Number(formData.ceiling_height)
            : undefined,
        },
      };

      if (floor) {
        await floorService.updateFloor(floor._id, payload);
      } else {
        await floorService.createFloor(payload);
      }

      onSuccess();
      onClose();
    } catch (err: any) {
      console.error('Error saving floor:', err);
      toast.error(err.response?.data?.error || 'Failed to save floor. Please try again.');
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
        {floor ? 'Update' : 'Create'} Floor
      </Button>
    </>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={floor ? 'Edit Floor' : 'Add New Floor'}
      width="md"
      footer={footer}
    >
      <div className={styles.form}>
        <Input
          label="Floor Name *"
          placeholder="e.g., Ground Floor, 1st Floor"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          error={errors.name}
        />

        <Input
          label="Floor Number *"
          type="number"
          placeholder="e.g., 0 (ground), 1, 2, -1 (basement)"
          value={formData.floor_number}
          onChange={(e) => setFormData({ ...formData, floor_number: e.target.value })}
          error={errors.floor_number}
          helperText="Use 0 for ground floor, negative for basements"
        />

        <div className={styles.row}>
          <Input
            label="Area (m²)"
            type="number"
            placeholder="e.g., 2500"
            value={formData.area}
            onChange={(e) => setFormData({ ...formData, area: e.target.value })}
            error={errors.area}
          />

          <Input
            label="Ceiling Height (m)"
            type="number"
            step="0.1"
            placeholder="e.g., 3.5"
            value={formData.ceiling_height}
            onChange={(e) =>
              setFormData({ ...formData, ceiling_height: e.target.value })
            }
            error={errors.ceiling_height}
          />
        </div>
      </div>
    </Modal>
  );
};

export default FloorFormModal;