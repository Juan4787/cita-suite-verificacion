import { describe, expect, it } from 'vitest';
import {
	FollowUpError,
	getFollowUpErrorMessage,
	getFollowUpErrorStatus,
	markFollowUpDone,
	snoozeFollowUp,
	type RoleScope
} from './follow-ups';

/**
 * Simula el contrato mínimo de Supabase para asegurar que una mutación que
 * afecta cero filas no se informe como exitosa. No toca una base real.
 */
const fakeAdmin = (results: Array<{ data: unknown; error: unknown }>) => {
	const queue = [...results];
	const calls: Array<{ operation: string; column?: string; value?: unknown }> = [];
	const builder: any = {
		from: () => builder,
		select: () => {
			calls.push({ operation: 'select' });
			return builder;
		},
		update: () => {
			calls.push({ operation: 'update' });
			return builder;
		},
		eq: (column: string, value: unknown) => {
			calls.push({ operation: 'eq', column, value });
			return builder;
		},
		maybeSingle: async () => queue.shift() ?? { data: null, error: null }
	};
	return { admin: builder, calls };
};

const scope: RoleScope = {
	businessId: '00000000-0000-0000-0000-000000000001',
	role: 'owner',
	professionalId: null
};

describe('mutaciones de seguimientos', () => {
	it('rechaza un marcar-como-gestionado que perdió la carrera y exige status de conflicto', async () => {
		const { admin, calls } = fakeAdmin([
			{
				data: {
					id: 'follow-up-1',
					patient_id: 'patient-1',
					assigned_professional_id: null,
					status: 'pending',
					updated_at: '2026-08-31T12:00:00.000000Z'
				},
				error: null
			},
			{ data: null, error: null }
		]);

		await expect(markFollowUpDone(admin, { ...scope, id: 'follow-up-1', expectedUpdatedAt: '2026-08-31T12:00:00.000000Z' })).rejects.toMatchObject({
			code: 'FOLLOWUP_STATUS_CONFLICT'
		});
		expect(calls.filter((call) => call.operation === 'eq').map((call) => call.column)).toContain(
			'updated_at'
		);
	});

	it('rechaza un posponer que encontró una versión vieja, sin falso éxito', async () => {
		const { admin } = fakeAdmin([
			{
				data: {
					id: 'follow-up-2',
					patient_id: 'patient-2',
					assigned_professional_id: null,
					status: 'pending',
					updated_at: '2026-08-31T12:00:00.000000Z'
				},
				error: null
			},
			{ data: null, error: null }
		]);

		await expect(
			snoozeFollowUp(admin, { ...scope, id: 'follow-up-2', newRemindOn: '2099-01-01', timezone: 'UTC', expectedUpdatedAt: '2026-08-31T12:00:00.000000Z' })
		).rejects.toMatchObject({ code: 'FOLLOWUP_STATUS_CONFLICT' });
	});

	it('rechaza una mutación sin versión observada, aunque la fila siga pendiente', async () => {
		const { admin } = fakeAdmin([
			{
				data: {
					id: 'follow-up-3',
					patient_id: 'patient-3',
					assigned_professional_id: null,
					status: 'pending',
					updated_at: '2026-08-31T12:00:00.000000Z'
				},
				error: null
			}
		]);

		await expect(
			snoozeFollowUp(admin, {
				...scope,
				id: 'follow-up-3',
				newRemindOn: '2099-01-01',
				timezone: 'UTC',
				expectedUpdatedAt: null
			})
		).rejects.toMatchObject({ code: 'FOLLOWUP_STATUS_CONFLICT' });
	});

	it('expone un mensaje humano y un HTTP 409 para el conflicto', () => {
		expect(getFollowUpErrorStatus('FOLLOWUP_STATUS_CONFLICT')).toBe(409);
		expect(getFollowUpErrorMessage('FOLLOWUP_STATUS_CONFLICT')).not.toMatch(/FOLLOWUP_|SQL|HTTP|RPC/);
		expect(new FollowUpError('FOLLOWUP_STATUS_CONFLICT').code).toBe('FOLLOWUP_STATUS_CONFLICT');
	});
});
