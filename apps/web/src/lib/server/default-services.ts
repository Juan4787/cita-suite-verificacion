import type { SupabaseClient } from '@supabase/supabase-js';

export const DEFAULT_SERVICE_NAMES = ['Consulta', 'Otro servicio'] as const;
export const DEFAULT_SERVICE_DURATION_MINUTES = 30;

export const isDefaultServiceName = (name: string | null | undefined) =>
	DEFAULT_SERVICE_NAMES.some(
		(defaultName) => defaultName.toLowerCase() === String(name ?? '').trim().toLowerCase()
	);

// Consulta y Otro servicio son servicios reales del consultorio: existen en `services`,
// tienen duración y participan del motor de disponibilidad como cualquier otro servicio.
export const ensureDefaultServices = async (
	supabase: SupabaseClient,
	businessId: string
): Promise<string[]> => {
	const { data, error } = await supabase
		.from('services')
		.select('id, name, is_active, is_public')
		.eq('business_id', businessId);
	if (error) throw error;

	const rows = data ?? [];
	const ids: string[] = [];
	for (const name of DEFAULT_SERVICE_NAMES) {
		const existing = rows.find(
			(row: any) => String(row.name ?? '').trim().toLowerCase() === name.toLowerCase()
		);
		if (existing?.id) {
			if (!existing.is_active || !existing.is_public) {
				const { data: updated, error: updateError } = await supabase
					.from('services')
					.update({ is_active: true, is_public: true, updated_at: new Date().toISOString() })
					.eq('business_id', businessId)
					.eq('id', existing.id)
					.select('id')
					.maybeSingle();
				if (updateError) throw updateError;
				if (!updated) throw new Error('DEFAULT_SERVICE_NOT_FOUND');
			}
			ids.push(String(existing.id));
			continue;
		}

		const id = crypto.randomUUID();
		const { error: insertError } = await supabase
			.from('services')
			.insert({
				id,
				business_id: businessId,
				name,
				description: null,
				duration_minutes: DEFAULT_SERVICE_DURATION_MINUTES,
				buffer_before_minutes: 0,
				buffer_after_minutes: 0,
				price_label: null,
				is_public: true,
				is_active: true
			});
		if (insertError) {
			throw insertError;
		}
		ids.push(id);
	}
	return ids;
};

export const ensureDefaultServicesAssigned = async (
	supabase: SupabaseClient,
	businessId: string,
	professionalId: string
): Promise<string[]> => {
	const serviceIds = await ensureDefaultServices(supabase, businessId);
	if (serviceIds.length > 0) {
		const { error } = await supabase.from('professional_services').upsert(
			serviceIds.map((serviceId) => ({
				business_id: businessId,
				professional_id: professionalId,
				service_id: serviceId
			})),
			{ onConflict: 'business_id,professional_id,service_id', ignoreDuplicates: true }
		);
		if (error) throw error;
	}
	return serviceIds;
};
