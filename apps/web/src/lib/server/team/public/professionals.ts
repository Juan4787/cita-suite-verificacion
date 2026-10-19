import type { CitaSupabaseClient } from '$lib/types/database';

export type ProfessionalEmailConflict = {
	id: string;
	name: string;
	email: string;
};

export const normalizeProfessionalEmail = (value: unknown) => {
	const email = String(value ?? '')
		.trim()
		.toLowerCase();
	return email || null;
};

export const findProfessionalByEmail = async (
	supabase: CitaSupabaseClient,
	businessId: string,
	email: string | null,
	excludeProfessionalId?: string | null
): Promise<ProfessionalEmailConflict | null> => {
	if (!email) return null;

	let query = supabase
		.from('professionals')
		.select('id, name, email')
		.eq('business_id', businessId)
		.eq('email', normalizeProfessionalEmail(email) ?? '');

	if (excludeProfessionalId) {
		query = query.neq('id', excludeProfessionalId);
	}

	// The existing database trigger normalizes stored email and enforces uniqueness.
	// Query that identity directly; never scan a list that PostgREST may truncate.
	const { data: existing, error } = await query.maybeSingle();
	if (error) throw error;
	if (!existing?.id || !existing.email) return null;

	return {
		id: String(existing.id),
		name: String(existing.name ?? 'Profesional'),
		email: String(existing.email).trim().toLowerCase()
	};
};

export const humanProfessionalEmailConflict = (conflict: ProfessionalEmailConflict) =>
	`Ese correo ya está cargado en ${conflict.name}. Seleccionalo como profesional existente o usá otro email.`;

export const getProfessionalForUser = async ({
	admin,
	businessId,
	userId
}: {
	admin: CitaSupabaseClient;
	businessId: string;
	userId: string;
}) => {
	const { data, error } = await admin
		.from('professional_users')
		.select('professional_id, professionals(name)')
		.eq('business_id', businessId)
		.eq('user_id', userId)
		.order('created_at', { ascending: true })
		.limit(1)
		.maybeSingle();

	if (error) throw error;
	const professional = data?.professionals;
	const professionalId = data?.professional_id ? String(data.professional_id) : null;
	if (!professionalId) return null;

	return {
		id: professionalId,
		name: String(professional?.name ?? '').trim() || 'Profesional'
	};
};
