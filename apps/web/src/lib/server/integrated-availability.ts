import type { SupabaseClient } from '@supabase/supabase-js';
import type { AvailabilityServiceRow, AvailabilityProfessionalRow, AvailabilityRuleRow, AvailabilityExceptionRow, AvailabilityAppointmentBlockRow } from '$lib/availability/calculate';

export type IntegratedAvailabilityRows = {
	services: Array<AvailabilityServiceRow & { description: string | null; price_label: string | null; sort_order: number }>;
	professionals: Array<AvailabilityProfessionalRow & { specialty: string | null; avatar_url: string | null; sort_order: number }>;
	assignments: Array<{ service_id: string; professional_id: string }>;
	rules: AvailabilityRuleRow[];
	exceptions: AvailabilityExceptionRow[];
	blocks: AvailabilityAppointmentBlockRow[];
};

export async function loadIntegratedAvailabilityRows(supabase: SupabaseClient, input: {
	businessId: string; serviceId: string; professionalIds: string[]; rangeStart: Date; rangeEnd: Date;
}): Promise<IntegratedAvailabilityRows> {
	const { data, error } = await supabase.rpc('get_integrated_public_availability_snapshot', {
		p_business_id: input.businessId, p_service_id: input.serviceId,
		p_professional_ids: input.professionalIds,
		p_range_start: input.rangeStart.toISOString(), p_range_end: input.rangeEnd.toISOString()
	});
	if (error) throw error;
	if (!data || typeof data !== 'object' || ['services', 'professionals', 'assignments', 'rules', 'exceptions', 'blocks'].some((key) => !Array.isArray(data[key]))) {
		throw new Error('BOOKING_AVAILABILITY_SNAPSHOT_INVALID');
	}
	return data as IntegratedAvailabilityRows;
}
