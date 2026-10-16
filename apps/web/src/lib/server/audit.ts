import type { CitaSupabaseClient } from '$lib/types/database';
import { createSupabaseAdminClient } from './supabase';
import { readJson } from './contracts';

export const writeAuditLog = async (
	supabase: CitaSupabaseClient,
	input: {
		businessId: string;
		userId?: string | null;
		action: string;
		entityType: string;
		entityId?: string | null;
		metadata?: Record<string, unknown> | null;
	}
) => {
	let auditClient = supabase;
	try {
		auditClient = await createSupabaseAdminClient('odonto');
	} catch {
		auditClient = supabase;
	}

	const { error } = await auditClient.from('audit_logs').insert({
		business_id: input.businessId,
		user_id: input.userId ?? null,
		action: input.action,
		entity_type: input.entityType,
		entity_id: input.entityId ?? null,
		metadata: readJson(input.metadata ?? null, 'audit.metadata')
	});

	if (error) {
		console.error('Error registrando auditoria', error);
	}
};
