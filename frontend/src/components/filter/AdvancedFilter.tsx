import React, { useState } from 'react';
import Modal from '../common/Modal';
import Button from '../common/Button';
import Input from '../common/Input';
import Select from '../common/Select';
import styles from '../../styles/components/AdvancedFilter.module.css';

export interface FilterCriteria {
  assetName?: string;
  manufacturer?: string;
  model?: string;
  serialNumber?: string;
  assetTag?: string;
  assignedPerson?: string;
  status?: string;
  itsmManaged?: 'all' | 'itsm' | 'manual';
  buildingId?: string;
  floorId?: string;
  workareaId?: string;
}

interface AdvancedFilterProps {
  isOpen: boolean;
  onClose: () => void;
  onApply: (filters: FilterCriteria) => void;
  currentFilters: FilterCriteria;
  buildings?: Array<{ _id: string; name: string }>;
  floors?: Array<{ _id: string; name: string }>;
  workareas?: Array<{ _id: string; name: string }>;
}

const AdvancedFilter: React.FC<AdvancedFilterProps> = ({
  isOpen,
  onClose,
  onApply,
  currentFilters,
  buildings = [],
  floors = [],
  workareas = [],
}) => {
  const [filters, setFilters] = useState<FilterCriteria>(currentFilters);

  const handleApply = () => {
    onApply(filters);
    onClose();
  };

  const handleReset = () => {
    const emptyFilters: FilterCriteria = {
      itsmManaged: 'all',
    };
    setFilters(emptyFilters);
    onApply(emptyFilters);
    onClose();
  };

  const footer = (
    <>
      <Button variant="outline" onClick={handleReset}>
        Reset All
      </Button>
      <Button variant="outline" onClick={onClose}>
        Cancel
      </Button>
      <Button variant="primary" onClick={handleApply}>
        Apply Filters
      </Button>
    </>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Advanced Filters"
      width="lg"
      footer={footer}
    >
      <div className={styles.container}>
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>🔍 Asset Information</h3>
          <div className={styles.grid}>
            <Input
              label="Asset Name"
              placeholder="Search by name..."
              value={filters.assetName || ''}
              onChange={(e) => setFilters({ ...filters, assetName: e.target.value })}
            />

            <Input
              label="Manufacturer"
              placeholder="e.g., Dell, HP, Lenovo"
              value={filters.manufacturer || ''}
              onChange={(e) => setFilters({ ...filters, manufacturer: e.target.value })}
            />

            <Input
              label="Model"
              placeholder="e.g., OptiPlex 7090"
              value={filters.model || ''}
              onChange={(e) => setFilters({ ...filters, model: e.target.value })}
            />

            <Input
              label="Serial Number"
              placeholder="Search by S/N..."
              value={filters.serialNumber || ''}
              onChange={(e) => setFilters({ ...filters, serialNumber: e.target.value })}
            />

            <Input
              label="Asset Tag"
              placeholder="Search by tag..."
              value={filters.assetTag || ''}
              onChange={(e) => setFilters({ ...filters, assetTag: e.target.value })}
            />

            <Input
              label="Assigned Person"
              placeholder="Search by person name..."
              value={filters.assignedPerson || ''}
              onChange={(e) => setFilters({ ...filters, assignedPerson: e.target.value })}
            />
          </div>
        </div>

        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>📊 Status & Type</h3>
          <div className={styles.grid}>
            <div>
              <label className={styles.label}>ITSM Status</label>
              <Select
                value={filters.itsmManaged || 'all'}
                onChange={(value) => setFilters({ ...filters, itsmManaged: value as any })}
                options={[
                  { value: 'all', label: 'All Assets' },
                  { value: 'itsm', label: 'ITSM Managed' },
                  { value: 'manual', label: 'Manual Only' },
                ]}
              />
            </div>

            <Input
              label="Status"
              placeholder="e.g., Active, Inactive"
              value={filters.status || ''}
              onChange={(e) => setFilters({ ...filters, status: e.target.value })}
            />
          </div>
        </div>

        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>📍 Location</h3>
          <div className={styles.grid}>
            {buildings.length > 0 && (
              <div>
                <label className={styles.label}>Building</label>
                <Select
                  value={filters.buildingId || ''}
                  onChange={(value) => setFilters({ ...filters, buildingId: value })}
                  options={[
                    { value: '', label: 'All Buildings' },
                    ...buildings.map((b) => ({ value: b._id, label: b.name })),
                  ]}
                />
              </div>
            )}

            {floors.length > 0 && (
              <div>
                <label className={styles.label}>Floor</label>
                <Select
                  value={filters.floorId || ''}
                  onChange={(value) => setFilters({ ...filters, floorId: value })}
                  options={[
                    { value: '', label: 'All Floors' },
                    ...floors.map((f) => ({ value: f._id, label: f.name })),
                  ]}
                />
              </div>
            )}

            {workareas.length > 0 && (
              <div>
                <label className={styles.label}>Work Area</label>
                <Select
                  value={filters.workareaId || ''}
                  onChange={(value) => setFilters({ ...filters, workareaId: value })}
                  options={[
                    { value: '', label: 'All Work Areas' },
                    ...workareas.map((wa) => ({ value: wa._id, label: wa.name })),
                  ]}
                />
              </div>
            )}
          </div>
        </div>

        {Object.keys(filters).filter(k => filters[k as keyof FilterCriteria] && k !== 'itsmManaged').length > 0 && (
          <div className={styles.activeFilters}>
            <h4>Active Filters:</h4>
            <div className={styles.filterTags}>
              {Object.entries(filters).map(([key, value]) => {
                if (!value || value === 'all' || key === 'itsmManaged') return null;
                return (
                  <div key={key} className={styles.filterTag}>
                    <span>{key}: {value}</span>
                    <button
                      onClick={() => setFilters({ ...filters, [key]: undefined })}
                      className={styles.removeTag}
                    >
                      ×
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default AdvancedFilter;