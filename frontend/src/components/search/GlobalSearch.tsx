import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
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

const GlobalSearch: React.FC<GlobalSearchProps> = ({ isOpen, onClose }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
      setQuery('');
      setResults([]);
      setSelectedIndex(0);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }

    const searchTimeout = setTimeout(async () => {
      setLoading(true);
      try {
        // Search across all entities
        const [buildings, floors, workareas, sections, workstations, assets] = await Promise.all([
          fetch(`http://localhost:5000/api/buildings`).then(r => r.json()),
          fetch(`http://localhost:5000/api/floors`).then(r => r.json()),
          fetch(`http://localhost:5000/api/workareas`).then(r => r.json()),
          fetch(`http://localhost:5000/api/sections`).then(r => r.json()),
          fetch(`http://localhost:5000/api/workstations`).then(r => r.json()),
          fetch(`http://localhost:5000/api/assets`).then(r => r.json()),
        ]);

        const searchResults: SearchResult[] = [];
        const lowerQuery = query.toLowerCase();

        // Buildings
        buildings.data?.forEach((b: any) => {
          if (b.name.toLowerCase().includes(lowerQuery) || b.address?.toLowerCase().includes(lowerQuery)) {
            searchResults.push({
              id: b._id,
              type: 'building',
              title: b.name,
              subtitle: b.address,
              icon: '🏢',
              path: `/buildings/${b._id}`,
            });
          }
        });

        // Floors
        floors.data?.forEach((f: any) => {
          if (f.name.toLowerCase().includes(lowerQuery)) {
            searchResults.push({
              id: f._id,
              type: 'floor',
              title: f.name,
              subtitle: `Level ${f.floor_number}`,
              icon: '📐',
              path: `/floors/${f._id}`,
            });
          }
        });

        // Work Areas
        workareas.data?.forEach((wa: any) => {
          if (wa.name.toLowerCase().includes(lowerQuery) || wa.type?.toLowerCase().includes(lowerQuery)) {
            searchResults.push({
              id: wa._id,
              type: 'workarea',
              title: wa.name,
              subtitle: wa.type,
              icon: '🏭',
              path: `/floors/${wa.floor_id}`,
            });
          }
        });

        // Sections
        sections.data?.forEach((s: any) => {
          if (s.name.toLowerCase().includes(lowerQuery)) {
            searchResults.push({
              id: s._id,
              type: 'section',
              title: s.name,
              subtitle: s.shift_schedule,
              icon: '🔧',
              path: `/floors/${s.workarea_id}`, // Navigate to floor
            });
          }
        });

        // Workstations
        workstations.data?.forEach((ws: any) => {
          if (ws.name.toLowerCase().includes(lowerQuery) || ws.type?.toLowerCase().includes(lowerQuery)) {
            searchResults.push({
              id: ws._id,
              type: 'workstation',
              title: ws.name,
              subtitle: ws.type,
              icon: '⚙️',
              path: `/floors/${ws.section_id}`, // Navigate to floor
            });
          }
        });

        // Assets
        assets.data?.forEach((a: any) => {
          if (
            a.basic_info.display_name.toLowerCase().includes(lowerQuery) ||
            a.basic_info.asset_tag?.toLowerCase().includes(lowerQuery) ||
            a.basic_info.serial_number?.toLowerCase().includes(lowerQuery) ||
            a.basic_info.manufacturer?.toLowerCase().includes(lowerQuery)
          ) {
            searchResults.push({
              id: a._id,
              type: 'asset',
              title: a.basic_info.display_name,
              subtitle: `${a.basic_info.manufacturer || ''} ${a.basic_info.model || ''}`.trim(),
              icon: '💻',
              path: `/assets/${a._id}`,
            });
          }
        });

        setResults(searchResults.slice(0, 10)); // Limit to 10 results
        setSelectedIndex(0);
      } catch (error) {
        console.error('Search error:', error);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => clearTimeout(searchTimeout);
  }, [query]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => Math.max(prev - 1, 0));
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
                  {result.subtitle && <div className={styles.resultSubtitle}>{result.subtitle}</div>}
                </div>
                <span className={styles.resultType}>{result.type}</span>
              </div>
            ))}
          </div>
        )}

        {query && !loading && results.length === 0 && (
          <div className={styles.noResults}>
            <p>No results found for "{query}"</p>
          </div>
        )}

        <div className={styles.footer}>
          <kbd>↑↓</kbd> Navigate • <kbd>↵</kbd> Select • <kbd>Esc</kbd> Close
        </div>
      </div>
    </div>
  );
};

export default GlobalSearch;