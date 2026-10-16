import type { CitaSupabaseClient } from '$lib/types/database';
import { createSupabaseAdminClient } from './supabase';
import { readJson } from '$lib/contracts/json';

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

	// Audit storage is best effort: malformed optional metadata or a transport
	// failure must not turn an already committed user operation into a failure.
	try {
		const { error } = await auditClient.from('audit_logs').insert({
			business_id: input.businessId,
			user_id: input.userId ?? null,
			action: input.action,
			entity_type: input.entityType,
			entity_id: input.entityId ?? null,
			metadata: readJson(input.metadata ?? null, 'audit.metadata')
		});
		if (error) console.error('No se pudo registrar la auditoría de la operación.');
	} catch {
		console.error('No se pudo registrar la auditoría de la operación.');
	}
};
