/**
 * statusMapping.ts — Value normalisation for ITSM ⇄ local reconciliation.
 *
 * The local app stores asset status as a lowercase enum
 * (`active` / `maintenance` / `inactive` / `retired`), while the ITSM system
 * uses its own labels (`Deployed` / `In Stock` / `Maintenance` / `Retired`).
 * Reconciliation must not report these equivalent values as a mismatch, so all
 * status comparisons go through this mapping. The mapping is intentionally kept
 * in one place so the business rules can be adjusted without touching the
 * comparison engine.
 *
 * Also provides `normalizeMac()` so that `AA-BB-CC-DD-EE-FF` and
 * `aa:bb:cc:dd:ee:ff` are treated as identical (the classic ipcdata lesson).
 */

export type LocalStatus = 'active' | 'maintenance' | 'inactive' | 'retired';

/** ITSM status label → local status enum. */
const ITSM_TO_LOCAL: Record<string, LocalStatus> = {
  'deployed': 'active',
  'in stock': 'inactive',
  'in-stock': 'inactive',
  'instock': 'inactive',
  'maintenance': 'maintenance',
  'retired': 'retired',
};

/** local status enum → canonical ITSM status label (for display only). */
const LOCAL_TO_ITSM: Record<LocalStatus, string> = {
  active: 'Deployed',
  inactive: 'In Stock',
  maintenance: 'Maintenance',
  retired: 'Retired',
};

/**
 * Translate an ITSM status label to the local enum value that should be written
 * into the app when the user accepts the ITSM value. Falls back to a lowercased
 * copy of the raw label when no mapping exists, so unknown ITSM statuses are at
 * least persisted rather than silently dropped.
 */
export function itsmStatusToLocal(itsmStatus: string | null | undefined): string | null {
  if (!itsmStatus) return null;
  const key = itsmStatus.trim().toLowerCase();
  return ITSM_TO_LOCAL[key] ?? key;
}

/** Local enum → ITSM label, used purely to render the "expected" value. */
export function localStatusToItsm(localStatus: string | null | undefined): string | null {
  if (!localStatus) return null;
  const key = localStatus.trim().toLowerCase() as LocalStatus;
  return LOCAL_TO_ITSM[key] ?? localStatus;
}

/**
 * True when a local status and an ITSM status describe the same state.
 * Comparison is done in the local domain so the mapping is the single authority.
 */
export function statusEquals(
  localStatus: string | null | undefined,
  itsmStatus: string | null | undefined,
): boolean {
  const mappedItsm = itsmStatusToLocal(itsmStatus);
  const localKey = (localStatus ?? '').trim().toLowerCase() || null;
  return mappedItsm === localKey;
}

/** Strip separators and upper-case so MAC addresses compare regardless of format. */
export function normalizeMac(mac: string | null | undefined): string {
  return (mac ?? '').toUpperCase().replace(/[^0-9A-F]/g, '');
}
