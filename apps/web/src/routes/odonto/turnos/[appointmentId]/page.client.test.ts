/** @vitest-environment jsdom */

import { cleanup, render, screen, waitFor } from '@testing-library/svelte';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Page from './+page.svelte';

const appointment = {
	id: 'appointment-1',
	starts_at: '2026-08-20T15:00:00.000Z',
	ends_at: '2026-08-20T15:30:00.000Z',
	status: 'reserved',
	source: 'manual',
	service_name_snapshot: 'Consulta',
	professional_name_snapshot: 'Dra. Ramírez',
	duration_minutes_snapshot: 30,
	internal_note: null,
	cancelled_reason: null,
	patients: {
		id: 'patient-1',
		full_name: 'Paciente de prueba',
		phone_e164: '+5493511234567',
		email: null
	},
	professionals: [
		{
			professional_id: 'professional-1',
			position: 0,
			is_primary: true,
			professional_name_snapshot: 'Dra. Ramírez',
			break_minutes_snapshot: 0
		}
	]
};

const data = {
	context: { canOperate: true, role: 'owner' },
	appointment,
	auditLogs: [],
	messageDispatches: [],
	userLabels: {},
	reprogramDate: '2026-08-20',
	minReprogramDate: '2026-08-05',
	reprogramSlots: [],
	reprogramSlotsLoaded: false,
	fromDate: '2026-08-20',
	justRescheduled: false,
	justCreated: true,
	activationWhatsAppUrl:
		'https://wa.me/5493511234567?text=Tu%20turno%20qued%C3%B3%20reservado.',
	activationWhatsAppWebUrl:
		'https://web.whatsapp.com/send?phone=5493511234567&text=Tu%20turno%20qued%C3%B3%20reservado.',
	activationDevice: 'desktop' as const,
	activationPublicUrl: 'https://cita-suite.test/turno/token-1?creado=1',
	phoneWarningAcknowledged: false,
	rescheduleWhatsAppUrl: null,
	rescheduleWhatsAppWebUrl: null,
	reschedulePublicUrl: null,
	demo: false
};

afterEach(() => {
	cleanup();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe('último paso después de crear un turno desde Agenda', () => {
	it('en PC abre WhatsApp Web directo con destinatario y mensaje precargados', () => {
		render(Page, { data });

		expect(screen.getByRole('heading', { name: 'Último paso' })).toBeInTheDocument();
		const action = screen.getByRole('link', { name: 'Enviar enlace de activación' });
		expect(action).toHaveAttribute('href', data.activationWhatsAppWebUrl);
		expect(action).toHaveAttribute('target', '_blank');
		expect(action.className).toContain('bg-emerald-500');
		expect(action.className).toContain('min-h-[4.5rem]');
		expect(
			screen.getByText('El paciente recibirá un enlace para activar sus recordatorios.')
		).toBeInTheDocument();
	});

	it.each(['android', 'ios'] as const)(
		'en teléfono o tablet %s entrega el enlace mediante wa.me',
		(activationDevice) => {
			render(Page, { data: { ...data, activationDevice } });

			expect(screen.getByRole('link', { name: 'Enviar enlace de activación' })).toHaveAttribute(
				'href',
				data.activationWhatsAppUrl
			);
		}
	);

	it('reconoce un iPad que se identifica como Mac y conserva wa.me', async () => {
		vi.stubGlobal('navigator', {
			maxTouchPoints: 5,
			platform: 'MacIntel',
			userAgent:
				'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15'
		});
		render(Page, { data: { ...data, activationDevice: 'desktop' } });

		await waitFor(() =>
			expect(screen.getByRole('link', { name: 'Enviar enlace de activación' })).toHaveAttribute(
				'href',
				data.activationWhatsAppUrl
			)
		);
	});

	it('en PC abre WhatsApp Web directo al avisar una reprogramación', () => {
		const rescheduleWhatsAppUrl = 'https://wa.me/5493511234567?text=Tu%20turno%20cambi%C3%B3.';
		const rescheduleWhatsAppWebUrl =
			'https://web.whatsapp.com/send?phone=5493511234567&text=Tu%20turno%20cambi%C3%B3.';
		render(Page, {
			data: {
				...data,
				justCreated: false,
				justRescheduled: true,
				rescheduleWhatsAppUrl,
				rescheduleWhatsAppWebUrl
			}
		});

		expect(screen.getByRole('link', { name: 'Enviar actualización por WhatsApp' })).toHaveAttribute(
			'href',
			rescheduleWhatsAppWebUrl
		);
	});

	it.each(['android', 'ios'] as const)(
		'en teléfono o tablet %s usa wa.me al avisar una reprogramación',
		(activationDevice) => {
			const rescheduleWhatsAppUrl = 'https://wa.me/5493511234567?text=Tu%20turno%20cambi%C3%B3.';
			render(Page, {
				data: {
					...data,
					activationDevice,
					justCreated: false,
					justRescheduled: true,
					rescheduleWhatsAppUrl,
					rescheduleWhatsAppWebUrl:
						'https://web.whatsapp.com/send?phone=5493511234567&text=Tu%20turno%20cambi%C3%B3.'
				}
			});

			expect(screen.getByRole('link', { name: 'Enviar actualización por WhatsApp' })).toHaveAttribute(
				'href',
				rescheduleWhatsAppUrl
			);
		}
	);

	it('si el número no es utilizable ofrece corregir la ficha en vez de generar un wa.me roto', () => {
		render(Page, {
			data: { ...data, activationWhatsAppUrl: null, activationWhatsAppWebUrl: null }
		});

		expect(screen.queryByRole('link', { name: 'Enviar enlace de activación' })).not.toBeInTheDocument();
		expect(screen.getByText('Falta completar el teléfono del paciente')).toBeInTheDocument();
		expect(screen.getByRole('heading', { name: 'Último paso' })).toBeInTheDocument();
	});

	it('no vuelve a advertir después de que el usuario confirmó sin un número utilizable', () => {
		render(Page, {
			data: { ...data, phoneWarningAcknowledged: true }
		});

		expect(screen.queryByRole('link', { name: 'Enviar enlace de activación' })).not.toBeInTheDocument();
		expect(screen.queryByText('Falta completar el teléfono del paciente')).not.toBeInTheDocument();
		expect(screen.queryByRole('heading', { name: 'Último paso' })).not.toBeInTheDocument();
	});

	it('mantiene el fallback para un turno legado creado sin decisión previa', () => {
		render(Page, {
			data: { ...data, activationWhatsAppUrl: null, activationWhatsAppWebUrl: null }
		});

		expect(screen.getByText('Falta completar el teléfono del paciente')).toBeInTheDocument();
	});

	it('no agrega el bloque a una visita normal del detalle', () => {
		render(Page, {
			data: { ...data, justCreated: false }
		});

		expect(screen.queryByRole('heading', { name: 'Último paso' })).not.toBeInTheDocument();
		expect(screen.queryByRole('link', { name: 'Enviar enlace de activación' })).not.toBeInTheDocument();
	});
});

describe('turno cancelado', () => {
	it('no vuelve a ofrecer la cancelación desde el detalle interno', () => {
		render(Page, {
			data: {
				...data,
				appointment: {
					...appointment,
					status: 'cancelled'
				}
			}
		});

		expect(screen.getByText('Cancelado')).toBeInTheDocument();
		expect(screen.queryByText('Cancelar turno')).not.toBeInTheDocument();
	});
});

describe('visibilidad de cancelación por estado y fecha', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-08-22T15:00:00.000Z'));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	const renderAppointment = (overrides: Record<string, unknown> = {}) =>
		render(Page, {
			data: {
				...data,
				justCreated: false,
				appointment: {
					...appointment,
					starts_at: '2026-08-22T16:00:00.000Z',
					ends_at: '2026-08-22T16:30:00.000Z',
					...overrides
				}
			}
		});

	it.each(['reserved', 'confirmed', 'reschedule_requested'] as const)(
		'muestra cancelar para un turno %s activo y futuro',
		(status) => {
			renderAppointment({ status });

			expect(screen.getByText('Cancelar turno', { selector: 'summary' })).toBeInTheDocument();
		}
	);

	it('oculta cancelar cuando el turno ya comenzó, aunque siga reservado', () => {
		renderAppointment({
			starts_at: '2026-08-22T14:59:59.999Z',
			ends_at: '2026-08-22T15:30:00.000Z'
		});

		expect(screen.queryByText('Cancelar turno', { selector: 'summary' })).not.toBeInTheDocument();
	});
});
