import { describe, expect, it } from 'vitest';
import {
	filterAgendaAppointmentSnapshot,
	filterAgendaAppointmentsByQuery,
	normalizeSearchText,
	patientMatchesAgendaQuery
} from './agenda-search';

describe('normalizeSearchText', () => {
	it('lowercases, trims, strips diacritics and collapses spaces', () => {
		expect(normalizeSearchText('  María   JOSÉ ')).toBe('maria jose');
		expect(normalizeSearchText('Ñandú')).toBe('nandu');
	});
});

describe('patientMatchesAgendaQuery', () => {
	const patient = { full_name: 'María José Pérez', phone_e164: '+5493515551234' };

	it('matches names by prefix from the first character', () => {
		expect(patientMatchesAgendaQuery(patient, 'M')).toBe(true);
		expect(patientMatchesAgendaQuery(patient, 'mar')).toBe(true);
		expect(patientMatchesAgendaQuery({ full_name: 'Pedro', phone_e164: null }, 'M')).toBe(false);
	});

	it('ignores case and accents in both directions', () => {
		expect(patientMatchesAgendaQuery(patient, 'maría')).toBe(true);
		expect(patientMatchesAgendaQuery(patient, 'maria')).toBe(true);
		expect(patientMatchesAgendaQuery({ full_name: 'Maria', phone_e164: null }, 'marí')).toBe(true);
	});

	it('matches any word of the name by prefix', () => {
		expect(patientMatchesAgendaQuery(patient, 'jose')).toBe(true);
		expect(patientMatchesAgendaQuery(patient, 'perez')).toBe(true);
	});

	it('matches multi-word prefixes of the full name', () => {
		expect(patientMatchesAgendaQuery(patient, 'maria jo')).toBe(true);
		expect(patientMatchesAgendaQuery(patient, 'jose maria')).toBe(false);
	});

	it('does not match fragments in the middle of a word', () => {
		expect(patientMatchesAgendaQuery(patient, 'aria')).toBe(false);
		expect(patientMatchesAgendaQuery(patient, 'rez')).toBe(false);
	});

	it('matches phones by contained digits ignoring formatting', () => {
		expect(patientMatchesAgendaQuery(patient, '3515551234')).toBe(true);
		expect(patientMatchesAgendaQuery(patient, '555 1234')).toBe(true);
		expect(patientMatchesAgendaQuery(patient, '351-555')).toBe(true);
		expect(patientMatchesAgendaQuery(patient, '999999')).toBe(false);
	});

	it('requires at least two digits before matching phones', () => {
		expect(patientMatchesAgendaQuery(patient, '5')).toBe(false);
		expect(patientMatchesAgendaQuery(patient, '55')).toBe(true);
	});

	it('handles empty queries and null fields safely', () => {
		expect(patientMatchesAgendaQuery(patient, '')).toBe(false);
		expect(patientMatchesAgendaQuery(patient, '   ')).toBe(false);
		expect(patientMatchesAgendaQuery({ full_name: null, phone_e164: null }, 'ana')).toBe(false);
	});
});

describe('filterAgendaAppointmentSnapshot', () => {
	const now = new Date('2026-08-23T12:00:00.000Z');
	const appointments = [
		{
			id: 'matching-future',
			starts_at: '2026-08-24T12:00:00.000Z',
			status: 'reserved',
			patients: { full_name: 'Juan Perez', phone_e164: '+5491112345678' }
		},
		{
			id: 'matching-cancelled',
			starts_at: '2026-08-25T12:00:00.000Z',
			status: 'cancelled',
			patients: { full_name: 'Juan Cancelado', phone_e164: null }
		},
		{
			id: 'matching-second',
			starts_at: '2026-08-25T13:00:00.000Z',
			status: 'confirmed',
			patients: { full_name: 'Juanita Gomez', phone_e164: null }
		},
		{
			id: 'other-future',
			starts_at: '2026-08-26T12:00:00.000Z',
			status: 'confirmed',
			patients: { full_name: 'Maria Lopez', phone_e164: '+5491199999999' }
		}
	];

	it('returns no rows before the professional types anything', () => {
		expect(filterAgendaAppointmentSnapshot(appointments, '  ', 60, now)).toEqual([]);
	});

	it('returns only upcoming active matches with the same patient semantics', () => {
		expect(filterAgendaAppointmentSnapshot(appointments, 'ju', 60, now).map(({ id }) => id)).toEqual([
			'matching-future',
			'matching-second'
		]);
		expect(filterAgendaAppointmentSnapshot(appointments, '1234', 60, now).map(({ id }) => id)).toEqual([
			'matching-future'
		]);
	});

	it('keeps the snapshot order and obeys the visible result limit', () => {
		expect(filterAgendaAppointmentSnapshot(appointments, 'ju', 1, now).map(({ id }) => id)).toEqual([
			'matching-future'
		]);
	});
});

describe('filterAgendaAppointmentsByQuery', () => {
	const appointments = [
		{
			id: 'expired-fernando',
			starts_at: '2026-08-25T17:30:00.000Z',
			status: 'reserved',
			patients: { full_name: 'Fernando Lopez', phone_e164: '+5493425048209' }
		},
		{
			id: 'upcoming-juan',
			starts_at: '2026-08-29T08:15:00.000Z',
			status: 'reserved',
			patients: { full_name: 'Juan Carlos Ramirez', phone_e164: '+5493425000000' }
		}
	];

	it('refilters known rows immediately while the authoritative request is pending', () => {
		expect(filterAgendaAppointmentsByQuery(appointments, 'fer').map(({ id }) => id)).toEqual([
			'expired-fernando'
		]);
		expect(filterAgendaAppointmentsByQuery(appointments, 'juan car').map(({ id }) => id)).toEqual([
			'upcoming-juan'
		]);
	});

	it('does not keep stale rows from a previous unrelated query', () => {
		expect(filterAgendaAppointmentsByQuery(appointments, 'ermene')).toEqual([]);
	});
});
