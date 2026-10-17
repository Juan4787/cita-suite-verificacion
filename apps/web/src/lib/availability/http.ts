import type { AvailabilitySnapshot } from './snapshot';
import { parseIntegratedAvailabilityRows } from './rows';
import { parseAvailabilityBusiness, validateAvailabilityConfiguration, validateAvailabilityOccupancy } from './contracts';
import { InvalidDataContractError, readArray, readBoolean, readRecord, readText } from '$lib/contracts/json';
import { isAvailabilityDate } from './windows';
import type { AvailabilitySlot } from './calculate';

const isTimestamp = (value: string) => /^\d{4}-\d{2}-\d{2}T/.test(value) && isAvailabilityDate(value.slice(0, 10)) && Number.isFinite(Date.parse(value));

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
  const professional_ids = row.professional_ids === undefined ? [professional_id] : readArray(row.professional_ids, 'availability.http.professionals').map(value => readText(value, 'availability.http.professional'));
  const professional_names = row.professional_names === undefined ? [professional_name] : readArray(row.professional_names, 'availability.http.names').map(value => readText(value, 'availability.http.name'));
  const is_joint = row.is_joint === undefined ? professional_ids.length > 1 : readBoolean(row.is_joint, 'availability.http.joint');
  const key = professional_ids.join(',') + ':' + starts_at;
  if (!isAvailabilityDate(date) || date < expected.fromDate || date > expected.toDate || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time) ||
   !isTimestamp(starts_at) || !isTimestamp(ends_at) || Date.parse(starts_at) >= Date.parse(ends_at) ||
   !professional_ids.length || professional_ids[0] !== professional_id || professional_ids.length !== professional_names.length ||
   new Set(professional_ids).size !== professional_ids.length || professional_ids.some(id => !allowed.has(id)) ||
   is_joint !== (professional_ids.length > 1) || seen.has(key)) throw new InvalidDataContractError('availability.http.slot');
  seen.add(key);
  return { date, time, starts_at, ends_at, professional_id, professional_name, professional_ids, professional_names, is_joint };
 });
}

/** Preserves the internal v1 HTTP projection; reuses the same row validators
 * as SQL v2, without synthesizing a revision or an authorization envelope.
 */
export function parseAvailabilitySnapshot(value: unknown, expected: { businessId: string; date: string }): AvailabilitySnapshot {
 const root = readRecord(value, 'availability.http.snapshot');
 const from_date = readText(root.from_date, 'availability.http.from');
 const to_date = readText(root.to_date, 'availability.http.to');
 const generated_at = readText(root.generated_at, 'availability.http.generatedAt');
 const valid_until = readText(root.valid_until, 'availability.http.validUntil');
 if (root.schema_version !== 1 || !isAvailabilityDate(from_date) || !isAvailabilityDate(to_date) ||
  !isAvailabilityDate(expected.date) || from_date > expected.date || to_date < expected.date ||
  (Date.parse(to_date) - Date.parse(from_date)) / 86_400_000 >= 31 || !isTimestamp(generated_at) || !isTimestamp(valid_until) ||
  Date.parse(valid_until) < Date.parse(generated_at)) throw new InvalidDataContractError('availability.http.snapshot');
 const business = parseAvailabilityBusiness(root.business);
 const rows = parseIntegratedAvailabilityRows(root);
 validateAvailabilityConfiguration(rows, { businessId: expected.businessId, scope: 'internal' });
 validateAvailabilityOccupancy(rows, rows.professionals.map(row => row.id));
 return { schema_version: 1, generated_at, valid_until, from_date, to_date, business,
  services: rows.services.map(({ description: _description, price_label: _price, ...row }) => row),
  professionals: rows.professionals.map(({ avatar_url: _avatar, ...row }) => row),
  assignments: rows.assignments, rules: rows.rules, exceptions: rows.exceptions, blocks: rows.blocks };
}
