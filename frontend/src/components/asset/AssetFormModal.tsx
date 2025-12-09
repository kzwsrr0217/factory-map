import React, { useState, useEffect } from 'react';
import Modal from '../common/Modal';
import Button from '../common/Button';
import Input from '../common/Input';
import Textarea from '../common/Textarea';
import Select from '../common/Select';
import { assetService, Asset } from '../../services/asset.service';
import { hierarchyService, Building } from '../../services/hierarchy.service';
import styles from '../../styles/components/AssetFormModal.module.css';

interface AssetFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  asset?: Asset | null;
  defaultBuildingId?: string;
}

const AssetFormModal: React.FC<AssetFormModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  asset,
  defaultBuildingId,
}) => {
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [formData, setFormData] = useState({
    // Basic Info
    display_name: '',
    manufacturer: '',
    model: '',
    serial_number: '',
    asset_tag: '',
    status: 'Active',
    
    // OS
    os_type: '',
    os_version: '',
    
    // Hierarchy
    building_id: defaultBuildingId || '',
    
    // Location
    coordinates_x: '0',
    coordinates_y: '0',
    location_description: '',
    
    // Assigned Person
    person_full_name: '',
    person_id: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      loadBuildings();
    }
  }, [isOpen]);

  useEffect(() => {
    if (asset) {
      setFormData({
        display_name: asset.basic_info.display_name || '',
        manufacturer: asset.basic_info.manufacturer || '',
        model: asset.basic_info.model || '',
        serial_number: asset.basic_info.serial_number || '',
        asset_tag: asset.basic_info.asset_tag || '',
        status: asset.basic_info.status || 'Active',
        os_type: asset.basic_info.os_type || '',
        os_version: asset.basic_info.os_version || '',
        building_id: asset.hierarchy.building_id || '',
        coordinates_x: asset.location.coordinates.x.toString(),
        coordinates_y: asset.location.coordinates.y.toString(),
        location_description: asset.location.description || '',
        person_full_name: asset.assigned_person?.full_name || '',
        person_id: asset.assigned_person?.person_id || '',
      });
    } else {
      setFormData({
        display_name: '',
        manufacturer: '',
        model: '',
        serial_number: '',
        asset_tag: '',
        status: 'Active',
        os_type: '',
        os_version: '',
        building_id: defaultBuildingId || '',
        coordinates_x: '0',
        coordinates_y: '0',
        location_description: '',
        person_full_name: '',
        person_id: '',
      });
    }
    setErrors({});
  }, [asset, isOpen, defaultBuildingId]);

  const loadBuildings = async () => {
    try {
      const data = await hierarchyService.getBuildings();
      setBuildings(data);
    } catch (error) {
      console.error('Error loading buildings:', error);
    }
  };

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    if (!formData.display_name.trim()) {
      newErrors.display_name = 'Display name is required';
    }

    if (!formData.building_id) {
      newErrors.building_id = 'Building is required';
    }

    if (formData.coordinates_x && isNaN(Number(formData.coordinates_x))) {
      newErrors.coordinates_x = 'Must be a number';
    }

    if (formData.coordinates_y && isNaN(Number(formData.coordinates_y))) {
      newErrors.coordinates_y = 'Must be a number';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;

    setSubmitting(true);
    try {
      const payload: Partial<Asset> = {
        basic_info: {
          display_name: formData.display_name,
          manufacturer: formData.manufacturer || undefined,
          model: formData.model || undefined,
          serial_number: formData.serial_number || undefined,
          asset_tag: formData.asset_tag || undefined,
          status: formData.status || undefined,
          os_type: formData.os_type || undefined,
          os_version: formData.os_version || undefined,
        },
        hierarchy: {
          building_id: formData.building_id,
          floor_id: asset?.hierarchy.floor_id || '',
          workarea_id: asset?.hierarchy.workarea_id || '',
          section_id: asset?.hierarchy.section_id || '',
          workstation_id: asset?.hierarchy.workstation_id || '',
        },
        location: {
          coordinates: {
            x: Number(formData.coordinates_x),
            y: Number(formData.coordinates_y),
          },
          description: formData.location_description || undefined,
        },
        itsm: asset?.itsm || {
          hardware_id: null,
          is_managed: false,
          last_synced: null,
          sync_status: 'never',
        },
      };

      // Assigned person (only if both fields filled)
      if (formData.person_full_name && formData.person_id) {
        payload.assigned_person = {
          full_name: formData.person_full_name,
          person_id: formData.person_id,
        };
      }

      if (asset) {
        // Update existing asset
        await assetService.updateAsset(asset._id, payload);
      } else {
        // Create new asset
        await assetService.createAsset(payload);
      }

      onSuccess();
      onClose();
    } catch (error) {
      console.error('Error saving asset:', error);
      alert('Failed to save asset. Please try again.');
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
        {asset ? 'Update' : 'Create'} Asset
      </Button>
    </>
  );

  const buildingOptions = buildings.map((building) => ({
    value: building._id,
    label: building.name,
  }));

  const statusOptions = [
    { value: 'Active', label: 'Active' },
    { value: 'Inactive', label: 'Inactive' },
    { value: 'Maintenance', label: 'Maintenance' },
    { value: 'Retired', label: 'Retired' },
  ];

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={asset ? 'Edit Asset' : 'Add New Asset'}
      width="lg"
      footer={footer}
    >
      <div className={styles.form}>
        {/* Basic Information Section */}
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Basic Information</h3>
          
          <Input
            label="Display Name *"
            placeholder="e.g., John's Workstation"
            value={formData.display_name}
            onChange={(e) => setFormData({ ...formData, display_name: e.target.value })}
            error={errors.display_name}
          />

          <div className={styles.row}>
            <Input
              label="Manufacturer"
              placeholder="e.g., Dell"
              value={formData.manufacturer}
              onChange={(e) => setFormData({ ...formData, manufacturer: e.target.value })}
            />

            <Input
              label="Model"
              placeholder="e.g., Optiplex 7090"
              value={formData.model}
              onChange={(e) => setFormData({ ...formData, model: e.target.value })}
            />
          </div>

          <div className={styles.row}>
            <Input
              label="Serial Number"
              placeholder="e.g., ABC123456"
              value={formData.serial_number}
              onChange={(e) => setFormData({ ...formData, serial_number: e.target.value })}
            />

            <Input
              label="Asset Tag"
              placeholder="e.g., ASSET-001"
              value={formData.asset_tag}
              onChange={(e) => setFormData({ ...formData, asset_tag: e.target.value })}
            />
          </div>

          <Select
            value={formData.status}
            onChange={(value) => setFormData({ ...formData, status: value })}
            options={statusOptions}
            placeholder="Select status"
          />
        </div>

        {/* Operating System Section */}
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Operating System</h3>
          
          <div className={styles.row}>
            <Input
              label="OS Type"
              placeholder="e.g., Windows, Linux, macOS"
              value={formData.os_type}
              onChange={(e) => setFormData({ ...formData, os_type: e.target.value })}
            />

            <Input
              label="OS Version"
              placeholder="e.g., Windows 11 Pro"
              value={formData.os_version}
              onChange={(e) => setFormData({ ...formData, os_version: e.target.value })}
            />
          </div>
        </div>

        {/* Location Section */}
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Location</h3>
          
          <Select
            value={formData.building_id}
            onChange={(value) => setFormData({ ...formData, building_id: value })}
            options={buildingOptions}
            placeholder="Select building *"
          />
          {errors.building_id && (
            <span className={styles.error}>{errors.building_id}</span>
          )}

          <div className={styles.row}>
            <Input
              label="Coordinate X"
              type="number"
              placeholder="0"
              value={formData.coordinates_x}
              onChange={(e) => setFormData({ ...formData, coordinates_x: e.target.value })}
              error={errors.coordinates_x}
            />

            <Input
              label="Coordinate Y"
              type="number"
              placeholder="0"
              value={formData.coordinates_y}
              onChange={(e) => setFormData({ ...formData, coordinates_y: e.target.value })}
              error={errors.coordinates_y}
            />
          </div>

          <Textarea
            label="Location Description"
            placeholder="Additional location details"
            value={formData.location_description}
            onChange={(e) => setFormData({ ...formData, location_description: e.target.value })}
            rows={2}
          />
        </div>

        {/* Assigned Person Section */}
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Assigned Person</h3>
          
          <div className={styles.row}>
            <Input
              label="Full Name"
              placeholder="e.g., John Doe"
              value={formData.person_full_name}
              onChange={(e) => setFormData({ ...formData, person_full_name: e.target.value })}
            />

            <Input
              label="Person ID"
              placeholder="e.g., EMP001"
              value={formData.person_id}
              onChange={(e) => setFormData({ ...formData, person_id: e.target.value })}
            />
          </div>
        </div>
      </div>
    </Modal>
  );
};

export default AssetFormModal;