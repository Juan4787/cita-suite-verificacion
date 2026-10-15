import { env } from '$env/dynamic/private';
import { error as kitError, fail, redirect } from '@sveltejs/kit';
import {
	createSupabaseAdminClient,
	createSupabaseServerClient,
	getAuthUserId
} from '$lib/server/supabase';
import { resolveActiveBusiness } from '$lib/server/business';
import { writeAuditLog } from '$lib/server/audit';
import {
	loadReminderCandidates,
	type ReminderCandidate,
	type ReminderDay
} from '$lib/server/reminders';
import type { Actions, PageServerLoad } from './$types';

const parseDay = (raw: string | null): ReminderDay => (raw === 'hoy' ? 'hoy' : 'manana');

const demoCandidates = (day: ReminderDay): ReminderCandidate[] => {
	const base = new Date();
	base.setHours(15, 30, 0, 0);
	if (day === 'manana') base.setDate(base.getDate() + 1);
	const at = (hour: number) => {
		const date = new Date(base);
		date.setHours(hour, hour === 15 ? 30 : 0);
		return date.toISOString();
	};
	return [
		{
			appointment_id: 'demo-reminder-1',
			patient_id: 'demo-patient-1',
			starts_at: at(15),
			time_label: '15:30',
			status: 'reserved',
			service_name: 'Consulta',
			professional_name: 'Dra. Jazmin Lopez',
			patient_name: 'Juan Pérez',
			coverage: 'sin_calendario',
			phone_e164: '+5493510000001',
			whatsapp_url: 'https://wa.me/5493510000001?text=Demo',
			whatsapp_opened_at: null,
			whatsapp_marked_sent_at: null
		},
		{
			appointment_id: 'demo-reminder-2',
			patient_id: 'demo-patient-2',
			starts_at: at(16),
			time_label: '16:00',
			status: 'confirmed',
			service_name: 'Otro servicio',
			professional_name: 'Dr. Jorge Tamara',
			patient_name: 'María Gómez',
			coverage: 'pendiente_actualizar',
			phone_e164: null,
			whatsapp_url: null,
			whatsapp_opened_at: null,
			whatsapp_marked_sent_at: null
		}
	];
};

export const load: PageServerLoad = async ({ locals, fetch, cookies, url }) => {
	if (!locals.auth) throw redirect(303, '/login');
	const day = parseDay(url.searchParams.get('dia'));

	if (env.DEMO_MODE === 'true') {
		return {
			demo: true,
			day,
			candidates: demoCandidates(day),
			restricted: false,
			remindersUnavailable: false
		};
	}

	const supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);
	const context = await resolveActiveBusiness({
		supabase,
		accessToken: locals.auth.access_token,
		cookies,
		membershipCache: 'fresh'
	});
	if (!context) throw kitError(500, 'No se pudo resolver el negocio activo');
	if (context.role === 'professional') throw redirect(303, '/odonto/mis-turnos');
	if (context.role === 'readonly') throw redirect(303, '/odonto/agenda');

	// Negocio restricted/archived: la sección no opera (§65 del documento madre).
	const restricted = !context.access.canUseBusiness;
	let candidates: ReminderCandidate[] = [];
	let remindersUnavailable = false;
	if (!restricted) {
		try {
			const pushSubscriptionsSupabase = await createSupabaseAdminClient('odonto', fetch);
			candidates = await loadReminderCandidates(supabase, context.business, {
				day,
				pushSubscriptionsSupabase
			});
		} catch (reminderError) {
			// Sin poder comprobar la cobertura de notificaciones y calendarios, no
			// mostramos turnos: es preferible a abrir un WhatsApp duplicado.
			console.error('Error cargando cobertura de recordatorios', reminderError);
			remindersUnavailable = true;
		}
	}

	return { demo: false, day, candidates, restricted, remindersUnavailable };
};

export const actions: Actions = {
	mark_sent: async ({ request, locals, fetch, cookies }) => {
		if (!locals.auth) throw redirect(303, '/login');
		if (env.DEMO_MODE === 'true') return fail(400, { message: 'No disponible en modo demo.' });

		const supabase = await createSupabaseServerClient('odonto', locals.auth, fetch);
		const context = await resolveActiveBusiness({
			supabase,
			accessToken: locals.auth.access_token,
			cookies
		});
		if (!context?.canOperate) {
			return fail(403, { message: 'No tenés permisos para gestionar recordatorios.' });
		}

		const form = await request.formData();
		const appointmentId = String(form.get('appointment_id') ?? '').trim();
		if (!appointmentId) return fail(400, { message: 'Falta el turno.' });

		const userId = await getAuthUserId(supabase, locals.auth.access_token);
		const now = new Date().toISOString();
		const { error } = await supabase
			.from('appointments')
			.update({
				whatsapp_reminder_marked_sent_at: now,
				whatsapp_reminder_marked_sent_by: userId,
				updated_at: now
			})
			.eq('id', appointmentId)
			.eq('business_id', context.business.id);
		if (error) {
			console.error('Error marcando recordatorio como enviado', error);
			return fail(500, { message: 'No se pudo marcar el recordatorio.' });
		}

		await writeAuditLog(supabase, {
			businessId: context.business.id,
			userId,
			action: 'reminder.whatsapp_marked_sent',
			entityType: 'appointment',
			entityId: appointmentId,
			metadata: null
		});

		return { success: true };
	}
};
