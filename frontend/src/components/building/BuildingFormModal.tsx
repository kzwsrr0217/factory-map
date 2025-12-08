import React, { useState, useEffect } from 'react';
import Modal from '../common/Modal';
import Button from '../common/Button';
import Input from '../common/Input';
import Textarea from '../common/Textarea';
import { hierarchyService, Building } from '../../services/hierarchy.service';
import styles from '../../styles/components/BuildingFormModal.module.css';

interface BuildingFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  building?: Building | null;
}

const BuildingFormModal: React.FC<BuildingFormModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  building,
}) => {
  const [formData, setFormData] = useState({
    name: '',
    address: '',
    total_area: '',
    construction_year: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (building) {
      setFormData({
        name: building.name || '',
        address: building.address || '',
        total_area: building.metadata?.total_area?.toString() || '',
        construction_year: building.metadata?.construction_year?.toString() || '',
      });
    } else {
      setFormData({
        name: '',
        address: '',
        total_area: '',
        construction_year: '',
      });
    }
    setErrors({});
  }, [building, isOpen]);

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.name.trim()) {
      newErrors.name = 'Building name is required';
    }

    if (formData.total_area && isNaN(Number(formData.total_area))) {
      newErrors.total_area = 'Must be a number';
    }

    if (formData.construction_year && isNaN(Number(formData.construction_year))) {
      newErrors.construction_year = 'Must be a valid year';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;

    setSubmitting(true);
    try {
      const payload: Partial<Building> = {
        name: formData.name,
        address: formData.address || undefined,
        metadata: {
          total_area: formData.total_area ? Number(formData.total_area) : undefined,
          construction_year: formData.construction_year
            ? Number(formData.construction_year)
            : undefined,
        },
      };

      if (building) {
        // Update existing building
        await hierarchyService.updateBuilding(building._id, payload);
      } else {
        // Create new building
        await hierarchyService.createBuilding(payload);
      }

      onSuccess();
      onClose();
    } catch (error) {
      console.error('Error saving building:', error);
      alert('Failed to save building. Please try again.');
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
        {building ? 'Update' : 'Create'} Building
      </Button>
    </>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={building ? 'Edit Building' : 'Add New Building'}
      width="md"
      footer={footer}
    >
      <div className={styles.form}>
        <Input
          label="Building Name *"
          placeholder="e.g., Factory Building A"
          value={formData.name}
          onChange={(e) => setFormData({ ...formData, name: e.target.value })}
          error={errors.name}
        />

        <Textarea
          label="Address"
          placeholder="Enter building address"
          value={formData.address}
          onChange={(e) => setFormData({ ...formData, address: e.target.value })}
          error={errors.address}
          rows={3}
        />

        <div className={styles.row}>
          <Input
            label="Total Area (m²)"
            type="number"
            placeholder="e.g., 5000"
            value={formData.total_area}
            onChange={(e) => setFormData({ ...formData, total_area: e.target.value })}
            error={errors.total_area}
          />

          <Input
            label="Construction Year"
            type="number"
            placeholder="e.g., 2010"
            value={formData.construction_year}
            onChange={(e) =>
              setFormData({ ...formData, construction_year: e.target.value })
            }
            error={errors.construction_year}
          />
        </div>
      </div>
    </Modal>
  );
};

export default BuildingFormModal;