import {
	deleteProfessional,
	setProfessionalArchived
} from '$lib/server/team/public/professional-lifecycle';
import {
	createProfessionalService,
	updateProfessionalService
} from '$lib/server/team/public/service-editor';
import {
	loadProfessionalEditor,
	getPendingProfessionalAccountEmail,
	saveProfessionalProfile,
	saveProfessionalServices,
	saveProfessionalWeeklyRules,
	createAvailabilityException,
	saveProfessionalEditor,
	type SaveResult
} from '$lib/server/team/public/professional-editor';
import { logServerFailure } from '$lib/server/platform/logging';
import { parsePriceAdjustments } from '$lib/scheduling/price-contracts';
import { readBoundedBookingForm } from '$lib/server/platform/form-data';
import { previewMonthlyPrices, formatQuotedPrice, monthForTimezone } from '$lib/booking/pricing';
import { env } from '$env/dynamic/private';
import { demoBusinessContext } from '$lib/server/access/public/business';
import { writeAuditLog } from '$lib/server/platform/audit';
import { getOdontoContext } from '$lib/server/access/public/odonto-context';
import {
	isDefaultServiceName
} from '$lib/server/team/public/default-services';
import {
	findProfessionalByEmail,
	humanProfessionalEmailConflict,
	normalizeProfessionalEmail
} from '$lib/server/team/public/professionals';
import { error as kitError, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';

const redirectToProfessional = (professionalId: string, tab = 'perfil') => {
	throw redirect(303, `/odonto/profesionales/${professionalId}?tab=${tab}`);
};

const failSave = (result: Extract<SaveResult, { ok: false }>) =>
	fail(result.status, { message: result.message, exceptionConflict: result.exceptionConflict });

export const load: PageServerLoad = async ({ params, locals, fetch, cookies, url, depends }) => {
	depends(`app:professional:${params.professionalId}`);
	if (!locals.auth) throw redirect(303, '/login');
	if (env.DEMO_MODE === 'true') {
		return {
			context: demoBusinessContext(),
			professional: null,
			services: [],
			assignedServiceIds: [],
			defaultServiceIds: [],
			rules: [],
			exceptions: [],
			tab: url.searchParams.get('tab') ?? 'perfil',
			userId: null,
			pendingAccountEmail: null,
			demo: true
		};
	}

	const { supabase, business, userId } = await getOdontoContext({ locals, fetch, cookies });
	if (!business.canManage)
		throw redirect(303, business.role === 'professional' ? '/odonto/mis-turnos' : '/odonto/agenda');
	const result = await loadProfessionalEditor(
		supabase,
		business,
		userId,
		params.professionalId,
		url.searchParams.get('tab') ?? 'perfil'
	);
	if (!result.ok) throw kitError(result.status, result.message);
	if (!result.data)
		throw kitError(503, 'No pudimos cargar toda la configuración. Volvé a intentar.');
	return result.data;
};

export const actions: Actions = {
	update_profile: async ({ request, params, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });
		const { supabase, business, userId } = await getOdontoContext({ locals, fetch, cookies });
		if (!business.canManage)
			return fail(403, { message: 'No tenés permisos para editar profesionales.' });

		const form = await request.formData();
		const pendingAccountEmail = await getPendingProfessionalAccountEmail(
			supabase,
			business.business.id,
			params.professionalId
		);
		const profileResult = await saveProfessionalProfile(
			supabase,
			business.business.id,
			params.professionalId,
			form,
			{ accountLinkPending: Boolean(pendingAccountEmail) }
		);
		if (!profileResult.ok) return failSave(profileResult);

		await writeAuditLog(supabase, {
			businessId: business.business.id,
			userId,
			action: 'professional.updated',
			entityType: 'professional',
			entityId: params.professionalId
		});

		return { success: true, message: 'Perfil guardado.' };
	},

	save_services: async ({ request, params, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });
		const { supabase, business, userId } = await getOdontoContext({ locals, fetch, cookies });
		if (!business.canManage)
			return fail(403, { message: 'No tenés permisos para asignar servicios.' });

		const form = await request.formData();
		const servicesResult = await saveProfessionalServices(
			supabase,
			business.business.id,
			params.professionalId,
			form
		);
		if (!servicesResult.ok) return failSave(servicesResult);

		await writeAuditLog(supabase, {
			businessId: business.business.id,
			userId,
			action: 'professional.services_updated',
			entityType: 'professional',
			entityId: params.professionalId,
			metadata: { service_ids: servicesResult.data?.serviceIds ?? [] }
		});

		return { success: true, message: 'Servicios guardados.' };
	},

	create_service: async ({ request, params, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });
		const { supabase, business, userId } = await getOdontoContext({ locals, fetch, cookies });
		if (!business.canManage)
			return fail(403, { message: 'No tenés permisos para crear servicios.' });

		let form: FormData;
		try {
			form = await readBoundedBookingForm(request);
		} catch {
			return fail(400, { message: 'Revisá los datos del servicio antes de guardar.' });
		}
		const result = await createProfessionalService(
			supabase,
			business.business.id,
			params.professionalId,
			form
		);
		if (!result.ok) return failSave(result);
		if (!result.data)
			return fail(503, {
				message:
					'No pudimos confirmar la creación. Revisá los servicios antes de volver a intentarlo.'
			});
		return {
			success: true,
			message: 'Servicio creado y asignado.',
			serviceId: result.data.serviceId
		};
	},

	update_service: async ({ request, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });
		const { supabase, business, userId } = await getOdontoContext({ locals, fetch, cookies });
		if (!business.canManage)
			return fail(403, { message: 'No tenés permisos para editar servicios.' });

		let form: FormData;
		try {
			form = await readBoundedBookingForm(request);
		} catch {
			return fail(400, { message: 'Revisá los datos del servicio antes de guardar.' });
		}
		const result = await updateProfessionalService(supabase, business.business.id, userId, form);
		if (!result.ok) return failSave(result);
		return { success: true, message: result.data?.message ?? 'Servicio guardado.' };
	},

	save_weekly_rules: async ({ request, params, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });
		const { supabase, business, userId } = await getOdontoContext({ locals, fetch, cookies });
		if (!business.canManage)
			return fail(403, { message: 'No tenés permisos para editar horarios.' });

		const form = await request.formData();
		const scheduleResult = await saveProfessionalWeeklyRules(
			supabase,
			business.business.id,
			params.professionalId,
			form
		);
		if (!scheduleResult.ok) return failSave(scheduleResult);

		await writeAuditLog(supabase, {
			businessId: business.business.id,
			userId,
			action: 'availability_rules.replaced',
			entityType: 'professional',
			entityId: params.professionalId,
			metadata: { schedule_blocks: scheduleResult.data?.blocks ?? [] }
		});

		return { success: true, message: 'Horarios guardados.' };
	},

	delete_rule: async ({ request, params, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });
		const { supabase, business, userId } = await getOdontoContext({ locals, fetch, cookies });
		if (!business.canManage)
			return fail(403, { message: 'No tenés permisos para editar horarios.' });

		const form = await request.formData();
		const ruleId = String(form.get('rule_id') ?? '').trim();
		if (!ruleId) return fail(400, { message: 'Horario inválido.' });

		const { error } = await supabase.rpc('delete_professional_schedule_rule', {
			p_business_id: business.business.id,
			p_professional_id: params.professionalId,
			p_rule_id: ruleId,
			p_expected_revision: Number(form.get('availability_revision'))
		});
		if (error) {
			logServerFailure('Error eliminando horario', error);
			return fail(500, { message: 'No se pudo eliminar el horario.' });
		}

		await writeAuditLog(supabase, {
			businessId: business.business.id,
			userId,
			action: 'availability_rule.deleted',
			entityType: 'availability_rule',
			entityId: ruleId
		});

		return { success: true, message: 'Horario eliminado.' };
	},

	create_exception: async ({ request, params, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });
		const { supabase, business, userId } = await getOdontoContext({ locals, fetch, cookies });
		if (!business.canManage)
			return fail(403, { message: 'No tenés permisos para crear excepciones.' });

		const form = await request.formData();
		const exceptionResult = await createAvailabilityException(
			supabase,
			business.business.id,
			params.professionalId,
			business.business.timezone,
			form
		);
		if (!exceptionResult.ok) return failSave(exceptionResult);

		await writeAuditLog(supabase, {
			businessId: business.business.id,
			userId,
			action: 'availability_exception.created',
			entityType: 'availability_exception',
			entityId: exceptionResult.data?.id ?? null,
			metadata: {
				professional_id: exceptionResult.data?.professionalId ?? null,
				type: exceptionResult.data?.type,
				period_mode: exceptionResult.data?.periodMode,
				start_date: exceptionResult.data?.startDate,
				end_date: exceptionResult.data?.endDate
			}
		});

		return {
			success: true,
			message:
				exceptionResult.data?.periodMode === 'range'
					? 'Rango de bloqueo guardado.'
					: 'Cambio puntual guardado.'
		};
	},

	delete_exception: async ({ request, params, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });
		const { supabase, business, userId } = await getOdontoContext({ locals, fetch, cookies });
		if (!business.canManage)
			return fail(403, { message: 'No tenés permisos para eliminar excepciones.' });

		const form = await request.formData();
		const exceptionId = String(form.get('exception_id') ?? '').trim();
		if (!exceptionId) return fail(400, { message: 'Cambio inválido.' });

		const { error } = await supabase
			.from('availability_exceptions')
			.delete()
			.eq('business_id', business.business.id)
			.eq('id', exceptionId);
		if (error) {
			logServerFailure('Error eliminando excepción', error);
			return fail(500, { message: 'No se pudo eliminar el cambio.' });
		}

		await writeAuditLog(supabase, {
			businessId: business.business.id,
			userId,
			action: 'availability_exception.deleted',
			entityType: 'availability_exception',
			entityId: exceptionId
		});

		return { success: true, message: 'Cambio puntual eliminado.' };
	},

	save_all: async ({ request, params, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });
		const { supabase, business, userId } = await getOdontoContext({ locals, fetch, cookies });
		if (!business.canManage)
			return fail(403, { message: 'No tenés permisos para editar profesionales.' });

		const form = await request.formData();

		const saved = await saveProfessionalEditor(
			supabase,
			business.business.id,
			params.professionalId,
			business.business.timezone,
			form
		);
		if (!saved.ok) return failSave(saved);
		return { success: true, message: saved.data?.message ?? 'Cambios guardados.' };
	},

	archive_professional: async ({ params, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });
		const { supabase, business, userId } = await getOdontoContext({ locals, fetch, cookies });
		if (!business.canManage) {
			return fail(403, {
				message: 'Solo el dueño o un administrador puede archivar profesionales.'
			});
		}
		const result = await setProfessionalArchived(
			supabase,
			business.business.id,
			userId,
			params.professionalId,
			true
		);
		if (!result.ok) return failSave(result);

		redirectToProfessional(params.professionalId, 'perfil');
	},

	restore_professional: async ({ params, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });
		const { supabase, business, userId } = await getOdontoContext({ locals, fetch, cookies });
		if (!business.canManage) {
			return fail(403, {
				message: 'Solo el dueño o un administrador puede restaurar profesionales.'
			});
		}
		const result = await setProfessionalArchived(
			supabase,
			business.business.id,
			userId,
			params.professionalId,
			false
		);
		if (!result.ok) return failSave(result);

		redirectToProfessional(params.professionalId, 'perfil');
	},

	delete_professional: async ({ params, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });
		const { supabase, business } = await getOdontoContext({ locals, fetch, cookies });
		if (!business.canManage) {
			return fail(403, {
				message: 'Solo el dueño o un administrador puede eliminar profesionales.'
			});
		}

		const result = await deleteProfessional(supabase, business.business.id, params.professionalId);
		if (!result.ok) return failSave(result);

		throw redirect(303, '/odonto/configuracion/usuarios');
	}
};
