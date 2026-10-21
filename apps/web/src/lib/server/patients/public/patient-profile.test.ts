import { describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type { CitaDatabase } from '$lib/types/database';
import { businessId, patientId, userId, patientContext } from '../__fixtures__/patient-context';
import { parsePatientProfileUpdate, updatePatientProfile } from './patient-profile';

const revision = '2026-01-01T12:00:00Z';
const currentPatient = () => ({
	full_name: 'Synthetic original',
	dni: null,
	phone: null,
	email: null,
	birth_date: null,
	address: null,
	insurance: null,
	insurance_plan: null,
	updated_at: revision
});
function fixture(
	options: {
		duplicate?: boolean;
		profileError?: boolean;
		rpcDenied?: boolean;
	} = {}
) {
	const requests: { url: URL; body: Record<string, unknown> | null }[] = [];
	const admin = createClient<CitaDatabase>('https://supabase.example.test', 'synthetic-key', {
		auth: { persistSession: false, autoRefreshToken: false },
		global: {
			fetch: async (request, init) => {
				const url = new URL(request instanceof Request ? request.url : String(request));
				requests.push({ url, body: typeof init?.body === 'string' ? JSON.parse(init.body) : null });
				const table = url.pathname.split('/').at(-1);
				if (table === 'patients')
					return Response.json(
						url.searchParams.has('dni')
							? options.duplicate
								? { id: userId }
								: null
							: currentPatient()
					);
				if (table === 'patient_clinical_profiles')
					return options.profileError
						? Response.json(
								{ code: 'XX000', message: 'Synthetic failure private details' },
								{ status: 400 }
							)
						: Response.json({
								allergies: 'Synthetic original allergy',
								medication: null,
								background: null,
								updated_at: revision
							});
				if (table === 'update_patient_with_clinical_profile_safely')
					return options.rpcDenied
						? Response.json(
								{ code: 'P0001', message: 'PATIENT_UPDATE_DENIED private data' },
								{ status: 400 }
							)
						: Response.json([{ patient_id: patientId }]);
				throw new Error('Unexpected patient profile request');
			}
		}
	});
	const input = parsePatientProfileUpdate({
		full_name: 'Synthetic updated',
		expected_patient_updated_at: revision,
		expected_clinical_profile_updated_at: revision,
		allergies: 'Synthetic updated allergy'
	});
	return { admin, input, requests, context: patientContext(), ownerId: userId, patientId };
}

describe('patient profile operation with typed SDK and simulated HTTP', () => {
	it('saves the change and its history line in one atomic call, with current revisions, actor and tenant', async () => {
		const state = fixture();
		await updatePatientProfile(state);
		const calls = state.requests.filter((r) => r.url.pathname.includes('/rpc/'));
		expect(calls).toHaveLength(1);
		expect(calls[0].body).toMatchObject({
			p_actor_id: userId,
			p_business_id: businessId,
			p_patient_id: patientId,
			p_expected_patient_updated_at: revision,
			p_expected_clinical_profile_updated_at: revision,
			p_update_clinical_profile: true,
			p_allergies: 'Synthetic updated allergy',
			p_changed_fields: ['nombre', 'alergias'],
			p_change_summary: 'Se modificó: nombre y alergias.',
			p_changed_by_professional_id: null,
			p_changed_by_name: 'Dueño'
		});
		// The history line is never written apart, where a failure could lose it.
		expect(state.requests.some((r) => r.url.pathname.endsWith('/patient_profile_change_events'))).toBe(false);
	});
	it('returns a resolvable duplicate conflict before mutation instead of swallowing the domain failure as an outage', async () => {
		const state = fixture({ duplicate: true });
		state.input.dni = 'synthetic-dni';
		state.input.updates.dni = 'synthetic-dni';
		await expect(updatePatientProfile(state)).rejects.toMatchObject({
			kind: 'conflict',
			feedback: {
				duplicate: true,
				duplicateField: 'dni',
				existingId: userId
			}
		});
		expect(state.requests).toHaveLength(1);
	});
	it('rejects a stale editable projection before invoking the RPC', async () => {
		const state = fixture();
		state.input.expectedPatientUpdatedAt = '2025-01-01T12:00:00Z';
		await expect(updatePatientProfile(state)).rejects.toMatchObject({
			kind: 'conflict',
			feedback: { currentPatientUpdatedAt: revision }
		});
		expect(state.requests.some((r) => r.url.pathname.includes('/rpc/'))).toBe(false);
	});
	it('does not clear the clinical profile when its current read failed', async () => {
		const output = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			const state = fixture({ profileError: true });
			await expect(updatePatientProfile(state)).rejects.toMatchObject({ kind: 'unavailable' });
			expect(state.requests.some((r) => r.url.pathname.includes('/rpc/'))).toBe(false);
			expect(JSON.stringify(output.mock.calls)).not.toContain('private');
		} finally {
			output.mockRestore();
		}
	});
	it('preserves reception permissions even if clinical values are supplied in the form', async () => {
		const state = fixture();
		state.context.role = 'reception';
		await updatePatientProfile(state);
		expect(state.requests.find((r) => r.url.pathname.includes('/rpc/'))?.body).toMatchObject({
			p_update_clinical_profile: false,
			p_allergies: null,
			p_medication: null,
			p_background: null,
			p_expected_clinical_profile_updated_at: null
		});
	});
	it('honors SQL permission revalidation without recording a successful change', async () => {
		const output = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			const state = fixture({ rpcDenied: true });
			await expect(updatePatientProfile(state)).rejects.toMatchObject({ kind: 'forbidden' });
			expect(
				state.requests.some((r) => r.url.pathname.endsWith('/patient_profile_change_events'))
			).toBe(false);
			expect(JSON.stringify(output.mock.calls)).not.toContain('private');
		} finally {
			output.mockRestore();
		}
	});
});
