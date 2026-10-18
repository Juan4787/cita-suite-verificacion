import { logServerFailure } from '$lib/server/platform/logging';
import { writeAuditLog } from '$lib/server/platform/audit';
import type { CitaSupabaseClient } from '$lib/types/database';
import {
	parseProfessionalDependencyCounts,
	type ProfessionalDependencyCounts
} from '$lib/team/professional-editor';
import { getPendingProfessionalAccountEmail, type SaveResult } from './professional-editor';
type Failure = Extract<SaveResult, { ok: false }>;

/** Informational projection. The deletion command checks live dependencies again. */
export async function getProfessionalDependencies(
	supabase: CitaSupabaseClient,
	businessId: string,
	professionalId: string
): Promise<Failure | { ok: true; data: ProfessionalDependencyCounts }> {
	const { data, error } = await supabase.rpc('get_professional_dependency_counts', {
		p_business_id: businessId,
		p_professional_id: professionalId
	});
	if (error) {
		logServerFailure('team.dependencies.read.failed', error);
		return {
			ok: false,
			status: error.message.includes('TEAM_PROFESSIONAL_NOT_FOUND') ? 404 : 503,
			message: 'No pudimos comprobar el historial del profesional. Volvé a intentar.'
		};
	}
	const counts =
		Array.isArray(data) && data.length === 1 ? parseProfessionalDependencyCounts(data[0]) : null;
	if (!counts)
		return {
			ok: false,
			status: 503,
			message: 'No pudimos comprobar el historial del profesional. Volvé a intentar.'
		};
	return { ok: true, data: counts };
}

export async function deleteProfessional(
	supabase: CitaSupabaseClient,
	businessId: string,
	professionalId: string
): Promise<SaveResult> {
	const { error } = await supabase.rpc('delete_professional_safely', {
		p_business_id: businessId,
		p_professional_id: professionalId
	});
	if (!error) return { ok: true };
	logServerFailure('team.professional.delete.failed', error);
	if (error.message.includes('TEAM_PROFESSIONAL_HAS_HISTORY'))
		return {
			ok: false,
			status: 409,
			message:
				'Este profesional tiene turnos, consultas o seguimientos. Archivalo para conservar su historial.'
		};
	if (error.code === '55P03')
		return {
			ok: false,
			status: 409,
			message:
				'Se está actualizando la información del profesional. Volvé a comprobar su historial antes de intentar eliminarlo.'
		};
	if (
		error.message.includes('TEAM_ACCESS_DENIED') ||
		error.message.includes('BUSINESS_ACCESS_RESTRICTED')
	)
		return {
			ok: false,
			status: 403,
			message: 'Ya no tenés permisos para eliminar a este profesional.'
		};
	if (error.message.includes('TEAM_PROFESSIONAL_NOT_FOUND'))
		return {
			ok: false,
			status: 404,
			message: 'El profesional ya no está disponible. Recargá la página.'
		};
	return {
		ok: false,
		status: 503,
		message:
			'No pudimos eliminar el profesional. No se aplicó la limpieza. Volvé a intentar o archivalo para conservar sus registros.'
	};
}

export async function setProfessionalArchived(
	supabase: CitaSupabaseClient,
	businessId: string,
	userId: string,
	professionalId: string,
	archived: boolean
): Promise<SaveResult> {
	const pending = archived
		? null
		: await getPendingProfessionalAccountEmail(supabase, businessId, professionalId);
	const { data, error } = await supabase
		.from('professionals')
		.update({
			is_active: !archived,
			is_public: !archived && !pending,
			updated_at: new Date().toISOString()
		})
		.eq('business_id', businessId)
		.eq('id', professionalId)
		.select('id')
		.maybeSingle();
	if (error) {
		logServerFailure('team.professional.archive.failed', error);
		return {
			ok: false,
			status: 503,
			message: 'No pudimos actualizar el profesional. Volvé a intentar.'
		};
	}
	if (!data)
		return {
			ok: false,
			status: 409,
			message: 'El profesional cambió o ya no está disponible. Recargá la página.'
		};
	await writeAuditLog(supabase, {
		businessId,
		userId,
		action: archived ? 'professional.archived' : 'professional.restored',
		entityType: 'professional',
		entityId: professionalId
	});
	return { ok: true };
}
