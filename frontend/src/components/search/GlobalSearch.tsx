/**
 * GlobalSearch.tsx — Full-screen search overlay (Ctrl+K).
 *
 * Provides instant prefix-search across all six entity types: buildings,
 * floors, workareas, sections, workstations, and assets.
 *
 * Architecture:
 *   Module-level cache (`cachedIndex`, `cachedResults`, `indexBuilding`) —
 *     the inverted prefix index is built once and survives across open/close
 *     cycles. Call `invalidateSearchCache()` after any create/delete mutation
 *     to force a rebuild on the next open.
 *
 *   `buildRecords()` — flattens all API responses into flat `IndexRecord`
 *     objects suitable for `buildSearchIndex`. Extra searchable text (tags,
 *     serial number, asset_tag) is appended to each record's `text` field.
 *
 *   `ensureIndex()` — parallel-fetches all entity endpoints and calls
 *     `buildSearchIndex`; idempotent via `indexBuilding` guard.
 *
 *   Keyboard navigation — ArrowUp/ArrowDown moves the selection cursor;
 *     Enter navigates to the selected result; Escape closes the overlay.
 *
 *   120 ms debounce on query input prevents index queries on every keystroke.
 *
 * Results are capped at 12 hits via `queryIndex(cachedIndex, trimmed, 12)`.
 */
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import { buildSearchIndex, queryIndex, IndexRecord, SearchIndex } from '../../utils/searchIndex';
import styles from '../../styles/components/GlobalSearch.module.css';

interface SearchResult {
  id: string;
  type: 'building' | 'floor' | 'workarea' | 'section' | 'workstation' | 'asset';
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
  buildings: any[], floors: any[], workareas: any[],
  sections: any[], workstations: any[], assets: any[]
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
    add(wa._id, 'workarea', wa.name, wa.type, '🏭', `/floors/${wa.floor_id}`, wa.type ?? '')
  );
  sections.forEach((s: any) =>
    add(s._id, 'section', s.name, s.shift_schedule, '🔧', `/floors/${s.workarea_id}`, '')
  );
  workstations.forEach((ws: any) =>
    add(ws._id, 'workstation', ws.name, ws.type, '⚙️', `/floors/${ws.section_id}`, ws.type ?? '')
  );
  assets.forEach((a: any) => {
    const name = a.basic_info?.display_name ?? '';
    const sub = [a.basic_info?.manufacturer, a.basic_info?.model].filter(Boolean).join(' ');
    const extra = [
      a.basic_info?.asset_tag,
      a.basic_info?.serial_number,
      a.basic_info?.type,
      a.basic_info?.status,
    ].filter(Boolean).join(' ');
    add(a._id, 'asset', name, sub || undefined, '💻', `/assets/${a._id}`, extra);
  });

  return { records, results };
}

async function ensureIndex(): Promise<void> {
  if (cachedIndex || indexBuilding) return;
  indexBuilding = true;
  try {
    const [b, f, wa, s, ws, a] = await Promise.all([
      api.get('/buildings').then(r => r.data.data ?? []),
      api.get('/floors').then(r => r.data.data ?? []),
      api.get('/workareas').then(r => r.data.data ?? []),
      api.get('/sections').then(r => r.data.data ?? []),
      api.get('/workstations').then(r => r.data.data ?? []),
      api.get('/assets').then(r => r.data.data ?? []),
    ]);
    const { records, results } = buildRecords(b, f, wa, s, ws, a);
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

  const runSearch = useCallback((q: string) => {
    const trimmed = q.trim();
    if (!trimmed) { setResults([]); return; }
    if (!cachedIndex) return;

    const hits = queryIndex(cachedIndex, trimmed, 12);
    setResults(hits.map((r) => r.payload as SearchResult));
    setSelectedIndex(0);
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
            placeholder="Search buildings, floors, assets..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            className={styles.searchInput}
          />
          {loading && <span className={styles.loader}>⏳</span>}
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

        {query.trim() && !loading && results.length === 0 && (
          <div className={styles.noResults}>
            <p>No results for &ldquo;{query}&rdquo;</p>
          </div>
        )}

        {!query && !loading && (
          <div className={styles.hint}>
            {cachedIndex
              ? `${cachedResults.length} items indexed — start typing to search`
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
