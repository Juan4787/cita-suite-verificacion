import type { CitaSupabaseClient } from '$lib/types/database';

export const getProfessionalPatientLink = async ({
	admin,
	businessId,
	patientId,
	professionalId
}: {
	admin: CitaSupabaseClient;
	businessId: string;
	patientId: string;
	professionalId: string;
}) => {
	const { data, error } = await admin
		.from('professional_patient_links')
		.select('id, archived_at')
		.eq('business_id', businessId)
		.eq('patient_id', patientId)
		.eq('professional_id', professionalId)
		.eq('is_active', true)
		.limit(1)
		.maybeSingle();

	if (error) throw error;
	return data ? { id: String(data.id), archived_at: data.archived_at ?? null } : null;
};
