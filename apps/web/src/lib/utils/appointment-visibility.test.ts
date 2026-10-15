import { describe, expect, it } from 'vitest';
import {
	ACTIVE_APPOINTMENT_STATUSES,
	getAgendaExpiredCutoff,
	isActiveAppointmentStatus,
	isExpiredActiveAppointment,
	splitActiveAppointmentGroups,
	isUpcomingActiveAppointment
} from './appointment-visibility';

const now = new Date('2026-08-22T15:00:00.000Z');

describe('upcoming active appointments', () => {
	it('defines the only statuses that remain operationally active', () => {
		expect(ACTIVE_APPOINTMENT_STATUSES).toEqual([
			'reserved',
			'confirmed',
			'reschedule_requested'
		]);
		expect(isActiveAppointmentStatus('cancelled')).toBe(false);
		expect(isActiveAppointmentStatus('attended')).toBe(false);
		expect(isActiveAppointmentStatus('no_show')).toBe(false);
	});

	it('keeps only active appointments at or after the current instant', () => {
		expect(
			isUpcomingActiveAppointment(
				{ starts_at: '2026-08-22T15:00:00.000Z', status: 'reserved' },
				now
			)
		).toBe(true);
		expect(
			isUpcomingActiveAppointment(
				{ starts_at: '2026-08-22T14:59:59.999Z', status: 'confirmed' },
				now
			)
		).toBe(false);
		expect(
			isUpcomingActiveAppointment(
				{ starts_at: '2026-08-23T15:00:00.000Z', status: 'cancelled' },
				now
			)
		).toBe(false);
		expect(isUpcomingActiveAppointment({ starts_at: 'invalid', status: 'reserved' }, now)).toBe(
			false
		);
	});
});

describe('expired active appointments', () => {
	it('uses a three-calendar-month window and includes the exact cutoff', () => {
		const endOfMay = new Date('2026-05-31T15:00:00.000Z');

		expect(getAgendaExpiredCutoff(endOfMay).toISOString()).toBe('2026-02-28T15:00:00.000Z');
		expect(
			isExpiredActiveAppointment(
				{ starts_at: '2026-02-28T15:00:00.000Z', status: 'reserved' },
				endOfMay
			)
		).toBe(true);
		expect(
			isExpiredActiveAppointment(
				{ starts_at: '2026-02-28T14:59:59.999Z', status: 'reserved' },
				endOfMay
			)
		).toBe(false);
	});

	it('only marks active appointments that have already started', () => {
		const now = new Date('2026-08-22T15:00:00.000Z');

		expect(
			isExpiredActiveAppointment(
				{ starts_at: '2026-08-22T14:59:59.999Z', status: 'confirmed' },
				now
			)
		).toBe(true);
		expect(
			isExpiredActiveAppointment(
				{ starts_at: '2026-08-22T15:00:00.000Z', status: 'reserved' },
				now
			)
		).toBe(false);
		expect(
			isExpiredActiveAppointment(
				{ starts_at: '2026-08-21T15:00:00.000Z', status: 'cancelled' },
				now
			)
		).toBe(false);
		expect(
			isExpiredActiveAppointment(
				{ starts_at: '2025-08-21T15:00:00.000Z', status: 'reserved' },
				now
			)
		).toBe(false);
	});

	it('puts upcoming appointments before recent expired ones and excludes old history', () => {
		const now = new Date('2026-08-22T15:00:00.000Z');
		const expired = { id: 'expired', starts_at: '2026-08-22T14:00:00.000Z', status: 'reserved' };
		const olderExpired = { id: 'older-expired', starts_at: '2026-08-21T14:00:00.000Z', status: 'confirmed' };
		const upcoming = { id: 'upcoming', starts_at: '2026-08-22T16:00:00.000Z', status: 'confirmed' };
		const laterUpcoming = { id: 'later-upcoming', starts_at: '2026-08-23T16:00:00.000Z', status: 'reserved' };
		const tooOld = { id: 'too-old', starts_at: '2025-08-01T12:00:00.000Z', status: 'reserved' };

		expect(
			splitActiveAppointmentGroups(
				[expired, laterUpcoming, tooOld, olderExpired, upcoming],
				now
			)
		).toEqual({
			upcoming: [upcoming, laterUpcoming],
			past: [expired, olderExpired]
		});
	});
});
