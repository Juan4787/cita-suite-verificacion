/** @vitest-environment jsdom */
import { cleanup, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';
import type { PublicAppointmentView } from '$lib/scheduling/public-appointment';
import RescheduleNoticePage from './RescheduleNoticePage.svelte';

afterEach(() => cleanup());

// Only what the page reads; the patient's pages name the practice and never the software (plan 12.35).
const appointment = {
	id: 'a1', token: 'a'.repeat(64), status: 'reserved', starts_at: '2026-11-20T15:00:00.000Z', ends_at: '2026-11-20T15:30:00.000Z',
	service_name_snapshot: 'Consulta', professional_name_snapshot: 'Dra. Sintética', professional_count: 1, is_joint: false,
	business: { id: 'b1', name: 'Consultorio Ramirez', slug: 'ramirez', phone: null, address: 'Calle 123', address_instructions: null,
		maps_link: null, logo_url: null, timezone: 'America/Argentina/Buenos_Aires', is_active: true, cancellation_policy: null, whatsapp_contact_phone: null }
} as unknown as PublicAppointmentView;

describe('título de la pestaña del turno actualizado', () => {
	it('nombra al consultorio', () => {
		render(RescheduleNoticePage, { data: { appointment, active: true, demo: false } });
		expect(document.title).toBe('Tu turno actualizado · Consultorio Ramirez');
	});
	it('con el enlace vencido dice que no está disponible, sin nombrar a nadie', () => {
		render(RescheduleNoticePage, { data: { appointment: null, active: false, demo: false } });
		expect(document.title).toBe('Enlace no disponible');
	});
});
