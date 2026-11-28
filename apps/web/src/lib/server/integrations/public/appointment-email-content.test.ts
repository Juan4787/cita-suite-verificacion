import { describe, expect, it } from 'vitest';
import { buildAppointmentEmail, headerText, parseAppointmentEmailWork, type AppointmentEmailWork } from './appointment-email-content';

const now = new Date('2026-11-10T12:00:00.000Z');
const siteUrl = 'https://app.cita-suite.com.ar';
const token = 'a'.repeat(64);
const snapshot = (over: Record<string, unknown> = {}) => ({
	id: 'appointment-1', status: 'reserved', starts_at: '2026-11-20T15:00:00.000Z', modality: 'in_person', patient_name: 'Ana María Pérez',
	service_name_snapshot: 'Tratamiento de conducto', professional_name_snapshot: 'Dra. Reservada', deposit: null, deposit_transfer_details: null,
	can_cancel: true, can_reschedule: true, new_booking_allowed: false, integration: null,
	business: { name: 'Consultorio Rojas', slug: 'rojas', timezone: 'America/Argentina/Buenos_Aires', address: 'Calle 123', address_instructions: null, maps_url: null, logo_url: null, phone: '+5493510000000', whatsapp_contact_phone: null },
	...over
});
const work = (purpose: AppointmentEmailWork['purpose'], over: Partial<AppointmentEmailWork> = {}, snap: Record<string, unknown> = {}): AppointmentEmailWork => ({
	deliveryId: 'd1', leaseToken: 'l1', purpose, recipient: 'paciente@example.test', token: purpose === 'cancellation_receipt' ? null : token, unsubscribeToken: 'b'.repeat(64),
	sender: { fromAddress: 'turnos@rojas.cita-suite.com.ar' }, preferences: { showCancel: true, showReschedule: true }, snapshot: snapshot(snap), ...over
});
const build = (input: AppointmentEmailWork) => {
	const built = buildAppointmentEmail(input, { siteUrl, now });
	if (!built.send) throw new Error(built.reason);
	return built;
};
const labels = (input: AppointmentEmailWork) => build(input).links.map((link) => link.label);

describe('buttons follow context and preferences (AC01, AC05, AC06)', () => {
	it('offers the four combinations on a current appointment', () => {
		for (const [showCancel, showReschedule, expected] of [
			[true, true, ['Ver mi turno', 'Reprogramar', 'Cancelar']], [true, false, ['Ver mi turno', 'Cancelar']],
			[false, true, ['Ver mi turno', 'Reprogramar']], [false, false, ['Ver mi turno']]
		] as const) expect(labels(work('booking_receipt', { preferences: { showCancel, showReschedule } }))).toEqual(expected);
	});
	it('never offers cancel or reschedule in a cancellation receipt, whatever the preferences say', () => {
		const built = build(work('cancellation_receipt', {}, { status: 'cancelled', can_cancel: false, can_reschedule: false }));
		expect(built.links).toEqual([]);
		expect(built.html).not.toMatch(/accion=|Reprogramar|Agregar a mi calendario/);
		expect(built.text).not.toMatch(/accion=|Reprogramar/);
	});
	it('offers a new booking only if public booking exists', () => {
		expect(labels(work('cancellation_receipt', {}, { status: 'cancelled', can_cancel: false, can_reschedule: false, new_booking_allowed: true }))).toEqual(['Reservar otro turno']);
	});
	it('does not offer what the appointment no longer allows, even with preferences on', () => {
		expect(labels(work('reminder_24h', {}, { can_cancel: false, can_reschedule: false }))).toEqual(['Ver mi turno']);
	});
	it('links to the actions of the management page', () => {
		const links = build(work('booking_receipt')).links;
		expect(links.find((link) => link.label === 'Cancelar')?.href).toBe(`${siteUrl}/gestion/${token}?accion=cancelar`);
		expect(links.find((link) => link.label === 'Reprogramar')?.href).toBe(`${siteUrl}/gestion/${token}?accion=reprogramar`);
	});
	it('says which time the message described, so an old link can warn that it changed (AC04)', () => {
		const links = build(work('booking_receipt', {}, { schedule_revision: 3 })).links;
		expect(links.find((link) => link.label === 'Ver mi turno')?.href).toBe(`${siteUrl}/gestion/${token}?desde=3`);
		expect(links.find((link) => link.label === 'Cancelar')?.href).toBe(`${siteUrl}/gestion/${token}?accion=cancelar&desde=3`);
	});
});

describe('stale work is refused by the same context the page uses', () => {
	it('does not build a reminder for a started or cancelled appointment', () => {
		expect(buildAppointmentEmail(work('reminder_24h', {}, { starts_at: '2026-11-10T11:00:00.000Z' }), { siteUrl, now })).toEqual({ send: false, reason: 'appointment_started' });
		expect(buildAppointmentEmail(work('reminder_24h', {}, { status: 'cancelled' }), { siteUrl, now })).toEqual({ send: false, reason: 'stale_event' });
	});
	it('does not build a deposit request once nothing is pending', () => {
		const deposit = { appointment_id: 'appointment-1', status: 'paid', amount: 40000, currency: 'ARS', request_from: '2026-11-10T12:00:00.000Z', due_at: '2026-11-18T15:00:00.000Z', auto_cancel: false, waived_reason: null, recorded_at: '2026-11-10T12:00:00.000Z', reminder_opened_at: null, expired_at: null, revision: 2 };
		expect(buildAppointmentEmail(work('deposit_request', {}, { deposit }), { siteUrl, now })).toEqual({ send: false, reason: 'deposit_not_pending' });
	});
});

describe('identity and privacy (UI01, UI03, UI04)', () => {
	it('carries the practice identity and never the name of the software', () => {
		const built = build(work('booking_receipt'));
		expect(built.fromName).toBe('Consultorio Rojas');
		for (const text of [built.subject, built.preheader, built.text, built.html.replaceAll(siteUrl, '').replaceAll('cita-suite', '')]) expect(text).not.toMatch(/cita suite/i);
	});
	it('shows the name in text when there is no logo, and the logo when there is one', () => {
		expect(build(work('booking_receipt')).html).not.toContain('<img');
		const business = { ...snapshot().business, logo_url: 'https://cdn.example.test/logo.png' };
		expect(build(work('booking_receipt', {}, { business })).html).toContain('alt="Consultorio Rojas"');
	});
	it('does not include the service or the professional anywhere', () => {
		const built = build(work('reminder_72h'));
		for (const text of [built.subject, built.preheader, built.text, built.html]) expect(text).not.toMatch(/conducto|Dra\. Reservada/);
	});
	it('escapes markup and removes line breaks from headers', () => {
		const business = { ...snapshot().business, name: 'Rojas <b>\r\nBcc: x@example.test' };
		const built = build(work('booking_receipt', {}, { business }));
		expect(built.html).not.toContain('<b>');
		expect(built.subject).not.toMatch(/[\r\n]/);
		expect(built.fromName).not.toMatch(/[\r\n]/);
		expect(headerText('a\n\nb')).toBe('a b');
	});
	it('does not use an insecure or relative logo', () => {
		const business = { ...snapshot().business, logo_url: 'javascript:alert(1)' };
		expect(build(work('booking_receipt', {}, { business })).html).not.toContain('javascript:');
	});
});

describe('truthful content (RM06, UI08)', () => {
	const deposit = { appointment_id: 'appointment-1', status: 'pending', amount: 40000, currency: 'ARS', request_from: '2026-11-10T12:00:00.000Z', due_at: '2026-11-18T15:00:00.000Z', auto_cancel: true, waived_reason: null, recorded_at: null, reminder_opened_at: null, expired_at: null, revision: 1 };
	it('says reserved and explains the deposit, without calling it a payment receipt', () => {
		const built = build(work('booking_receipt', {}, { deposit, deposit_transfer_details: 'Alias: prueba' }));
		expect(built.text).toContain('Se confirma cuando el consultorio registre la seña');
		expect(built.text).toContain('Alias: prueba');
		expect(built.text).toContain('no es un comprobante de pago');
		expect(built.text).toContain('se cancela automáticamente');
		expect(built.text).not.toContain('Tu turno está confirmado');
	});
	it('says confirmed only when it is', () => {
		expect(build(work('reminder_24h', {}, { status: 'confirmed' })).text).toContain('Tu turno está confirmado');
	});
	it('asks to replace a saved calendar event after a change, because a file cannot update it', () => {
		expect(build(work('reschedule_receipt')).text).toContain('borrá el evento anterior y guardá el nuevo');
		expect(build(work('reschedule_receipt')).text).toContain('Si conectaste tu cuenta Google, ese evento se actualiza solo.');
	});
	it('uses the time zone of the practice', () => {
		expect(build(work('booking_receipt')).text).toContain('12:00');
	});
	it('offers one-click removal in the headers and the body', () => {
		const built = build(work('booking_receipt'));
		expect(built.headers['List-Unsubscribe']).toBe(`<${siteUrl}/correo/baja/${'b'.repeat(64)}>`);
		expect(built.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
		expect(built.text).toContain(`/correo/baja/${'b'.repeat(64)}`);
	});
	it('says it is not answered and never asks for a reply (plan 12.35)', () => {
		for (const purpose of ['booking_receipt', 'cancellation_receipt'] as const) {
			const built = build(work(purpose, {}, purpose === 'cancellation_receipt' ? { status: 'cancelled' } : {}));
			for (const body of [built.text, built.html]) {
				expect(body).toContain('Este correo es automático y no recibe respuestas.');
				expect(body).not.toMatch(/respond[eé] este correo/i);
			}
		}
	});
	it('has a plain-text version with the same actions', () => {
		const built = build(work('booking_receipt'));
		for (const link of built.links) expect(built.text).toContain(link.href);
	});
});

describe('modality-specific instructions (D1)', () => {
	const detailPurposes = [
		'booking_receipt',
		'reschedule_receipt',
		'deposit_request',
		'reminder_72h',
		'reminder_24h'
	] as const;

	const depositPending = {
		appointment_id: 'appointment-1',
		status: 'pending',
		amount: 40000,
		currency: 'ARS',
		request_from: '2026-11-10T12:00:00.000Z',
		due_at: '2026-11-18T15:00:00.000Z',
		auto_cancel: true,
		waived_reason: null,
		recorded_at: null,
		reminder_opened_at: null,
		expired_at: null,
		revision: 1
	};

	const bothInstructionsSnapshot = (modality: 'in_person' | 'video', videoInstructions: string | null = 'Conectate al enlace de la consulta online 5 minutos antes.') => ({
		modality,
		integration: {
			is_active: true,
			public_key: 'a'.repeat(32),
			modality,
			video_instructions_snapshot: videoInstructions
		},
		business: {
			...snapshot().business,
			address: 'Presidente Roca 2906',
			address_instructions: 'Portón rojo, timbre 4B',
			maps_url: 'https://maps.app.goo.gl/ejemplo'
		}
	});

	it.each(detailPurposes)(
		'virtual %s muestra indicaciones online y nunca dirección ni indicaciones para llegar',
		(purpose) => {
			const snap = {
				...bothInstructionsSnapshot('video'),
				...(purpose === 'deposit_request' ? { deposit: depositPending } : {})
			};
			const built = build(work(purpose, {}, snap));
			for (const body of [built.text, built.html]) {
				expect(body).toContain('Modalidad: virtual');
				expect(body).toContain('Conectate al enlace de la consulta online 5 minutos antes.');
				expect(body).not.toContain('Presidente Roca 2906');
				expect(body).not.toContain('Portón rojo');
				expect(body).not.toContain('timbre 4B');
				expect(body).not.toContain('Cómo llegar');
				expect(body).not.toContain('maps.app.goo.gl');
			}
		}
	);

	it.each(detailPurposes)(
		'presencial %s muestra dirección e indicaciones para llegar y nunca indicaciones online',
		(purpose) => {
			const snap = {
				...bothInstructionsSnapshot('in_person'),
				...(purpose === 'deposit_request' ? { deposit: depositPending } : {})
			};
			const built = build(work(purpose, {}, snap));
			for (const body of [built.text, built.html]) {
				expect(body).toContain('Presidente Roca 2906');
				expect(body).toContain('Portón rojo, timbre 4B');
				expect(body).toContain('https://maps.app.goo.gl/ejemplo');
				expect(body).not.toContain('Modalidad: virtual');
				expect(body).not.toContain('Conectate al enlace de la consulta online');
			}
		}
	);

	it('turno virtual sin indicaciones online omite la línea de indicaciones aunque el consultorio tenga indicaciones físicas', () => {
		const built = build(work('booking_receipt', {}, bothInstructionsSnapshot('video', null)));
		for (const body of [built.text, built.html]) {
			expect(body).toContain('Modalidad: virtual');
			expect(body).not.toContain('Indicaciones:');
			expect(body).not.toContain('Portón rojo');
		}
	});

	it('comprobante de cancelación virtual nunca filtra dirección, mapa ni indicaciones para llegar', () => {
		const built = build(
			work('cancellation_receipt', {}, { ...bothInstructionsSnapshot('video'), status: 'cancelled', can_cancel: false, can_reschedule: false })
		);
		for (const body of [built.text, built.html]) {
			expect(body).not.toContain('Presidente Roca 2906');
			expect(body).not.toContain('Portón rojo');
			expect(body).not.toContain('Conectate al enlace');
			expect(body).not.toContain('maps.app.goo.gl');
		}
	});

	it.each(detailPurposes)(
		'P7: virtual %s vuelve clicable sólo enlaces https://, escapa HTML y aclara que el enlace vigente está en la página del turno',
		(purpose) => {
			const snap = {
				...bothInstructionsSnapshot(
					'video',
					'Ingresá por https://meet.google.com/abc-defg-hij. <script>alert(1)</script> http://inseguro.test javascript:alert(2)'
				),
				...(purpose === 'deposit_request' ? { deposit: depositPending } : {})
			};
			const built = build(work(purpose, {}, snap));
			expect(built.html).toContain('href="https://meet.google.com/abc-defg-hij"');
			expect(built.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
			expect(built.html).not.toContain('<script>');
			expect(built.html).not.toContain('href="http://inseguro.test"');
			expect(built.html).not.toContain('href="javascript:alert(2)"');
			expect(built.html).toMatch(/enlace vigente está siempre en la página de tu turno/i);
			expect(built.text).toContain('https://meet.google.com/abc-defg-hij');
			expect(built.text).toMatch(/enlace vigente está siempre en la página de tu turno/i);
		}
	);

	it('P7: virtual sin indicaciones no muestra aviso de enlace y presencial nunca muestra enlace ni aviso online', () => {
		const virtualEmpty = build(work('booking_receipt', {}, bothInstructionsSnapshot('video', '   ')));
		expect(virtualEmpty.html).not.toMatch(/enlace vigente/i);
		expect(virtualEmpty.text).not.toMatch(/enlace vigente/i);

		const inPerson = build(
			work('booking_receipt', {}, bothInstructionsSnapshot('in_person', 'https://meet.google.com/abc-defg-hij'))
		);
		expect(inPerson.html).not.toContain('meet.google.com');
		expect(inPerson.html).not.toMatch(/enlace vigente/i);
		expect(inPerson.text).not.toContain('meet.google.com');
		expect(inPerson.text).not.toMatch(/enlace vigente/i);
	});
});

describe('parseAppointmentEmailWork', () => {
	it('refuses an unknown purpose', () => {
		expect(() => parseAppointmentEmailWork({ delivery_id: 'd', lease_token: 'l', purpose: 'promotion', recipient: 'x', token: null, unsubscribe_token: 'u', sender: { from_address: 'a', reply_to: 'b' }, preferences: { show_cancel: true, show_reschedule: true }, snapshot: {} })).toThrow();
	});
});
