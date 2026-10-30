import { describe, expect, it } from 'vitest';
import { formatInTimeZone } from '$lib/utils/format';
import {
	buildDepositWhatsAppNotices,
	buildExpiredDepositWhatsAppNotice,
	buildPracticeWhatsAppNotice,
	buildTurnWhatsAppNotices
} from '$lib/server/scheduling/public/practice-whatsapp';

// El consultorio está en Tokio a propósito: a las 10:00 del 20 de noviembre allá,
// en Argentina todavía son las 22:00 del 19. Si el mensaje usara la zona de la
// máquina o la de Argentina, la hora o el día saldrían distintos.
const PRACTICE_TIMEZONE = 'Asia/Tokyo';
const STARTS_AT = '2026-11-20T01:00:00.000Z';
const PHONE = '+5493421234567';

const appointment = (overrides: Record<string, unknown> = {}) => ({
	status: 'reserved' as const,
	is_past: false,
	starts_at: STARTS_AT,
	patient_name: 'Ana Pérez',
	business: { timezone: PRACTICE_TIMEZONE, whatsapp_contact_phone: PHONE },
	...overrides
});

const linksFor = (message: string) => ({
	message,
	whatsappUrl: `https://wa.me/5493421234567?text=${encodeURIComponent(message)}`,
	whatsappWebUrl: `https://web.whatsapp.com/send?phone=5493421234567&text=${encodeURIComponent(message)}`
});

describe('aviso de la persona al consultorio por WhatsApp', () => {
	it('la máquina de prueba no está en la zona del consultorio', () => {
		expect(new Date(STARTS_AT).getTimezoneOffset()).not.toBe(-540);
	});

	it('al terminar la reserva manda nombre, día y hora del consultorio, sin la prestación', () => {
		const { dateLabel } = formatInTimeZone(STARTS_AT, PRACTICE_TIMEZONE);
		expect(dateLabel).toMatch(/viernes.*20 de noviembre/);
		expect(buildPracticeWhatsAppNotice(appointment(), { created: true })).toEqual(
			linksFor(`Hola, soy Ana Pérez. Reservé un turno para el ${dateLabel} a las 10:00.`)
		);
	});

	it('si vuelve a la página más tarde, escribe por su turno sin decir que recién reservó', () => {
		const { dateLabel } = formatInTimeZone(STARTS_AT, PRACTICE_TIMEZONE);
		expect(buildPracticeWhatsAppNotice(appointment(), { created: false })).toEqual(
			linksFor(`Hola, soy Ana Pérez. Te escribo por mi turno del ${dateLabel} a las 10:00.`)
		);
	});

	it('limpia espacios del nombre y no inventa uno si falta', () => {
		const { dateLabel } = formatInTimeZone(STARTS_AT, PRACTICE_TIMEZONE);
		expect(buildPracticeWhatsAppNotice(appointment({ patient_name: '  Ana   Pérez  ' }), { created: true })?.message).toBe(
			`Hola, soy Ana Pérez. Reservé un turno para el ${dateLabel} a las 10:00.`
		);
		expect(buildPracticeWhatsAppNotice(appointment({ patient_name: null }), { created: true })?.message).toBe(
			`Hola. Reservé un turno para el ${dateLabel} a las 10:00.`
		);
		expect(buildPracticeWhatsAppNotice(appointment({ patient_name: '   ' }), { created: true })?.message).toBe(
			`Hola. Reservé un turno para el ${dateLabel} a las 10:00.`
		);
	});

	it('no ofrece el botón si el consultorio no habilitó su WhatsApp', () => {
		expect(
			buildPracticeWhatsAppNotice(
				appointment({ business: { timezone: PRACTICE_TIMEZONE, whatsapp_contact_phone: null } }),
				{ created: true }
			)
		).toBeNull();
	});

	it('no ofrece el botón para un turno cancelado o que ya pasó', () => {
		expect(buildPracticeWhatsAppNotice(appointment({ status: 'cancelled' }), { created: true })).toBeNull();
		expect(buildPracticeWhatsAppNotice(appointment({ is_past: true }), { created: false })).toBeNull();
	});

	it('lo ofrece mientras el turno sigue activo, también si pidió reprogramar', () => {
		expect(buildPracticeWhatsAppNotice(appointment({ status: 'confirmed' }), { created: false })).not.toBeNull();
		expect(
			buildPracticeWhatsAppNotice(appointment({ status: 'reschedule_requested' }), { created: false })
		).not.toBeNull();
	});
});

describe('aviso al consultorio con la seña pendiente', () => {
	const DUE_AT = '2026-11-18T01:00:00.000Z'; // 10:00 on 18 November in Tokyo
	const withDeposit = (status: string, overrides: Record<string, unknown> = {}) =>
		appointment({ deposit: { status, due_at: DUE_AT }, ...overrides });

	it('ofrece dos caminos: mandar el comprobante ya o avisar que paga antes del vencimiento', () => {
		const turn = formatInTimeZone(STARTS_AT, PRACTICE_TIMEZONE);
		const due = formatInTimeZone(DUE_AT, PRACTICE_TIMEZONE);
		expect(buildDepositWhatsAppNotices(withDeposit('pending'), { created: true })).toEqual({
			paidNow: linksFor(
				`Hola, soy Ana Pérez. Reservé un turno para el ${turn.dateLabel} a las 10:00. Te envío el comprobante de la seña.`
			),
			payLater: linksFor(
				`Hola, soy Ana Pérez. Reservé un turno para el ${turn.dateLabel} a las 10:00. Voy a transferir la seña antes del ${due.dateLabel} a las 10:00.`
			)
		});
	});

	it('si vuelve más tarde, los mismos dos caminos sin decir que recién reservó', () => {
		const notices = buildDepositWhatsAppNotices(withDeposit('pending'), { created: false });
		expect(notices?.paidNow.message).toMatch(/^Hola, soy Ana Pérez\. Te escribo por mi turno del .+ Te envío el comprobante de la seña\.$/);
		expect(notices?.payLater.message).toMatch(/^Hola, soy Ana Pérez\. Te escribo por mi turno del .+ Voy a transferir la seña antes del .+$/);
	});

	it('sólo con la seña pendiente, el WhatsApp del consultorio habilitado y el turno activo', () => {
		for (const status of ['paid', 'waived', 'expired']) {
			expect(buildDepositWhatsAppNotices(withDeposit(status), { created: true })).toBeNull();
		}
		expect(buildDepositWhatsAppNotices(appointment(), { created: true })).toBeNull();
		expect(
			buildDepositWhatsAppNotices(
				withDeposit('pending', { business: { timezone: PRACTICE_TIMEZONE, whatsapp_contact_phone: null } }),
				{ created: true }
			)
		).toBeNull();
		expect(buildDepositWhatsAppNotices(withDeposit('pending', { status: 'cancelled' }), { created: true })).toBeNull();
		expect(buildDepositWhatsAppNotices(withDeposit('pending', { is_past: true }), { created: true })).toBeNull();
	});
});

describe('aviso al consultorio con el turno cancelado por la seña', () => {
	const expired = (overrides: Record<string, unknown> = {}) =>
		appointment({ status: 'cancelled', deposit: { status: 'expired' }, ...overrides });

	it('ofrece mandar el comprobante, con el día y la hora del consultorio', () => {
		const { dateLabel } = formatInTimeZone(STARTS_AT, PRACTICE_TIMEZONE);
		expect(buildExpiredDepositWhatsAppNotice(expired())).toEqual(
			linksFor(
				`Hola, soy Ana Pérez. Mi turno del ${dateLabel} a las 10:00 se canceló por la seña, pero ya la había transferido. Te envío el comprobante.`
			)
		);
	});

	it('sólo para un turno cancelado por la seña vencida, antes de su hora y con el WhatsApp habilitado', () => {
		expect(buildExpiredDepositWhatsAppNotice(expired({ is_past: true }))).toBeNull();
		expect(buildExpiredDepositWhatsAppNotice(expired({ deposit: { status: 'pending' } }))).toBeNull();
		expect(buildExpiredDepositWhatsAppNotice(expired({ deposit: null }))).toBeNull();
		expect(buildExpiredDepositWhatsAppNotice(expired({ status: 'reserved' }))).toBeNull();
		expect(
			buildExpiredDepositWhatsAppNotice(expired({ business: { timezone: PRACTICE_TIMEZONE, whatsapp_contact_phone: null } }))
		).toBeNull();
	});

	it('el aviso general no reemplaza a éste: para un turno cancelado no hay otro botón', () => {
		expect(buildPracticeWhatsAppNotice(expired(), { created: false })).toBeNull();
		expect(buildDepositWhatsAppNotices(expired(), { created: false })).toBeNull();
	});
});

describe('qué avisos recibe la página del turno', () => {
	const DUE_AT = '2026-11-18T01:00:00.000Z';

	it('con la seña pendiente, sólo los dos caminos de la seña', () => {
		const notices = buildTurnWhatsAppNotices(appointment({ deposit: { status: 'pending', due_at: DUE_AT } }), { created: true });
		expect(notices.depositWhatsApp?.paidNow.message).toMatch(/Te envío el comprobante de la seña\.$/);
		expect(notices.practiceWhatsApp).toBeNull();
	});

	it('sin seña, o con la seña resuelta, el aviso general del turno activo', () => {
		for (const deposit of [null, { status: 'paid', due_at: DUE_AT }, { status: 'waived', due_at: DUE_AT }]) {
			const notices = buildTurnWhatsAppNotices(appointment({ deposit, status: deposit ? 'confirmed' : 'reserved' }), { created: false });
			expect(notices.depositWhatsApp).toBeNull();
			expect(notices.practiceWhatsApp?.message).toMatch(/^Hola, soy Ana Pérez\. Te escribo por mi turno del /);
		}
	});

	it('con el turno cancelado por la seña, sólo el aviso que ofrece el comprobante', () => {
		const notices = buildTurnWhatsAppNotices(
			appointment({ status: 'cancelled', deposit: { status: 'expired', due_at: DUE_AT } }),
			{ created: false }
		);
		expect(notices.depositWhatsApp).toBeNull();
		expect(notices.practiceWhatsApp?.message).toMatch(/se canceló por la seña, pero ya la había transferido\. Te envío el comprobante\.$/);
	});

	it('sin el WhatsApp del consultorio, ningún aviso', () => {
		const business = { timezone: PRACTICE_TIMEZONE, whatsapp_contact_phone: null };
		for (const overrides of [
			{ deposit: { status: 'pending', due_at: DUE_AT } },
			{ deposit: null },
			{ status: 'cancelled', deposit: { status: 'expired', due_at: DUE_AT } }
		]) {
			expect(buildTurnWhatsAppNotices(appointment({ ...overrides, business }), { created: true })).toEqual({
				depositWhatsApp: null,
				practiceWhatsApp: null
			});
		}
	});
});
