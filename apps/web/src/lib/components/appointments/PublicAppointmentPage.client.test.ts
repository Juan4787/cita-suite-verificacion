/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }) }));
vi.mock('$app/navigation', () => ({ goto: vi.fn(), invalidateAll: vi.fn() }));
vi.mock('$app/stores', async () => {
	const { readable } = await import('svelte/store');
	return { page: readable({ url: new URL('https://app.test/turno/abc?creado=1') }) };
});

import PublicAppointmentPage from './PublicAppointmentPage.svelte';

afterEach(cleanup);

describe('AF1-018: PublicAppointmentPage confirmation hero order and container', () => {
	it('renders the confirmation hero first inside max-w-3xl before price quote and long instructions', () => {
		const { container } = render(PublicAppointmentPage, {
			data: {
				created: true,
				isSoon: false,
				remindersEnabled: false,
				bookingInformationEnabled: false,
				message: '',
				calendarMessage: '',
				googleCalendar: { enabled: false, state: 'idle' },
				pushReminders: { enabled: false, vapidPublicKey: null, subscribed: false },
				practiceWhatsApp: null,
				appointment: {
					id: 'apt-1',
					token: 'a'.repeat(64),
					status: 'reserved',
					starts_at: '2026-11-26T12:00:00.000Z',
					ends_at: '2026-11-26T13:00:00.000Z',
					service_name_snapshot: 'Primera consulta',
					professional_name_snapshot: 'Dra. Natalia Frutos',
					professional_count: 1,
					is_joint: false,
					calendar_action_status: 'none',
					calendar_action_at: null,
					calendar_action_count: 0,
					calendar_sequence: 0,
					calendar_update_required_at: null,
					patient_name: 'Paciente Prueba',
					booking_context: null,
					patient_instructions_snapshot: 'Indicaciones extensas para preparar la consulta.\n'.repeat(12),
					public_reminder_description_snapshot: null,
					price_quote_snapshot: { amount: 45000, currency: 'ARS', adjusted: false },
					deposit: null,
					deposit_transfer_details: null,
					public_status_label: 'Reservado',
					public_actions_available: true,
					can_cancel: true,
					can_confirm: false,
					can_request_reschedule: true,
					is_past: false,
					business: {
						id: 'biz-1',
						name: 'Dra. Natalia Frutos',
						slug: 'dra-natalia-frutos',
						timezone: 'America/Argentina/Cordoba',
						is_active: true,
						phone: '+5493511234567',
						logo_url: null,
						address: 'Calle 123',
						address_instructions: null,
						maps_link: null,
						cancellation_policy: null,
						whatsapp_contact_phone: null
					}
				}
			} as never,
			form: undefined
		});

		const wrapper = container.querySelector('main > .max-w-3xl');
		expect(wrapper).not.toBeNull();

		const heroHeading = screen.getByRole('heading', { name: 'Tu turno quedó reservado' });
		const priceHeading = screen.getByRole('heading', { name: 'Arancel registrado al reservar' });
		const instructionsHeading = screen.getByRole('heading', { name: 'Indicaciones para tu turno' });

		// Every card must live inside the max-w-3xl column.
		expect(wrapper!.contains(heroHeading)).toBe(true);
		expect(wrapper!.contains(priceHeading)).toBe(true);
		expect(wrapper!.contains(instructionsHeading)).toBe(true);

		// Hero confirmation must appear BEFORE price quote and patient instructions.
		expect(heroHeading.compareDocumentPosition(priceHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		expect(heroHeading.compareDocumentPosition(instructionsHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
		// P6: without future adjustments, no estimated legend is rendered.
		expect(screen.queryByText(/valor estimado/i)).not.toBeInTheDocument();
	});

	it('P6 y P7: muestra leyenda de valor estimado sólo con ajuste futuro y enlaces https:// escapados en consultas virtuales', () => {
		render(PublicAppointmentPage, {
			data: {
				created: false,
				isSoon: false,
				remindersEnabled: false,
				bookingInformationEnabled: false,
				message: '',
				calendarMessage: '',
				googleCalendar: { enabled: false, state: 'idle' },
				pushReminders: { enabled: false, vapidPublicKey: null, subscribed: false },
				practiceWhatsApp: null,
				appointment: {
					id: 'apt-2',
					token: 'b'.repeat(64),
					status: 'reserved',
					starts_at: '2027-06-20T12:00:00.000Z',
					ends_at: '2027-06-20T13:00:00.000Z',
					service_name_snapshot: 'Primera consulta',
					professional_name_snapshot: 'Dra. Natalia Frutos',
					professional_count: 1,
					is_joint: false,
					calendar_action_status: 'none',
					calendar_action_at: null,
					calendar_action_count: 0,
					calendar_sequence: 0,
					calendar_update_required_at: null,
					patient_name: 'Paciente Virtual',
					booking_context: {
						theme: 'cita-suite',
						modality: 'video',
						videoInstructions: 'Conectate en https://meet.google.com/abc-defg-hij. <img src=x> http://no.test'
					},
					patient_instructions_snapshot: null,
					public_reminder_description_snapshot: null,
					price_quote_snapshot: { amount: 52000, currency: 'ARS', adjusted: true },
					deposit: null,
					deposit_transfer_details: null,
					public_status_label: 'Reservado',
					public_actions_available: true,
					can_cancel: true,
					can_confirm: false,
					can_request_reschedule: true,
					is_past: false,
					business: {
						id: 'biz-1',
						name: 'Dra. Natalia Frutos',
						slug: 'dra-natalia-frutos',
						timezone: 'America/Argentina/Cordoba',
						is_active: true,
						phone: '+5493511234567',
						logo_url: null,
						address: null,
						address_instructions: 'Conectate en https://meet.google.com/abc-defg-hij. <img src=x> http://no.test',
						maps_link: null,
						cancellation_policy: null,
						whatsapp_contact_phone: null
					}
				}
			} as never,
			form: undefined
		});

		expect(screen.getByText(/valor estimado/i)).toBeInTheDocument();
		expect(screen.getByText(/puede actualizarse/i)).toBeInTheDocument();

		const meetLink = screen.getByRole('link', { name: 'https://meet.google.com/abc-defg-hij' });
		expect(meetLink).toHaveAttribute('href', 'https://meet.google.com/abc-defg-hij');
		expect(screen.queryByRole('link', { name: /http:\/\/no\.test/ })).not.toBeInTheDocument();
		expect(document.querySelector('img[src="x"]')).toBeNull();
		expect(screen.getByText(/<img src=x>/)).toBeInTheDocument();
	});

	it('P2 + P5: en la confirmación muestra fecha y hora exactas de seña sin prometer auto-cancelación cuando auto_cancel=false y avisa si nació dentro de la ventana de autogestión', () => {
		render(PublicAppointmentPage, {
			data: {
				created: true,
				isSoon: false,
				remindersEnabled: false,
				bookingInformationEnabled: false,
				message: '',
				calendarMessage: '',
				googleCalendar: { available: false, state: 'none', current: false, reminderLabel: 'antes del turno' },
				practiceWhatsApp: {
					whatsappUrl: 'https://wa.me/5493415550123?text=Hola',
					whatsappWebUrl: 'https://web.whatsapp.com/send?phone=5493415550123&text=Hola'
				},
				depositWhatsApp: null,
				rebookUrl: null,
				device: 'desktop',
				vapidPublicKey: null,
				publicSiteUrl: 'https://app.test',
				notificationBrowser: { id: 'other', sitePermissionGuide: null, phoneNotificationGuide: null },
				suggestedAction: '',
				demo: false,
				management: {
					url: '/turno/' + 'c'.repeat(64),
					revision: 'd'.repeat(64),
					operationId: '00000000-0000-4000-8000-000000000001',
					mode: 'overview',
					startsAt: '2026-11-26T12:00:00.000Z',
					timezone: 'America/Argentina/Cordoba',
					now: '2026-11-25T12:00:00.000Z',
					canCancel: false,
					canReschedule: false,
					canConfirm: false,
					selfManagementCutoffHours: 48,
					selfManagementCutoffAt: '2026-11-24T12:00:00.000Z',
					selfManagementWindowClosed: true,
					practiceWhatsApp: {
						whatsappUrl: 'https://wa.me/5493415550123?text=Hola',
						whatsappWebUrl: 'https://web.whatsapp.com/send?phone=5493415550123&text=Hola'
					},
					practicePhone: '+5493511234567',
					date: '2026-11-26',
					slots: [],
					selectedStart: null,
					availabilityRevision: null,
					integrationRevision: null,
					durationMinutes: 30,
					financialTerms: null,
					unavailableMessage: null,
					financialSummary: { appliedAmount: '0', forfeitedAmount: '0', unresolvedAmount: '0' }
				},
				appointment: {
					id: 'apt-3',
					token: 'c'.repeat(64),
					status: 'reserved',
					starts_at: '2026-11-26T12:00:00.000Z',
					ends_at: '2026-11-26T13:00:00.000Z',
					service_name_snapshot: 'Primera consulta',
					professional_name_snapshot: 'Dra. Natalia Frutos',
					professional_count: 1,
					is_joint: false,
					calendar_action_status: 'none',
					calendar_action_at: null,
					calendar_action_count: 0,
					calendar_sequence: 0,
					calendar_update_required_at: null,
					patient_name: 'Paciente Tardío',
					booking_context: null,
					patient_instructions_snapshot: null,
					public_reminder_description_snapshot: null,
					price_quote_snapshot: null,
					deposit: {
						appointment_id: 'apt-3',
						status: 'pending',
						amount: 40000,
						currency: 'ARS',
						request_from: '2026-11-25T12:00:00.000Z',
						due_at: '2026-11-26T10:00:00.000Z',
						auto_cancel: false,
						waived_reason: null,
						recorded_at: null,
						reminder_opened_at: null,
						expired_at: null,
						revision: 1
					},
					deposit_transfer_details: 'Alias prueba.sena',
					public_status_label: 'Reservado',
					public_actions_available: true,
					can_cancel: false,
					can_confirm: false,
					can_request_reschedule: false,
					is_past: false,
					business: {
						id: 'biz-1',
						name: 'Dra. Natalia Frutos',
						slug: 'dra-natalia-frutos',
						timezone: 'America/Argentina/Cordoba',
						is_active: true,
						phone: '+5493511234567',
						logo_url: null,
						address: 'Calle 123',
						address_instructions: null,
						maps_link: null,
						cancellation_policy: null,
						whatsapp_contact_phone: '+5493415550123'
					}
				}
			} as never,
			form: undefined
		});

		expect(screen.getByText(/26 de noviembre a las 07:00/)).toBeInTheDocument();
		expect(screen.queryByText(/cancela automáticamente/i)).not.toBeInTheDocument();
		expect(document.querySelector('[data-self-management-summary]')?.textContent).toMatch(/48\s*horas/i);
		expect(document.querySelector('[data-self-management-closed-notice]')?.textContent).toMatch(/48\s*horas/i);
		expect(screen.queryByRole('link', { name: 'Cancelar turno' })).not.toBeInTheDocument();
		expect(screen.queryByRole('link', { name: 'Reprogramar turno' })).not.toBeInTheDocument();
	});
});
