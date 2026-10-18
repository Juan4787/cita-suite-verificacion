import type { CitaSupabaseClient } from '$lib/types/database';
import type { BusinessRole } from '$lib/access/contracts';
import { parseBusinessRoleAccesses, parseRoleAccessOutcome } from '$lib/access/team-contracts';

/** Whole authorized list: malformed rows fail instead of disappearing from roles/owner counts. */
export async function listBusinessRoleAccess(supabase: CitaSupabaseClient, businessId: string) {
	const { data, error } = await supabase.rpc('list_business_role_access', {
		target_business_id: businessId
	});
	if (error) throw error;
	return parseBusinessRoleAccesses(data, businessId);
}

/** SQL owns current authorization, role/link changes, invitation and rollback. */
export async function grantBusinessRoleAccess(
	supabase: CitaSupabaseClient,
	businessId: string,
	email: string,
	role: BusinessRole,
	professionalId: string | null = null
) {
	const { data, error } = await supabase.rpc('upsert_business_role_access', {
		target_business_id: businessId,
		target_email: email.trim().toLowerCase(),
		target_role: role,
		target_professional_id: professionalId
	});
	if (error) throw error;
	return { status: parseRoleAccessOutcome(data) };
}
