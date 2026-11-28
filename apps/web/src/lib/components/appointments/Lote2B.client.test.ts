/** @vitest-environment jsdom */

import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ search: '' }));
vi.mock('$app/state', () => ({
	page: {
		get url() {
			return new URL(`http://localhost/odonto/senas${state.search}`);
		}
	}
}));

import SenasPage from '../../../routes/odonto/senas/+page.svelte';
import ConfigSenasPage from '../../../routes/odonto/configuracion/senas/+page.svelte';
import ConfigCorreoPage from '../../../routes/odonto/configuracion/correo/+page.svelte';
import StaffCancelPanel from './StaffCancelPanel.svelte';
import PatientProfilePanel from '../patients/PatientProfilePanel.svelte';
import PublicAppointmentPage from './PublicAppointmentPage.svelte';
import TurnoDetailPage from '../../../routes/odonto/turnos/[appointmentId]/+page.svelte';
import { notificationBrowserProfile } from '$lib/device';

afterEach(() => {
	cleanup();
	state.search = '';
});

describe('Lote 2B — pantallas P1 y P4', () => {
	it('P1 + P4 en /odonto/senas: muestra «Avisó que pagó: verificar» con tiempo transcurrido y acciones, y «Aplicar» con nota de diferencia', () => {
		const nowIso = new Date(Date.now() - 15 * 60_000).toISOString();
		render(SenasPage, {
			data: {
				demo: false,
				restricted: false,
				canConfigure: true,
				policyEnabled: true,
				truncated: false,
				page: 1,
				automation: { tone: 'ok', text: 'Última revisión automática: hace 2 min.' },
				sections: [
					{
						id: 'payment_reported',
						title: 'Avisó que pagó: verificar',
						folded: false,
						rows: [
							{
								appointmentId: '00000000-0000-4000-8000-0000000000a1',
								patientId: 'pt-1',
								patientName: 'Carla Ruiz',
								turnLabel: 'viernes, 20 de noviembre a las 10:00',
								amountLabel: '$ 40.000',
								amount: 40000,
								dueLabel: 'miércoles, 18 de noviembre a las 10:00',
								section: 'payment_reported',
								revision: 4,
								managementRevision: 'a'.repeat(64),
								appointmentStatus: 'reserved',
								hasPhone: true,
								hasEmail: true,
								canPrepareDelivery: true,
								paymentNoticeAt: nowIso,
								reminder: null,
								cancellation: null,
								availableCredits: []
							}
						]
					},
					{
						id: 'to_request',
						title: 'Para pedir',
						folded: false,
						rows: [
							{
								appointmentId: '00000000-0000-4000-8000-0000000000a2',
								patientId: 'pt-2',
								patientName: 'Martín Silva',
								turnLabel: 'martes, 24 de noviembre a las 11:00',
								amountLabel: '$ 50.000',
								amount: 50000,
								dueLabel: 'martes, 17 de noviembre a las 11:00',
								section: 'to_request',
								revision: 2,
								managementRevision: 'b'.repeat(64),
								appointmentStatus: 'reserved',
								hasPhone: true,
								hasEmail: true,
								canPrepareDelivery: true,
								paymentNoticeAt: null,
								reminder: null,
								cancellation: null,
								availableCredits: [
									{
										id: '00000000-0000-4000-8000-0000000000c1',
										amount: 40000,
										currency: 'ARS',
										reason: 'cancelled_in_time',
										sourceAppointmentId: '00000000-0000-4000-8000-0000000000a0',
										createdAt: '2026-11-10T12:00:00.000Z'
									}
								]
							}
						]
					}
				]
			} as never
		});

		expect(screen.getByRole('heading', { name: 'Avisó que pagó: verificar (1)' })).toBeInTheDocument();
		expect(screen.getByText(/Avisó que pagó hace 15\s+min/)).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Registrar pago' })).toBeInTheDocument();
		expect(screen.getByText('No llegó el pago')).toBeInTheDocument();

		expect(screen.getByText(/Tiene 1 seña a cuenta/i)).toBeInTheDocument();
		expect(screen.getByText(/Si la aplicás, falta cobrar \$[\s\u00a0]*10\.000 de diferencia/i)).toBeInTheDocument();
		expect(screen.queryByText(/Se aplicó la seña a cuenta/i)).not.toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Aplicar' })).toBeInTheDocument();
	});

	it('P1 + P4 en /odonto/configuracion/senas: muestra selector de aviso (Desactivado / 24 h / 48 h) y horas de seña a cuenta', () => {
		const { container } = render(ConfigSenasPage, {
			data: {
				demo: false,
				whatsappConfigured: true,
				automationStopped: false,
				supportWhatsApp: null,
				timezone: 'America/Argentina/Buenos_Aires',
				device: 'desktop',
				services: [],
				policy: {
					revision: 1,
					enabled: true,
					autoCancelEnabled: true,
					amountMode: 'fixed',
					fixedAmount: 40000,
					percentage: null,
					requestDays: 7,
					deadlineHours: 168,
					minPaymentHours: 24,
					lateBookingPaymentHours: 48,
					expiringReminderHours: 24,
					depositCreditCutoffHours: 48,
					transferDetails: 'Alias prueba',
					appliesToManual: true,
					excludedServiceIds: []
				}
			} as never
		});
		expect(container.querySelector('select[name="expiring_reminder_hours"], input[name="expiring_reminder_hours"]')).not.toBeNull();
		expect(screen.getByRole('radio', { name: /Desactivado/i })).toBeInTheDocument();
		expect(screen.getByRole('radio', { name: /24\s*horas antes/i })).toBeChecked();
		expect(screen.getByRole('radio', { name: /48\s*horas antes/i })).toBeInTheDocument();
		const cutoffInput = container.querySelector<HTMLInputElement>('input[name="deposit_credit_cutoff_hours"]');
		expect(cutoffInput).not.toBeNull();
		expect(cutoffInput?.value).toBe('48');
	});

	it('P4 en /odonto/configuracion/correo: «Seña al reprogramar» muestra la regla por horas cuando el campo está cargado', () => {
		render(ConfigCorreoPage, {
			data: {
				demo: false,
				context: {},
				depositCreditCutoffHours: 48,
				policy: {
					email_enabled: true,
					require_email: true,
					show_cancel: true,
					show_reschedule: true,
					require_deposit_on_reschedule: true,
					previous_deposit_disposition: 'forfeit',
					self_management_cutoff_hours: 48,
					revision: 1,
					sender_verified: true
				},
				status: null
			} as never
		});
		expect(screen.getByText(/48\s*horas o más/i)).toBeInTheDocument();
		expect(screen.getByRole('link', { name: /Configuración.*Señas|Cambiar en Señas/i })).toHaveAttribute(
			'href',
			'/odonto/configuracion/senas'
		);
	});

	it('P4 en StaffCancelPanel: ofrece excepción por fuerza mayor al cancelar con menos de las horas del corte', async () => {
		const { container } = render(StaffCancelPanel, {
			patientName: 'Sofía Gómez',
			when: 'mañana a las 10:00',
			patientHasEmail: true,
			deposit: {
				appointment_id: 'a1',
				status: 'paid',
				amount: 40000,
				currency: 'ARS',
				request_from: '2026-11-10T03:00:00.000Z',
				due_at: '2026-11-18T13:00:00.000Z',
				auto_cancel: false,
				waived_reason: null,
				recorded_at: '2026-11-12T12:00:00.000Z',
				reminder_opened_at: null,
				expired_at: null,
				revision: 2
			},
			depositCreditCutoffHours: 48,
			startsAt: '2026-11-20T13:00:00.000Z',
			nowIso: '2026-11-19T13:00:00.000Z',
			operationId: '00000000-0000-4000-8000-0000000000f1',
			revision: 'a'.repeat(64),
			disabled: false,
			onsubmit: () => {}
		} as never);
		await fireEvent.click(container.querySelector('summary')!);
		expect(screen.getByText(/se pierde/i)).toBeInTheDocument();
		const checkbox = screen.getByLabelText(/fuerza mayor/i) as HTMLInputElement;
		expect(checkbox.type).toBe('checkbox');
		expect(checkbox.name).toBe('keep_deposit_as_credit');
	});

	it('P4 en PatientProfilePanel: muestra las señas a cuenta disponibles en la ficha del paciente', () => {
		render(PatientProfilePanel, {
			active: true,
			deferred: false,
			demo: false,
			scope: 'all',
			businessTimeZone: 'America/Argentina/Buenos_Aires',
			onEdit: () => {},
			permissions: {
				canReadClinicalHistory: true,
				canReadClinicalProfile: true,
				canEditClinicalProfile: true,
				canViewCosts: true,
				canEditPatient: true,
				canArchivePatient: false,
				canCreateClinicalEntry: true,
				canEditClinicalEntry: true,
				canCreateAppointment: true,
				canViewRadiographs: false,
				canUploadRadiographs: false,
				canViewRadiographTrash: false,
				canTrashRadiographs: false,
				canExportPatientData: false,
				canManageDepositAutoCancelExemption: true
			},
			patient: {
				id: 'pt-1',
				full_name: 'Ana Crédito',
				created_at: '2026-11-01T12:00:00.000Z',
				updated_at: '2026-11-10T12:00:00.000Z',
				exempt_from_deposit_auto_cancel: false,
				available_deposit_credits: [
					{
						id: '00000000-0000-4000-8000-0000000000c1',
						amount: 40000,
						currency: 'ARS',
						reason: 'cancelled_in_time',
						sourceAppointmentId: '00000000-0000-4000-8000-0000000000a0',
						createdAt: '2026-11-12T15:00:00.000Z'
					}
				]
			} as never
		});
		expect(screen.getByText(/Señas a cuenta/i)).toBeInTheDocument();
		expect(screen.getByText(/\$ 40\.000/)).toBeInTheDocument();
	});

	it('P1 en PublicAppointmentPage: «Ya transferí» pide confirmación breve, oculta auto-cancelación al registrarse y muestra resultado P4 al cancelar', async () => {
		const pendingAppointment = {
			id: 'appt-p1',
			token: 'a'.repeat(64),
			starts_at: '2026-11-25T13:00:00.000Z',
			ends_at: '2026-11-25T13:30:00.000Z',
			status: 'reserved' as const,
			is_past: false,
			is_joint: false,
			professional_count: 1,
			calendar_action_status: 'not_offered',
			calendar_action_at: null,
			calendar_action_count: 0,
			calendar_sequence: 0,
			calendar_update_required_at: null,
			professional_name_snapshot: 'Dra. Prueba',
			service_name_snapshot: 'Consulta',
			patient_name: 'Sofía Prueba',
			deposit: {
				appointment_id: 'appt-p1',
				status: 'pending' as const,
				amount: 40000,
				currency: 'ARS' as const,
				request_from: '2026-11-10T03:00:00.000Z',
				due_at: '2026-11-23T13:00:00.000Z',
				auto_cancel: true,
				waived_reason: null,
				recorded_at: null,
				reminder_opened_at: null,
				expired_at: null,
				revision: 1,
				patient_payment_notice_at: null
			},
			deposit_transfer_details: 'Alias prueba.sena',
			public_status_label: 'Reservado',
			public_actions_available: true,
			can_confirm: false,
			can_cancel: true,
			can_request_reschedule: true,
			business: {
				id: 'biz-1',
				name: 'Consultorio Prueba',
				slug: 'consultorio-prueba',
				phone: null,
				timezone: 'America/Argentina/Buenos_Aires',
				address: null,
				address_instructions: null,
				maps_link: null,
				logo_url: null,
				is_active: true,
				cancellation_policy: null,
				whatsapp_contact_phone: '+5491155550000'
			}
		};
		const baseData = {
			appointment: pendingAppointment,
			management: {
				url: `/turno/${'a'.repeat(64)}`,
				revision: 'b'.repeat(64),
				operationId: '00000000-0000-4000-8000-000000000011',
				mode: 'overview' as const,
				startsAt: pendingAppointment.starts_at,
				timezone: pendingAppointment.business.timezone,
				now: '2026-11-20T12:00:00.000Z',
				canCancel: true,
				canConfirm: false,
				canReschedule: true,
				date: '2026-11-25',
				slots: [],
				selectedStart: null,
				availabilityRevision: null,
				integrationRevision: null,
				durationMinutes: 30,
				financialTerms: null,
				financialSummary: { appliedAmount: '0', forfeitedAmount: '0', unresolvedAmount: '0' },
				unavailableMessage: null
			},
			remindersEnabled: false,
			message: '',
			created: false,
			suggestedAction: '',
			demo: false,
			device: 'desktop' as const,
			isSoon: false,
			vapidPublicKey: null,
			publicSiteUrl: 'https://turnos.test',
			notificationBrowser: notificationBrowserProfile('Mozilla/5.0'),
			googleCalendar: { available: false, state: 'none' as const, current: false, reminderLabel: '24 horas antes' },
			calendarMessage: null,
			practiceWhatsApp: null,
			depositWhatsApp: {
				paidNow: {
					message: 'Ya transferí',
					whatsappUrl: 'https://wa.me/5491155550000?text=comprobante',
					whatsappWebUrl: 'https://web.whatsapp.com/send?phone=5491155550000&text=comprobante'
				},
				payLater: {
					message: 'Más adelante',
					whatsappUrl: 'https://wa.me/5491155550000?text=despues',
					whatsappWebUrl: 'https://web.whatsapp.com/send?phone=5491155550000&text=despues'
				}
			},
			rebookUrl: null
		};

		const view = render(PublicAppointmentPage, { data: baseData });
		await fireEvent.click(screen.getByRole('button', { name: 'Ya transferí: enviar el comprobante' }));
		expect(screen.getByText(/¿Confirmás que ya transferiste/)).toBeInTheDocument();
		expect(screen.getByRole('button', { name: 'Sí, ya transferí' })).toBeInTheDocument();
		await fireEvent.click(screen.getByRole('button', { name: 'Todavía no' }));
		expect(screen.queryByRole('button', { name: 'Sí, ya transferí' })).not.toBeInTheDocument();

		view.unmount();
		render(PublicAppointmentPage, {
			data: {
				...baseData,
				appointment: {
					...pendingAppointment,
					deposit: {
						...pendingAppointment.deposit,
						auto_cancel: false,
						patient_payment_notice_at: '2026-11-20T12:05:00.000Z'
					}
				}
			}
		});
		expect(screen.getByText(/Avisamos al consultorio que transferiste la seña/)).toBeInTheDocument();
		expect(screen.queryByText(/cancela automáticamente/)).not.toBeInTheDocument();
		expect(screen.getByRole('link', { name: 'Enviar comprobante por WhatsApp' })).toHaveAttribute(
			'href',
			'https://web.whatsapp.com/send?phone=5491155550000&text=comprobante'
		);
	});

	it('Decisión #1 de Juan en /odonto/turnos/[id]: pregunta obligatoria sin opción premarcada «¿Quién pidió el cambio?» al reprogramar con < corte de P4 y seña pagada', () => {
		const { container } = render(TurnoDetailPage, {
			data: {
				context: { canOperate: true, role: 'reception', business: { timezone: 'America/Argentina/Buenos_Aires' } },
				canEditInstructions: false,
				appointment: {
					id: '00000000-0000-4000-8000-0000000000a1',
					starts_at: '2026-11-20T15:00:00.000Z',
					ends_at: '2026-11-20T15:30:00.000Z',
					status: 'confirmed',
					source: 'public_booking',
					service_name_snapshot: 'Consulta',
					professional_name_snapshot: 'Dra. Prueba',
					duration_minutes_snapshot: 30,
					internal_note: null,
					cancelled_reason: null,
					price_quote_snapshot: null,
					booking_context: null,
					booking_intake: null,
					professionals: [{ professional_id: 'p1', position: 1, is_primary: true, professional_name_snapshot: 'Dra. Prueba', break_minutes_snapshot: 0 }],
					patients: { id: 'pt1', full_name: 'Carla Prueba', phone_e164: '+5491155550000', email: 'carla@test.ar', blocked: false, archived_at: null }
				},
				management: {
					revision: 'a'.repeat(64),
					statusOperationId: '00000000-0000-4000-8000-000000000011',
					rescheduleOperationId: '00000000-0000-4000-8000-000000000012',
					lateDepositOperationId: '00000000-0000-4000-8000-000000000013'
				},
				deposit: {
					appointment_id: '00000000-0000-4000-8000-0000000000a1',
					status: 'paid',
					amount: 40000,
					currency: 'ARS',
					request_from: '2026-11-10T03:00:00.000Z',
					due_at: '2026-11-18T15:00:00.000Z',
					auto_cancel: false,
					waived_reason: null,
					recorded_at: '2026-11-12T12:00:00.000Z',
					reminder_opened_at: null,
					expired_at: null,
					revision: 2,
					cancelsItself: false
				},
				depositFinancials: { appliedAmount: '40000', forfeitedAmount: '0', unresolvedAmount: '0', latePayments: [], latePaymentsTruncated: false },
				depositCreditCutoffHours: 48,
				availableDepositCredits: [],
				nowIso: '2026-11-19T15:00:00.000Z',
				canRecordDeposit: true,
				auditLogs: [],
				emailDeliveries: [],
				userLabels: {},
				reprogramDate: '2026-11-22',
				minReprogramDate: '2026-11-19',
				reprogramSlots: [],
				reprogramSlotsLoaded: false,
				fromDate: '2026-11-20',
				justRescheduled: false,
				justCreated: false,
				delivery: { available: false, hasPhone: true },
				activationDevice: 'desktop',
				phoneWarningAcknowledged: false,
				demo: false
			} as never
		});

		const fieldset = container.querySelector('[data-reschedule-requester-fieldset]');
		expect(fieldset).not.toBeNull();
		expect(fieldset?.textContent).toContain('¿Quién pidió el cambio?');
		const radios = [...container.querySelectorAll<HTMLInputElement>('input[name="reschedule_requester"]')];
		expect(radios).toHaveLength(2);
		expect(radios.map((r) => r.value)).toEqual(['patient', 'practice_or_force_majeure']);
		expect(radios.every((r) => !r.checked)).toBe(true);
		expect(radios.every((r) => r.required)).toBe(true);
	});
});
