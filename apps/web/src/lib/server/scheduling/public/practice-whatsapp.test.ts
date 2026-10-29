import { describe, expect, it } from 'vitest';
import { formatInTimeZone } from '$lib/utils/format';
import { buildPracticeWhatsAppNotice } from '$lib/server/scheduling/public/practice-whatsapp';

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
