import { describe, expect, it } from 'vitest';
import {
	calendarDescriptionFor,
	calendarLocationFor,
	calendarSummaryFor,
	googleCalendarUrlFor,
	icsForAppointment
} from './calendar-content';
import type { PublicAppointmentView } from './public-appointments';

const appointment = (overrides: Partial<PublicAppointmentView> = {}): PublicAppointmentView => ({
	id: 'apt-1',
	token: 'tok-1',
	status: 'reserved',
	starts_at: '2026-06-15T17:30:00.000Z',
	ends_at: '2026-06-15T18:00:00.000Z',
	service_name_snapshot: 'Extracción',
	professional_name_snapshot: 'Dra. Jazmin Lopez',
	professional_count: 1,
	is_joint: false,
	calendar_action_status: 'offered',
	calendar_action_at: null,
	calendar_action_count: 0,
	calendar_sequence: 1,
	calendar_update_required_at: null,
	business: {
		id: 'biz-1',
		name: 'Clínica Sabrina',
		slug: 'clinica-sabrina',
		phone: null,
		address: 'Av. Santa Fe 1234, Piso 3, CABA',
		address_instructions: 'Tocar timbre 4B',
		maps_link: 'https://maps.app.goo.gl/xyz',
		logo_url: null,
		timezone: 'America/Argentina/Cordoba',
		is_active: true,
		cancellation_policy: null
	},
	patient_name: 'Juan Pérez',
	public_status_label: 'Reservado',
	public_actions_available: true,
	can_confirm: true,
	can_cancel: true,
	can_request_reschedule: true,
	is_past: false,
	...overrides
});

const now = new Date('2026-06-11T12:00:00.000Z');

describe('contenido neutral del evento', () => {
	it('does not show a physical address for virtual appointments even if a caller retains it', () => {
		const virtual = appointment({ booking_context: { theme: 'natalia', modality: 'video', videoInstructions: 'Se coordina el acceso.' } });
		expect(calendarLocationFor(virtual)).toBe('Consulta virtual');
		expect(calendarDescriptionFor(virtual)).toContain('Modalidad: Virtual');
		expect(calendarDescriptionFor(virtual)).not.toContain('Av. Santa Fe');
		expect(calendarDescriptionFor(virtual)).not.toContain('maps.app.goo.gl');
	});
	it('el título NUNCA incluye el servicio (privacidad en pantalla bloqueada)', () => {
		const summary = calendarSummaryFor(appointment());
		expect(summary).toBe('Turno en Clínica Sabrina');
		expect(summary).not.toContain('Extracción');
	});

	it('la descripción no incluye servicio ni nombre del paciente', () => {
		const description = calendarDescriptionFor(appointment());
		expect(description).not.toContain('Extracción');
		expect(description).not.toContain('Juan Pérez');
		expect(description).toContain('Hora local del consultorio: 14:30');
		expect(description).toContain('Dirección: Av. Santa Fe 1234, Piso 3, CABA');
		expect(description).toContain('Indicaciones: Tocar timbre 4B');
		expect(description).toContain('Cómo llegar: https://maps.app.goo.gl/xyz');
		expect(description).toContain('Ver turno: ');
		expect(description).toContain('/turno/tok-1');
	});

	it('LOCATION combina dirección e indicaciones', () => {
		expect(calendarLocationFor(appointment())).toBe('Av. Santa Fe 1234, Piso 3, CABA · Tocar timbre 4B');
		expect(calendarLocationFor(appointment({ business: { ...appointment().business, address: null } }))).toBeNull();
	});
});

describe('icsForAppointment', () => {
	it('usa el calendar_sequence del turno y UID estable', () => {
		const ics = icsForAppointment(appointment(), { now });
		expect(ics).toContain('SEQUENCE:1\r\n');
		expect(ics).toContain('UID:appointment-apt-1@');
		expect(ics).toContain('STATUS:CONFIRMED\r\n');
		expect(ics).toContain('METHOD:PUBLISH\r\n');
		expect(ics).toContain('TRIGGER:-PT24H');
	});

	it('turno cancelado: METHOD:CANCEL, SEQUENCE+1, sin alarmas', () => {
		const ics = icsForAppointment(appointment({ status: 'cancelled' }), { now });
		expect(ics).toContain('METHOD:CANCEL\r\n');
		expect(ics).toContain('STATUS:CANCELLED\r\n');
		expect(ics).toContain('SEQUENCE:2\r\n');
		expect(ics).not.toContain('BEGIN:VALARM');
	});

	it('turno pasado: sin alarmas pero evento válido', () => {
		const past = appointment({
			starts_at: '2026-06-01T17:30:00.000Z',
			ends_at: '2026-06-01T18:00:00.000Z',
			is_past: true
		});
		const ics = icsForAppointment(past, { now });
		expect(ics).not.toContain('BEGIN:VALARM');
		expect(ics).toContain('STATUS:CONFIRMED\r\n');
	});
});

describe('googleCalendarUrlFor', () => {
	it('lleva título neutral, fechas UTC y timezone del negocio', () => {
		const url = new URL(googleCalendarUrlFor(appointment()));
		expect(url.searchParams.get('text')).toBe('Turno en Clínica Sabrina');
		expect(url.searchParams.get('dates')).toBe('20260615T173000Z/20260615T180000Z');
		expect(url.searchParams.get('ctz')).toBe('America/Argentina/Cordoba');
	});
});
