/**
 * GlobalSearch.tsx — Full-screen search overlay (Ctrl+K).
 *
 * Searches two kinds of thing two different ways, because they differ by orders of
 * magnitude in count:
 *
 *   The hierarchy — buildings, floors, zones, work areas — is small, static and
 *     cheap to hold, so it stays in a module-level prefix index built once per
 *     session (`cachedIndex`, invalidated by `invalidateSearchCache()`).
 *
 *   Devices and sockets are asked of the server on each query. Devices used to be
 *     in the index too, fetched with one unpaginated `GET /assets` — which the
 *     server caps at 1000 rows, so with 1057 devices the last 57 could not be found
 *     here at all, silently. Sockets were not searchable in any form, even though
 *     their label ("R1/001") is exactly what someone types when a user reports a
 *     dead network point; a surveyed factory has thousands of them, far past what is
 *     worth indexing in a browser.
 *
 * Both server searches are capped and debounced (120 ms), and late responses are
 * dropped by sequence number so a slow request can't overwrite a newer answer.
 *
 * Keyboard: ArrowUp/Down moves the cursor, Enter opens, Escape closes.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import { assetService } from '../../services/asset.service';
import { networkService } from '../../services/network.service';
import { buildSearchIndex, queryIndex, IndexRecord, SearchIndex } from '../../utils/searchIndex';
import styles from '../../styles/components/GlobalSearch.module.css';

interface SearchResult {
  id: string;
  type: 'building' | 'floor' | 'zone' | 'workarea' | 'asset' | 'socket';
  title: string;
  subtitle?: string;
  icon: string;
  path: string;
}

interface GlobalSearchProps {
  isOpen: boolean;
  onClose: () => void;
}

// Module-level cache so the index survives across open/close cycles
let cachedIndex: SearchIndex | null = null;
let cachedResults: SearchResult[] = [];
let indexBuilding = false;

function buildRecords(
  buildings: any[], floors: any[], zones: any[], workareas: any[]
): { records: IndexRecord[]; results: SearchResult[] } {
  const results: SearchResult[] = [];
  const records: IndexRecord[] = [];

  const add = (
    id: string,
    type: SearchResult['type'],
    title: string,
    subtitle: string | undefined,
    icon: string,
    path: string,
    extra: string
  ) => {
    const text = [title, subtitle, extra].filter(Boolean).join(' ').toLowerCase();
    results.push({ id, type, title, subtitle, icon, path });
    records.push({ id, text, payload: results[results.length - 1] });
  };

  buildings.forEach((b: any) =>
    add(b._id, 'building', b.name, b.address, '🏢', `/buildings/${b._id}`, '')
  );
  floors.forEach((f: any) =>
    add(f._id, 'floor', f.name, `Level ${f.floor_number}`, '📐', `/floors/${f._id}`, `floor ${f.floor_number}`)
  );
  workareas.forEach((wa: any) =>
    add(wa._id, 'workarea', wa.name, wa.zone?.name, '🏭', `/floors/${wa.floor_id}`, wa.zone?.name ?? '')
  );
  zones.forEach((z: any) =>
    add(z._id, 'zone', z.name, z.description, '🗺️', `/floors/${z.floor_id}`, '')
  );

  return { records, results };
}

/** A device hit, straight from the server's own `q` search. */
function assetResult(a: any): SearchResult {
  const sub = [a.basic_info?.manufacturer, a.basic_info?.model].filter(Boolean).join(' ');
  return {
    id: a._id,
    type: 'asset',
    title: a.basic_info?.display_name ?? '(unnamed)',
    subtitle: sub || a.basic_info?.serial_number || undefined,
    icon: '💻',
    path: `/assets/${a._id}`,
  };
}

/**
 * A socket hit. Goes to the floor's socket list with the label pre-filtered —
 * landing on a floor with 500 sockets and no hint which one was meant would answer
 * the question with a haystack.
 */
function socketResult(p: any): SearchResult {
  const where = [p.workarea?.name, p.rack_name && `rack ${p.rack_name}`].filter(Boolean).join(' · ');
  const state = p.occupied_by ? `used by ${p.occupied_by.display_name}` : 'free';
  return {
    id: p._id,
    type: 'socket',
    title: p.label,
    subtitle: [where, state].filter(Boolean).join(' — '),
    icon: '🔌',
    path: `/floors/${p.floor_id}?socket=${encodeURIComponent(p.label)}`,
  };
}

async function ensureIndex(): Promise<void> {
  if (cachedIndex || indexBuilding) return;
  indexBuilding = true;
  try {
    const [b, f, z, wa] = await Promise.all([
      api.get('/buildings').then(r => r.data.data ?? []),
      api.get('/floors').then(r => r.data.data ?? []),
      api.get('/zones').then(r => r.data.data ?? []),
      api.get('/workareas').then(r => r.data.data ?? []),
    ]);
    const { records, results } = buildRecords(b, f, z, wa);
    cachedResults = results;
    cachedIndex = buildSearchIndex(records);
  } finally {
    indexBuilding = false;
  }
}

// Allow other components to invalidate the cache (e.g. after create/delete)
export function invalidateSearchCache() {
  cachedIndex = null;
  cachedResults = [];
}

const GlobalSearch: React.FC<GlobalSearchProps> = ({ isOpen, onClose }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  /** A server search is in flight; separate from `loading` (the one-off index build). */
  const [searching, setSearching] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  // Pre-load the index as soon as the modal opens
  useEffect(() => {
    if (!isOpen) return;
    inputRef.current?.focus();
    setQuery('');
    setResults([]);
    setSelectedIndex(0);

    if (!cachedIndex) {
      setLoading(true);
      ensureIndex().then(() => setLoading(false)).catch(() => setLoading(false));
    }
  }, [isOpen]);

  /**
   * Sequence number of the newest query. A server search started earlier can answer
   * later; without this, typing "R1/0" then "R1/001" could end up showing the wider
   * result set.
   */
  const querySeq = useRef(0);

  const runSearch = useCallback(async (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) { setResults([]); setSearching(false); return; }

    const seq = ++querySeq.current;

    // The hierarchy answers instantly from the index; show it rather than an empty
    // list while the two server searches are in flight.
    const local = cachedIndex
      ? queryIndex(cachedIndex, trimmed, 6).map((r) => r.payload as SearchResult)
      : [];
    setResults(local);
    setSelectedIndex(0);
    setSearching(true);

    const [assets, sockets] = await Promise.all([
      assetService.searchAssets(trimmed, 6).catch(() => []),
      networkService.searchWallPorts(trimmed, 6).catch(() => []),
    ]);
    if (seq !== querySeq.current) return;

    setResults([...local, ...assets.map(assetResult), ...sockets.map(socketResult)]);
    setSelectedIndex(0);
    setSearching(false);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const id = setTimeout(() => runSearch(query), 120);
    return () => clearTimeout(id);
  }, [query, isOpen, runSearch]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((p) => Math.min(p + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((p) => Math.max(p - 1, 0));
    } else if (e.key === 'Enter' && results[selectedIndex]) {
      handleResultClick(results[selectedIndex]);
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  const handleResultClick = (result: SearchResult) => {
    navigate(result.path);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.searchBox}>
          <span className={styles.searchIcon}>🔍</span>
          <input
            ref={inputRef}
            type="text"
            placeholder="Search devices, sockets (R1/001), rooms, floors…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            className={styles.searchInput}
          />
          {(loading || searching) && <span className={styles.loader}>⏳</span>}
          {!loading && query && (
            <button className={styles.clearBtn} onClick={() => setQuery('')}>✕</button>
          )}
        </div>

        {results.length > 0 && (
          <div className={styles.results}>
            {results.map((result, index) => (
              <div
                key={result.id}
                className={`${styles.resultItem} ${index === selectedIndex ? styles.selected : ''}`}
                onClick={() => handleResultClick(result)}
                onMouseEnter={() => setSelectedIndex(index)}
              >
                <span className={styles.resultIcon}>{result.icon}</span>
                <div className={styles.resultContent}>
                  <div className={styles.resultTitle}>{result.title}</div>
                  {result.subtitle && (
                    <div className={styles.resultSubtitle}>{result.subtitle}</div>
                  )}
                </div>
                <span className={styles.resultType}>{result.type}</span>
              </div>
            ))}
          </div>
        )}

        {query.trim() && !loading && !searching && results.length === 0 && (
          <div className={styles.noResults}>
            <p>No results for &ldquo;{query}&rdquo;</p>
          </div>
        )}

        {!query && !loading && (
          <div className={styles.hint}>
            {cachedIndex
              ? `${cachedResults.length} places indexed — devices and sockets are searched as you type`
              : 'Loading search index…'}
          </div>
        )}

        <div className={styles.footer}>
          <kbd>↑↓</kbd> Navigate &nbsp;•&nbsp; <kbd>↵</kbd> Select &nbsp;•&nbsp; <kbd>Esc</kbd> Close
        </div>
      </div>
    </div>
  );
};

export default GlobalSearch;
