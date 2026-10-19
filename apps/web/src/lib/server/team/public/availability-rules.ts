import { professionalSchedulePayload } from '$lib/team/professional-form';
import type { CitaSupabaseClient } from '$lib/types/database';
import { timeRangesOverlap, type NormalizedScheduleBlock } from '$lib/utils/schedule-blocks';

export const MIN_SLOT_INTERVAL_MINUTES = 5;
export const MAX_SLOT_INTERVAL_MINUTES = 120;

export { timeRangesOverlap };

export const replaceProfessionalScheduleBlocks = async (
	supabase: CitaSupabaseClient,
	input: {
		businessId: string;
		professionalId: string;
		blocks: NormalizedScheduleBlock[];
		expectedRevision?: number;
	}
) => {
	let revision = input.expectedRevision;
	if (revision === undefined) {
		const { data, error } = await supabase
			.from('businesses')
			.select('booking_availability_revision')
			.eq('id', input.businessId)
			.single();
		if (error) throw error;
		revision = Number(data.booking_availability_revision);
	}
	const { error } = await supabase.rpc('replace_professional_schedule_blocks', {
		p_business_id: input.businessId,
		p_professional_id: input.professionalId,
		p_expected_revision: revision,
		p_blocks: professionalSchedulePayload(input.blocks)
	});
	if (error) throw error;
};
