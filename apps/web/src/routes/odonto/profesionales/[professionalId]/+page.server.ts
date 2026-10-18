import {
	loadProfessionalEditor,
	parsePositiveInt,
	MIN_SERVICE_DURATION_MINUTES,
	MAX_SERVICE_DURATION_MINUTES,
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
import { createSupabaseAdminClient } from '$lib/server/platform/supabase';
import { professionalHasFollowUps } from '$lib/server/patients/public/follow-ups';
import { idsFromForm } from '$lib/server/team/public/professional-services';
import {
	ensureDefaultServices,
	isDefaultServiceName
} from '$lib/server/team/public/default-services';
import {
	findProfessionalByEmail,
	humanProfessionalEmailConflict,
	normalizeProfessionalEmail
} from '$lib/server/team/public/professionals';
import { formatPriceLabel } from '$lib/utils/money-input';
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

		const form = await request.formData();
		const name = String(form.get('name') ?? '').trim();
		const duration = parsePositiveInt(form.get('duration_minutes'), 30);
		const priceLabel = formatPriceLabel(String(form.get('price_label') ?? ''));
		if (!name) return fail(400, { message: 'El nombre del servicio es obligatorio.' });
		if (duration < MIN_SERVICE_DURATION_MINUTES || duration > MAX_SERVICE_DURATION_MINUTES) {
			return fail(400, { message: 'La duración debe estar entre 5 y 480 minutos.' });
		}

		const serviceId = crypto.randomUUID();
		const { error } = await supabase.from('services').insert({
			id: serviceId,
			business_id: business.business.id,
			name,
			duration_minutes: duration,
			price_label: priceLabel || null,
			description: null,
			buffer_before_minutes: 0,
			buffer_after_minutes: 0,
			is_public: true,
			is_active: true
		});

		if (error) {
			logServerFailure('Error creando servicio desde profesional', error);
			return fail(500, { message: 'No se pudo crear el servicio.' });
		}

		const { error: assignmentError } = await supabase.from('professional_services').upsert(
			{
				business_id: business.business.id,
				professional_id: params.professionalId,
				service_id: serviceId
			},
			{ onConflict: 'business_id,professional_id,service_id' }
		);
		if (assignmentError) {
			logServerFailure('Error asignando servicio creado', assignmentError);
			return fail(500, { message: 'El servicio se creó, pero no se pudo asignar al profesional.' });
		}

		await writeAuditLog(supabase, {
			businessId: business.business.id,
			userId,
			action: 'service.created_from_professional',
			entityType: 'service',
			entityId: serviceId,
			metadata: { professional_id: params.professionalId, name, duration_minutes: duration }
		});

		return { success: true, message: 'Servicio creado y asignado.', serviceId };
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
		const serviceId = String(form.get('service_id') ?? '').trim();
		if (!serviceId)
			return fail(400, {
				message: 'No pudimos identificar el servicio. Cerrá el editor y volvé a abrirlo.'
			});

		const { data: currentService, error: serviceError } = await supabase
			.from('services')
			.select('id, name, updated_at')
			.eq('business_id', business.business.id)
			.eq('id', serviceId)
			.maybeSingle();
		if (serviceError || !currentService) {
			logServerFailure('Error buscando servicio para editar', serviceError);
			return fail(404, {
				message: 'Ese servicio ya no está disponible. Cerrá el editor y recargá la página.'
			});
		}

		const expectedVersion = String(form.get('service_updated_at') ?? currentService.updated_at);
		if (expectedVersion !== currentService.updated_at)
			return fail(409, {
				message: 'El servicio cambió. Cerrá el editor y recargá antes de guardar.'
			});
		const instructions = String(form.get('patient_instructions') ?? '').trim();
		const reminderDescription = String(form.get('public_reminder_description') ?? '').trim();
		if (instructions.length > 2000 || reminderDescription.length > 180)
			return fail(400, {
				message: 'Acortá las indicaciones o el texto del aviso antes de guardar.'
			});
		const isDefault = isDefaultServiceName(String(currentService.name ?? ''));
		const name = isDefault ? String(currentService.name) : String(form.get('name') ?? '').trim();
		const duration = parsePositiveInt(form.get('duration_minutes'));
		const bufferBefore = parsePositiveInt(form.get('buffer_before_minutes'));
		const bufferAfter = parsePositiveInt(form.get('buffer_after_minutes'));
		const priceLabel = formatPriceLabel(String(form.get('price_label') ?? ''));
		if (!name) return fail(400, { message: 'El nombre del servicio es obligatorio.' });
		if (duration < MIN_SERVICE_DURATION_MINUTES || duration > MAX_SERVICE_DURATION_MINUTES) {
			return fail(400, { message: 'La duración debe estar entre 5 y 480 minutos.' });
		}
		if (bufferBefore < 0 || bufferBefore > 480 || bufferAfter < 0 || bufferAfter > 480) {
			return fail(400, { message: 'Los márgenes deben estar entre 0 y 480 minutos.' });
		}

		const { data: updatedService, error } = await supabase
			.from('services')
			.update({
				name,
				description: String(form.get('description') ?? '').trim() || null,
				...(form.has('patient_instructions') ? { patient_instructions: instructions || null } : {}),
				...(form.has('public_reminder_description')
					? { public_reminder_description: reminderDescription || null }
					: {}),
				duration_minutes: duration,
				buffer_before_minutes: bufferBefore,
				buffer_after_minutes: bufferAfter,
				price_label: priceLabel || null,
				is_public: isDefault || form.get('is_public') === 'true',
				is_active: isDefault || form.get('is_active') === 'true',
				updated_at: new Date().toISOString()
			})
			.eq('business_id', business.business.id)
			.eq('id', serviceId)
			.eq('updated_at', expectedVersion)
			.select('id')
			.maybeSingle();
		if (!error && !updatedService)
			return fail(409, {
				message: 'El servicio cambió. Cerrá el editor y recargá antes de guardar.'
			});
		if (error || !updatedService) {
			logServerFailure('Error actualizando servicio', error);
			return fail(500, {
				message: 'No pudimos guardar el servicio. Revisá los datos e intentá nuevamente.'
			});
		}

		await writeAuditLog(supabase, {
			businessId: business.business.id,
			userId,
			action: 'service.updated_from_professional',
			entityType: 'service',
			entityId: serviceId,
			metadata: { name, duration_minutes: duration }
		});

		return { success: true, message: 'Servicio guardado.' };
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

		const { data: updatedProfessional, error } = await supabase
			.from('professionals')
			.update({ is_active: false, is_public: false, updated_at: new Date().toISOString() })
			.eq('business_id', business.business.id)
			.eq('id', params.professionalId)
			.select('id')
			.maybeSingle();
		if (error) {
			logServerFailure('Error archivando profesional', error);
			return fail(500, { message: 'No se pudo archivar el profesional.' });
		}
		if (!updatedProfessional) {
			return fail(404, { message: 'El profesional ya no está disponible. Recargá la página.' });
		}

		await writeAuditLog(supabase, {
			businessId: business.business.id,
			userId,
			action: 'professional.archived',
			entityType: 'professional',
			entityId: params.professionalId
		});

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
		const pendingAccountEmail = await getPendingProfessionalAccountEmail(
			supabase,
			business.business.id,
			params.professionalId
		);

		const { data: updatedProfessional, error } = await supabase
			.from('professionals')
			.update({
				is_active: true,
				is_public: !pendingAccountEmail,
				updated_at: new Date().toISOString()
			})
			.eq('business_id', business.business.id)
			.eq('id', params.professionalId)
			.select('id')
			.maybeSingle();
		if (error) {
			logServerFailure('Error restaurando profesional', error);
			return fail(500, { message: 'No se pudo restaurar el profesional.' });
		}
		if (!updatedProfessional) {
			return fail(404, { message: 'El profesional ya no está disponible. Recargá la página.' });
		}

		await writeAuditLog(supabase, {
			businessId: business.business.id,
			userId,
			action: 'professional.restored',
			entityType: 'professional',
			entityId: params.professionalId
		});

		redirectToProfessional(params.professionalId, 'perfil');
	},

	delete_professional: async ({ params, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });
		const { business, userId } = await getOdontoContext({ locals, fetch, cookies });
		if (!business.canManage) {
			return fail(403, {
				message: 'Solo el dueño o un administrador puede eliminar profesionales.'
			});
		}

		const admin = await createSupabaseAdminClient('odonto', fetch);
		const businessId = business.business.id;
		const profId = params.professionalId;

		// No se puede eliminar un profesional con HISTORIAL (turnos o consultas clínicas):
		// son registros de la agenda y de los pacientes que hay que conservar. Se archiva.
		const [apptResult, entryResult, followUpCount] = await Promise.all([
			admin
				.from('appointment_professionals')
				.select('id', { count: 'exact', head: true })
				.eq('business_id', businessId)
				.eq('professional_id', profId),
			admin
				.from('clinical_entries')
				.select('id', { count: 'exact', head: true })
				.eq('business_id', businessId)
				.eq('created_by_professional_id', profId),
			professionalHasFollowUps(admin, businessId, profId)
		]);
		const apptCount = apptResult.count ?? 0;
		const entryCount = entryResult.count ?? 0;
		if (apptCount > 0 || entryCount > 0 || followUpCount > 0) {
			const parts: string[] = [];
			if (apptCount > 0) parts.push(`${apptCount} turno${apptCount === 1 ? '' : 's'}`);
			if (entryCount > 0)
				parts.push(
					`${entryCount} consulta${entryCount === 1 ? '' : 's'} clínica${entryCount === 1 ? '' : 's'}`
				);
			if (followUpCount > 0)
				parts.push(`${followUpCount} seguimiento${followUpCount === 1 ? '' : 's'}`);
			return fail(400, {
				message: `No se puede eliminar a este profesional: tiene ${parts.join(' y ')} en su historial. Archivalo para conservar esos registros.`
			});
		}

		// Limpiar los dependientes que NO son historial (se pueden borrar): invitaciones,
		// vínculo de usuario, servicios, vínculos con pacientes, reglas y excepciones.
		// Chequeamos cada paso: si algo falla, mostramos el motivo real, no un genérico.
		const steps = [
			await admin
				.from('patient_profile_change_events')
				.update({ changed_by_professional_id: null })
				.eq('business_id', businessId)
				.eq('changed_by_professional_id', profId),
			await admin
				.from('business_user_invites')
				.delete()
				.eq('business_id', businessId)
				.eq('professional_id', profId),
			await admin
				.from('professional_users')
				.delete()
				.eq('business_id', businessId)
				.eq('professional_id', profId),
			await admin
				.from('professional_services')
				.delete()
				.eq('business_id', businessId)
				.eq('professional_id', profId),
			await admin
				.from('professional_patient_links')
				.delete()
				.eq('business_id', businessId)
				.eq('professional_id', profId),
			await admin
				.from('availability_rules')
				.delete()
				.eq('business_id', businessId)
				.eq('professional_id', profId),
			await admin
				.from('availability_exceptions')
				.delete()
				.eq('business_id', businessId)
				.eq('professional_id', profId)
		];
		const prepError = steps.find((step) => step.error)?.error;
		if (prepError) {
			logServerFailure('Error preparando el borrado del profesional', prepError);
			return fail(400, {
				message:
					'No se pudo eliminar el profesional en este momento. Reintentá en unos segundos o archivalo para conservar sus registros.'
			});
		}

		const { error } = await admin
			.from('professionals')
			.delete()
			.eq('business_id', businessId)
			.eq('id', profId);
		if (error) {
			logServerFailure('Error eliminando profesional', error);
			// 23503 = FK: aún tiene registros asociados → guiar a archivar (nunca exponer el código al usuario).
			const message =
				error.code === '23503'
					? 'No se puede eliminar a este profesional porque tiene registros asociados. Archivalo para conservarlos.'
					: 'No se pudo eliminar el profesional en este momento. Reintentá en unos segundos o archivalo para conservar sus registros.';
			return fail(400, { message });
		}

		await writeAuditLog(admin, {
			businessId: business.business.id,
			userId,
			action: 'professional.deleted',
			entityType: 'professional',
			entityId: params.professionalId
		});

		throw redirect(303, '/odonto/configuracion/usuarios');
	}
};
