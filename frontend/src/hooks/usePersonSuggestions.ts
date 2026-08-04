/**
 * usePersonSuggestions.ts — Known people, for the asset form's person field.
 *
 * The ITSM person directory isn't exposed to this app, so the names come from the
 * assets themselves — but from a dedicated endpoint (`GET /assets/persons`) rather
 * than from a full asset download. Deriving them client-side meant shipping the
 * entire asset list (1.65 MB, and several requests once that list was paged) to
 * collect a few hundred names, and it required both a name and a `person_id`,
 * which silently dropped everyone the inventory survey contributes: informal names
 * deliberately kept as free text with no id. Those are the people most likely to
 * be typed here, so they are included, with a null id.
 *
 * Someone never assigned to any asset still won't appear; the field stays free
 * text, so they can be typed in.
 */
import { useState, useEffect } from 'react';
import { assetService } from '../services/asset.service';

export interface PersonSuggestion {
  full_name: string;
  /** Empty when the person is known only by name — see the file header. */
  person_id: string;
}

export const usePersonSuggestions = () => {
  const [suggestions, setSuggestions] = useState<PersonSuggestion[]>([]);

  useEffect(() => {
    assetService.getPersons()
      .then(rows => setSuggestions(rows.map(r => ({
        full_name: r.full_name,
        // The form's datalists key on person_id; '' keeps them keyable without
        // pretending an id exists.
        person_id: r.person_id ?? '',
      }))))
      .catch(() => {});
  }, []);

  return suggestions;
};
