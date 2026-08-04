/**
 * useAssetSearch.ts — Debounced server-side asset lookup for "pick an asset"
 * fields.
 *
 * Every picker in the app used to call `getAssets()` and filter the result in the
 * browser. That downloads the whole estate — 1.65 MB at 1057 assets, and several
 * requests now that the sweep is paged — to populate a dropdown that shows thirty
 * rows. It was also incomplete before the sweep existed: anything past the API's
 * 1000-row cap could not be picked at all.
 *
 * Searching server-side inverts that: nothing is fetched until someone types, the
 * query runs against the whole table, and only the matches come back.
 *
 * Returns an empty list below MIN_CHARS rather than everything — a picker that
 * dumps the first N assets before you've typed invites picking the wrong one.
 */
import { useEffect, useState } from 'react';
import { assetService, Asset } from '../services/asset.service';

/** One character matches most of the estate; not worth a round trip. */
const MIN_CHARS = 2;
const DEBOUNCE_MS = 300;
/** More than this in a dropdown is unreadable anyway. */
const DEFAULT_LIMIT = 30;

export interface AssetSearchState {
  results: Asset[];
  loading: boolean;
  /** True once the query is long enough to have been sent. */
  active: boolean;
}

export function useAssetSearch(query: string, limit = DEFAULT_LIMIT): AssetSearchState {
  const [results, setResults] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(false);
  const term = query.trim();
  const active = term.length >= MIN_CHARS;

  useEffect(() => {
    if (!active) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const timer = setTimeout(() => {
      assetService.searchAssets(term, limit)
        .then(setResults)
        // Silent on failure: an empty picker with the field still typable beats an
        // error toast on every keystroke of a flaky connection.
        .catch(() => setResults([]))
        .finally(() => setLoading(false));
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [term, active, limit]);

  return { results, loading, active };
}
