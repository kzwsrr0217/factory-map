/**
 * settings.ts — Application preferences with localStorage persistence.
 *
 * `loadSettings()`: Reads stored settings and merges with defaults (so newly
 * added settings keys always have a value even if missing from the stored JSON).
 *
 * `saveSettings(settings)`: Persists the full settings object to localStorage.
 *
 * `resetSettings()`: Removes the stored key and returns the default settings.
 *
 * Consumed by the Settings page and by components that respect user preferences
 * (e.g., `FloorMap` reads `mapGridSize` and `mapSnapToGrid`).
 */
export interface AppSettings {
  itemsPerPage: number;
  dateFormat: 'relative' | 'short' | 'long';
  mapGridSize: number;
  mapSnapToGrid: boolean;
  defaultMapZoom: number;
}

const SETTINGS_KEY = 'appSettings';

const DEFAULTS: AppSettings = {
  itemsPerPage: 25,
  dateFormat: 'relative',
  mapGridSize: 20,
  mapSnapToGrid: true,
  defaultMapZoom: 1,
};

export const loadSettings = (): AppSettings => {
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (stored) return { ...DEFAULTS, ...JSON.parse(stored) };
  } catch { /* ignore */ }
  return { ...DEFAULTS };
};

export const saveSettings = (settings: AppSettings): void => {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
};

export const resetSettings = (): AppSettings => {
  localStorage.removeItem(SETTINGS_KEY);
  return { ...DEFAULTS };
};
