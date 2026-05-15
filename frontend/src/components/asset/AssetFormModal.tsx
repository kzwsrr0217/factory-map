/**
 * AssetFormModal.tsx — Create / edit form for assets.
 *
 * Used for both new asset creation and editing an existing asset. When an
 * `asset` prop is provided the form pre-fills all fields and switches to
 * PATCH mode; otherwise it sends a POST.
 *
 * Form structure (tabbed sections):
 *   Basic Info   — display_name, type (with template loader), status,
 *                  manufacturer, model, serial_number, asset_tag.
 *   Location     — building → floor cascade dropdowns; map coordinates if
 *                  `defaultCoordinates` are provided (e.g. from FloorMap click).
 *   Network      — ip_address, mac_address, hostname, vlan, subnet, gateway,
 *                  dns_servers, network_zone, remote_access_tool.
 *   Operational  — department, person (with autocomplete from usePersonSuggestions),
 *                  notes, tags (comma-separated).
 *   Lifecycle    — purchase_date, warranty_expiry, last_maintenance, next_maintenance,
 *                  end_of_life.
 *   Relations    — predecessor / successor asset links (type-ahead search).
 *
 * Templates (ASSET_TEMPLATES) pre-fill type-specific fields on type change.
 * Lookups (useAssetLookups) drive autocomplete suggestions for departments,
 * VLANs, and network zones. The lookup cache is invalidated after save so
 * new values become available for the next form open.
 *
 * Props:
 *   isOpen / onClose / onSuccess — modal lifecycle.
 *   asset                        — null for create, populated object for edit.
 *   defaultBuildingId / defaultFloorId / defaultCoordinates — pre-select
 *     location context when opened from the Floor Map.
 */
import React, { useState, useEffect } from 'react';
import Modal from '../common/Modal';
import Button from '../common/Button';
import Input from '../common/Input';
import Textarea from '../common/Textarea';
import Select from '../common/Select';
import ConfirmDialog from '../common/ConfirmDialog';
import { assetService, Asset, AssetStatus } from '../../services/asset.service';
import { hierarchyService, Building } from '../../services/hierarchy.service';
import { ASSET_TYPE_OPTIONS } from '../../utils/assetTypes';
import { ASSET_TEMPLATES } from '../../utils/assetTemplates';
import { usePersonSuggestions } from '../../hooks/usePersonSuggestions';
import { useAssetLookups, invalidateLookupCache } from '../../hooks/useAssetLookups';
import { useToast } from '../../contexts/ToastContext';
import styles from '../../styles/components/AssetFormModal.module.css';

interface AssetFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  asset?: Asset | null;
  defaultBuildingId?: string;
  defaultFloorId?: string;
  defaultCoordinates?: { x: number; y: number };
}

interface AssetOption {
  _id: string;
  label: string;
}

const AssetFormModal: React.FC<AssetFormModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  asset,
  defaultBuildingId,
  defaultFloorId,
  defaultCoordinates,
}) => {
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [allAssets, setAllAssets] = useState<AssetOption[]>([]);
  const [predecessorSearch, setPredecessorSearch] = useState('');
  const [successorSearch, setSuccessorSearch] = useState('');

  const normalizeStatus = (status?: string): AssetStatus => {
    const normalized = status?.toLowerCase();
    return normalized === 'inactive' || normalized === 'maintenance' || normalized === 'retired' || normalized === 'active'
      ? normalized
      : 'active';
  };

  const [formData, setFormData] = useState<{
    display_name: string;
    manufacturer: string;
    model: string;
    serial_number: string;
    asset_tag: string;
    mac_address: string;
    asset_type: string;
    status: AssetStatus;
    os_type: string;
    os_version: string;
    building_id: string;
    floor_id: string;
    coordinates_x: string;
    coordinates_y: string;
    location_description: string;
    person_full_name: string;
    person_id: string;
    cpu: string;
    ram: string;
    storage: string;
    gpu: string;
    ip_address: string;
    hostname: string;
    vlan: string;
    switch_port: string;
    physical_condition: string;
    environment: string;
    notes: string;
    tags: string;
    maintenance_last_date: string;
    maintenance_next_date: string;
    maintenance_interval_days: string;
    maintenance_notes: string;
    organization_display_name: string;
    organization_itsm_id: string;
    catalog_item_display_name: string;
    catalog_item_itsm_id: string;
    person_itsm_id: string;
    source_of_truth: 'local' | 'itsm';
    object_id: string;
    serial_object: string;
    dhcp_static: string;
    remote_access_tool: string;
    remote_access_version: string;
    backup_tool: string;
    backup_status: string;
    winupdate_date: string;
    fortiedr_active: string;
    predecessor_id: string;
    successor_id: string;
  }>({
    display_name: '',
    manufacturer: '',
    model: '',
    serial_number: '',
    asset_tag: '',
    mac_address: '',
    asset_type: '',
    status: 'active',
    os_type: '',
    os_version: '',
    building_id: defaultBuildingId || '',
    floor_id: defaultFloorId || '',
    coordinates_x: (defaultCoordinates?.x ?? 0).toString(),
    coordinates_y: (defaultCoordinates?.y ?? 0).toString(),
    location_description: '',
    person_full_name: '',
    person_id: '',
    cpu: '',
    ram: '',
    storage: '',
    gpu: '',
    ip_address: '',
    hostname: '',
    vlan: '',
    switch_port: '',
    dhcp_static: '',
    physical_condition: '',
    environment: '',
    notes: '',
    tags: '',
    maintenance_last_date: '',
    maintenance_next_date: '',
    maintenance_interval_days: '',
    maintenance_notes: '',
    organization_display_name: '',
    organization_itsm_id: '',
    catalog_item_display_name: '',
    catalog_item_itsm_id: '',
    person_itsm_id: '',
    source_of_truth: 'local',
    object_id: '',
    serial_object: '',
    remote_access_tool: '',
    remote_access_version: '',
    backup_tool: '',
    backup_status: '',
    winupdate_date: '',
    fortiedr_active: '',
    predecessor_id: '',
    successor_id: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [itsmConfirming, setItsmConfirming] = useState(false);
  const personSuggestions = usePersonSuggestions();
  const lookups = useAssetLookups();
  const toast = useToast();
  const isItsmManaged = asset?.itsm?.source_of_truth === 'itsm';

  const setField = (updates: Partial<typeof formData>) => {
    setFormData(prev => ({ ...prev, ...updates }));
    setIsDirty(true);
  };

  const handleAttemptClose = () => {
    if (isDirty) {
      setDiscardOpen(true);
    } else {
      onClose();
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadBuildings();
      assetService.getAssets().then(assets => {
        setAllAssets(
          assets
            .filter(a => !asset || a._id !== asset._id)
            .map(a => ({
              _id: a._id,
              label: a.basic_info.display_name + (a.custom_fields?.object_id ? ` [${a.custom_fields.object_id}]` : ''),
            }))
        );
      }).catch(() => {});
    }
  }, [isOpen, asset]);

  useEffect(() => {
    if (asset) {
      setFormData({
        display_name: asset.basic_info.display_name || '',
        manufacturer: asset.basic_info.manufacturer || '',
        model: asset.basic_info.model || '',
        serial_number: asset.basic_info.serial_number || '',
        asset_tag: asset.basic_info.asset_tag || '',
        mac_address: asset.basic_info.mac_address || '',
        asset_type: asset.basic_info.type || '',
        status: normalizeStatus(asset.basic_info.status),
        os_type: asset.basic_info.os_type || '',
        os_version: asset.basic_info.os_version || '',
        building_id: asset.hierarchy.building_id || '',
        floor_id: asset.hierarchy.floor_id || defaultFloorId || '',
        coordinates_x: asset.location.coordinates.x.toString(),
        coordinates_y: asset.location.coordinates.y.toString(),
        location_description: asset.location.description || '',
        person_full_name: asset.assigned_person?.full_name || '',
        person_id: asset.assigned_person?.person_id || '',
        cpu: asset.technical_specs?.cpu || '',
        ram: asset.technical_specs?.ram || '',
        storage: asset.technical_specs?.storage || '',
        gpu: asset.technical_specs?.gpu || '',
        ip_address: asset.network?.ip_address || '',
        hostname: asset.network?.hostname || '',
        vlan: asset.network?.vlan || '',
        switch_port: asset.network?.switch_port || '',
        dhcp_static: asset.network?.dhcp_static || '',
        physical_condition: asset.custom_fields?.physical_condition || '',
        environment: asset.custom_fields?.environment || '',
        notes: asset.custom_fields?.notes || '',
        tags: asset.custom_fields?.tags?.join(', ') || '',
        maintenance_last_date: asset.maintenance?.last_date
          ? new Date(asset.maintenance.last_date).toISOString().split('T')[0] : '',
        maintenance_next_date: asset.maintenance?.next_date
          ? new Date(asset.maintenance.next_date).toISOString().split('T')[0] : '',
        maintenance_interval_days: asset.maintenance?.interval_days?.toString() || '',
        maintenance_notes: asset.maintenance?.notes || '',
        organization_display_name: asset.organization?.display_name || '',
        organization_itsm_id: asset.organization?.itsm_id || '',
        catalog_item_display_name: asset.catalog_item?.display_name || '',
        catalog_item_itsm_id: asset.catalog_item?.itsm_id || '',
        person_itsm_id: asset.assigned_person?.itsm_id || '',
        source_of_truth: asset.itsm?.source_of_truth || 'local',
        object_id: asset.custom_fields?.object_id || '',
        serial_object: asset.custom_fields?.serial_object || '',
        remote_access_tool: asset.custom_fields?.remote_access_tool || '',
        remote_access_version: asset.custom_fields?.remote_access_version || '',
        backup_tool: asset.custom_fields?.backup_tool || '',
        backup_status: asset.custom_fields?.backup_status || '',
        winupdate_date: asset.custom_fields?.winupdate_date
          ? new Date(asset.custom_fields.winupdate_date as unknown as string).toISOString().split('T')[0] : '',
        fortiedr_active: asset.custom_fields?.fortiedr_active != null
          ? String(asset.custom_fields.fortiedr_active) : '',
        predecessor_id: asset.predecessor_id || '',
        successor_id: asset.successor_id || '',
      });
    } else {
      setFormData({
        display_name: '',
        manufacturer: '',
        model: '',
        serial_number: '',
        asset_tag: '',
        mac_address: '',
        asset_type: '',
        status: 'active',
        os_type: '',
        os_version: '',
        building_id: defaultBuildingId || '',
        floor_id: defaultFloorId || '',
        coordinates_x: (defaultCoordinates?.x ?? 0).toString(),
        coordinates_y: (defaultCoordinates?.y ?? 0).toString(),
        location_description: '',
        person_full_name: '',
        person_id: '',
        cpu: '',
        ram: '',
        storage: '',
        gpu: '',
        ip_address: '',
        hostname: '',
        vlan: '',
        switch_port: '',
        dhcp_static: '',
        physical_condition: '',
        environment: '',
        notes: '',
        tags: '',
        maintenance_last_date: '',
        maintenance_next_date: '',
        maintenance_interval_days: '',
        maintenance_notes: '',
        organization_display_name: '',
        organization_itsm_id: '',
        catalog_item_display_name: '',
        catalog_item_itsm_id: '',
        person_itsm_id: '',
        source_of_truth: 'local',
        object_id: '',
        serial_object: '',
        remote_access_tool: '',
        remote_access_version: '',
        backup_tool: '',
        backup_status: '',
        winupdate_date: '',
        fortiedr_active: '',
        predecessor_id: '',
        successor_id: '',
      });
    }
    setPredecessorSearch('');
    setSuccessorSearch('');
    setErrors({});
    setIsDirty(false);
  }, [asset, isOpen, defaultBuildingId, defaultFloorId, defaultCoordinates]);

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
      newErrors.display_name = 'Asset name is required';
    }

    if (formData.coordinates_x !== '') {
      const xNum = Number(formData.coordinates_x);
      if (isNaN(xNum) || xNum < 0 || xNum > 1000) {
        newErrors.coordinates_x = 'X must be 0-1000';
      }
    }

    if (formData.coordinates_y !== '') {
      const yNum = Number(formData.coordinates_y);
      if (isNaN(yNum) || yNum < 0 || yNum > 800) {
        newErrors.coordinates_y = 'Y must be 0-800';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const validateCoordinate = (field: 'coordinates_x' | 'coordinates_y'): string | undefined => {
    const value = formData[field];
    const num = Number(value);
    const max = field === 'coordinates_x' ? 1000 : 800;

    if (!value) return undefined;
    if (isNaN(num)) return 'Must be a number';
    if (num < 0 || num > max) return `Must be 0-${max}`;
    return undefined;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    if (isItsmManaged && isDirty) {
      setItsmConfirming(true);
      return;
    }
    await doSubmit();
  };

  const doSubmit = async () => {
    setItsmConfirming(false);
    setSubmitting(true);
    try {
      const payload: Partial<Asset> = {
        basic_info: {
          display_name: formData.display_name,
          manufacturer: formData.manufacturer || undefined,
          model: formData.model || undefined,
          serial_number: formData.serial_number || undefined,
          asset_tag: formData.asset_tag || undefined,
          mac_address: formData.mac_address || undefined,
          type: formData.asset_type || undefined,
          status: formData.status || undefined,
          os_type: formData.os_type || undefined,
          os_version: formData.os_version || undefined,
        },
        hierarchy: {
          building_id: formData.building_id || null,
          floor_id: formData.floor_id || defaultFloorId || null,
          workarea_id: asset?.hierarchy?.workarea_id || null,
          section_id: asset?.hierarchy?.section_id || null,
          workstation_id: asset?.hierarchy?.workstation_id || null,
        },
        location: {
          coordinates: {
            x: formData.coordinates_x !== '' ? Number(formData.coordinates_x) : 0,
            y: formData.coordinates_y !== '' ? Number(formData.coordinates_y) : 0,
          },
          description: formData.location_description || undefined,
        },
        itsm: {
          itsm_guid: asset?.itsm?.itsm_guid ?? null,
          hardware_asset_id: asset?.itsm?.hardware_asset_id ?? null,
          asset_class: asset?.itsm?.asset_class ?? null,
          itsm_modified_at: asset?.itsm?.itsm_modified_at ?? null,
          source_of_truth: formData.source_of_truth,
          is_managed: asset?.itsm?.is_managed ?? false,
          last_synced: asset?.itsm?.last_synced ?? null,
          sync_status: asset?.itsm?.sync_status ?? 'never',
        },
      };

      if (formData.person_full_name && formData.person_id) {
        payload.assigned_person = {
          full_name: formData.person_full_name,
          person_id: formData.person_id,
          ...(formData.person_itsm_id && { itsm_id: formData.person_itsm_id }),
        };
      }

      if (formData.organization_display_name || formData.organization_itsm_id) {
        payload.organization = {
          display_name: formData.organization_display_name || undefined,
          itsm_id: formData.organization_itsm_id || undefined,
        };
      }

      if (formData.catalog_item_display_name || formData.catalog_item_itsm_id) {
        payload.catalog_item = {
          display_name: formData.catalog_item_display_name || undefined,
          itsm_id: formData.catalog_item_itsm_id || undefined,
        };
      }

      if (formData.cpu || formData.ram || formData.storage || formData.gpu) {
        payload.technical_specs = {
          cpu: formData.cpu || undefined,
          ram: formData.ram || undefined,
          storage: formData.storage || undefined,
          gpu: formData.gpu || undefined,
        };
      }

      if (formData.ip_address || formData.hostname || formData.vlan || formData.switch_port || formData.dhcp_static) {
        payload.network = {
          ip_address: formData.ip_address || undefined,
          hostname: formData.hostname || undefined,
          vlan: formData.vlan || undefined,
          switch_port: formData.switch_port || undefined,
          dhcp_static: (formData.dhcp_static as 'dhcp' | 'static' | 'unknown') || undefined,
        };
      }

      if (formData.physical_condition || formData.environment || formData.notes || formData.tags ||
          formData.object_id || formData.serial_object || formData.remote_access_tool ||
          formData.remote_access_version || formData.backup_tool || formData.backup_status ||
          formData.winupdate_date || formData.fortiedr_active) {
        payload.custom_fields = {
          physical_condition: (formData.physical_condition as 'Good' | 'Fair' | 'Poor') || undefined,
          environment: formData.environment || undefined,
          notes: formData.notes || undefined,
          tags: formData.tags ? formData.tags.split(',').map(t => t.trim()).filter(Boolean) : undefined,
          object_id: formData.object_id || undefined,
          serial_object: formData.serial_object || undefined,
          remote_access_tool: formData.remote_access_tool || undefined,
          remote_access_version: formData.remote_access_version || undefined,
          backup_tool: formData.backup_tool || undefined,
          backup_status: (formData.backup_status as 'active' | 'inactive' | 'error' | 'not_configured') || undefined,
          winupdate_date: formData.winupdate_date || undefined,
          fortiedr_active: formData.fortiedr_active !== '' ? formData.fortiedr_active === 'true' : undefined,
        };
      }

      if (formData.maintenance_last_date || formData.maintenance_next_date || formData.maintenance_interval_days) {
        payload.maintenance = {
          last_date: formData.maintenance_last_date || undefined,
          next_date: formData.maintenance_next_date || undefined,
          interval_days: formData.maintenance_interval_days ? Number(formData.maintenance_interval_days) : undefined,
          notes: formData.maintenance_notes || undefined,
        };
      }

      payload.predecessor_id = formData.predecessor_id || null;
      payload.successor_id = formData.successor_id || null;

      if (asset) {
        await assetService.updateAsset(asset._id, payload);
      } else {
        await assetService.createAsset(payload);
      }

      invalidateLookupCache();
      onSuccess();
      onClose();
    } catch (err) {
      console.error('Error saving asset:', err);
      toast.error('Failed to save asset. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const footer = (
    <>
      <Button variant="outline" onClick={handleAttemptClose} disabled={submitting}>
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

  const statusOptions: Array<{ value: AssetStatus; label: string }> = [
    { value: 'active', label: 'Active' },
    { value: 'inactive', label: 'Inactive' },
    { value: 'maintenance', label: 'Maintenance' },
    { value: 'retired', label: 'Retired' },
  ];

  return (
    <>
    <ConfirmDialog
      isOpen={discardOpen}
      onClose={() => setDiscardOpen(false)}
      onConfirm={() => { setDiscardOpen(false); setIsDirty(false); onClose(); }}
      title="Discard changes?"
      message="You have unsaved changes. Are you sure you want to close without saving?"
      confirmText="Discard"
      cancelText="Keep editing"
      variant="danger"
    />
    <ConfirmDialog
      isOpen={itsmConfirming}
      onClose={() => setItsmConfirming(false)}
      onConfirm={doSubmit}
      title="Override ITSM data?"
      message="This asset is managed by ITSM. Your local changes will diverge from ITSM data and may be overwritten on the next sync. To preserve local changes permanently, set the Source of Truth to 'Local'."
      confirmText="Save local override"
      cancelText="Cancel"
      variant="danger"
    />
    <Modal
      isOpen={isOpen}
      onClose={handleAttemptClose}
      title={asset ? 'Edit Asset' : 'Add New Asset'}
      width="lg"
      footer={footer}
    >
      <div className={styles.form}>
        {asset && isItsmManaged && (
          <div className={styles.itsmWarning}>
            <span className={styles.itsmWarningIcon}>⚠️</span>
            <div>
              <strong className={styles.itsmWarningTitle}>ITSM-Managed Asset</strong>
              <span className={styles.itsmWarningText}>
                Data is sourced from ITSM. Local edits will diverge from ITSM data and may be
                overwritten on next sync. To make local data authoritative, change the Source of
                Truth to "Local" at the bottom of this form.
              </span>
            </div>
          </div>
        )}

        {/* Autocomplete datalists */}
      <datalist id="lookup-manufacturer">{lookups.manufacturer.map(v => <option key={v} value={v} />)}</datalist>
      <datalist id="lookup-model">{lookups.model.map(v => <option key={v} value={v} />)}</datalist>
      <datalist id="lookup-os-type">{lookups.os_type.map(v => <option key={v} value={v} />)}</datalist>
      <datalist id="lookup-os-version">{lookups.os_version.map(v => <option key={v} value={v} />)}</datalist>
      <datalist id="lookup-vlan">{lookups.vlan.map(v => <option key={v} value={v} />)}</datalist>
      <datalist id="lookup-environment">{lookups.environment.map(v => <option key={v} value={v} />)}</datalist>
      <datalist id="lookup-remote-access-tool">{lookups.remote_access_tool.map(v => <option key={v} value={v} />)}</datalist>
      <datalist id="lookup-remote-access-version">{lookups.remote_access_version.map(v => <option key={v} value={v} />)}</datalist>
      <datalist id="lookup-backup-tool">{lookups.backup_tool.map(v => <option key={v} value={v} />)}</datalist>
      <datalist id="lookup-catalog-item">{lookups.catalog_item.map(v => <option key={v} value={v} />)}</datalist>
      <datalist id="lookup-organization">{lookups.organization.map(v => <option key={v} value={v} />)}</datalist>
      <datalist id="lookup-serial-object">{lookups.serial_object.map(v => <option key={v} value={v} />)}</datalist>

      {/* Template picker — only shown when creating */}
        {!asset && (
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>Quick Template</h3>
            <div className={styles.templateGrid}>
              {ASSET_TEMPLATES.map((tpl) => (
                <button
                  key={tpl.id}
                  type="button"
                  className={styles.templateBtn}
                  onClick={() =>
                    setField({
                      asset_type: tpl.defaults.asset_type,
                      ...(tpl.defaults.manufacturer != null && { manufacturer: tpl.defaults.manufacturer }),
                      ...(tpl.defaults.model != null && { model: tpl.defaults.model }),
                      ...(tpl.defaults.os_type != null && { os_type: tpl.defaults.os_type }),
                      ...(tpl.defaults.cpu != null && { cpu: tpl.defaults.cpu }),
                      ...(tpl.defaults.ram != null && { ram: tpl.defaults.ram }),
                      ...(tpl.defaults.storage != null && { storage: tpl.defaults.storage }),
                    })
                  }
                >
                  <span>{tpl.icon}</span>
                  <span>{tpl.label}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Basic Information Section */}
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Basic Information</h3>

          <Input
            label="Display Name *"
            placeholder="e.g., John's Workstation"
            value={formData.display_name}
            onChange={(e) => {
              setField({ display_name: e.target.value });
              if (errors.display_name) setErrors({ ...errors, display_name: '' });
            }}
            error={errors.display_name}
            helperText={formData.display_name ? `${formData.display_name.length} characters` : 'Unique identifier for this asset'}
          />

          <div className={styles.row}>
            <Input
              label="Manufacturer"
              placeholder="e.g., Dell"
              value={formData.manufacturer}
              onChange={(e) => setField({ manufacturer: e.target.value })}
              list="lookup-manufacturer"
            />

            <Input
              label="Model"
              placeholder="e.g., Optiplex 7090"
              value={formData.model}
              onChange={(e) => setField({ model: e.target.value })}
              list="lookup-model"
            />
          </div>

          <div className={styles.row}>
            <Input
              label="Serial Number"
              placeholder="e.g., ABC123456"
              value={formData.serial_number}
              onChange={(e) => setField({ serial_number: e.target.value })}
            />

            <Input
              label="Asset Tag"
              placeholder="e.g., ASSET-001"
              value={formData.asset_tag}
              onChange={(e) => setField({ asset_tag: e.target.value })}
            />
          </div>

          <div className={styles.row}>
            <Select
              value={formData.status}
              onChange={(value) => setField({ status: value as AssetStatus })}
              options={statusOptions}
              placeholder="Select status"
            />
            <Select
              value={formData.asset_type}
              onChange={(value) => setField({ asset_type: value })}
              options={ASSET_TYPE_OPTIONS}
              placeholder="Asset Type"
            />
          </div>

          <div className={styles.row}>
            <Input
              label="Station / Object ID"
              placeholder="e.g., 518142-23"
              value={formData.object_id}
              onChange={(e) => setField({ object_id: e.target.value })}
              helperText="Local machine/station identifier (not from ITSM)"
            />
            <Input
              label="Serial Object"
              placeholder="e.g., GEH12345"
              value={formData.serial_object}
              onChange={(e) => setField({ serial_object: e.target.value })}
              helperText="Internal tracking / serial object number"
              list="lookup-serial-object"
            />
          </div>

          <div className={styles.row}>
            <Input
              label="Catalog Item"
              placeholder="e.g., IPC 19&quot; Rack"
              value={formData.catalog_item_display_name}
              onChange={(e) => setField({ catalog_item_display_name: e.target.value })}
              helperText="Hardware model / catalog entry from ITSM"
              list="lookup-catalog-item"
            />
            <Input
              label="Catalog Item ITSM ID"
              placeholder="ITSM catalog GUID"
              value={formData.catalog_item_itsm_id}
              onChange={(e) => setField({ catalog_item_itsm_id: e.target.value })}
            />
          </div>
        </div>

        {/* Operating System Section */}
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Operating System</h3>
          
          <div className={styles.row}>
            <Input
              label="OS Type"
              placeholder="e.g., Windows, Linux, macOS"
              value={formData.os_type}
              onChange={(e) => setField({ os_type: e.target.value })}
              list="lookup-os-type"
            />

            <Input
              label="OS Version"
              placeholder="e.g., Windows 11 Pro"
              value={formData.os_version}
              onChange={(e) => setField({ os_version: e.target.value })}
              list="lookup-os-version"
            />
          </div>
        </div>

        {/* Location Section */}
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Location</h3>
          
          <Select
            value={formData.building_id}
            onChange={(value) => {
              setField({ building_id: value });
              if (errors.building_id) setErrors({ ...errors, building_id: '' });
            }}
            options={buildingOptions}
            placeholder="Select building *"
          />
          {errors.building_id && (
            <span className={styles.error}>{errors.building_id}</span>
          )}
          {formData.building_id && !errors.building_id && (
            <p className={styles.helperText}>✓ Building selected</p>
          )}

          <div className={styles.row}>
            <Input
              label="Coordinate X"
              type="number"
              placeholder="0"
              value={formData.coordinates_x}
              onChange={(e) => setField({ coordinates_x: e.target.value })}
              error={errors.coordinates_x || validateCoordinate('coordinates_x')}
              helperText={!errors.coordinates_x && !validateCoordinate('coordinates_x') && formData.coordinates_x ? `Position: ${formData.coordinates_x}px` : 'Horizontal position on floor'}
            />

            <Input
              label="Coordinate Y"
              type="number"
              placeholder="0"
              value={formData.coordinates_y}
              onChange={(e) => setField({ coordinates_y: e.target.value })}
              error={errors.coordinates_y || validateCoordinate('coordinates_y')}
              helperText={!errors.coordinates_y && !validateCoordinate('coordinates_y') && formData.coordinates_y ? `Position: ${formData.coordinates_y}px` : 'Vertical position on floor'}
            />
          </div>

          <Textarea
            label="Location Description"
            placeholder="Additional location details"
            value={formData.location_description}
            onChange={(e) => setField({ location_description: e.target.value })}
            rows={2}
          />
        </div>

        {/* Assigned Person Section */}
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Assigned Person</h3>

          {personSuggestions.length > 0 && (
            <>
              <datalist id="person-names-list">
                {personSuggestions.map(p => (
                  <option key={p.person_id} value={p.full_name}>{p.person_id}</option>
                ))}
              </datalist>
              <datalist id="person-ids-list">
                {personSuggestions.map(p => (
                  <option key={p.person_id} value={p.person_id}>{p.full_name}</option>
                ))}
              </datalist>
            </>
          )}

          <div className={styles.row}>
            <div className={styles.inputWrapper}>
              <label className={styles.inputLabel}>Full Name</label>
              <input
                className={styles.input}
                list="person-names-list"
                placeholder="e.g., John Doe"
                value={formData.person_full_name}
                onChange={(e) => {
                  const name = e.target.value;
                  const match = personSuggestions.find(p => p.full_name === name);
                  setField({ person_full_name: name, ...(match && { person_id: match.person_id }) });
                }}
              />
            </div>

            <div className={styles.inputWrapper}>
              <label className={styles.inputLabel}>Person ID</label>
              <input
                className={styles.input}
                list="person-ids-list"
                placeholder="e.g., EMP001"
                value={formData.person_id}
                onChange={(e) => {
                  const id = e.target.value;
                  const match = personSuggestions.find(p => p.person_id === id);
                  setField({ person_id: id, ...(match && { person_full_name: match.full_name }) });
                }}
              />
            </div>
          </div>

          <Input
            label="Person ITSM ID"
            placeholder="ITSM person GUID (auto-filled by sync)"
            value={formData.person_itsm_id}
            onChange={(e) => setField({ person_itsm_id: e.target.value })}
            helperText="Populated automatically when syncing from ITSM"
          />
        </div>

        {/* Organization Section */}
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Organization</h3>
          <div className={styles.row}>
            <Input
              label="Organization Name"
              placeholder="e.g., Fertigung Wicklerei / Rotoren"
              value={formData.organization_display_name}
              onChange={(e) => setField({ organization_display_name: e.target.value })}
              list="lookup-organization"
            />
            <Input
              label="Organization ITSM ID"
              placeholder="ITSM organization GUID"
              value={formData.organization_itsm_id}
              onChange={(e) => setField({ organization_itsm_id: e.target.value })}
            />
          </div>
        </div>

        {/* Technical Specifications Section */}
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Technical Specifications</h3>

          <div className={styles.row}>
            <Input
              label="CPU"
              placeholder="e.g., Intel Core i7-12700"
              value={formData.cpu}
              onChange={(e) => setField({ cpu: e.target.value })}
            />
            <Input
              label="RAM"
              placeholder="e.g., 16GB DDR4"
              value={formData.ram}
              onChange={(e) => setField({ ram: e.target.value })}
            />
          </div>

          <div className={styles.row}>
            <Input
              label="Storage"
              placeholder="e.g., 512GB SSD"
              value={formData.storage}
              onChange={(e) => setField({ storage: e.target.value })}
            />
            <Input
              label="GPU"
              placeholder="e.g., NVIDIA RTX 3060"
              value={formData.gpu}
              onChange={(e) => setField({ gpu: e.target.value })}
            />
          </div>
        </div>

        {/* Network Section */}
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Network</h3>

          <div className={styles.row}>
            <Input
              label="IP Address"
              placeholder="e.g., 192.168.1.100"
              value={formData.ip_address}
              onChange={(e) => setField({ ip_address: e.target.value })}
            />
            <Input
              label="Hostname"
              placeholder="e.g., ws-floor2-001"
              value={formData.hostname}
              onChange={(e) => setField({ hostname: e.target.value })}
            />
          </div>

          <div className={styles.row}>
            <Input
              label="VLAN"
              placeholder="e.g., VLAN-100"
              value={formData.vlan}
              onChange={(e) => setField({ vlan: e.target.value })}
              list="lookup-vlan"
            />
            <Input
              label="Switch Port"
              placeholder="e.g., SW1/Gi0/1"
              value={formData.switch_port}
              onChange={(e) => setField({ switch_port: e.target.value })}
            />
          </div>

          <Input
            label="MAC Address"
            placeholder="e.g., AA:BB:CC:DD:EE:FF"
            value={formData.mac_address}
            onChange={(e) => setField({ mac_address: e.target.value })}
          />

          <div className={styles.row}>
            <div className={styles.inputWrapper}>
              <label className={styles.inputLabel}>IP Assignment</label>
              <div style={{ display: 'flex', gap: 16, marginTop: 6 }}>
                {(['dhcp', 'static', 'unknown'] as const).map((opt) => (
                  <label key={opt} style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', fontSize: '0.875rem' }}>
                    <input
                      type="radio"
                      name="dhcp_static"
                      value={opt}
                      checked={formData.dhcp_static === opt}
                      onChange={() => setField({ dhcp_static: opt })}
                    />
                    {opt.charAt(0).toUpperCase() + opt.slice(1)}
                  </label>
                ))}
                {formData.dhcp_static && (
                  <button type="button" style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}
                    onClick={() => setField({ dhcp_static: '' })}>clear</button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Operational Section */}
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Operational</h3>

          <div className={styles.row}>
            <Input
              label="Remote Access Tool"
              placeholder="e.g., BeyondTrust, TeamViewer"
              value={formData.remote_access_tool}
              onChange={(e) => setField({ remote_access_tool: e.target.value })}
              list="lookup-remote-access-tool"
            />
            <Input
              label="Remote Access Version"
              placeholder="e.g., 24.1.0"
              value={formData.remote_access_version}
              onChange={(e) => setField({ remote_access_version: e.target.value })}
              list="lookup-remote-access-version"
            />
          </div>

          <div className={styles.row}>
            <Input
              label="Backup Tool"
              placeholder="e.g., Veeam, Acronis, Manual"
              value={formData.backup_tool}
              onChange={(e) => setField({ backup_tool: e.target.value })}
              list="lookup-backup-tool"
            />
          </div>

          <div className={styles.row}>
            <Select
              value={formData.backup_status}
              onChange={(value) => setField({ backup_status: value })}
              options={[
                { value: '', label: 'Backup Status' },
                { value: 'active', label: 'Active' },
                { value: 'inactive', label: 'Inactive' },
                { value: 'error', label: 'Error' },
                { value: 'not_configured', label: 'Not Configured' },
              ]}
              placeholder="Backup Status"
            />
            <Input
              label="Windows Update Date"
              type="date"
              value={formData.winupdate_date}
              onChange={(e) => setField({ winupdate_date: e.target.value })}
              helperText="Last successful Windows Update"
            />
          </div>

          <Select
            value={formData.fortiedr_active}
            onChange={(value) => setField({ fortiedr_active: value })}
            options={[
              { value: '', label: 'FortiEDR Status' },
              { value: 'true', label: 'Active' },
              { value: 'false', label: 'Inactive' },
            ]}
            placeholder="FortiEDR Active"
          />
        </div>

        {/* Additional Info Section */}
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Additional Info</h3>

          <div className={styles.row}>
            <Select
              value={formData.physical_condition}
              onChange={(value) => setField({ physical_condition: value })}
              options={[
                { value: '', label: 'Physical Condition' },
                { value: 'Good', label: 'Good' },
                { value: 'Fair', label: 'Fair' },
                { value: 'Poor', label: 'Poor' },
              ]}
              placeholder="Physical Condition"
            />
            <Input
              label="Environment"
              placeholder="e.g., Production, Dev, Test"
              value={formData.environment}
              onChange={(e) => setField({ environment: e.target.value })}
              list="lookup-environment"
            />
          </div>

          <Input
            label="Tags"
            placeholder="Comma-separated, e.g., critical, floor2, IT"
            value={formData.tags}
            onChange={(e) => setField({ tags: e.target.value })}
          />

          <Textarea
            label="Notes"
            placeholder="Any additional notes about this asset"
            value={formData.notes}
            onChange={(e) => setField({ notes: e.target.value })}
            rows={3}
          />
        </div>

        {/* Maintenance Section */}
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Maintenance</h3>

          <div className={styles.row}>
            <Input
              label="Last Maintenance Date"
              type="date"
              value={formData.maintenance_last_date}
              onChange={(e) => setField({ maintenance_last_date: e.target.value })}
            />
            <Input
              label="Next Maintenance Due"
              type="date"
              value={formData.maintenance_next_date}
              onChange={(e) => setField({ maintenance_next_date: e.target.value })}
              helperText={
                formData.maintenance_next_date && new Date(formData.maintenance_next_date) < new Date()
                  ? '⚠️ This date is in the past'
                  : undefined
              }
            />
          </div>

          <Input
            label="Interval (days)"
            type="number"
            placeholder="e.g., 90"
            value={formData.maintenance_interval_days}
            onChange={(e) => setField({ maintenance_interval_days: e.target.value })}
            helperText="How often maintenance should be performed"
          />

          <Textarea
            label="Maintenance Notes"
            placeholder="e.g., Replace filter, firmware update, calibration"
            value={formData.maintenance_notes}
            onChange={(e) => setField({ maintenance_notes: e.target.value })}
            rows={2}
          />
        </div>

        {/* Lifecycle Section */}
        <div className={styles.section}>
          <h3 className={styles.sectionTitle}>Lifecycle</h3>
          <p className={styles.helperText} style={{ marginBottom: 8 }}>
            Link this asset to the one it replaces (predecessor) or the one that replaced it (successor).
          </p>

          <div className={styles.row}>
            <div className={styles.inputWrapper}>
              <label className={styles.inputLabel}>Replaces (predecessor)</label>
              {formData.predecessor_id ? (
                <div className={styles.selectedAsset}>
                  <span>{allAssets.find(a => a._id === formData.predecessor_id)?.label ?? formData.predecessor_id}</span>
                  <button
                    type="button"
                    className={styles.clearBtn}
                    onClick={() => { setField({ predecessor_id: '' }); setPredecessorSearch(''); }}
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <>
                  <input
                    className={styles.input}
                    placeholder="Type to search assets…"
                    value={predecessorSearch}
                    onChange={(e) => setPredecessorSearch(e.target.value)}
                    list="predecessor-options"
                    onBlur={(e) => {
                      const match = allAssets.find(a => a.label === e.target.value);
                      if (match) { setField({ predecessor_id: match._id }); setPredecessorSearch(''); }
                    }}
                  />
                  <datalist id="predecessor-options">
                    {allAssets
                      .filter(a => a._id !== formData.successor_id)
                      .filter(a => !predecessorSearch || a.label.toLowerCase().includes(predecessorSearch.toLowerCase()))
                      .slice(0, 30)
                      .map(a => <option key={a._id} value={a.label} />)}
                  </datalist>
                </>
              )}
            </div>

            <div className={styles.inputWrapper}>
              <label className={styles.inputLabel}>Replaced by (successor)</label>
              {formData.successor_id ? (
                <div className={styles.selectedAsset}>
                  <span>{allAssets.find(a => a._id === formData.successor_id)?.label ?? formData.successor_id}</span>
                  <button
                    type="button"
                    className={styles.clearBtn}
                    onClick={() => { setField({ successor_id: '' }); setSuccessorSearch(''); }}
                  >
                    ✕
                  </button>
                </div>
              ) : (
                <>
                  <input
                    className={styles.input}
                    placeholder="Type to search assets…"
                    value={successorSearch}
                    onChange={(e) => setSuccessorSearch(e.target.value)}
                    list="successor-options"
                    onBlur={(e) => {
                      const match = allAssets.find(a => a.label === e.target.value);
                      if (match) { setField({ successor_id: match._id }); setSuccessorSearch(''); }
                    }}
                  />
                  <datalist id="successor-options">
                    {allAssets
                      .filter(a => a._id !== formData.predecessor_id)
                      .filter(a => !successorSearch || a.label.toLowerCase().includes(successorSearch.toLowerCase()))
                      .slice(0, 30)
                      .map(a => <option key={a._id} value={a.label} />)}
                  </datalist>
                </>
              )}
            </div>
          </div>
        </div>

        {/* ITSM Data Source Section — only shown when editing */}
        {asset && (
          <div className={styles.section}>
            <h3 className={styles.sectionTitle}>ITSM Data Source</h3>
            <Select
              value={formData.source_of_truth}
              onChange={(value) => setField({ source_of_truth: value as 'local' | 'itsm' })}
              options={[
                { value: 'local', label: 'Local — this app is authoritative' },
                { value: 'itsm', label: 'ITSM — ITSM data takes precedence' },
              ]}
              placeholder="Source of Truth"
            />
            <p className={styles.helperText}>
              {formData.source_of_truth === 'itsm'
                ? 'ITSM sync will overwrite local fields. Local edits are treated as temporary overrides.'
                : 'Local data is authoritative. ITSM sync will not overwrite your edits.'}
            </p>
          </div>
        )}
      </div>
    </Modal>
    </>
  );
};

export default AssetFormModal;