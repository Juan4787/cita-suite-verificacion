import { describe, expect, it, vi } from 'vitest';
import {
	DEPOSIT_SECTIONS,
	classifyDeposit,
	describeDepositDeadline,
	parseAppointmentDeposit,
	type AppointmentDepositView
} from '$lib/scheduling/deposits';
import { bookingReschedulePolicyNotice } from '$lib/scheduling/email-policy';
import {
	APPOINTMENT_EMAIL_PURPOSES,
	resolveAppointmentEmailContext
} from '$lib/scheduling/patient-action-context';
import { buildAppointmentEmail, type AppointmentEmailWork } from '$lib/server/integrations/public/appointment-email-content';
import { parsePolicyForm } from '$lib/server/scheduling/public/deposit-policy-form';
import {
	DEFAULT_DEPOSIT_POLICY,
	saveDepositPolicy,
	summarizeDepositAlerts,
	type DepositListItem
} from '$lib/server/scheduling/public/deposits';
import { EMAIL_PURPOSES } from '$lib/server/scheduling/public/email-status';
import { RATE_LIMIT_ACTIONS } from '$lib/server/platform/rate-limits';
import { getHumanAppointmentErrorMessage } from '$lib/server/scheduling/public/appointments';

const BUSINESS = '00000000-0000-4000-8000-0000000000b1';
const APPOINTMENT = '00000000-0000-4000-8000-0000000000a1';
const SERVICE = '00000000-0000-4000-8000-0000000000d1';
const TZ = 'America/Argentina/Buenos_Aires';

const baseDeposit = (overrides: Partial<AppointmentDepositView> = {}): AppointmentDepositView => ({
	appointment_id: APPOINTMENT,
	status: 'pending',
	amount: 40000,
	currency: 'ARS',
	request_from: '2026-11-10T03:00:00.000Z',
	due_at: '2026-11-18T13:00:00.000Z',
	auto_cancel: true,
	waived_reason: null,
	recorded_at: null,
	reminder_opened_at: null,
	expired_at: null,
	revision: 1,
	...overrides
});

const emailWork = (overrides: Partial<AppointmentEmailWork> = {}): AppointmentEmailWork => ({
	deliveryId: '00000000-0000-4000-8000-0000000000e1',
	leaseToken: '00000000-0000-4000-8000-0000000000e2',
	purpose: 'deposit_expiring_reminder' as AppointmentEmailWork['purpose'],
	recipient: 'paciente@ejemplo.test',
	token: 'a'.repeat(64),
	unsubscribeToken: 'b'.repeat(64),
	sender: { fromAddress: 'turnos@consultorio.cita-suite.com.ar' },
	preferences: { showCancel: true, showReschedule: true },
	snapshot: {
		id: APPOINTMENT,
		status: 'reserved',
		starts_at: '2026-11-25T13:00:00.000Z',
		ends_at: '2026-11-25T13:30:00.000Z',
		schedule_revision: 2,
		patient_name: 'Lucía Fernández',
		modality: 'in_person',
		integration: null,
		can_cancel: true,
		can_reschedule: true,
		new_booking_allowed: false,
		self_management_cutoff_hours: 48,
		self_management_window_closed: false,
		deposit: baseDeposit(),
		deposit_transfer_details: 'Alias: consultorio.prueba\nCBU: 0000003100012345678901',
		business: {
			id: BUSINESS,
			name: 'Consultorio Prueba',
			slug: 'consultorio-prueba',
			timezone: TZ,
			phone: '+54 9 11 5555-0000',
			address: 'Av. Santa Fe 1234',
			address_instructions: 'Piso 2, timbre B',
			maps_url: 'https://maps.google.com/?q=prueba',
			logo_url: null,
			whatsapp_contact_phone: '+5491155550000'
		}
	},
	...overrides
});

const formWith = (fields: Record<string, string>) => {
	const form = new FormData();
	for (const [k, v] of Object.entries(fields)) form.set(k, v);
	return form;
};

describe('Lote 2B — P1: aviso de seña por vencer y «Ya transferí»', () => {
	it('incorpora deposit_expiring_reminder en propósitos de correo, estado y contexto', () => {
		expect(APPOINTMENT_EMAIL_PURPOSES).toContain('deposit_expiring_reminder');
		expect(EMAIL_PURPOSES).toContain('deposit_expiring_reminder');
		const ctx = resolveAppointmentEmailContext({
			status: 'reserved',
			startsAt: '2026-11-25T13:00:00.000Z',
			now: new Date('2026-11-17T13:00:00.000Z'),
			managementAccessValid: true,
			cancelAllowed: true,
			rescheduleAllowed: true,
			newBookingAllowed: false,
			purpose: 'deposit_expiring_reminder',
			depositStatus: 'pending',
			showCancel: true,
			showReschedule: true
		});
		expect(ctx.send).toBe(true);
		const paidCtx = resolveAppointmentEmailContext({
			status: 'confirmed',
			startsAt: '2026-11-25T13:00:00.000Z',
			now: new Date('2026-11-17T13:00:00.000Z'),
			managementAccessValid: true,
			cancelAllowed: true,
			rescheduleAllowed: true,
			newBookingAllowed: false,
			purpose: 'deposit_expiring_reminder',
			depositStatus: 'paid',
			showCancel: true,
			showReschedule: true
		});
		expect(paidCtx.send).toBe(false);
		expect(paidCtx.skipReason).toBe('deposit_not_pending');
	});

	it('arma el correo deposit_expiring_reminder con fecha límite exacta, monto, datos para transferir y botón «Pagar la seña y avisar» hacia #sena-del-turno', () => {
		const built = buildAppointmentEmail(emailWork(), {
			siteUrl: 'https://app.cita-suite.com.ar',
			now: new Date('2026-11-17T13:00:00.000Z')
		});
		expect(built.send).toBe(true);
		if (!built.send) return;
		expect(built.subject).toMatch(/seña/i);
		expect(built.html).toContain('40.000');
		expect(built.html).toContain('Alias: consultorio.prueba');
		expect(built.html).toContain('Pagar la seña y avisar');
		expect(built.html).toContain('#sena-del-turno');
		expect(built.links[0]).toMatchObject({
			label: 'Pagar la seña y avisar',
			primary: true,
			href: `https://app.cita-suite.com.ar/gestion/${'a'.repeat(64)}?desde=2#sena-del-turno`
		});
		expect(built.text).toContain('Pagar la seña y avisar');
		expect(built.text).toContain('#sena-del-turno');
		expect(built.html).toContain('cancela automáticamente');
	});

	it('en deposit_expiring_reminder para paciente P3 (auto_cancel=false) omite frase de cancelación, y respeta modalidad virtual D1/P7 y ventana P5', () => {
		const work = emailWork();
		work.snapshot = {
			...work.snapshot,
			modality: 'video',
			can_cancel: false,
			can_reschedule: false,
			self_management_window_closed: true,
			integration: { video_instructions_snapshot: 'Conectate a https://meet.google.com/prueba-2b' },
			deposit: baseDeposit({ auto_cancel: false })
		};
		const built = buildAppointmentEmail(work, {
			siteUrl: 'https://app.cita-suite.com.ar',
			now: new Date('2026-11-17T13:00:00.000Z')
		});
		expect(built.send).toBe(true);
		if (!built.send) return;
		expect(built.html).not.toContain('cancela automáticamente');
		expect(built.text).not.toContain('cancela automáticamente');
		expect(built.html).toContain('Modalidad: virtual');
		expect(built.html).toContain('https://meet.google.com/prueba-2b');
		expect(built.html).not.toContain('Av. Santa Fe 1234');
		expect(built.html).not.toContain('Piso 2, timbre B');
		expect(built.links.map((l) => l.label)).toEqual(['Pagar la seña y avisar']);
	});

	it('cuando el paciente ya registró «Ya transferí», describeDepositDeadline no promete auto-cancelación y la lista lo ubica primero en «Avisó que pagó: verificar»', () => {
		const now = new Date('2026-11-17T12:00:00.000Z');
		const noticeAt = '2026-11-17T11:30:00.000Z';
		const parsed = parseAppointmentDeposit({
			...baseDeposit({ auto_cancel: false }),
			patient_payment_notice_at: noticeAt
		});
		expect((parsed as Record<string, unknown>)?.patient_payment_notice_at).toBe(noticeAt);
		expect(DEPOSIT_SECTIONS[0]).toEqual({
			id: 'payment_reported',
			title: 'Avisó que pagó: verificar',
			folded: false
		});
		expect(
			classifyDeposit(parsed!, { status: 'reserved', startsAt: '2026-11-25T13:00:00.000Z' }, now)
		).toBe('payment_reported');
		// Incluso si ya pasó el vencimiento, sigue en «Avisó que pagó: verificar» hasta que decida el consultorio.
		expect(
			classifyDeposit(parsed!, { status: 'reserved', startsAt: '2026-11-25T13:00:00.000Z' }, new Date('2026-11-19T12:00:00.000Z'))
		).toBe('payment_reported');
		const deadline = describeDepositDeadline(
			{ amount: 40000, dueAt: '2026-11-18T13:00:00.000Z', autoCancel: true, paymentNoticeAt: noticeAt } as never,
			TZ,
			now
		);
		expect(deadline.autoCancel).toBe(false);
		expect(deadline.autoCancelSentence).toBeNull();
	});

	it('registra acciones de límite de intentos para «Ya transferí» y cuenta paymentReported en alertas de agenda', () => {
		expect(RATE_LIMIT_ACTIONS).toContain('deposit_payment_notice_by_ip');
		expect(RATE_LIMIT_ACTIONS).toContain('deposit_payment_notice_by_token');
		const item = {
			deposit: baseDeposit({ auto_cancel: false }),
			reminderOpenedBy: null,
			section: 'payment_reported',
			appointment: {
				id: APPOINTMENT,
				startsAt: '2026-11-25T13:00:00.000Z',
				status: 'reserved',
				managementRevision: 'a'.repeat(64),
				professionalId: 'p1',
				serviceId: SERVICE
			},
			patient: { id: 'pt1', name: 'Ana', phoneE164: '+5491155551111', blocked: false, archivedAt: null }
		} as unknown as DepositListItem;
		const alerts = summarizeDepositAlerts([item], new Date('2026-11-17T12:00:00.000Z'));
		expect((alerts as Record<string, unknown>).paymentReported).toBe(1);
	});
});

describe('Lote 2B — P4: seña a cuenta al reprogramar o cancelar y decisiones de Juan', () => {
	it('valida expiring_reminder_hours (P1) y deposit_credit_cutoff_hours (P4) en parsePolicyForm y saveDepositPolicy', async () => {
		const baseFields = {
			enabled: 'true',
			auto_cancel_enabled: 'true',
			amount_mode: 'fixed',
			fixed_amount: '40.000',
			percentage: '',
			request_days: '7',
			deadline_hours: '48',
			min_payment_hours: '24',
			late_booking_payment_hours: '48',
			expiring_reminder_hours: '24',
			deposit_credit_cutoff_hours: '48',
			transfer_details: 'Alias prueba',
			applies_to_manual: 'true'
		};
		const parsed = parsePolicyForm(formWith(baseFields), new Set([SERVICE]));
		expect(parsed.errors).toEqual({});
		expect(parsed.policy).toMatchObject({
			expiringReminderHours: 24,
			depositCreditCutoffHours: 48
		});
		expect(parsePolicyForm(formWith({ ...baseFields, expiring_reminder_hours: '' }), new Set([SERVICE])).policy).toMatchObject({
			expiringReminderHours: null
		});
		expect(parsePolicyForm(formWith({ ...baseFields, expiring_reminder_hours: '48' }), new Set([SERVICE])).policy).toMatchObject({
			expiringReminderHours: 48
		});
		expect(parsePolicyForm(formWith({ ...baseFields, expiring_reminder_hours: '12' }), new Set([SERVICE])).errors).toHaveProperty(
			'expiring_reminder_hours'
		);
		expect(parsePolicyForm(formWith({ ...baseFields, deposit_credit_cutoff_hours: '' }), new Set([SERVICE])).policy).toMatchObject({
			depositCreditCutoffHours: null
		});
		for (const bad of ['0', '721', '48,5', '-1']) {
			expect(
				parsePolicyForm(formWith({ ...baseFields, deposit_credit_cutoff_hours: bad }), new Set([SERVICE])).errors
			).toHaveProperty('deposit_credit_cutoff_hours');
		}
		expect(DEFAULT_DEPOSIT_POLICY).toMatchObject({
			expiringReminderHours: 24,
			depositCreditCutoffHours: null
		});

		const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
		const rpc = vi.fn((name: string, args: Record<string, unknown>) => {
			calls.push({ name, args });
			return Promise.resolve({ data: 2, error: null });
		});
		await saveDepositPolicy({ rpc } as never, {
			businessId: BUSINESS,
			expectedRevision: 1,
			policy: {
				...DEFAULT_DEPOSIT_POLICY,
				enabled: true,
				fixedAmount: 40000,
				expiringReminderHours: 48,
				depositCreditCutoffHours: 48
			} as never
		});
		expect((calls[0].args.p_settings as Record<string, unknown>).expiring_reminder_hours).toBe(48);
		expect((calls[0].args.p_settings as Record<string, unknown>).deposit_credit_cutoff_hours).toBe(48);
	});

	it('el correo cancellation_receipt informa si la seña pagada quedó a cuenta, por fuerza mayor o se perdió según las horas', () => {
		const cancelledBase = emailWork({
			purpose: 'cancellation_receipt',
			token: null,
			snapshot: {
				...emailWork().snapshot,
				status: 'cancelled',
				can_cancel: false,
				can_reschedule: false,
				new_booking_allowed: true,
				deposit: baseDeposit({ status: 'paid', recorded_at: '2026-11-12T12:00:00.000Z' })
			}
		});

		const creditEmail = buildAppointmentEmail(
			{
				...cancelledBase,
				snapshot: {
					...cancelledBase.snapshot,
					cancellation_deposit_outcome: {
						outcome: 'credit',
						amount: '40000',
						reason: 'cancelled_in_time',
						cutoff_hours: 48
					}
				}
			},
			{ siteUrl: 'https://app.cita-suite.com.ar', now: new Date('2026-11-20T12:00:00.000Z') }
		);
		expect(creditEmail.send).toBe(true);
		if (creditEmail.send) {
			expect(creditEmail.html).toContain('40.000');
			expect(creditEmail.html).toMatch(/quedó a cuenta/i);
			expect(creditEmail.text).toMatch(/quedó a cuenta/i);
		}

		const forfeitEmail = buildAppointmentEmail(
			{
				...cancelledBase,
				snapshot: {
					...cancelledBase.snapshot,
					cancellation_deposit_outcome: {
						outcome: 'forfeit',
						amount: '40000',
						reason: 'cancelled_late',
						cutoff_hours: 48
					}
				}
			},
			{ siteUrl: 'https://app.cita-suite.com.ar', now: new Date('2026-11-24T12:00:00.000Z') }
		);
		expect(forfeitEmail.send).toBe(true);
		if (forfeitEmail.send) {
			expect(forfeitEmail.html).toContain('40.000');
			expect(forfeitEmail.html).toMatch(/se perdió/i);
			expect(forfeitEmail.html).toContain('48');
			expect(forfeitEmail.text).toMatch(/se perdió/i);
		}
	});

	it('bookingReschedulePolicyNotice muestra la regla por horas cuando depositCreditCutoffHours está cargado y conserva la actual si es null', () => {
		const policy = {
			schema_version: 1 as const,
			policy_revision: 1,
			require_deposit_on_reschedule: true,
			previous_deposit_disposition: 'forfeit' as const
		};
		const withCutoff = (bookingReschedulePolicyNotice as (p: typeof policy, cutoff?: number | null) => string)(policy, 48);
		expect(withCutoff).toContain('48');
		expect(withCutoff).toMatch(/a cuenta/i);
		expect(withCutoff).toMatch(/se pierde/i);
		const withoutCutoff = bookingReschedulePolicyNotice(policy);
		expect(withoutCutoff).not.toContain('48');
	});

	it('traduce el error de falta de respuesta obligatoria «¿Quién pidió el cambio?» (decisión #1 de Juan)', () => {
		const msg = getHumanAppointmentErrorMessage({ message: 'APPOINTMENT_RESCHEDULE_REQUESTER_REQUIRED' });
		expect(msg).toMatch(/quién pidió el cambio/i);
	});
});
