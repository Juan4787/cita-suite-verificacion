import type { CitaSupabaseClient } from '$lib/types/database';
import type { BookingModality, BookingModalityWindow } from '@cita-suite/shared/booking-integration';
import type { AvailabilityScope } from '$lib/availability/contracts';
import { isAvailabilityDate } from '$lib/availability/windows';
import { InvalidDataContractError } from '$lib/contracts/json';
import { loadAvailabilityCatalog, loadAvailabilityWindowRows } from '$lib/server/scheduling/public/availability-windows';
import {
 calculateAvailabilitySlots, clampRangeToBusinessRules, hasVisibleProfessionalName,
 type AvailabilityBusiness, type AvailabilitySlot
} from '$lib/availability/calculate';
export * from '$lib/availability/calculate';

export type AvailabilityInput = {
	/** Authentication scope, fixed by the server endpoint; publicOnly controls visibility. */
	readScope?: AvailabilityScope;
	modality?: BookingModality;
	modalityWindows?: BookingModalityWindow[];
	business: AvailabilityBusiness & { id: string };
	serviceId: string;
	professionalId?: string | null;
	professionalIds?: string[] | null;
	fromDate: string;
	toDate: string;
	publicOnly?: boolean;
	excludeAppointmentId?: string | null;
	ignoreBreak?: boolean;
	maxSlots?: number;
	maxSlotsPerDate?: number;
};


export const getAvailabilitySlots = async (client: CitaSupabaseClient, input: AvailabilityInput): Promise<AvailabilitySlot[]> => {
 if (!isAvailabilityDate(input.fromDate) || !isAvailabilityDate(input.toDate) || input.fromDate > input.toDate)
  throw new InvalidDataContractError('availability.range');
 const publicOnly = input.publicOnly ?? false;
 if (publicOnly && (!input.business.is_active || !input.business.public_booking_enabled)) return [];
 const catalog = await loadAvailabilityCatalog(client, input.business.id, input.readScope ?? (publicOnly ? 'public' : 'internal'));
 const service = catalog.services.find(row => row.id === input.serviceId && (!publicOnly || row.is_public));
 if (!service) return [];
 const requiredProfessionalIds = [...new Set((input.professionalIds ?? []).map(id => id.trim().toLowerCase()).filter(Boolean))];
 const professionalId = input.professionalId?.trim().toLowerCase();
 const assigned = new Set(catalog.assignments.filter(row => row.service_id === service.id).map(row => row.professional_id));
 const professionals = catalog.professionals.filter(row => assigned.has(row.id) &&
  (!publicOnly || (row.is_public && hasVisibleProfessionalName(row))) &&
  (requiredProfessionalIds.length ? requiredProfessionalIds.includes(row.id) : !professionalId || row.id === professionalId));
 if (!professionals.length || (requiredProfessionalIds.length && professionals.length !== requiredProfessionalIds.length)) return [];
 const now = new Date();
 const dates = clampRangeToBusinessRules(catalog.business, input.fromDate, input.toDate, now);
 if (!dates.length) return [];
 const rows = await loadAvailabilityWindowRows(client, catalog, {
  serviceId: service.id, professionalIds: professionals.map(row => row.id), fromDate: dates[0], toDate: dates[dates.length - 1]
 });
 return calculateAvailabilitySlots({
  business: catalog.business, service, professionals, rules: catalog.rules,
  exceptions: rows.exceptions, blocks: rows.blocks.filter(row => row.appointment_id !== input.excludeAppointmentId),
  fromDate: dates[0], toDate: dates[dates.length - 1], publicOnly, requiredProfessionalIds,
  modality: input.modality, modalityWindows: input.modalityWindows, ignoreBreak: input.ignoreBreak,
  maxSlots: input.maxSlots, maxSlotsPerDate: input.maxSlotsPerDate, now
 });
};
