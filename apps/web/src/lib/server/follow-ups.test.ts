import { describe, it, expect } from 'vitest';
import {
	addDaysISO,
	buildNotice,
	businessTodayISO,
	getFollowUpErrorMessage,
	isExecuting,
	isValidISODate,
	mergeAssignableProfessionals,
	roleParticipatesInFollowUps,
	roleSeesAllFollowUps,
	snoozePresetDate,
	type FollowUpListItem
} from './follow-ups';

const item = (id: string, remind_on = '2026-06-15'): FollowUpListItem => ({
	id,
	patient_id: `p-${id}`,
	patient_name: `Paciente ${id}`,
	message: null,
	remind_on,
	assigned_professional_id: null,
	updated_at: '2026-06-14T12:00:00.000Z'
});

describe('businessTodayISO', () => {
	it('usa la tz del negocio, no la del server (día UTC distinto al local)', () => {
		// 2026-06-15 02:00 UTC = 2026-06-14 23:00 en Córdoba (UTC-3)
		const now = new Date('2026-06-15T02:00:00.000Z');
		expect(businessTodayISO('America/Argentina/Cordoba', now)).toBe('2026-06-14');
		expect(businessTodayISO('UTC', now)).toBe('2026-06-15');
	});
});

describe('isValidISODate', () => {
	it('acepta fechas ISO reales y rechaza basura', () => {
		expect(isValidISODate('2026-12-17')).toBe(true);
		expect(isValidISODate('2026-02-30')).toBe(false); // no existe
		expect(isValidISODate('17/12/2026')).toBe(false);
		expect(isValidISODate('')).toBe(false);
	});
});

describe('addDaysISO', () => {
	it('cruza límites de mes/año', () => {
		expect(addDaysISO('2026-06-15', 1)).toBe('2026-06-16');
		expect(addDaysISO('2026-06-30', 1)).toBe('2026-07-01');
		expect(addDaysISO('2026-12-31', 1)).toBe('2027-01-01');
	});
});

describe('snoozePresetDate', () => {
	it('mañana / en 3 días / la semana que viene', () => {
		expect(snoozePresetDate('manana', '2026-06-15')).toBe('2026-06-16');
		expect(snoozePresetDate('tres_dias', '2026-06-15')).toBe('2026-06-18');
		expect(snoozePresetDate('semana', '2026-06-15')).toBe('2026-06-22');
	});
});

describe('roles', () => {
	it('Dueño/Admin/Recepción ven todo; Profesional participa pero scopeado; Lectura no', () => {
		expect(roleSeesAllFollowUps('owner')).toBe(true);
		expect(roleSeesAllFollowUps('admin')).toBe(true);
		expect(roleSeesAllFollowUps('reception')).toBe(true);
		expect(roleSeesAllFollowUps('professional')).toBe(false);
		expect(roleSeesAllFollowUps('readonly')).toBe(false);

		expect(roleParticipatesInFollowUps('professional')).toBe(true);
		expect(roleParticipatesInFollowUps('owner')).toBe(true);
		expect(roleParticipatesInFollowUps('readonly')).toBe(false);
	});
});

describe('mergeAssignableProfessionals', () => {
	it('combina vinculados al paciente con dueños/admins atendibles sin duplicar perfiles', () => {
		const result = mergeAssignableProfessionals(
			[
				{ id: 'pro-linked-b', name: 'Dra. Beatriz', source: 'patient_link' },
				{ id: 'pro-shared', name: 'Dr. Compartido', source: 'patient_link' }
			],
			[
				{ id: 'pro-owner', name: 'Dr. Admin', source: 'owner_admin_attending' },
				{ id: 'pro-shared', name: 'Dr. Compartido', source: 'owner_admin_attending' }
			]
		);

		expect(result).toEqual([
			{ id: 'pro-shared', name: 'Dr. Compartido', source: 'patient_link' },
			{ id: 'pro-linked-b', name: 'Dra. Beatriz', source: 'patient_link' },
			{ id: 'pro-owner', name: 'Dr. Admin', source: 'owner_admin_attending' }
		]);
	});
});

describe('isExecuting', () => {
	it('ejecutándose = remind_on <= hoy', () => {
		expect(isExecuting('2026-06-14', '2026-06-15')).toBe(true); // pasado
		expect(isExecuting('2026-06-15', '2026-06-15')).toBe(true); // hoy
		expect(isExecuting('2026-06-16', '2026-06-15')).toBe(false); // futuro
	});
});

describe('buildNotice', () => {
	it('0 → sin single; 1 → single; 2+ → sólo count', () => {
		expect(buildNotice([], 0)).toEqual({
			count: 0,
			single: null,
			dismissalKey: expect.any(String)
		});

		const one = buildNotice([item('a')], 1);
		expect(one.count).toBe(1);
		expect(one.single?.id).toBe('a');

		const many = buildNotice([], 3, ['a', 'b', 'c']);
		expect(many.count).toBe(3);
		expect(many.single).toBeNull();
		expect(many.dismissalKey).not.toBe(one.dismissalKey);
	});
});

describe('mensajes de error', () => {
	it('explica el objeto y el siguiente paso incluso para un código inesperado', () => {
		const message = getFollowUpErrorMessage('UNKNOWN');
		expect(message).toContain('seguimiento');
		expect(message).toContain('Recargá');
		expect(message).not.toMatch(/FOLLOWUP_|SQL|HTTP|RPC/);
	});
});
