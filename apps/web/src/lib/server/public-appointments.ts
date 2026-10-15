import type { SupabaseClient } from '@supabase/supabase-js';
import { bookingContextsAvailable } from './booking-integration-flags';
import { loadAppointmentBookingContext, type AppointmentBookingContext } from './booking-integrations';
import { isActiveAppointmentStatus } from '$lib/utils/appointment-visibility';
import { writeAuditLog } from './audit';
import { resolveMapsUrl } from './location';
import {
	APPOINTMENT_STATUS_LABELS,
	type AppointmentStatus,
	addMinutes,
	isAppointmentStatus
} from './appointments';
import {
	PUBLIC_BUSINESS_SELECT,
	canUsePublicBusiness,
	publicHash,
	recordPublicBookingAttempt
} from './public-booking';
import { sanitizePublicImageUrl } from './public-image';

export type PublicAppointmentAction = 'confirm' | 'cancel' | 'reschedule';

type PublicAppointmentDatabaseRow = {
	id: string; status: string; starts_at: string; ends_at: string; confirmation_token: string;
	service_name_snapshot: string; professional_name_snapshot: string;
	calendar_action_status?: string; calendar_action_at?: string | null;
	calendar_action_count?: number; calendar_sequence?: number; calendar_update_required_at?: string | null;
	businesses: Record<string, any>; patients?: { full_name?: string | null };
	appointment_professionals?: unknown[];
};

export type PublicAppointmentView = {
	booking_context?: AppointmentBookingContext | null;
 price_quote_snapshot?:import('$lib/booking/pricing').PriceQuote|null;patient_instructions_snapshot?:string|null;public_reminder_description_snapshot?:string|null;
	id: string;
	token: string;
	status: AppointmentStatus;
	starts_at: string;
	ends_at: string;
	service_name_snapshot: string;
	professional_name_snapshot: string;
	professional_count: number;
	is_joint: boolean;
	calendar_action_status: string;
	calendar_action_at: string | null;
	calendar_action_count: number;
	calendar_sequence: number;
	calendar_update_required_at: string | null;
	business: {
		id: string;
		name: string;
		slug: string;
		phone: string | null;
		address: string | null;
		address_instructions: string | null;
		maps_link: string | null;
		logo_url: string | null;
		timezone: string;
		is_active: boolean;
		cancellation_policy: string | null;
	};
	patient_name: string | null;
	public_status_label: string;
	public_actions_available: boolean;
	can_confirm: boolean;
	can_cancel: boolean;
	can_request_reschedule: boolean;
	is_past: boolean;
};

// Turno de muestra para DEMO_MODE: misma forma que la vista real para que páginas
// y endpoints públicos funcionen sin Supabase.
export const demoPublicAppointment = (token: string): PublicAppointmentView => ({
	id: 'demo-appointment',
	token,
	status: 'reserved',
	starts_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
	ends_at: new Date(Date.now() + 24 * 60 * 60 * 1000 + 30 * 60 * 1000).toISOString(),
	service_name_snapshot: 'Consulta',
	professional_name_snapshot: 'Dra. Pérez',
	professional_count: 1,
	is_joint: false,
	calendar_action_status: 'not_offered',
	calendar_action_at: null,
	calendar_action_count: 0,
	calendar_sequence: 0,
	calendar_update_required_at: null,
	business: {
		id: 'demo-business',
		name: 'Consultorio demo',
		slug: 'consultorio-demo',
		phone: '351 555 0101',
		address: 'Av. Demo 123',
		address_instructions: 'Timbre 2B. Presentarse 10 minutos antes.',
		maps_link: 'https://www.google.com/maps/search/?api=1&query=Av.%20Demo%20123',
		logo_url: null,
		timezone: 'America/Argentina/Cordoba',
		is_active: true,
		cancellation_policy: null
	},
	patient_name: 'Paciente demo',
	public_status_label: 'Reservado',
	public_actions_available: true,
	can_confirm: true,
	can_cancel: true,
	can_request_reschedule: true,
	is_past: false
});

const appointmentSelect = `
	id,
	confirmation_token,
	status,
	starts_at,
	ends_at,
	service_name_snapshot,
    price_quote_snapshot,patient_instructions_snapshot,public_reminder_description_snapshot,
	professional_name_snapshot,
	calendar_action_status,
	calendar_action_at,
	calendar_action_count,
	calendar_sequence,
	calendar_update_required_at,
	businesses!inner(${PUBLIC_BUSINESS_SELECT}),
	patients(full_name),
	appointment_professionals(professional_id)
`;

const publicActionAttempt: Record<
	PublicAppointmentAction,
	'token_confirm' | 'token_cancel' | 'token_reschedule'
> = {
	confirm: 'token_confirm',
	cancel: 'token_cancel',
	reschedule: 'token_reschedule'
};

export const loadPublicAppointmentByToken = async (
	supabase: SupabaseClient,
	token: string,
	now = new Date(),
	expectedIntegrationId?: string
): Promise<PublicAppointmentView | null> => {
	let query = supabase
		.from('appointments')
		.select(appointmentSelect + (expectedIntegrationId ? ', appointment_booking_contexts!inner(integration_id)' : ''))
		.eq('confirmation_token', token);
	if (expectedIntegrationId) query = query.eq('appointment_booking_contexts.integration_id', expectedIntegrationId);
	const { data, error } = await query.maybeSingle<PublicAppointmentDatabaseRow>();
	if (error) throw error;
	if (!data) return null;
	const bookingContext = bookingContextsAvailable()
		? await loadAppointmentBookingContext(supabase, String(data.id)) : null;

	const status = String(data.status);
	if (!isAppointmentStatus(status)) return null;
	const business = (data as any).businesses;
	const startsAt = new Date(data.starts_at);
	const isPast = startsAt <= now;
	const isBusinessActive = Boolean(business?.is_active);
	const canUsePublicTokens = isBusinessActive
		? await canUsePublicBusiness(supabase, String(business.id), business.created_at ?? null)
		: false;
	const canAct = isBusinessActive && canUsePublicTokens && !isPast;
	const professionalCount = Math.max(
		1,
		Array.isArray((data as any).appointment_professionals)
			? (data as any).appointment_professionals.length
			: 0
	);

	return {
        price_quote_snapshot:(data as any).price_quote_snapshot??null,patient_instructions_snapshot:(data as any).patient_instructions_snapshot??null,public_reminder_description_snapshot:(data as any).public_reminder_description_snapshot??null,
		booking_context: bookingContext,
		id: String(data.id),
		token: String(data.confirmation_token),
		status,
		starts_at: String(data.starts_at),
		ends_at: String(data.ends_at),
		service_name_snapshot: String(data.service_name_snapshot),
		professional_name_snapshot: String(data.professional_name_snapshot),
		professional_count: professionalCount,
		is_joint: professionalCount > 1,
		calendar_action_status: String(data.calendar_action_status ?? 'not_offered'),
		calendar_action_at: data.calendar_action_at ?? null,
		calendar_action_count: Number(data.calendar_action_count ?? 0),
		calendar_sequence: Number(data.calendar_sequence ?? 0),
		calendar_update_required_at: data.calendar_update_required_at ?? null,
		business: {
			id: String(business.id),
			name: String(business.name),
			slug: String(business.slug),
			phone: business.phone ?? null,
			address: bookingContext?.modality === 'video' ? null : business.address ?? null,
			address_instructions: bookingContext?.modality === 'video' ? bookingContext.videoInstructions : business.address_instructions ?? null,
			maps_link: bookingContext?.modality === 'video' ? null : resolveMapsUrl({
				address: business.address ?? null,
				maps_url: business.maps_url ?? null
			}),
			logo_url: sanitizePublicImageUrl(business.logo_url),
			timezone: String(business.timezone),
			is_active: Boolean(business.is_active),
			cancellation_policy: business.cancellation_policy ?? null
		},
		patient_name: (data as any).patients?.full_name ?? null,
		public_status_label: APPOINTMENT_STATUS_LABELS[status],
		public_actions_available: canUsePublicTokens,
		can_confirm: canAct && status === 'reserved',
		can_cancel: canAct && (status === 'reserved' || status === 'confirmed' || status === 'reschedule_requested'),
		can_request_reschedule: canAct && (status === 'reserved' || status === 'confirmed'),
		is_past: isPast
	};
};

export const getPublicAppointmentMessage = (appointment: PublicAppointmentView | null) => {
	if (!appointment) return 'El enlace no es válido o ya no está disponible.';
	if (!appointment.business.is_active) return 'Este turno no admite cambios online en este momento.';
	if (!appointment.public_actions_available) {
		return 'Este enlace no está disponible en este momento. Contactá al consultorio.';
	}
	if (appointment.is_past) return 'Este turno ya no admite cambios online.';
	if (appointment.status === 'cancelled') return 'Este turno ya fue cancelado.';
	if (appointment.status === 'confirmed') return 'Tu turno está confirmado.';
	if (appointment.status === 'reschedule_requested') {
		return 'Recibimos tu pedido de reprogramación. El consultorio lo gestionará.';
	}
	return 'Tu turno está reservado.';
};

const assertCanApplyPublicAction = (
	appointment: PublicAppointmentView,
	action: PublicAppointmentAction
) => {
	if (!appointment.business.is_active) throw new Error('PUBLIC_TOKEN_BUSINESS_DISABLED');
	if (!appointment.public_actions_available) throw new Error('PUBLIC_TOKEN_COMMERCIAL_UNAVAILABLE');
	if (appointment.is_past) throw new Error('PUBLIC_TOKEN_APPOINTMENT_PAST');
	if (!isActiveAppointmentStatus(appointment.status)) {
		throw new Error('PUBLIC_TOKEN_APPOINTMENT_CLOSED');
	}
	if (action === 'confirm' && appointment.status === 'confirmed') return;
	if (action === 'confirm' && appointment.status !== 'reserved') throw new Error('PUBLIC_TOKEN_CONFIRM_DENIED');
	if (action === 'cancel' && !appointment.can_cancel) throw new Error('PUBLIC_TOKEN_CANCEL_DENIED');
	if (action === 'reschedule' && !appointment.can_request_reschedule) {
		throw new Error('PUBLIC_TOKEN_RESCHEDULE_DENIED');
	}
};

export const applyPublicAppointmentAction = async (
	supabase: SupabaseClient,
	input: {
		token: string;
		action: PublicAppointmentAction;
		note?: string | null;
		ip?: string | null;
		userAgent?: string | null;
		now?: Date;
	}
) => {
	const now = input.now ?? new Date();
	let appointment: PublicAppointmentView | null = null;
	const attemptAction = publicActionAttempt[input.action];

	try {
		appointment = await loadPublicAppointmentByToken(supabase, input.token, now);
		if (!appointment) throw new Error('PUBLIC_TOKEN_NOT_FOUND');
		assertCanApplyPublicAction(appointment, input.action);

		if (input.action === 'confirm' && appointment.status === 'confirmed') {
			await recordPublicBookingAttempt(supabase, {
				businessId: appointment.business.id,
				ipHash: publicHash(input.ip),
				action: attemptAction,
				success: true,
				userAgent: input.userAgent,
				metadata: { appointment_id: appointment.id, action: input.action, changed: false }
			});
			return { appointment, changed: false };
		}

		const updates: Record<string, unknown> = {
			updated_at: now.toISOString(),
			updated_by_user_id: null
		};
		const metadata: Record<string, unknown> = {
			source: 'public_token',
			from_status: appointment.status,
			note: input.note?.trim() || null
		};
		let auditAction = '';

		if (input.action === 'confirm') {
			updates.status = 'confirmed';
			updates.confirmed_at = now.toISOString();
			auditAction = 'appointment.public_confirmed';
			metadata.to_status = 'confirmed';
		} else if (input.action === 'cancel') {
			updates.status = 'cancelled';
			updates.cancelled_at = now.toISOString();
			updates.cancelled_by_user_id = null;
			updates.cancelled_reason = input.note?.trim() || 'Cancelado por paciente desde link público';
			auditAction = 'appointment.public_cancelled';
			metadata.to_status = 'cancelled';
			metadata.reason = updates.cancelled_reason;
		} else {
			updates.status = 'reschedule_requested';
			updates.reschedule_requested_at = now.toISOString();
			auditAction = 'appointment.public_reschedule_requested';
			metadata.to_status = 'reschedule_requested';
		}

		const { data: changedAppointment, error } = await supabase
			.from('appointments')
			.update(updates)
			.eq('id', appointment.id)
			.eq('business_id', appointment.business.id)
			// Serialize competing public actions at the row's observed state. Without
			// this predicate, confirm/cancel/reschedule requests could all read the
			// same status and report success even though only the last write survived.
			.eq('status', appointment.status)
			.select('id')
			.maybeSingle();
		if (error) throw error;
		if (!changedAppointment) throw new Error('PUBLIC_TOKEN_ACTION_CONFLICT');

		await writeAuditLog(supabase, {
			businessId: appointment.business.id,
			userId: null,
			action: auditAction,
			entityType: 'appointment',
			entityId: appointment.id,
			metadata
		});

		await recordPublicBookingAttempt(supabase, {
			businessId: appointment.business.id,
			ipHash: publicHash(input.ip),
			action: attemptAction,
			success: true,
			userAgent: input.userAgent,
			metadata: { appointment_id: appointment.id, action: input.action }
		});

		const updated = await loadPublicAppointmentByToken(supabase, input.token, addMinutes(now, 0));
		return { appointment: updated ?? appointment, changed: true };
	} catch (error) {
		await recordPublicBookingAttempt(supabase, {
			businessId: appointment?.business.id ?? null,
			ipHash: publicHash(input.ip),
			action: attemptAction,
			success: false,
			errorCode: (error as Error)?.message ?? 'UNKNOWN',
			userAgent: input.userAgent,
			metadata: { appointment_id: appointment?.id ?? null, action: input.action }
		});
		throw error;
	}
};

export const getPublicTokenErrorMessage = (error: unknown) => {
	const raw = `${(error as { message?: string; details?: string })?.message ?? ''} ${(error as { details?: string })?.details ?? ''}`;
	if (raw.includes('PUBLIC_TOKEN_NOT_FOUND')) return 'El enlace no es válido o ya no está disponible.';
	if (raw.includes('PUBLIC_TOKEN_BUSINESS_DISABLED')) return 'Este turno no admite cambios online en este momento.';
	if (raw.includes('PUBLIC_TOKEN_COMMERCIAL_UNAVAILABLE')) {
		return 'Este enlace no está disponible en este momento. Contactá al consultorio.';
	}
	if (raw.includes('PUBLIC_TOKEN_APPOINTMENT_PAST')) return 'Este turno ya no admite cambios online.';
	if (raw.includes('PUBLIC_TOKEN_APPOINTMENT_CLOSED')) return 'Este turno ya está cerrado.';
	if (raw.includes('PUBLIC_TOKEN_CONFIRM_DENIED')) return 'Este turno no se puede confirmar desde este enlace.';
	if (raw.includes('PUBLIC_TOKEN_CANCEL_DENIED')) return 'Este turno no se puede cancelar desde este enlace.';
	if (raw.includes('PUBLIC_TOKEN_RESCHEDULE_DENIED')) {
		return 'Este turno no puede pedir reprogramación desde este enlace.';
	}
	if (raw.includes('PUBLIC_TOKEN_ACTION_CONFLICT')) {
		return 'Este turno cambió mientras lo actualizábamos. Volvé a abrir el enlace y revisá su estado.';
	}
	return 'No pudimos actualizar este turno desde el enlace. Volvé a abrirlo y revisá su estado antes de intentar de nuevo.';
};
