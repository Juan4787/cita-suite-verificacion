// Señas de los turnos del lado del servidor (campaña de señas y avisos, etapa B). Cada
// escritura es una función de la base que decide permisos, bloqueos, transiciones y
// auditoría en una sola transacción; acá se valida la entrada, se llama y se traducen los
// errores a mensajes humanos.
import { isUuid } from '@cita-suite/shared/uuid';
import type { CitaSupabaseClient } from '$lib/types/database';
import {
	isRecord,
	readArray,
	readBoolean,
	readChoice,
	readFiniteNumber,
	readNullableText,
	readRecord,
	readText
} from '$lib/contracts/json';
import {
	DEPOSIT_STATUSES,
	classifyDeposit,
	parseAppointmentDeposit,
	parsePatientDepositCredits,
	type AppointmentDepositView,
	type DepositListSection,
	type DepositSlotTerms,
	type PatientDepositCredit
} from '$lib/scheduling/deposits';
import { managementRevision } from '../internal/management-contract';
import { APPOINTMENT_STATUSES } from '$lib/server/scheduling/public/appointments';

export const DEPOSIT_ACTIONS = ['paid', 'waived', 'pending'] as const;
export type DepositAction = (typeof DEPOSIT_ACTIONS)[number];

const DEPOSIT_ERROR_CODES = [
	'DEPOSIT_FORBIDDEN',
	'DEPOSIT_NOT_FOUND',
	'DEPOSIT_CHANGED',
	'DEPOSIT_APPOINTMENT_CLOSED',
	'DEPOSIT_NOT_PENDING',
	'DEPOSIT_REMINDER_ALREADY_OPENED',
	'DEPOSIT_ACTION_INVALID',
	'DEPOSIT_NOTE_INVALID',
	'DEPOSIT_CREDIT_UNAVAILABLE',
	'APPOINTMENT_DEPOSIT_PENDING',
	'DEPOSIT_POLICY_FORBIDDEN',
	'DEPOSIT_POLICY_CHANGED',
	'DEPOSIT_POLICY_INVALID'
] as const;
export type DepositErrorCode = (typeof DEPOSIT_ERROR_CODES)[number];

export class DepositError extends Error {
	code: DepositErrorCode | 'DEPOSIT_UNEXPECTED';
	constructor(code: DepositErrorCode | 'DEPOSIT_UNEXPECTED') {
		super(code);
		this.code = code;
		this.name = 'DepositError';
	}
}

export const getDepositErrorMessage = (code: DepositError['code']): string => {
	switch (code) {
		case 'DEPOSIT_FORBIDDEN':
			return 'No tenés permiso para registrar señas en este consultorio.';
		case 'DEPOSIT_NOT_FOUND':
			return 'No encontramos la seña de ese turno.';
		case 'DEPOSIT_CHANGED':
			return 'Otra persona actualizó esta seña mientras la mirabas. Revisá su estado actual antes de seguir.';
		case 'DEPOSIT_APPOINTMENT_CLOSED':
			return 'El turno ya está cancelado, así que no se puede registrar la seña. Si el horario sigue libre, podés volver a darlo.';
		case 'DEPOSIT_NOT_PENDING':
			return 'Esta seña ya no está pendiente: otra persona la registró o la exceptuó. Recargá la lista.';
		case 'DEPOSIT_REMINDER_ALREADY_OPENED':
			return 'Ya se abrió el WhatsApp para pedir esta seña. Si querés mandarlo otra vez, confirmalo.';
		case 'DEPOSIT_ACTION_INVALID':
			return 'Esa acción no corresponde al estado de esta seña.';
		case 'DEPOSIT_NOTE_INVALID':
			return 'La nota puede tener hasta 300 caracteres.';
		case 'DEPOSIT_CREDIT_UNAVAILABLE':
			return 'Esa seña a cuenta ya no está disponible para aplicar. Recargá la página para ver el estado actual.';
		case 'APPOINTMENT_DEPOSIT_PENDING':
			return 'Este turno tiene la seña pendiente. Para confirmarlo, usá «Confirmar seña».';
		case 'DEPOSIT_POLICY_FORBIDDEN':
			return 'Sólo la dueña o la administración pueden cambiar la configuración de señas.';
		case 'DEPOSIT_POLICY_CHANGED':
			return 'Otra persona cambió la configuración de señas. Recargá la página y revisala antes de guardar.';
		case 'DEPOSIT_POLICY_INVALID':
			return 'Revisá los datos: el monto, el porcentaje o los plazos no son válidos.';
		default:
			return 'No pudimos guardar el cambio de la seña. Recargá la página y revisá su estado antes de volver a intentar.';
	}
};

export const getDepositErrorStatus = (code: DepositError['code']): number => {
	if (code === 'DEPOSIT_FORBIDDEN' || code === 'DEPOSIT_POLICY_FORBIDDEN') return 403;
	if (code === 'DEPOSIT_NOT_FOUND') return 404;
	if (
		code === 'DEPOSIT_CHANGED' ||
		code === 'DEPOSIT_POLICY_CHANGED' ||
		code === 'DEPOSIT_APPOINTMENT_CLOSED' ||
		code === 'DEPOSIT_NOT_PENDING' ||
		code === 'DEPOSIT_REMINDER_ALREADY_OPENED' ||
		code === 'DEPOSIT_CREDIT_UNAVAILABLE'
	)
		return 409;
	if (code === 'DEPOSIT_UNEXPECTED') return 500;
	return 400;
};

const tokenPattern = (code: string) => new RegExp(`(^|[^A-Z0-9_])${code}([^A-Z0-9_]|$)`);

/** The deposit code a database error carries, or null when it is not a deposit rule. */
export const getDepositErrorCode = (error: unknown): DepositErrorCode | null => {
	const value = isRecord(error) ? error : {};
	const raw = [value.message, value.details, value.hint].filter((part) => typeof part === 'string').join(' ');
	return DEPOSIT_ERROR_CODES.find((code) => tokenPattern(code).test(raw)) ?? null;
};

const depositFailure = (error: unknown) => new DepositError(getDepositErrorCode(error) ?? 'DEPOSIT_UNEXPECTED');

export type DepositChange = { status: (typeof DEPOSIT_STATUSES)[number]; revision: number; appointmentStatus: string };

/** Received, waived or undone, in one database transaction (plan, sections 4.2 and 4.5). */
export const setAppointmentDeposit = async (
	supabase: CitaSupabaseClient,
	input: { businessId: string; appointmentId: string; action: DepositAction; expectedRevision: number; note?: string | null }
): Promise<DepositChange> => {
	if (!isUuid(input.businessId) || !isUuid(input.appointmentId)) throw new DepositError('DEPOSIT_NOT_FOUND');
	if (!(DEPOSIT_ACTIONS as readonly string[]).includes(input.action)) throw new DepositError('DEPOSIT_ACTION_INVALID');
	if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) throw new DepositError('DEPOSIT_CHANGED');
	const note = input.note?.trim() || null;
	if (note && note.length > 300) throw new DepositError('DEPOSIT_NOTE_INVALID');
	const { data, error } = await supabase
		.rpc('set_appointment_deposit', {
			p_business_id: input.businessId,
			p_appointment_id: input.appointmentId,
			p_action: input.action,
			p_expected_revision: input.expectedRevision,
			p_note: note
		})
		.single();
	if (error) throw depositFailure(error);
	const row = readRecord(data, 'depositChange');
	const revision = readFiniteNumber(row.revision, 'depositChange.revision');
	if (!Number.isSafeInteger(revision) || revision < 1) throw new DepositError('DEPOSIT_UNEXPECTED');
	return {
		status: readChoice(row.status, DEPOSIT_STATUSES, 'depositChange.status'),
		revision,
		appointmentStatus: readChoice(row.appointment_status, APPOINTMENT_STATUSES, 'depositChange.appointmentStatus')
	};
};

/**
 * Records who opened the WhatsApp asking for the deposit, right before opening it. A second opening
 * needs `reopen`: the database refuses it otherwise, under the turn's lock (plan, section 4.8).
 */
export const openDepositReminder = async (
	supabase: CitaSupabaseClient,
	input: { businessId: string; appointmentId: string; reopen: boolean }
): Promise<{ previouslyOpenedAt: string | null }> => {
	if (!isUuid(input.businessId) || !isUuid(input.appointmentId)) throw new DepositError('DEPOSIT_NOT_FOUND');
	const { data, error } = await supabase
		.rpc('open_appointment_deposit_reminder', {
			p_business_id: input.businessId,
			p_appointment_id: input.appointmentId,
			p_reopen: input.reopen
		})
		.single();
	if (error) throw depositFailure(error);
	const row = readRecord(data, 'depositReminder');
	return { previouslyOpenedAt: readNullableText(row.previously_opened_at, 'depositReminder.previouslyOpenedAt') };
};

export type PaymentNoticeCleared = {
	revision: number;
	autoCancel: boolean;
	dueAt: string;
};

/** Clears a patient's «Ya transferí» notice («No llegó el pago») and returns the turn to the normal circuit. */
export const clearAppointmentDepositPaymentNotice = async (
	supabase: CitaSupabaseClient,
	input: { businessId: string; appointmentId: string; expectedRevision: number }
): Promise<PaymentNoticeCleared> => {
	if (!isUuid(input.businessId) || !isUuid(input.appointmentId)) throw new DepositError('DEPOSIT_NOT_FOUND');
	if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) throw new DepositError('DEPOSIT_CHANGED');
	const { data, error } = await supabase.rpc('clear_appointment_deposit_payment_notice', {
		p_business_id: input.businessId,
		p_appointment_id: input.appointmentId,
		p_expected_revision: input.expectedRevision
	});
	if (error) throw depositFailure(error);
	const row = readRecord(data, 'paymentNoticeCleared');
	const revision = readFiniteNumber(row.revision, 'paymentNoticeCleared.revision');
	if (!Number.isSafeInteger(revision) || revision < 1) throw new DepositError('DEPOSIT_UNEXPECTED');
	return {
		revision,
		autoCancel: readBoolean(row.auto_cancel, 'paymentNoticeCleared.autoCancel'),
		dueAt: readText(row.due_at, 'paymentNoticeCleared.dueAt')
	};
};

export type AppliedDepositCreditResult = {
	status: (typeof DEPOSIT_STATUSES)[number];
	revision: number;
	appointmentStatus: string;
	creditId: string;
	creditAmount: number;
	depositAmount: number;
	differenceAmount: number;
	differenceNote: string | null;
};

/** Applies one available patient deposit credit to a pending appointment deposit in a single transaction. */
export const applyPatientDepositCredit = async (
	supabase: CitaSupabaseClient,
	input: { businessId: string; appointmentId: string; expectedRevision: number; creditId?: string | null }
): Promise<AppliedDepositCreditResult> => {
	if (!isUuid(input.businessId) || !isUuid(input.appointmentId)) throw new DepositError('DEPOSIT_NOT_FOUND');
	if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1) throw new DepositError('DEPOSIT_CHANGED');
	if (input.creditId != null && !isUuid(input.creditId)) throw new DepositError('DEPOSIT_CREDIT_UNAVAILABLE');
	const { data, error } = await supabase.rpc('apply_patient_deposit_credit', {
		p_business_id: input.businessId,
		p_appointment_id: input.appointmentId,
		p_expected_revision: input.expectedRevision,
		p_credit_id: input.creditId ?? null
	});
	if (error) throw depositFailure(error);
	const row = readRecord(data, 'appliedDepositCredit');
	const revision = readFiniteNumber(row.revision, 'appliedDepositCredit.revision');
	if (!Number.isSafeInteger(revision) || revision < 1) throw new DepositError('DEPOSIT_UNEXPECTED');
	return {
		status: readChoice(row.status, DEPOSIT_STATUSES, 'appliedDepositCredit.status'),
		revision,
		appointmentStatus: readChoice(row.appointment_status, APPOINTMENT_STATUSES, 'appliedDepositCredit.appointmentStatus'),
		creditId: readText(row.credit_id, 'appliedDepositCredit.creditId'),
		creditAmount: readFiniteNumber(row.credit_amount, 'appliedDepositCredit.creditAmount'),
		depositAmount: readFiniteNumber(row.deposit_amount, 'appliedDepositCredit.depositAmount'),
		differenceAmount: readFiniteNumber(row.difference_amount, 'appliedDepositCredit.differenceAmount'),
		differenceNote: readNullableText(row.difference_note, 'appliedDepositCredit.differenceNote')
	};
};

export type DepositPolicy = {
	revision: number;
	enabled: boolean;
	autoCancelEnabled: boolean;
	amountMode: 'fixed' | 'percentage';
	fixedAmount: number | null;
	percentage: number | null;
	requestDays: number;
	deadlineHours: number;
	minPaymentHours: number;
	lateBookingPaymentHours: number | null;
	expiringReminderHours: 24 | 48 | null;
	depositCreditCutoffHours: number | null;
	transferDetails: string | null;
	appliesToManual: boolean;
	excludedServiceIds: string[];
};

// What a practice that never saved a policy sees: everything off, revision 0.
export const DEFAULT_DEPOSIT_POLICY: DepositPolicy = {
	revision: 0,
	enabled: false,
	autoCancelEnabled: false,
	amountMode: 'fixed',
	fixedAmount: null,
	percentage: null,
	requestDays: 7,
	deadlineHours: 48,
	minPaymentHours: 24,
	lateBookingPaymentHours: null,
	expiringReminderHours: 24,
	depositCreditCutoffHours: null,
	transferDetails: null,
	appliesToManual: true,
	excludedServiceIds: []
};

const readNullableNumber = (value: unknown, contract: string) =>
	value === null || value === undefined ? null : readFiniteNumber(value, contract);

const readExpiringReminderHours = (value: unknown): 24 | 48 | null => {
	if (value === null) return null;
	if (value === undefined) return 24;
	const parsed = readFiniteNumber(value, 'depositPolicy.expiringReminderHours');
	if (parsed === 24 || parsed === 48) return parsed;
	throw new DepositError('DEPOSIT_UNEXPECTED');
};

export const loadDepositPolicy = async (supabase: CitaSupabaseClient, businessId: string): Promise<DepositPolicy> => {
	const [policyResult, exclusionsResult] = await Promise.all([
		supabase
			.from('deposit_policies')
			.select('enabled, auto_cancel_enabled, amount_mode, fixed_amount, percentage, request_days, deadline_hours, min_payment_hours, late_booking_payment_hours, expiring_reminder_hours, deposit_credit_cutoff_hours, transfer_details, applies_to_manual, revision')
			.eq('business_id', businessId)
			.maybeSingle(),
		supabase.from('deposit_service_exclusions').select('service_id').eq('business_id', businessId)
	]);
	if (policyResult.error) throw policyResult.error;
	if (exclusionsResult.error) throw exclusionsResult.error;
	const row = policyResult.data;
	const excludedServiceIds = readArray(exclusionsResult.data ?? [], 'depositPolicy.exclusions').map((value) =>
		readText(readRecord(value, 'depositPolicy.exclusion').service_id, 'depositPolicy.exclusion.serviceId')
	);
	if (!row) return { ...DEFAULT_DEPOSIT_POLICY, excludedServiceIds };
	return {
		revision: readFiniteNumber(row.revision, 'depositPolicy.revision'),
		enabled: readBoolean(row.enabled, 'depositPolicy.enabled'),
		autoCancelEnabled: readBoolean(row.auto_cancel_enabled, 'depositPolicy.autoCancelEnabled'),
		amountMode: readChoice(row.amount_mode, ['fixed', 'percentage'] as const, 'depositPolicy.amountMode'),
		fixedAmount: readNullableNumber(row.fixed_amount, 'depositPolicy.fixedAmount'),
		percentage: readNullableNumber(row.percentage, 'depositPolicy.percentage'),
		requestDays: readFiniteNumber(row.request_days, 'depositPolicy.requestDays'),
		deadlineHours: readFiniteNumber(row.deadline_hours, 'depositPolicy.deadlineHours'),
		minPaymentHours: readFiniteNumber(row.min_payment_hours, 'depositPolicy.minPaymentHours'),
		lateBookingPaymentHours: readNullableNumber(row.late_booking_payment_hours, 'depositPolicy.lateBookingPaymentHours'),
		expiringReminderHours: readExpiringReminderHours(row.expiring_reminder_hours),
		depositCreditCutoffHours: readNullableNumber(row.deposit_credit_cutoff_hours, 'depositPolicy.depositCreditCutoffHours'),
		transferDetails: readNullableText(row.transfer_details, 'depositPolicy.transferDetails'),
		appliesToManual: readBoolean(row.applies_to_manual, 'depositPolicy.appliesToManual'),
		excludedServiceIds
	};
};

/** Saves the whole policy at the revision the person read; returns the new revision. */
export const saveDepositPolicy = async (
	supabase: CitaSupabaseClient,
	input: { businessId: string; policy: Omit<DepositPolicy, 'revision'>; expectedRevision: number }
): Promise<number> => {
	const { policy } = input;
	const { data, error } = await supabase.rpc('save_deposit_policy', {
		p_business_id: input.businessId,
		p_settings: {
			enabled: policy.enabled,
			auto_cancel_enabled: policy.autoCancelEnabled,
			amount_mode: policy.amountMode,
			fixed_amount: policy.fixedAmount,
			percentage: policy.percentage,
			request_days: policy.requestDays,
			deadline_hours: policy.deadlineHours,
			min_payment_hours: policy.minPaymentHours,
			late_booking_payment_hours: policy.lateBookingPaymentHours ?? null,
			expiring_reminder_hours: policy.expiringReminderHours === undefined ? 24 : policy.expiringReminderHours,
			deposit_credit_cutoff_hours: policy.depositCreditCutoffHours ?? null,
			transfer_details: policy.transferDetails ?? '',
			applies_to_manual: policy.appliesToManual,
			excluded_service_ids: policy.excludedServiceIds
		},
		p_expected_revision: input.expectedRevision
	});
	if (error) throw depositFailure(error);
	const revision = readFiniteNumber(data, 'depositPolicy.savedRevision');
	if (!Number.isSafeInteger(revision) || revision < 1) throw new DepositError('DEPOSIT_UNEXPECTED');
	return revision;
};

// The database refuses longer lists; a day never has this many slots for one choice, and a longer
// one is asked in parts instead of failing.
const TERMS_SLOTS_PER_CALL = 200;

/**
 * The deposit each slot of the chosen day would ask (plan, section 4.9, adjustment 4): the rule the
 * booking applies, asked for the whole day at once because choosing a time never reloads the page.
 * A slot missing from the result asks no deposit. The keys are the slot instants as the page holds
 * them; the database writes the same instants in its own format, so they are matched by time.
 */
export const loadDepositTermsForSlots = async (
	admin: CitaSupabaseClient,
	input: { businessId: string; serviceId: string; slotStartsAt: string[]; source: 'public_booking' | 'manual'; priceQuote: unknown }
): Promise<Record<string, DepositSlotTerms>> => {
	const requested = new Map<number, string>();
	for (const startsAt of input.slotStartsAt) {
		const instant = Date.parse(startsAt);
		if (!Number.isFinite(instant)) throw new DepositError('DEPOSIT_UNEXPECTED');
		requested.set(instant, startsAt);
	}
	const slots = [...requested.values()];
	const terms: Record<string, DepositSlotTerms> = {};
	for (let index = 0; index < slots.length; index += TERMS_SLOTS_PER_CALL) {
		const part = slots.slice(index, index + TERMS_SLOTS_PER_CALL);
		const { data, error } = await admin.rpc('get_deposit_terms_for_slots', {
			p_business_id: input.businessId,
			p_service_id: input.serviceId,
			p_starts_at: part,
			p_source: input.source,
			p_price_quote: (input.priceQuote ?? null) as never
		});
		if (error) throw error;
		const rows = readArray(data, 'depositTerms');
		if (rows.length !== part.length) throw new DepositError('DEPOSIT_UNEXPECTED');
		const seen = new Set<string>();
		for (const value of rows) {
			const row = readRecord(value, 'depositTerms.slot');
			const startsAt = requested.get(Date.parse(readText(row.starts_at, 'depositTerms.startsAt')));
			if (!startsAt || !part.includes(startsAt) || seen.has(startsAt)) throw new DepositError('DEPOSIT_UNEXPECTED');
			seen.add(startsAt);
			if (readBoolean(row.required, 'depositTerms.required') === false) continue;
			const amount = readFiniteNumber(row.amount, 'depositTerms.amount');
			if (!Number.isSafeInteger(amount) || amount < 1) throw new DepositError('DEPOSIT_UNEXPECTED');
			const dueAt = readText(row.due_at, 'depositTerms.dueAt');
			if (!Number.isFinite(Date.parse(dueAt))) throw new DepositError('DEPOSIT_UNEXPECTED');
			terms[startsAt] = {
				amount,
				dueAt,
				autoCancel: readBoolean(row.auto_cancel, 'depositTerms.autoCancel')
			};
		}
	}
	return terms;
};

export type DepositListItem = {
	deposit: AppointmentDepositView;
	/** Who opened the WhatsApp asking for it, to say so in the row (plan, section 4.8). */
	reminderOpenedBy: string | null;
	section: DepositListSection;
	appointment: { id: string; startsAt: string; status: string; managementRevision: string; professionalId: string; serviceId: string };
	patient: {
		id: string;
		name: string;
		phoneE164: string | null;
		email?: string | null;
		blocked: boolean;
		archivedAt: string | null;
		availableDepositCredits?: PatientDepositCredit[];
	};
};

// One practice holds few dozen pending deposits; past this bound the page says the list is
// incomplete instead of presenting part of it as everything.
export const DEPOSIT_LIST_LIMIT = 300;

/**
 * Pending deposits of turns that have not started, and the ones cancelled in the last seven days,
 * with their section. Turns that already started are left out in the query itself: they have
 * nothing left to decide, and as months go by they would fill the bound and hide the current ones.
 */
export const loadDepositList = async (
	supabase: CitaSupabaseClient,
	businessId: string,
	now: Date = new Date(),
	page = 1
): Promise<{ items: DepositListItem[]; truncated: boolean }> => {
	if (!Number.isSafeInteger(page) || page < 1 || page > 1_000_000) throw new DepositError('DEPOSIT_UNEXPECTED');
	const since = new Date(now.getTime() - 7 * 24 * 3_600_000).toISOString();
	const query = supabase
		.from('appointment_deposits')
		.select(
			'appointment_id, status, amount, currency, request_from, due_at, auto_cancel, waived_reason, recorded_at, reminder_opened_at, reminder_opened_by, expired_at, revision, patient_payment_notice_at, applied_credit_id, applied_credit_amount, amount_difference_note, appointments!inner(id, starts_at, status, appointment_management_revision, professional_id, service_id, patients!inner(id, full_name, phone_e164, email, blocked, archived_at, patient_available_deposit_credits))'
		)
		.eq('business_id', businessId)
		.gt('appointments.starts_at', now.toISOString())
		// The instant is quoted: inside a PostgREST logic tree `.` and `:` are reserved.
		.or(`status.eq.pending,and(status.eq.expired,expired_at.gte."${since}")`)
		.order('due_at', { ascending: true })
		.order('appointment_id', { ascending: true });
	const offset = (page - 1) * DEPOSIT_LIST_LIMIT;
	const { data, error } = await (page === 1 ? query.limit(DEPOSIT_LIST_LIMIT + 1) : query.range(offset, offset + DEPOSIT_LIST_LIMIT));
	if (error) throw error;
	const rows = readArray(data ?? [], 'depositList');
	const items: DepositListItem[] = [];
	for (const value of rows.slice(0, DEPOSIT_LIST_LIMIT)) {
		const row = readRecord(value, 'depositList.row');
		const appointment = readRecord(row.appointments, 'depositList.appointment');
		const patient = readRecord(appointment.patients, 'depositList.patient');
		const deposit = parseAppointmentDeposit(row);
		if (!deposit) continue;
		const status = readText(appointment.status, 'depositList.appointment.status');
		const startsAt = readText(appointment.starts_at, 'depositList.appointment.startsAt');
		const section = classifyDeposit(deposit, { status, startsAt }, now);
		if (!section) continue;
		const availableCredits =
			patient.patient_available_deposit_credits === undefined
				? undefined
				: parsePatientDepositCredits(patient.patient_available_deposit_credits);
		items.push({
			deposit,
			reminderOpenedBy: readNullableText(row.reminder_opened_by, 'depositList.reminderOpenedBy'),
			section,
			appointment: {
				id: readText(appointment.id, 'depositList.appointment.id'),
				startsAt,
				status,
				managementRevision: managementRevision(appointment.appointment_management_revision),
				professionalId: readText(appointment.professional_id, 'depositList.appointment.professionalId'),
				serviceId: readText(appointment.service_id, 'depositList.appointment.serviceId')
			},
			patient: {
				id: readText(patient.id, 'depositList.patient.id'),
				name: readText(patient.full_name, 'depositList.patient.name'),
				phoneE164: readNullableText(patient.phone_e164, 'depositList.patient.phone'),
				email: patient.email === undefined ? undefined : readNullableText(patient.email, 'depositList.patient.email'),
				blocked: readBoolean(patient.blocked, 'depositList.patient.blocked'),
				archivedAt: readNullableText(patient.archived_at, 'depositList.patient.archivedAt'),
				...(availableCredits !== undefined ? { availableDepositCredits: availableCredits } : {})
			}
		});
	}
	return { items, truncated: rows.length > DEPOSIT_LIST_LIMIT };
};

/** Whether the practice asks for deposits: it decides the «Señas» menu entry, in one light read. */
export const loadDepositPolicyEnabled = async (supabase: CitaSupabaseClient, businessId: string): Promise<boolean> => {
	const { data, error } = await supabase.from('deposit_policies').select('enabled').eq('business_id', businessId).maybeSingle();
	if (error) throw error;
	return data ? readBoolean(data.enabled, 'depositPolicy.enabled') : false;
};

export type DepositAlerts = { toRequest: number; dueSoon: number; cancelledToday: number; paymentReported?: number };

/**
 * The agenda's alerts (plan, section 4.8 + P1), from the same list and sections as the deposits page:
 * deposits where the patient reported payment, deposits to request whose WhatsApp nobody opened yet,
 * deposits due in less than 24 hours and turns cancelled by a missing deposit in the last 24 hours.
 */
export const summarizeDepositAlerts = (items: DepositListItem[], now: Date): DepositAlerts => {
	const paymentReported = items.filter((item) => item.section === 'payment_reported').length;
	const base: DepositAlerts = {
		toRequest: items.filter((item) => item.section === 'to_request' && !item.deposit.reminder_opened_at).length,
		dueSoon: items.filter((item) => item.section === 'due_soon').length,
		cancelledToday: items.filter(
			(item) => item.section === 'cancelled' && now.getTime() - Date.parse(item.deposit.expired_at ?? '') <= 24 * 3_600_000
		).length
	};
	return paymentReported > 0 ? { ...base, paymentReported } : base;
};

export const loadDepositAutomationStatus = async (
	supabase: CitaSupabaseClient
): Promise<{ enabled: boolean; lastRunFinishedAt: string | null }> => {
	const { data, error } = await supabase.rpc('get_deposit_automation_status').single();
	if (error) throw error;
	const row = readRecord(data, 'depositAutomation');
	return {
		enabled: readBoolean(row.enabled, 'depositAutomation.enabled'),
		lastRunFinishedAt: readNullableText(row.last_run_finished_at, 'depositAutomation.lastRunFinishedAt')
	};
};
