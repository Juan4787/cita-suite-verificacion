import { InvalidDataContractError, readArray, readBoolean, readRecord, readText } from '$lib/contracts/json';
import { isAvailabilityDate } from './windows';
import type { AvailabilitySlot } from './calculate';

/** Internal HTTP results are complete arrays, never an absent-array fallback.
 * SQL rows were validated on the server; this boundary protects the browser
 * from incomplete/stale responses before they replace its calculated options.
 */
export function parseAvailabilitySlots(value: unknown, expected: {
 fromDate: string; toDate: string; professionalIds: readonly string[];
}): AvailabilitySlot[] {
 const root = readRecord(value, 'availability.http');
 const allowed = new Set(expected.professionalIds);
 const seen = new Set<string>();
 return readArray(root.slots, 'availability.http.slots').map(value => {
  const row = readRecord(value, 'availability.http.slot');
  const date = readText(row.date, 'availability.http.date');
  const time = readText(row.time, 'availability.http.time');
  const starts_at = readText(row.starts_at, 'availability.http.start');
  const ends_at = readText(row.ends_at, 'availability.http.end');
  const professional_id = readText(row.professional_id, 'availability.http.professional');
  const professional_name = readText(row.professional_name, 'availability.http.name');
  const professional_ids = readArray(row.professional_ids, 'availability.http.professionals').map(value => readText(value, 'availability.http.professional'));
  const professional_names = readArray(row.professional_names, 'availability.http.names').map(value => readText(value, 'availability.http.name'));
  const is_joint = readBoolean(row.is_joint, 'availability.http.joint');
  const timestamp = (value: string) => /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
  const key = professional_ids.join(',') + ':' + starts_at;
  if (!isAvailabilityDate(date) || date < expected.fromDate || date > expected.toDate || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time) ||
   !timestamp(starts_at) || !timestamp(ends_at) || Date.parse(starts_at) >= Date.parse(ends_at) ||
   !professional_ids.length || professional_ids[0] !== professional_id || professional_ids.length !== professional_names.length ||
   new Set(professional_ids).size !== professional_ids.length || professional_ids.some(id => !allowed.has(id)) ||
   is_joint !== (professional_ids.length > 1) || seen.has(key)) throw new InvalidDataContractError('availability.http.slot');
  seen.add(key);
  return { date, time, starts_at, ends_at, professional_id, professional_name, professional_ids, professional_names, is_joint };
 });
}
