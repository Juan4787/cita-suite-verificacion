import type { CitaSupabaseClient } from '$lib/types/database';
import type { AvailabilitySnapshot } from '$lib/availability/snapshot';
import type { AvailabilityBusiness } from '$lib/availability/calculate';
import { AVAILABILITY_WINDOW_DAYS, isAvailabilityDate, shiftAvailabilityDate } from '$lib/availability/windows';
import { loadAvailabilityCatalog, loadAvailabilityWindowRows } from '$lib/server/scheduling/public/availability-windows';

const SNAPSHOT_TTL_MS = 20_000;
const INTERNAL_REQUEST_MAX_DAYS = 31;

const dateForTimezone = (date: Date, timeZone: string) => {
 const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
  timeZone, year: 'numeric', month: '2-digit', day: '2-digit'
 }).formatToParts(date).map(part => [part.type, part.value]));
 return `${parts.year}-${parts.month}-${parts.day}`;
};

export const defaultInternalAvailabilitySnapshotRange = (
 business: Pick<AvailabilityBusiness, 'timezone'>, preferredFromDate?: string, now = new Date()
) => {
 const today = dateForTimezone(now, business.timezone);
 const fromDate = preferredFromDate && isAvailabilityDate(preferredFromDate) && preferredFromDate >= today ? preferredFromDate : today;
 return { fromDate, toDate: shiftAvailabilityDate(fromDate, AVAILABILITY_WINDOW_DAYS - 1) };
};

export const loadInternalAvailabilitySnapshot = async (client: CitaSupabaseClient, input: {
 business: AvailabilityBusiness & { id: string }; fromDate: string; toDate: string;
}): Promise<AvailabilitySnapshot> => {
 const { fromDate, toDate } = input;
 if (!isAvailabilityDate(fromDate) || !isAvailabilityDate(toDate) || fromDate > toDate)
  throw new Error('Rango inválido para consultar disponibilidad.');
 if ((Date.parse(toDate) - Date.parse(fromDate)) / 86_400_000 >= INTERNAL_REQUEST_MAX_DAYS)
  throw new Error('La consulta de disponibilidad supera el rango permitido.');
 const catalog = await loadAvailabilityCatalog(client, input.business.id, 'internal');
 const rows = await loadAvailabilityWindowRows(client, catalog, {
  serviceId: null, professionalIds: catalog.professionals.map(row => row.id), fromDate, toDate
 });
 return {
  schema_version: 1, generated_at: rows.generatedAt,
  valid_until: new Date(Date.parse(rows.generatedAt) + SNAPSHOT_TTL_MS).toISOString(),
  from_date: fromDate, to_date: toDate, business: catalog.business,
  services: catalog.services.map(({ description: _description, price_label: _price, ...row }) => row),
  professionals: catalog.professionals.map(({ avatar_url: _avatar, ...row }) => row),
  assignments: catalog.assignments, rules: catalog.rules, exceptions: rows.exceptions, blocks: rows.blocks
 };
};
