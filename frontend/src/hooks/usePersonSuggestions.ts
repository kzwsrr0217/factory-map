/**
 * usePersonSuggestions.ts — Extracts unique person records from loaded assets.
 *
 * Since the ITSM person directory is not directly exposed as an API endpoint,
 * this hook derives the list of known persons from the `assigned_person` field
 * of all assets. Duplicates are removed using a Map keyed by `person_id`.
 * Results are sorted alphabetically by full name.
 *
 * Used by the asset form's "Assigned Person" autocomplete field. If a person
 * has never been assigned to any asset in Factory Map, they won't appear here —
 * the user can still type a name/ID manually.
 */
import { useState, useEffect } from 'react';
import { assetService } from '../services/asset.service';

export interface PersonSuggestion {
  full_name: string;
  person_id: string;
}

export const usePersonSuggestions = () => {
  const [suggestions, setSuggestions] = useState<PersonSuggestion[]>([]);

  useEffect(() => {
    assetService.getAssets().then(assets => {
      const seen = new Map<string, PersonSuggestion>();
      assets.forEach(a => {
        if (a.assigned_person?.full_name && a.assigned_person?.person_id) {
          seen.set(a.assigned_person.person_id, {
            full_name: a.assigned_person.full_name,
            person_id: a.assigned_person.person_id,
          });
        }
      });
      setSuggestions(Array.from(seen.values()).sort((a, b) => a.full_name.localeCompare(b.full_name)));
    }).catch(() => {});
  }, []);

  return suggestions;
};
