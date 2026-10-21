import { describe, expect, it, vi } from 'vitest';
import {
	FollowUpError,
	createFollowUp,
	getFollowUpErrorMessage,
	getFollowUpErrorStatus,
	markFollowUpDone,
	snoozeFollowUp,
	updateFollowUp
} from '$lib/server/patients/public/follow-ups';

/**
 * The database checks the actor, the link, the operation and the version of each
 * change; the server only sends it and translates its refusals. No real database.
 */
const client = (answer: { data?: unknown; error: { message: string } | null }) => {
	const rpc = vi.fn(async () => ({ data: answer.data ?? null, error: answer.error }));
	return { supabase: { rpc } as never, rpc };
};

const change = { businessId: '00000000-0000-4000-8000-000000000001', id: 'follow-up-1', expectedUpdatedAt: '2026-09-04T06:30:15.123Z' };

describe('cambios de seguimientos', () => {
	it('envía la versión observada y traduce el conflicto de la base, sin falso éxito', async () => {
		const { supabase, rpc } = client({ error: { message: 'FOLLOWUP_STATUS_CONFLICT' } });
		await expect(markFollowUpDone(supabase, change)).rejects.toMatchObject({ code: 'FOLLOWUP_STATUS_CONFLICT' });
		expect(rpc).toHaveBeenCalledWith('complete_follow_up', {
			p_business_id: change.businessId, p_follow_up_id: change.id, p_expected_updated_at: change.expectedUpdatedAt
		});
	});

	it('rechaza una acción sin versión observada antes de llegar a la base', async () => {
		const { supabase, rpc } = client({ error: null });
		await expect(snoozeFollowUp(supabase, { ...change, expectedUpdatedAt: null, newRemindOn: '2026-09-10' }))
			.rejects.toMatchObject({ code: 'FOLLOWUP_STATUS_CONFLICT' });
		expect(rpc).not.toHaveBeenCalled();
	});

	it('traduce cada rechazo de la base a su motivo y deja pasar los errores técnicos', async () => {
		const forbidden = client({ error: { message: 'FOLLOWUP_FORBIDDEN' } });
		await expect(updateFollowUp(forbidden.supabase, { ...change, remindOn: '2026-09-10', message: null, assignToProfessionalId: null }))
			.rejects.toBeInstanceOf(FollowUpError);
		const outage = client({ error: { message: 'canceling statement due to statement timeout' } });
		await expect(createFollowUp(outage.supabase, {
			businessId: change.businessId, patientId: 'patient-1', remindOn: '2026-09-10', message: null, assignToProfessionalId: null
		})).rejects.not.toBeInstanceOf(FollowUpError);
	});

	it('no envía una fecha que no es una fecha', async () => {
		const { supabase, rpc } = client({ error: null });
		await expect(createFollowUp(supabase, {
			businessId: change.businessId, patientId: 'patient-1', remindOn: '2026-13-40', message: null, assignToProfessionalId: null
		})).rejects.toMatchObject({ code: 'FOLLOWUP_INVALID_DATE' });
		expect(rpc).not.toHaveBeenCalled();
	});

	it('expone un mensaje humano y un HTTP 409 para el conflicto, y 403 al vencer el acceso', () => {
		expect(getFollowUpErrorStatus('FOLLOWUP_STATUS_CONFLICT')).toBe(409);
		expect(getFollowUpErrorMessage('FOLLOWUP_STATUS_CONFLICT')).toContain('Recargá la lista');
		expect(getFollowUpErrorStatus('FOLLOWUP_ACCESS_EXPIRED')).toBe(403);
	});
});
