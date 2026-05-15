/**
 * assetTemplates.ts — Pre-filled asset creation templates.
 *
 * `ASSET_TEMPLATES` is a list of common hardware types with sensible default
 * field values. When the user picks a template in the asset form (CSV import
 * or inline "Start from template" option), these defaults are pre-populated so
 * the user only needs to fill in the device-specific details (name, serial, IP).
 *
 * Adding a new template: append an entry to `ASSET_TEMPLATES` with a unique `id`,
 * a display `label`, an `icon` emoji, and any `defaults` that apply to that
 * hardware category. The `asset_type` value must match a key in `ASSET_TYPE_MAP`.
 */
export interface AssetTemplate {
  id: string;
  label: string;
  icon: string;
  defaults: {
    asset_type: string;
    manufacturer?: string;
    model?: string;
    os_type?: string;
    cpu?: string;
    ram?: string;
    storage?: string;
  };
}

export const ASSET_TEMPLATES: AssetTemplate[] = [
  {
    id: 'dell-laptop',
    label: 'Dell Laptop',
    icon: '💻',
    defaults: { asset_type: 'laptop', manufacturer: 'Dell', os_type: 'Windows 11 Pro', ram: '16 GB', storage: '512 GB SSD' },
  },
  {
    id: 'hp-workstation',
    label: 'HP Workstation',
    icon: '🖥️',
    defaults: { asset_type: 'workstation', manufacturer: 'HP', os_type: 'Windows 11 Pro', cpu: 'Intel Core i7', ram: '32 GB', storage: '1 TB SSD' },
  },
  {
    id: 'dell-server',
    label: 'Dell PowerEdge Server',
    icon: '🗄️',
    defaults: { asset_type: 'server', manufacturer: 'Dell', model: 'PowerEdge R750', os_type: 'Ubuntu Server 22.04', ram: '64 GB', storage: '2 TB NVMe' },
  },
  {
    id: 'cisco-switch',
    label: 'Cisco Switch',
    icon: '🔀',
    defaults: { asset_type: 'network', manufacturer: 'Cisco', model: 'Catalyst 9300' },
  },
  {
    id: 'ups',
    label: 'UPS / Power',
    icon: '🔋',
    defaults: { asset_type: 'power', manufacturer: 'APC' },
  },
  {
    id: 'printer',
    label: 'Printer',
    icon: '🖨️',
    defaults: { asset_type: 'printer', manufacturer: 'HP' },
  },
  {
    id: 'ip-phone',
    label: 'IP Phone',
    icon: '📞',
    defaults: { asset_type: 'phone', manufacturer: 'Cisco' },
  },
  {
    id: 'camera',
    label: 'IP Camera',
    icon: '📷',
    defaults: { asset_type: 'camera', manufacturer: 'Hikvision' },
  },
];
