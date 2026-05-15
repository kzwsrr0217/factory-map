/**
 * searchIndex.ts — Inverted prefix token index for instant client-side search.
 *
 * Build phase (`buildSearchIndex`):
 *   Tokenizes each record's searchable text into lowercase words, splitting on
 *   whitespace and common separators (comma, dot, underscore, dash, slash, parens).
 *   For every token, ALL prefixes of 2+ characters are indexed to a Set of record IDs.
 *   Example: token "dell" → index "de" → {id1}, "del" → {id1}, "dell" → {id1}.
 *   This makes any prefix query an O(1) Map lookup.
 *
 * Query phase (`queryIndex`):
 *   Tokenizes the query the same way, looks up each token's ID set, then intersects
 *   all sets (AND semantics — all query terms must match). Results are scored by
 *   relevance: full-phrase match scores highest, followed by exact token match,
 *   then partial match. Returns the top `limit` results.
 *
 * Used by `GlobalSearch.tsx` to provide instant search over all loaded assets
 * without any server round-trip after the initial data load.
 */

export interface IndexRecord {
  id: string;
  /** All searchable text concatenated and lowercased */
  text: string;
  /** Original data payload returned on hit */
  payload: unknown;
}

type TokenMap = Map<string, Set<string>>; // prefix → set of record IDs

export interface SearchIndex {
  records: Map<string, IndexRecord>;   // id → record (for fast payload lookup)
  tokenMap: TokenMap;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[\s,._\-/\\()+]+/)
    .filter((t) => t.length >= 2);
}

export function buildSearchIndex(records: IndexRecord[]): SearchIndex {
  const tokenMap: TokenMap = new Map();
  const recordMap = new Map<string, IndexRecord>();

  for (const rec of records) {
    recordMap.set(rec.id, rec);
    const tokens = tokenize(rec.text);
    for (const token of tokens) {
      // Index every prefix of every token for prefix-aware lookup
      for (let len = 2; len <= token.length; len++) {
        const prefix = token.slice(0, len);
        let set = tokenMap.get(prefix);
        if (!set) { set = new Set(); tokenMap.set(prefix, set); }
        set.add(rec.id);
      }
    }
  }

  return { records: recordMap, tokenMap };
}

export function queryIndex(
  index: SearchIndex,
  query: string,
  limit = 20
): IndexRecord[] {
  const terms = tokenize(query);
  if (terms.length === 0) return [];

  // For each query term, get the matching ID set
  const sets = terms.map((term) => index.tokenMap.get(term) ?? new Set<string>());

  // Intersect all sets (AND semantics) — start from smallest for efficiency
  sets.sort((a, b) => a.size - b.size);
  const [first, ...rest] = sets;
  const intersection = new Set<string>(Array.from(first));
  for (const s of rest) {
    Array.from(intersection).forEach((id) => {
      if (!s.has(id)) intersection.delete(id);
    });
  }

  if (intersection.size === 0) return [];

  // Score by how closely the record text matches the full query
  const lowerQuery = query.toLowerCase();
  const scored = Array.from(intersection)
    .map((id) => {
      const rec = index.records.get(id)!;
      let score = 0;
      if (rec.text.includes(lowerQuery)) score += 10;   // full phrase bonus
      for (const term of terms) {
        if (rec.text.includes(` ${term} `) || rec.text.startsWith(term)) score += 2;
        else if (rec.text.includes(term)) score += 1;
      }
      return { rec, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.rec);

  return scored;
}
