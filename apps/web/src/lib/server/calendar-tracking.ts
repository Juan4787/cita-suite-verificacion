// Tracking honesto de acciones de calendario. La app registra que el paciente TOCÓ
// una opción ("acción de calendario registrada"), nunca certeza de guardado.
// La transición corre en la RPC record_calendar_action (un solo UPDATE atómico:
// dos clicks concurrentes no se pisan y el contador no pierde incrementos).

import type { SupabaseClient } from '@supabase/supabase-js';
import { writeAuditLog } from './audit';
import type { PublicAppointmentView } from './public-appointments';

export const CALENDAR_CLICK_ACTIONS = [
	'clicked_google',
	'clicked_ics',
	'downloaded_ics',
	'clicked_outlook',
	'clicked_phone_calendar'
] as const;
export type CalendarClickAction = (typeof CALENDAR_CLICK_ACTIONS)[number];

const providerByAction: Record<CalendarClickAction, string> = {
	clicked_google: 'google',
	clicked_ics: 'ics',
	downloaded_ics: 'ics',
	clicked_outlook: 'outlook',
	clicked_phone_calendar: 'phone_calendar'
};

const activeStatuses = new Set(['reserved', 'confirmed', 'reschedule_requested']);

// Solo turnos vigentes generan acciones nuevas: pasados/cancelados/cerrados no.
export const canRegisterCalendarAction = (appointment: PublicAppointmentView): boolean =>
	!appointment.is_past && activeStatuses.has(appointment.status);

export const recordCalendarAction = async (
	supabase: SupabaseClient,
	appointment: PublicAppointmentView,
	action: CalendarClickAction,
	options: { source?: string | null } = {}
) => {
	const { error } = await supabase.rpc('record_calendar_action', {
		p_appointment_id: appointment.id,
		p_action: action,
		p_provider: providerByAction[action]
	});
	if (error) throw error;

	await writeAuditLog(supabase, {
		businessId: appointment.business.id,
		userId: null,
		action: 'appointment.calendar_action',
		entityType: 'appointment',
		entityId: appointment.id,
		metadata: {
			calendar_action: action,
			calendar_provider: providerByAction[action],
			previous_status: appointment.calendar_action_status,
			...(options.source ? { source: options.source } : {})
		}
	});
};

// Marca "ofrecido" la primera vez que el paciente ve la pantalla con el CTA.
// Best-effort y solo desde not_offered: nunca pisa una acción real ya registrada.
export const markCalendarOffered = async (
	supabase: SupabaseClient,
	appointment: PublicAppointmentView,
	now = new Date()
) => {
	try {
		await supabase
			.from('appointments')
			.update({ calendar_action_status: 'offered', calendar_offered_at: now.toISOString() })
			.eq('id', appointment.id)
			.eq('business_id', appointment.business.id)
			.eq('calendar_action_status', 'not_offered');
	} catch (error) {
		console.error('Error marcando calendario ofrecido', error);
	}
};
