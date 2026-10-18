import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type { CitaDatabase } from '$lib/types/database';
import { businessId, patientId, patientContext } from '../__fixtures__/patient-context';
import { setPatientArchived } from './patient-archive';

afterEach(() => vi.restoreAllMocks());
function clientFor(response: Response) {
	const calls: { path: string; body: unknown }[] = [];
	const supabase = createClient<CitaDatabase>('https://supabase.example.test', 'synthetic-key', {
		auth: { persistSession: false, autoRefreshToken: false },
		global: {
			fetch: async (input, init) => {
				calls.push({
					path: new URL(input instanceof Request ? input.url : String(input)).pathname,
					body: typeof init?.body === 'string' ? JSON.parse(init.body) : null
				});
				return response;
			}
		}
	});
	return { supabase, calls };
}
describe('patient archive operation with typed SDK and simulated HTTP', () => {
	it.each(['owner', 'admin', 'professional'] as const)(
		'delegates %s scope to the authenticated atomic RPC',
		async (role) => {
			const context = patientContext();
			context.role = role;
			const { supabase, calls } = clientFor(new Response(null, { status: 204 }));
			await setPatientArchived({ supabase, context, patientId, archived: true });
			expect(calls).toEqual([
				{
					path: '/rest/v1/rpc/set_patient_archive_state_safely',
					body: {
						p_business_id: businessId,
						p_patient_id: patientId,
						p_archived: true
					}
				}
			]);
		}
	);
	it('restores through the same actor-scoped operation', async () => {
		const { supabase, calls } = clientFor(new Response(null, { status: 204 }));
		await setPatientArchived({ supabase, context: patientContext(), patientId, archived: false });
		expect(calls[0].body).toMatchObject({ p_archived: false });
	});
	it.each(['reception', 'readonly'] as const)(
		'rejects %s without making a request',
		async (role) => {
			const context = patientContext();
			context.role = role;
			const { supabase, calls } = clientFor(new Response(null, { status: 204 }));
			await expect(
				setPatientArchived({ supabase, context, patientId, archived: true })
			).rejects.toMatchObject({ kind: 'forbidden' });
			expect(calls).toEqual([]);
		}
	);
	it('propagates fresh SQL denial and never falls back to an administrative table write', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const context = patientContext();
		context.role = 'professional';
		const { supabase, calls } = clientFor(
			Response.json({ code: 'P0001', message: 'PATIENT_ARCHIVE_DENIED' }, { status: 400 })
		);
		await expect(
			setPatientArchived({ supabase, context, patientId, archived: true })
		).rejects.toMatchObject({
			kind: 'forbidden',
			message: 'No tenés permiso para archivar este paciente.'
		});
		expect(calls).toHaveLength(1);
	});
	it('keeps a technical failure distinct from success without exposing its details', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const { supabase, calls } = clientFor(
			Response.json({ code: 'XX000', message: 'PRIVATE_SENTINEL' }, { status: 500 })
		);
		await expect(
			setPatientArchived({ supabase, context: patientContext(), patientId, archived: true })
		).rejects.toMatchObject({
			kind: 'unavailable',
			message: 'No se pudo actualizar el estado de la ficha. Intentá de nuevo.'
		});
		expect(calls).toHaveLength(1);
	});
});
