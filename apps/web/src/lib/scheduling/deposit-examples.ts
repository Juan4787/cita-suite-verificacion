// P2: cálculo espejo del vencimiento de seña y ejemplos dinámicos para el acordeón de
// Configuración -> Señas. Usa la misma regla que private.deposit_schedule (migración #173)
// para que los ejemplos nunca contradigan la política guardada ni la que está editando el usuario.
import { formatInTimeZone } from '$lib/utils/format';

const HOUR_MS = 3_600_000;
const AUTO_CANCEL_CUTOFF_HOURS = 24;

export type DepositSchedulePreviewInput = {
	startsAt: Date;
	bookedAt: Date;
	deadlineHours: number;
	minPaymentHours: number;
	lateBookingPaymentHours: number | null;
	autoCancelEnabled: boolean;
};

export type DepositSchedulePreview = {
	dueAt: Date;
	autoCancel: boolean;
	hoursBeforeStart: number;
	hoursFromBooking: number;
};

/** Exact mirror of private.deposit_schedule for previewing rules and testing edge cases. */
export const computeDepositSchedulePreview = (
	input: DepositSchedulePreviewInput
): DepositSchedulePreview => {
	const startsMs = input.startsAt.getTime();
	const bookedMs = input.bookedAt.getTime();
	const normalDueMs = startsMs - input.deadlineHours * HOUR_MS;
	let dueMs: number;
	let scheduleAutoCancel: boolean;

	if (input.lateBookingPaymentHours === null) {
		dueMs = normalDueMs;
		scheduleAutoCancel = normalDueMs - bookedMs >= input.minPaymentHours * HOUR_MS;
	} else {
		const lateDueMs = bookedMs + input.lateBookingPaymentHours * HOUR_MS;
		dueMs = Math.min(startsMs, Math.max(normalDueMs, lateDueMs));
		scheduleAutoCancel = startsMs - dueMs >= AUTO_CANCEL_CUTOFF_HOURS * HOUR_MS;
	}

	return {
		dueAt: new Date(dueMs),
		autoCancel: input.autoCancelEnabled && scheduleAutoCancel,
		hoursBeforeStart: Math.max(0, Math.round((startsMs - dueMs) / HOUR_MS)),
		hoursFromBooking: Math.max(0, Math.round((dueMs - bookedMs) / HOUR_MS))
	};
};

export type DepositRuleExampleId = 'over_week' | 'between_3_and_7_days' | 'under_72_hours';

export type DepositRuleExample = {
	id: DepositRuleExampleId;
	title: string;
	scenario: string;
	summary: string;
	outcome: string;
	willAutoCancel: boolean;
};

const formatHoursFriendly = (hours: number): string => {
	if (hours <= 0) return 'antes de que empiece el turno';
	if (hours % 24 === 0 && hours >= 72) {
		const days = hours / 24;
		return `${days}\u00a0días (${hours}\u00a0horas) antes del turno`;
	}
	return hours === 1 ? '1\u00a0hora antes del turno' : `${hours}\u00a0horas antes del turno`;
};

const formatFromBookingFriendly = (hours: number): string =>
	hours === 1 ? '1\u00a0hora después de reservar' : `${hours}\u00a0horas después de reservar`;

// Fixed reference slot (10:00 local time on a future date) purely for illustrating relative rules.
const REFERENCE_SLOT = new Date('2026-12-20T13:00:00.000Z');

export const buildDepositRuleExamples = (policy: {
	enabled: boolean;
	autoCancelEnabled: boolean;
	deadlineHours: number;
	minPaymentHours: number;
	lateBookingPaymentHours: number | null;
	timezone?: string;
}): DepositRuleExample[] => {
	const tz = policy.timezone || 'America/Argentina/Buenos_Aires';
	const scenarios: Array<{
		id: DepositRuleExampleId;
		title: string;
		leadHours: number;
		scenario: string;
	}> = [
		{
			id: 'over_week',
			title: 'Reserva con más de una semana de anticipación',
			leadHours: 10 * 24,
			scenario: 'Por ejemplo, si reservan 10\u00a0días antes del turno:'
		},
		{
			id: 'between_3_and_7_days',
			title: 'Reserva entre 3 y 7 días antes',
			leadHours: 4 * 24,
			scenario: 'Por ejemplo, si reservan 4\u00a0días antes del turno:'
		},
		{
			id: 'under_72_hours',
			title: 'Reserva con menos de 72 horas',
			leadHours: 50,
			scenario: 'Por ejemplo, si reservan 50\u00a0horas antes del turno:'
		}
	];

	return scenarios.map(({ id, title, leadHours, scenario }) => {
		const bookedAt = new Date(REFERENCE_SLOT.getTime() - leadHours * HOUR_MS);
		const preview = computeDepositSchedulePreview({
			startsAt: REFERENCE_SLOT,
			bookedAt,
			deadlineHours: policy.deadlineHours,
			minPaymentHours: policy.minPaymentHours,
			lateBookingPaymentHours: policy.lateBookingPaymentHours,
			autoCancelEnabled: policy.autoCancelEnabled
		});

		const usesLateWindow =
			policy.lateBookingPaymentHours !== null &&
			preview.dueAt.getTime() > REFERENCE_SLOT.getTime() - policy.deadlineHours * HOUR_MS;

		let summary: string;
		if (preview.dueAt.getTime() <= bookedAt.getTime()) {
			summary = `El plazo normal (${formatHoursFriendly(policy.deadlineHours)}) ya pasó al momento de reservar: se pide transferir apenas reserve.`;
		} else if (preview.dueAt.getTime() >= REFERENCE_SLOT.getTime()) {
			summary = 'La seña vence antes de que empiece el turno.';
		} else if (usesLateWindow) {
			summary = `Tiene ${formatFromBookingFriendly(preview.hoursFromBooking)} (vence ${formatHoursFriendly(preview.hoursBeforeStart)}).`;
		} else {
			// Reference timezone kept exercised so DST/midnight changes remain consistent.
			void formatInTimeZone(preview.dueAt, tz);
			summary = `La seña vence ${formatHoursFriendly(preview.hoursBeforeStart)}.`;
		}

		let outcome: string;
		if (!policy.autoCancelEnabled) {
			outcome =
				'No se cancela solo porque la cancelación automática está apagada: si la seña vence, decide el consultorio.';
		} else if (preview.autoCancel) {
			outcome = 'Si no se registra la seña antes de ese momento, el turno se cancela automáticamente y el horario vuelve a quedar libre.';
		} else if (policy.lateBookingPaymentHours !== null) {
			outcome =
				'Se sigue pidiendo la seña, pero el turno no se cancela solo porque el vencimiento queda a menos de 24\u00a0horas de la consulta: decide el consultorio.';
		} else {
			outcome = `Se sigue pidiendo la seña, pero el turno no se cancela solo porque quedan menos de ${policy.minPaymentHours}\u00a0horas mínimas para pagar: decide el consultorio.`;
		}

		return {
			id,
			title,
			scenario,
			summary,
			outcome,
			willAutoCancel: preview.autoCancel
		};
	});
};
