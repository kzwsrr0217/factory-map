/**
 * useAssetLookups.ts — Fetches and caches distinct field values for autocomplete.
 *
 * Calls `GET /api/assets/lookups` once per application session and returns the
 * distinct values for all autocomplete fields (manufacturer, model, OS, VLAN, etc.).
 * These values are used to populate `<datalist>` elements in the asset form,
 * giving users typeahead suggestions based on existing data in the database.
 *
 * Caching strategy:
 *   A module-level `cache` variable holds the result after the first successful
 *   fetch. All subsequent `useAssetLookups()` calls return the cached value
 *   immediately without a network request. The `inflight` variable deduplicates
 *   concurrent fetch attempts — only one HTTP request is ever in-flight.
 *
 * `invalidateLookupCache()`: Call after creating or updating an asset so the next
 * form open fetches fresh suggestions. Exported so `AssetFormModal` can call it.
 */
import { useState, useEffect } from 'react';
import api from '../services/api';

export interface AssetLookups {
  manufacturer: string[];
  model: string[];
  os_type: string[];
  os_version: string[];
  vlan: string[];
  environment: string[];
  remote_access_tool: string[];
  remote_access_version: string[];
  backup_tool: string[];
  catalog_item: string[];
  organization: string[];
  serial_object: string[];
  asset_type: string[];
}

const empty: AssetLookups = {
  manufacturer: [], model: [], os_type: [], os_version: [], vlan: [],
  environment: [], remote_access_tool: [], remote_access_version: [],
  backup_tool: [], catalog_item: [], organization: [], serial_object: [], asset_type: [],
};

let cache: AssetLookups | null = null;
let inflight: Promise<AssetLookups> | null = null;

async function fetchLookups(): Promise<AssetLookups> {
  if (cache) return cache;
  if (!inflight) {
    inflight = api.get('/assets/lookups').then(r => {
      cache = { ...empty, ...r.data.data };
      inflight = null;
      return cache!;
    }).catch(() => {
      inflight = null;
      return empty;
    });
  }
  return inflight;
}

export function invalidateLookupCache() {
  cache = null;
}

export function useAssetLookups(): AssetLookups {
  const [lookups, setLookups] = useState<AssetLookups>(cache ?? empty);

  useEffect(() => {
    let cancelled = false;
    fetchLookups().then(data => { if (!cancelled) setLookups(data); });
    return () => { cancelled = true; };
  }, []);

  return lookups;
}
