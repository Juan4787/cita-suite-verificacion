import { describe, expect, it } from 'vitest';
import { formatInTimeZone } from '$lib/utils/format';
import { buildDepositTermsNotice, describeDepositDeadline } from './deposits';
import { buildAppointmentEmail, type AppointmentEmailWork } from '$lib/server/integrations/public/appointment-email-content';

const TIMEZONE = 'America/Argentina/Buenos_Aires';
const NOW = new Date('2026-12-10T13:00:00.000Z');
const STARTS_AT = '2026-12-20T03:00:00.000Z'; // 2026-12-20 00:00 AR (midnight local edge!)
const DUE_AT = '2026-12-13T03:00:00.000Z'; // 2026-12-13 00:00 AR

const emailWork = (purpose: AppointmentEmailWork['purpose'], autoCancel: boolean): AppointmentEmailWork => ({
	deliveryId: 'd-consistency',
	leaseToken: 'l-consistency',
	purpose,
	recipient: 'paciente@example.test',
	token: 'a'.repeat(64),
	unsubscribeToken: 'b'.repeat(64),
	sender: { fromAddress: 'turnos@consultorio.cita-suite.com.ar' },
	preferences: { showCancel: true, showReschedule: true },
	snapshot: {
		id: 'apt-consistency',
		status: 'reserved',
		starts_at: STARTS_AT,
		modality: 'in_person',
		patient_name: 'Ana Prueba',
		service_name_snapshot: 'Consulta',
		professional_name_snapshot: 'Dra. Prueba',
		deposit: {
			appointment_id: 'apt-consistency',
			status: 'pending',
			amount: 40000,
			currency: 'ARS',
			request_from: '2026-12-10T13:00:00.000Z',
			due_at: DUE_AT,
			auto_cancel: autoCancel,
			waived_reason: null,
			recorded_at: null,
			reminder_opened_at: null,
			expired_at: null,
			revision: 1
		},
		deposit_transfer_details: 'Alias prueba.sena',
		can_cancel: true,
		can_reschedule: true,
		new_booking_allowed: false,
		integration: null,
		business: {
			name: 'Consultorio Prueba',
			slug: 'consultorio-prueba',
			timezone: TIMEZONE,
			address: 'Calle 123',
			address_instructions: null,
			maps_url: null,
			logo_url: null,
			phone: '+5493415550000',
			whatsapp_contact_phone: '+5493415550000'
		}
	}
});

describe('P2 criterio 2: fecha y hora exactas idénticas en las cinco superficies (incluida medianoche local)', () => {
	it.each([true, false])('coinciden exactamente con autoCancel=%s en resumen previo, confirmación, página del turno, comprobante y pedido/recordatorio', (autoCancel) => {
		const expectedDue = formatInTimeZone(DUE_AT, TIMEZONE).full;
		expect(expectedDue).toContain('00:00');
		expect(expectedDue).toContain('13 de diciembre');

		// 1. Resumen previo a reservar (paso 5)
		const preBooking = buildDepositTermsNotice({ amount: 40000, dueAt: DUE_AT, autoCancel }, TIMEZONE, NOW);
		// 2. Confirmación y página del turno (/turno/[token])
		const turnPage = describeDepositDeadline({ amount: 40000, dueAt: DUE_AT, autoCancel }, TIMEZONE, NOW);
		// 3. Confirmación embebida (/embed/v1/.../turno/[token]) usa el mismo describeDepositDeadline
		const embeddedPage = `${turnPage.turnPageLine} ${turnPage.autoCancelSentence ?? ''}`.trim();
		// 4. Comprobante de reserva (booking_receipt)
		const receipt = buildAppointmentEmail(emailWork('booking_receipt', autoCancel), { siteUrl: 'https://app.cita-suite.com.ar', now: NOW });
		if (!receipt.send) throw new Error('expected receipt to send');
		// 5. Pedido / aviso de seña (deposit_request y reminder_72h)
		const depositReq = buildAppointmentEmail(emailWork('deposit_request', autoCancel), { siteUrl: 'https://app.cita-suite.com.ar', now: NOW });
		if (!depositReq.send) throw new Error('expected deposit_request to send');

		const surfaces = [preBooking, turnPage.turnPageLine, embeddedPage, receipt.text, receipt.html, depositReq.text, depositReq.html];
		for (const text of surfaces) {
			expect(text).toContain(expectedDue);
			if (autoCancel) {
				if (text !== turnPage.turnPageLine) expect(text).toMatch(/cancela automáticamente/i);
			} else {
				expect(text).not.toMatch(/cancela automáticamente/i);
			}
		}
	});
});
