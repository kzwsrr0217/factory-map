/**
 * assetTypes.ts — Asset type registry with display metadata.
 *
 * `ASSET_TYPE_MAP` is the single source of truth for all known asset types.
 * Each entry provides a human-readable label, an emoji icon for map and list
 * display, and a brand color used for the type badge and map icon background.
 *
 * When adding a new asset type:
 *  1. Add an entry to `ASSET_TYPE_MAP` here.
 *  2. The type will automatically appear in `ASSET_TYPE_OPTIONS` (used by the
 *     asset form type dropdown) and be handled by `getAssetIcon()` /
 *     `getAssetTypeLabel()`.
 *  3. No other changes needed — the map, list, and badge components all use
 *     these helpers dynamically.
 */
export interface AssetTypeDefinition {
  label: string;
  icon: string;
  color: string;
}

export const ASSET_TYPE_MAP: Record<string, AssetTypeDefinition> = {
  workstation:   { label: 'Workstation',    icon: '🖥️',  color: '#3b82f6' },
  laptop:        { label: 'Laptop',         icon: '💻',  color: '#6366f1' },
  server:        { label: 'Server',         icon: '🖧',  color: '#7c3aed' },
  switch:        { label: 'Network Switch', icon: '🔀',  color: '#0891b2' },
  router:        { label: 'Router',         icon: '📡',  color: '#0e7490' },
  access_point:  { label: 'Access Point',   icon: '📶',  color: '#0284c7' },
  printer:       { label: 'Printer',        icon: '🖨️',  color: '#b45309' },
  camera:        { label: 'IP Camera',      icon: '📷',  color: '#374151' },
  ipc:           { label: 'IPC',            icon: '🖥️',  color: '#166534' },
  plc:           { label: 'PLC',            icon: '⚙️',  color: '#15803d' },
  ups:           { label: 'UPS',            icon: '🔋',  color: '#dc2626' },
  monitor:       { label: 'Monitor',        icon: '🖵',  color: '#4f46e5' },
  phone:         { label: 'IP Phone',       icon: '☎️',  color: '#0369a1' },
  scanner:       { label: 'Scanner',        icon: '📠',  color: '#92400e' },
  terminal:      { label: 'Terminal',       icon: '⌨️',  color: '#1d4ed8' },
  other:         { label: 'Other',          icon: '📦',  color: '#6b7280' },
};

export const ASSET_TYPE_OPTIONS = [
  { value: '', label: 'Select type...' },
  ...Object.entries(ASSET_TYPE_MAP).map(([value, def]) => ({
    value,
    label: `${def.icon} ${def.label}`,
  })),
];

export const getAssetIcon = (type?: string): string => {
  if (!type) return '📦';
  return ASSET_TYPE_MAP[type]?.icon ?? '📦';
};

export const getAssetTypeLabel = (type?: string): string => {
  if (!type) return 'Unknown';
  return ASSET_TYPE_MAP[type]?.label ?? type;
};
