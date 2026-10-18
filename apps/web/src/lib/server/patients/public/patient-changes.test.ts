import { describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type { CitaDatabase } from '$lib/types/database';
import { readPatientChanges } from './patient-changes';
import { patientContext, patientId, businessId, userId } from '../__fixtures__/patient-context';

function fixture(failure?: 'patient' | 'events' | 'missing') {
	const requests: URL[] = [];
	const supabase = createClient<CitaDatabase>('https://supabase.example.test', 'synthetic-key', {
		auth: { persistSession: false, autoRefreshToken: false },
		global: {
			fetch: async (input) => {
				const url = new URL(input instanceof Request ? input.url : String(input));
				requests.push(url);
				const patient = url.pathname.endsWith('/patients');
				if ((patient && failure === 'patient') || (!patient && failure === 'events'))
					return Response.json({ code: 'XX000', message: 'PRIVATE_SENTINEL' }, { status: 400 });
				return Response.json(
					patient
						? failure === 'missing'
							? null
							: { id: patientId }
						: [
								{
									id: userId,
									summary: 'Se modificó: teléfono.',
									changed_by_name: 'Synthetic actor',
									changed_fields: ['teléfono'],
									created_at: '2026-01-01T12:00:00Z'
								}
							]
				);
			}
		}
	});
	return { supabase, requests };
}
describe('patient change history with user-scoped SDK and simulated HTTP', () => {
	it.each(['patient', 'events'] as const)(
		'rejects a failed %s read without inventing an absent patient or empty audit',
		async (failure) => {
			const log = vi.spyOn(console, 'error').mockImplementation(() => {});
			const { supabase, requests } = fixture(failure);
			try {
				await expect(
					readPatientChanges({ supabase, patientId, context: patientContext() })
				).rejects.toMatchObject({ kind: 'unavailable' });
				expect(requests).toHaveLength(failure === 'patient' ? 1 : 2);
			} finally {
				log.mockRestore();
			}
		}
	);
	it('never reads the audit when the authenticated patient projection is invisible', async () => {
		const { supabase, requests } = fixture('missing');
		await expect(
			readPatientChanges({ supabase, patientId, context: patientContext() })
		).rejects.toMatchObject({ kind: 'missing' });
		expect(requests).toHaveLength(1);
	});
	it('keeps basic reception access and scopes both reads to the same business and patient', async () => {
		const { supabase, requests } = fixture();
		const context = patientContext();
		context.role = 'reception';
		const result = await readPatientChanges({ supabase, patientId, context });
		expect(result.change_events[0].summary).toBe('Se modificó: teléfono.');
		expect(requests).toHaveLength(2);
		expect(
			requests.every((url) => url.searchParams.get('business_id') === `eq.${businessId}`)
		).toBe(true);
		expect(requests[1].searchParams.get('patient_id')).toBe(`eq.${patientId}`);
		expect(requests[1].searchParams.get('limit')).toBe('5');
	});
});
