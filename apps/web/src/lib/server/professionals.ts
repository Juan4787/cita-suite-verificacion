import type { SupabaseClient } from '@supabase/supabase-js';

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
	supabase: SupabaseClient,
	businessId: string,
	email: string | null,
	excludeProfessionalId?: string | null
): Promise<ProfessionalEmailConflict | null> => {
	if (!email) return null;

	let query = supabase
		.from('professionals')
		.select('id, name, email')
		.eq('business_id', businessId)
		.not('email', 'is', null)
		.range(0, 9999);

	if (excludeProfessionalId) {
		query = query.neq('id', excludeProfessionalId);
	}

	const { data, error } = await query;
	if (error) throw error;
	const existing = (data ?? []).find((item) => String(item.email ?? '').trim().toLowerCase() === email);
	if (!existing?.id || !existing.email) return null;

	return {
		id: String(existing.id),
		name: String(existing.name ?? 'Profesional'),
		email: String(existing.email).trim().toLowerCase()
	};
};

export const humanProfessionalEmailConflict = (conflict: ProfessionalEmailConflict) =>
	`Ese correo ya está cargado en ${conflict.name}. Seleccionalo como profesional existente o usá otro email.`;
