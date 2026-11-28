import { describe, expect, it } from 'vitest';
import {
	buildDepositRuleExamples,
	computeDepositSchedulePreview
} from './deposit-examples';

const TZ = 'America/Argentina/Buenos_Aires';
// Fixed reference: 2026-12-20 10:00 AR (13:00 UTC)
const STARTS_AT = new Date('2026-12-20T13:00:00.000Z');
const hoursBefore = (hours: number) => new Date(STARTS_AT.getTime() - hours * 3_600_000);
const minutesBefore = (minutes: number) => new Date(STARTS_AT.getTime() - minutes * 60_000);

describe('P2: cálculo de vencimiento y corte de 24 h para reservas tardías', () => {
	const natalia = {
		deadlineHours: 168,
		minPaymentHours: 24,
		lateBookingPaymentHours: 48,
		autoCancelEnabled: true
	};

	it('reproduce exactamente las 6 filas de la tabla del plan para Natalia (168 h / 48 h / corte 24 h)', () => {
		// 10 días antes -> 7 días antes del turno, se cancela solo
		const d10 = computeDepositSchedulePreview({ ...natalia, startsAt: STARTS_AT, bookedAt: hoursBefore(240) });
		expect(d10.dueAt.toISOString()).toBe(hoursBefore(168).toISOString());
		expect(d10.autoCancel).toBe(true);

		// 8 días antes (192 h) -> 48 h después de reservar (6 días antes = 144 h antes), se cancela solo
		const d8 = computeDepositSchedulePreview({ ...natalia, startsAt: STARTS_AT, bookedAt: hoursBefore(192) });
		expect(d8.dueAt.toISOString()).toBe(hoursBefore(144).toISOString());
		expect(d8.autoCancel).toBe(true);

		// 4 días antes (96 h) -> 48 h después de reservar (2 días antes = 48 h antes), se cancela solo
		const d4 = computeDepositSchedulePreview({ ...natalia, startsAt: STARTS_AT, bookedAt: hoursBefore(96) });
		expect(d4.dueAt.toISOString()).toBe(hoursBefore(48).toISOString());
		expect(d4.autoCancel).toBe(true);

		// Exactamente 72 h antes -> vence 24 h antes del turno, se cancela solo
		const h72 = computeDepositSchedulePreview({ ...natalia, startsAt: STARTS_AT, bookedAt: hoursBefore(72) });
		expect(h72.dueAt.toISOString()).toBe(hoursBefore(24).toISOString());
		expect(h72.autoCancel).toBe(true);

		// 71 h 59 min antes -> vence 23 h 59 min antes -> corte < 24 h -> NO se cancela solo
		const h71m59 = computeDepositSchedulePreview({
			...natalia,
			startsAt: STARTS_AT,
			bookedAt: minutesBefore(72 * 60 - 1)
		});
		expect(h71m59.dueAt.toISOString()).toBe(minutesBefore(24 * 60 - 1).toISOString());
		expect(h71m59.autoCancel).toBe(false);

		// 50 h antes -> vence 2 h antes del turno -> NO se cancela solo
		const h50 = computeDepositSchedulePreview({ ...natalia, startsAt: STARTS_AT, bookedAt: hoursBefore(50) });
		expect(h50.dueAt.toISOString()).toBe(hoursBefore(2).toISOString());
		expect(h50.autoCancel).toBe(false);

		// El mismo día (3 h antes) -> tope al comienzo del turno -> NO se cancela solo
		const sameDay = computeDepositSchedulePreview({ ...natalia, startsAt: STARTS_AT, bookedAt: hoursBefore(3) });
		expect(sameDay.dueAt.toISOString()).toBe(STARTS_AT.toISOString());
		expect(sameDay.autoCancel).toBe(false);
	});

	it('con lateBookingPaymentHours vacío mantiene exactamente el comportamiento actual', () => {
		const standard = {
			deadlineHours: 48,
			minPaymentHours: 24,
			lateBookingPaymentHours: null,
			autoCancelEnabled: true
		};
		const at80h = computeDepositSchedulePreview({ ...standard, startsAt: STARTS_AT, bookedAt: hoursBefore(80) });
		expect(at80h.dueAt.toISOString()).toBe(hoursBefore(48).toISOString());
		expect(at80h.autoCancel).toBe(true);

		const at60h = computeDepositSchedulePreview({ ...standard, startsAt: STARTS_AT, bookedAt: hoursBefore(60) });
		expect(at60h.dueAt.toISOString()).toBe(hoursBefore(48).toISOString());
		expect(at60h.autoCancel).toBe(false);
	});

	it('maneja correctamente la medianoche en la zona horaria del consultorio', () => {
		// 2026-12-20 00:00 AR = 2026-12-20T03:00:00Z
		const midnightAr = new Date('2026-12-20T03:00:00.000Z');
		const bookedAt = new Date(midnightAr.getTime() - 96 * 3_600_000); // 4 días antes -> vence 2026-12-18 00:00 AR
		const res = computeDepositSchedulePreview({ ...natalia, startsAt: midnightAr, bookedAt });
		expect(res.dueAt.toISOString()).toBe('2026-12-18T03:00:00.000Z');
		expect(res.autoCancel).toBe(true);
	});
});

describe('P2: ejemplos desplegables calculados con la configuración vigente del consultorio', () => {
	it('genera los tres ejemplos dinámicos para la configuración de Natalia', () => {
		const examples = buildDepositRuleExamples({
			enabled: true,
			autoCancelEnabled: true,
			deadlineHours: 168,
			minPaymentHours: 24,
			lateBookingPaymentHours: 48,
			timezone: TZ
		});
		expect(examples).toHaveLength(3);
		expect(examples[0]).toMatchObject({ id: 'over_week', willAutoCancel: true });
		expect(examples[0].summary).toMatch(/7\s*días|168\s*horas/i);
		expect(examples[0].outcome).toMatch(/cancela automáticamente/i);

		expect(examples[1]).toMatchObject({ id: 'between_3_and_7_days', willAutoCancel: true });
		expect(examples[1].summary).toMatch(/48\s*horas/i);
		expect(examples[1].outcome).toMatch(/cancela automáticamente/i);

		expect(examples[2]).toMatchObject({ id: 'under_72_hours', willAutoCancel: false });
		expect(examples[2].outcome).toMatch(/no se cancela solo/i);
		expect(examples[2].outcome).toMatch(/decide el consultorio/i);
	});

	it('genera ejemplos coherentes cuando el plazo de reservas tardías queda sin configurar (valor por defecto)', () => {
		const examples = buildDepositRuleExamples({
			enabled: true,
			autoCancelEnabled: true,
			deadlineHours: 48,
			minPaymentHours: 24,
			lateBookingPaymentHours: null,
			timezone: TZ
		});
		expect(examples).toHaveLength(3);
		expect(examples[0].willAutoCancel).toBe(true);
		expect(examples[0].summary).toMatch(/48\s*horas antes/i);
		expect(examples[1].willAutoCancel).toBe(true);
		expect(examples[2].willAutoCancel).toBe(false);
		expect(examples[2].outcome).toMatch(/no se cancela solo/i);
	});

	it('con cancelación automática apagada ningún ejemplo promete cancelar automáticamente', () => {
		const examples = buildDepositRuleExamples({
			enabled: true,
			autoCancelEnabled: false,
			deadlineHours: 168,
			minPaymentHours: 24,
			lateBookingPaymentHours: 48,
			timezone: TZ
		});
		for (const item of examples) {
			expect(item.willAutoCancel).toBe(false);
			expect(item.outcome).not.toMatch(/se cancela automáticamente/i);
		}
	});
});
