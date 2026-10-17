import type { CitaSupabaseClient } from '$lib/types/database';
import { parseIntegratedAvailabilityRows, type IntegratedAvailabilityRows } from '$lib/availability/rows';
export { parseIntegratedAvailabilityRows, type IntegratedAvailabilityRows } from '$lib/availability/rows';

export async function loadIntegratedAvailabilityRows(supabase: CitaSupabaseClient, input: {
	businessId: string; serviceId: string; professionalIds: string[]; rangeStart: Date; rangeEnd: Date;
}): Promise<IntegratedAvailabilityRows> {
	const { data, error } = await supabase.rpc('get_integrated_public_availability_snapshot', {
		p_business_id: input.businessId, p_service_id: input.serviceId,
		p_professional_ids: input.professionalIds,
		p_range_start: input.rangeStart.toISOString(), p_range_end: input.rangeEnd.toISOString()
	});
	if (error) throw error;
	return parseIntegratedAvailabilityRows(data);
}
