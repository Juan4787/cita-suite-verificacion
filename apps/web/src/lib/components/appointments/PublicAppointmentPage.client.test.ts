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
	});
});
