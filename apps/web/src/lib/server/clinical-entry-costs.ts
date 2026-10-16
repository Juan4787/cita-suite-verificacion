import { readFiniteNumber, readRecord } from '$lib/contracts/json';

/**
 * PostgREST returns an array for the legacy single-column FK, and an object
 * when the composite FK matches UNIQUE(business_id, clinical_entry_id).
 * Accept both during the compatible migration/rollback window.
 */
export function readClinicalEntryAmount(value: unknown): number | null {
  const item: unknown = Array.isArray(value) ? value[0] : value;
  if (item === null || item === undefined) return null;
  const row = readRecord(item, 'clinicalEntryCost');
  return row.amount === null ? null : readFiniteNumber(row.amount, 'clinicalEntryCost.amount');
}
