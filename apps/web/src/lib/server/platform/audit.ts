import type { CitaSupabaseClient } from '$lib/types/database';
import { createSupabaseAdminClient } from '$lib/server/platform/supabase';
import { readJson } from '$lib/contracts/json';

type AuditLogInput = {
	businessId: string;
	userId?: string | null;
	action: string;
	entityType: string;
	entityId?: string | null;
	metadata?: Record<string, unknown> | null;
};

/** Writes with the privileged client it receives, such as the budgeted client of a job. */
export const insertAuditLog = async (adminClient: CitaSupabaseClient, input: AuditLogInput) => {
	// Audit storage is best effort: malformed optional metadata or a transport
	// failure must not turn an already committed user operation into a failure.
	try {
		const { error } = await adminClient.from('audit_logs').insert({
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

/** Writes with an administrative client even when the caller holds a user session. */
export const writeAuditLog = async (supabase: CitaSupabaseClient, input: AuditLogInput) => {
	let auditClient = supabase;
	try {
		auditClient = await createSupabaseAdminClient('odonto');
	} catch {
		auditClient = supabase;
	}
	await insertAuditLog(auditClient, input);
};
