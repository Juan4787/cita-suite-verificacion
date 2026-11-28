// Señas de los turnos: el contrato puro que comparten el servidor y el navegador (campaña de
// señas y avisos, etapa B). La base decide estados, montos y fechas; acá sólo se valida lo que
// llega y se arman los textos. Ningún mensaje nombra la prestación: la vista previa del
// teléfono no debe mostrar datos de salud.
import { formatQuotedPrice } from '$lib/booking/pricing';
import {
	InvalidDataContractError,
	readBoolean,
	readChoice,
	readFiniteNumber,
	readRecord,
	readText
} from '$lib/contracts/json';
import { formatInTimeZone } from '$lib/utils/format';

export const DEPOSIT_STATUSES = ['pending', 'paid', 'waived', 'expired'] as const;
export type DepositStatus = (typeof DEPOSIT_STATUSES)[number];
export const DEPOSIT_WAIVED_REASONS = ['staff', 'policy_disabled'] as const;
export type DepositWaivedReason = (typeof DEPOSIT_WAIVED_REASONS)[number];

export type AppointmentDepositView = {
	appointment_id: string;
	status: DepositStatus;
	amount: number;
	currency: 'ARS';
	request_from: string;
	due_at: string;
	auto_cancel: boolean;
	waived_reason: DepositWaivedReason | null;
	recorded_at: string | null;
	reminder_opened_at: string | null;
	expired_at: string | null;
	revision: number;
	patient_payment_notice_at?: string | null;
	applied_credit_id?: string | null;
	applied_credit_amount?: number | null;
	amount_difference_note?: string | null;
};

export type PatientDepositCredit = {
	id: string;
	amount: number;
	currency: 'ARS';
	reason: 'cancelled_in_time' | 'force_majeure';
	sourceAppointmentId: string;
	createdAt: string;
};

export type CancellationDepositOutcome = {
	outcome: 'credit' | 'forfeit';
	amount: string;
	reason: 'cancelled_in_time' | 'force_majeure' | 'cancelled_late';
	cutoffHours: number | null;
};

export const DEPOSIT_STATUS_LABELS: Record<DepositStatus, string> = {
	pending: 'Seña pendiente',
	paid: 'Seña recibida',
	waived: 'Seña exceptuada',
	expired: 'Seña vencida'
};

const readInstant = (value: unknown, contract: string) => {
	const text = readText(value, contract);
	if (!Number.isFinite(Date.parse(text))) throw new InvalidDataContractError(contract);
	return text;
};
const readNullableInstant = (value: unknown, contract: string) =>
	value === null || value === undefined ? null : readInstant(value, contract);
const readPositiveInteger = (value: unknown, contract: string) => {
	const number = readFiniteNumber(value, contract);
	if (!Number.isSafeInteger(number) || number < 1) throw new InvalidDataContractError(contract);
	return number;
};

/** A deposit row as the database returns it; null when the turn asks for no deposit. */
export const parseAppointmentDeposit = (value: unknown): AppointmentDepositView | null => {
	if (value === null || value === undefined) return null;
	const row = readRecord(value, 'deposit');
	if (row.currency !== 'ARS') throw new InvalidDataContractError('deposit.currency');
	const base: AppointmentDepositView = {
		appointment_id: readText(row.appointment_id, 'deposit.appointment_id'),
		status: readChoice(row.status, DEPOSIT_STATUSES, 'deposit.status'),
		amount: readPositiveInteger(row.amount, 'deposit.amount'),
		currency: 'ARS',
		request_from: readInstant(row.request_from, 'deposit.request_from'),
		due_at: readInstant(row.due_at, 'deposit.due_at'),
		auto_cancel: readBoolean(row.auto_cancel, 'deposit.auto_cancel'),
		waived_reason:
			row.waived_reason === null || row.waived_reason === undefined
				? null
				: readChoice(row.waived_reason, DEPOSIT_WAIVED_REASONS, 'deposit.waived_reason'),
		recorded_at: readNullableInstant(row.recorded_at, 'deposit.recorded_at'),
		reminder_opened_at: readNullableInstant(row.reminder_opened_at, 'deposit.reminder_opened_at'),
		expired_at: readNullableInstant(row.expired_at, 'deposit.expired_at'),
		revision: readPositiveInteger(row.revision, 'deposit.revision')
	};
	if (row.patient_payment_notice_at !== undefined) {
		base.patient_payment_notice_at = readNullableInstant(row.patient_payment_notice_at, 'deposit.patient_payment_notice_at');
	}
	if (row.applied_credit_id !== undefined) {
		base.applied_credit_id = row.applied_credit_id === null ? null : readText(row.applied_credit_id, 'deposit.applied_credit_id');
	}
	if (row.applied_credit_amount !== undefined) {
		base.applied_credit_amount =
			row.applied_credit_amount === null ? null : readPositiveInteger(row.applied_credit_amount, 'deposit.applied_credit_amount');
	}
	if (row.amount_difference_note !== undefined) {
		base.amount_difference_note =
			row.amount_difference_note === null ? null : readText(row.amount_difference_note, 'deposit.amount_difference_note');
	}
	return base;
};

export const parsePatientDepositCredits = (value: unknown): PatientDepositCredit[] => {
	if (!Array.isArray(value)) return [];
	const credits: PatientDepositCredit[] = [];
	for (const entry of value) {
		if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
		const row = entry as Record<string, unknown>;
		try {
			const id = readText(row.id, 'depositCredit.id');
			const amount = readPositiveInteger(row.amount, 'depositCredit.amount');
			if (row.currency !== 'ARS') continue;
			const reason = readChoice(row.reason, ['cancelled_in_time', 'force_majeure'] as const, 'depositCredit.reason');
			const sourceAppointmentId = readText(row.source_appointment_id ?? row.sourceAppointmentId, 'depositCredit.source');
			const createdAt = readInstant(row.created_at ?? row.createdAt, 'depositCredit.createdAt');
			credits.push({ id, amount, currency: 'ARS', reason, sourceAppointmentId, createdAt });
		} catch {
			continue;
		}
	}
	return credits;
};

export const parseCancellationDepositOutcome = (value: unknown): CancellationDepositOutcome | null => {
	if (value === null || value === undefined) return null;
	const row = readRecord(value, 'cancellationDepositOutcome');
	const outcome = readChoice(row.outcome, ['credit', 'forfeit'] as const, 'cancellationDepositOutcome.outcome');
	const amount = readText(row.amount, 'cancellationDepositOutcome.amount');
	if (!/^[1-9]\d{0,12}$/.test(amount)) throw new InvalidDataContractError('cancellationDepositOutcome.amount');
	const reason = readChoice(
		row.reason,
		['cancelled_in_time', 'force_majeure', 'cancelled_late'] as const,
		'cancellationDepositOutcome.reason'
	);
	const rawCutoff = row.cutoff_hours;
	const cutoffHours =
		rawCutoff === null || rawCutoff === undefined
			? null
			: readPositiveInteger(rawCutoff, 'cancellationDepositOutcome.cutoffHours');
	return { outcome, amount, reason, cutoffHours };
};

export const describeCreditDifference = (
	paidAmount: number,
	targetAmount: number,
	context: 'preview' | 'credit_applied' | 'rescheduled' = 'credit_applied'
): string | null => {
	if (!Number.isSafeInteger(paidAmount) || !Number.isSafeInteger(targetAmount) || paidAmount === targetAmount) return null;
	const paidLabel = formatDepositAmount(paidAmount);
	const targetLabel = formatDepositAmount(targetAmount);
	if (targetAmount > paidAmount) {
		const diffLabel = formatDepositAmount(targetAmount - paidAmount);
		if (context === 'preview') {
			return `Si la aplicás, falta cobrar ${diffLabel} de diferencia.`;
		}
		return context === 'rescheduled'
			? `Se conserva la seña pagada de ${paidLabel}. Como el monto vigente es ${targetLabel}, falta cobrar ${diffLabel} de diferencia.`
			: `Se aplicó la seña a cuenta de ${paidLabel}. Falta cobrar ${diffLabel} de diferencia.`;
	}
	const diffLabel = formatDepositAmount(paidAmount - targetAmount);
	if (context === 'preview') {
		return `Si la aplicás, queda ${diffLabel} de saldo a favor.`;
	}
	return context === 'rescheduled'
		? `Se conserva la seña pagada de ${paidLabel}. Como el monto vigente es ${targetLabel}, queda ${diffLabel} de saldo a favor.`
		: `Se aplicó la seña a cuenta de ${paidLabel}. Queda ${diffLabel} de saldo a favor.`;
};

export const formatDepositAmount = (amount: number) => formatQuotedPrice({ amount, currency: 'ARS' });

/** What one slot of the booking page would ask (plan, section 4.9). */
export type DepositSlotTerms = { amount: number; dueAt: string; autoCancel: boolean };

/**
 * The deposit of the chosen slot as the confirmation step sees it: its terms, `none` when the slot
 * asks no deposit, or `unknown` when they could not be computed (the booking still goes on).
 */
export type BookingDepositTerms = DepositSlotTerms | 'none' | 'unknown';

/** The conditions shown in the summary, returned with the booking rather than recalculated by JS. */
export const parseBookingDepositTerms = (value: unknown): BookingDepositTerms => {
	if (value === 'none' || value === 'unknown') return value;
	const row = readRecord(value, 'bookingDepositTerms');
	const amount = readPositiveInteger(row.amount, 'bookingDepositTerms.amount');
	if (amount > 1_000_000_000_000) throw new InvalidDataContractError('bookingDepositTerms.amount');
	return {
		amount,
		dueAt: readInstant(row.dueAt, 'bookingDepositTerms.dueAt'),
		autoCancel: readBoolean(row.autoCancel, 'bookingDepositTerms.autoCancel')
	};
};

export type DepositListSection = 'payment_reported' | 'to_request' | 'due_soon' | 'manual' | 'overdue' | 'later' | 'cancelled';

/** The sections of the deposits page, in the order of the plan (section 4.8 + P1). */
export const DEPOSIT_SECTIONS: ReadonlyArray<{ id: DepositListSection; title: string; folded: boolean }> = [
	{ id: 'payment_reported', title: 'Avisó que pagó: verificar', folded: false },
	{ id: 'to_request', title: 'Para pedir', folded: false },
	{ id: 'due_soon', title: 'Vencen en menos de 24 horas', folded: false },
	{ id: 'manual', title: 'Último momento: resolver a mano', folded: false },
	{ id: 'overdue', title: 'Vencidas sin cancelar: decidir', folded: false },
	{ id: 'later', title: 'Más adelante', folded: true },
	{ id: 'cancelled', title: 'Canceladas por falta de seña, últimos 7 días', folded: false }
];

/**
 * «recién», «hace 12 min», «hace 3 h» or «hace 2 días»: how long ago something happened. A
 * non-breaking space keeps each number with its unit: at 320 px «hace 2 min.» broke between them.
 */
export const formatElapsed = (iso: string, now: Date): string => {
	const minutes = Math.max(0, Math.floor((now.getTime() - Date.parse(iso)) / 60_000));
	if (minutes < 1) return 'recién';
	if (minutes < 60) return `hace ${minutes}\u00a0min`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `hace ${hours}\u00a0h`;
	const days = Math.floor(hours / 24);
	return days === 1 ? 'hace 1\u00a0día' : `hace ${days}\u00a0días`;
};

export type DepositAutomationNotice = { tone: 'ok' | 'warning' | 'info'; text: string };

/**
 * What the deposits page says about the automatic cancellation (plan, section 4.6): when it last
 * ran, an alert after 20 minutes without a run, or why nothing is cancelled automatically. Unknown
 * status is said as such, never as a healthy run.
 */
export const describeDepositAutomation = (input: {
	practiceAutoCancel: boolean;
	status: { enabled: boolean; lastRunFinishedAt: string | null } | null;
	now: Date;
}): DepositAutomationNotice => {
	if (!input.practiceAutoCancel) {
		return {
			tone: 'info',
			text: 'La cancelación automática está apagada: ningún turno se cancela solo. Las señas vencidas quedan para decidir a mano.'
		};
	}
	if (!input.status) {
		return { tone: 'warning', text: 'No pudimos comprobar la revisión automática. Revisá a mano las señas vencidas.' };
	}
	if (!input.status.enabled) {
		return {
			tone: 'warning',
			text: 'La cancelación automática está detenida por el operador de Cita Suite: ningún turno se cancela solo hasta que vuelva a encenderse.'
		};
	}
	const finished = Date.parse(input.status.lastRunFinishedAt ?? '');
	if (!Number.isFinite(finished)) {
		return { tone: 'warning', text: 'La revisión automática todavía no corrió. Revisá a mano las señas vencidas.' };
	}
	const elapsed = formatElapsed(input.status.lastRunFinishedAt!, input.now);
	if (input.now.getTime() - finished > 20 * 60_000) {
		return { tone: 'warning', text: `La revisión automática no corre desde ${elapsed}. Revisá a mano las señas vencidas.` };
	}
	return { tone: 'ok', text: `Última revisión automática: ${elapsed}.` };
};

const HOUR_MS = 3_600_000;

/**
 * Where a deposit goes in the deposits page (plan, section 4.8), or null when nothing is left
 * to do. Overdue comes first: a due date that passed without a cancellation always needs a
 * person, whatever the reason (late booking, reschedule request, automation off or not run yet).
 * A turn that already started has nothing left to decide, whatever its deposit says.
 */
export const classifyDeposit = (
	deposit: AppointmentDepositView,
	appointment: { status: string; startsAt: string },
	now: Date
): DepositListSection | null => {
	const nowMs = now.getTime();
	if (deposit.status === 'expired') {
		const expiredAt = Date.parse(deposit.expired_at ?? '');
		return Number.isFinite(expiredAt) && nowMs - expiredAt <= 7 * 24 * HOUR_MS ? 'cancelled' : null;
	}
	if (deposit.status !== 'pending' || appointment.status === 'cancelled') return null;
	if (!(Date.parse(appointment.startsAt) > nowMs)) return null;
	if (deposit.patient_payment_notice_at) return 'payment_reported';
	const due = Date.parse(deposit.due_at);
	if (due <= nowMs) return 'overdue';
	if (!deposit.auto_cancel || appointment.status === 'reschedule_requested') return 'manual';
	if (due - nowMs < 24 * HOUR_MS) return 'due_soon';
	return Date.parse(deposit.request_from) <= nowMs ? 'to_request' : 'later';
};

export type DepositDeadlineDescription = {
	amountLabel: string;
	dueLabel: string;
	overdue: boolean;
	autoCancel: boolean;
	bookingNotice: string;
	turnPageLine: string;
	emailLine: string;
	autoCancelSentence: string | null;
};

/**
 * Single source of truth for deposit deadline formatting across every patient surface
 * (pre-booking summary, confirmation, turn page, embedded confirmation, emails and reschedule).
 * Never promises automatic cancellation when `autoCancel` is false, a payment notice was
 * already recorded, or the deadline already passed.
 */
export const describeDepositDeadline = (
	terms: { amount: number; dueAt: string; autoCancel: boolean; paymentNoticeAt?: string | null },
	timezone: string,
	now: Date
): DepositDeadlineDescription => {
	const amountLabel = formatDepositAmount(terms.amount);
	const due = formatInTimeZone(terms.dueAt, timezone);
	const overdue = Date.parse(terms.dueAt) <= now.getTime();
	const willAutoCancel = terms.autoCancel && !overdue && !terms.paymentNoticeAt;
	const autoCancelSentence = willAutoCancel
		? 'Si no se registra para esa fecha, el turno se cancela automáticamente y el horario se libera.'
		: null;
	const bookingNotice = overdue
		? `Este turno requiere una seña de ${amountLabel}. Transferila apenas reserves: el consultorio confirma el turno cuando la recibe.`
		: willAutoCancel
			? `Este turno requiere una seña de ${amountLabel}. Tenés tiempo hasta el ${due.full} para transferirla. Si no se registra, el turno se cancela automáticamente.`
			: `Este turno requiere una seña de ${amountLabel}. Tenés tiempo hasta el ${due.full} para transferirla.`;
	const turnPageLine = overdue
		? `Para confirmar tu turno, transferí la seña de ${amountLabel} cuanto antes y coordiná el pago con el consultorio.`
		: `Para confirmar tu turno, transferí la seña de ${amountLabel} antes del ${due.full}.`;
	const emailLine = `Seña: ${amountLabel}, antes del ${due.full}.`;

	return {
		amountLabel,
		dueLabel: due.full,
		overdue,
		autoCancel: willAutoCancel,
		bookingNotice,
		turnPageLine,
		emailLine,
		autoCancelSentence
	};
};

/**
 * What the booking confirmation says about the deposit before booking (plan, section 4.9). The
 * automatic cancellation is promised only when this slot has it; a due date already past asks to
 * transfer right away, since the turn is confirmed only when the practice receives it.
 */
export const buildDepositTermsNotice = (
	terms: { amount: number; dueAt: string; autoCancel: boolean },
	timezone: string,
	now: Date
): string => describeDepositDeadline(terms, timezone, now).bookingNotice;

/** When the server could not compute the terms: the booking goes on and the turn's page shows them. */
export const DEPOSIT_TERMS_UNAVAILABLE_NOTICE =
	'No pudimos calcular si este turno requiere una seña. Si corresponde, la vas a ver al terminar la reserva.';

/** Asks for the deposit (plan, section 4.8): the practice sends it from the deposits list. */
export const buildDepositRequestMessage = (input: {
	patientName: string;
	businessName: string;
	startsAt: string;
	dueAt: string;
	timezone: string;
	amount: number;
	transferDetails: string | null;
	autoCancel: boolean;
	publicUrl: string;
}, now: Date): string => {
	const turn = formatInTimeZone(input.startsAt, input.timezone);
	const due = formatInTimeZone(input.dueAt, input.timezone);
	const overdue = Date.parse(input.dueAt) <= now.getTime();
	const lines = [
		`Hola ${input.patientName}. Te escribimos de ${input.businessName} por tu turno del ${turn.dateLabel} a las ${turn.timeLabel}.`,
		overdue
   ? `El plazo habitual de la seña ya pasó. Para confirmarlo necesitamos la seña de ${formatDepositAmount(input.amount)}; coordiná el pago con el consultorio.`
   : `Para confirmarlo necesitamos la seña de ${formatDepositAmount(input.amount)} antes del ${due.dateLabel} a las ${due.timeLabel}.`
	];
	const transfer = input.transferDetails?.trim();
	if (transfer) lines.push(`Datos para transferir: ${transfer}`);
	// Only a person told about the automatic cancellation is cancelled automatically.
	if (input.autoCancel && !overdue) lines.push('Si no la recibimos para esa fecha, el turno se libera automáticamente.');
	lines.push(
		'Si ya la transferiste, desestimá este mensaje (si podés, mandanos el comprobante por acá).',
		`Ver tu turno: ${input.publicUrl}`
	);
	return lines.join('\n');
};

/** Tells the person why the turn was cancelled and how to solve it (plan, section 4.8). */
export const buildDepositCancellationMessage = (input: {
	patientName: string;
	businessName: string;
	startsAt: string;
	dueAt: string;
	timezone: string;
	bookingUrl: string | null;
}): string => {
	const turn = formatInTimeZone(input.startsAt, input.timezone);
	const due = formatInTimeZone(input.dueAt, input.timezone);
	const lines = [
		`Hola ${input.patientName}. Tu turno del ${turn.dateLabel} a las ${turn.timeLabel} en ${input.businessName} se canceló porque no registramos la seña antes del ${due.dateLabel} a las ${due.timeLabel}.`,
		'Si ya la transferiste, respondé este mensaje con el comprobante y lo resolvemos.'
	];
	if (input.bookingUrl) lines.push(`Si querés otro turno, podés reservarlo acá: ${input.bookingUrl}`);
	return lines.join('\n');
};
