import { describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type { CitaDatabase } from '$lib/types/database';
import { businessId, patientId, userId, patientContext } from '../__fixtures__/patient-context';
import {
	createClinicalEntry,
	updateClinicalEntry,
	parseClinicalEntryInput
} from './clinical-entries';
import { PatientOperationError } from './patient-operation-error';

const input = () =>
	parseClinicalEntryInput({
		entryType: 'Consulta',
		description: 'Synthetic entry',
		createdAt: '2026-01-15T09:30',
		teeth: '',
		amount: '25000',
		internalNote: ''
	});
const saved = () => ({
	id: userId,
	patient_id: patientId,
	created_at: '2026-01-15T09:30:00Z',
	entry_type: 'Consulta',
	description: 'Synthetic entry',
	teeth: null,
	internal_note: null,
	created_by_user_id: userId,
	locked_after: null,
	amount: 25000
});
function clientFor(response: () => Response) {
	const requests: { path: string; body: unknown }[] = [];
	const supabase = createClient<CitaDatabase>('https://supabase.example.test', 'synthetic-key', {
		auth: { persistSession: false, autoRefreshToken: false },
		global: {
			fetch: async (request, init) => {
				const url = new URL(request instanceof Request ? request.url : String(request));
				requests.push({
					path: url.pathname,
					body: typeof init?.body === 'string' ? JSON.parse(init.body) : null
				});
				return response();
			}
		}
	});
	return { supabase, requests };
}

describe('clinical operations through typed SDK with simulated HTTP', () => {
	it('preserves a historical canonical fractional clinical amount instead of stripping its decimal point', () => {
		expect(
			parseClinicalEntryInput({
				entryType: 'Consulta',
				description: 'Synthetic historical amount',
				createdAt: '2026-01-15T09:30',
				teeth: '',
				amount: '125.5',
				internalNote: ''
			}).amount
		).toBe(125.5);
	});
	it('sends the accepted clinical date when editing instead of silently ignoring the field', async () => {
		const { supabase, requests } = clientFor(() => new Response(null, { status: 204 }));
		const value = input();
		await updateClinicalEntry({
			supabase,
			context: patientContext(),
			patientId,
			entryId: userId,
			input: value
		});
		expect(requests).toHaveLength(1);
		expect(requests[0].body).toMatchObject({ p_created_at: value.created_at });
	});
	it('creates through the atomic RPC and returns the saved patient entry', async () => {
		const { supabase, requests } = clientFor(() => Response.json(saved()));
		const value = input();
		const result = await createClinicalEntry({
			supabase,
			context: patientContext(),
			patientId,
			input: value
		});
		expect(result).toEqual(saved());
		expect(requests).toEqual([
			{
				path: '/rest/v1/rpc/create_clinical_entry_with_result_safely',
				body: {
					p_business_id: businessId,
					p_patient_id: patientId,
					p_entry_type: 'Consulta',
					p_description: 'Synthetic entry',
					p_created_at: value.created_at,
					p_teeth: null,
					p_internal_note: null,
					p_amount: 25000
				}
			}
		]);
	});
	it('denies non-clinical roles and cost writes before any RPC', async () => {
		const { supabase, requests } = clientFor(() => Response.json(saved()));
		const context = patientContext();
		context.role = 'reception';
		await expect(
			createClinicalEntry({ supabase, context, patientId, input: input() })
		).rejects.toMatchObject({ kind: 'forbidden' });
		context.role = 'professional';
		await expect(
			createClinicalEntry({ supabase, context, patientId, input: input() })
		).rejects.toMatchObject({ kind: 'forbidden' });
		expect(requests).toEqual([]);
	});
	it('honors SQL revalidation after the request context was resolved', async () => {
		const output = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			const { supabase, requests } = clientFor(() =>
				Response.json(
					{ code: 'P0001', message: 'CLINICAL_ENTRY_DENIED private payload', details: 'private' },
					{ status: 400 }
				)
			);
			await expect(
				createClinicalEntry({ supabase, context: patientContext(), patientId, input: input() })
			).rejects.toMatchObject({
				kind: 'forbidden',
				message: 'Tu rol no permite modificar la historia clinica de este paciente.'
			});
			expect(requests).toHaveLength(1);
			expect(JSON.stringify(output.mock.calls)).not.toContain('private');
		} finally {
			output.mockRestore();
		}
	});
	it.each([null, { ...saved(), patient_id: 'another-patient' }])(
		'requests reload after an unusable committed result without sending another insert',
		async (body) => {
			const output = vi.spyOn(console, 'error').mockImplementation(() => {});
			try {
				const { supabase, requests } = clientFor(() => Response.json(body));
				await expect(
					createClinicalEntry({ supabase, context: patientContext(), patientId, input: input() })
				).resolves.toBeNull();
				expect(requests).toHaveLength(1);
			} finally {
				output.mockRestore();
			}
		}
	);
	it('updates with the compatible date-aware RPC and preserves its scope', async () => {
		const { supabase, requests } = clientFor(() => new Response(null, { status: 204 }));
		await updateClinicalEntry({
			supabase,
			context: patientContext(),
			patientId,
			entryId: userId,
			input: input()
		});
		expect(requests).toEqual([
			{
				path: '/rest/v1/rpc/update_clinical_entry_with_date_safely',
				body: {
					p_business_id: businessId,
					p_patient_id: patientId,
					p_entry_id: userId,
					p_entry_type: 'Consulta',
					p_description: 'Synthetic entry',
					p_created_at: input().created_at,
					p_teeth: null,
					p_internal_note: null,
					p_amount: 25000
				}
			}
		]);
	});
	it('rejects impossible calendar dates and retains custom text labels without a type assertion', () => {
		const raw = {
			entryType: 'Custom historical label',
			description: 'Synthetic entry',
			createdAt: '2026-02-30T09:30',
			teeth: '',
			amount: '',
			internalNote: ''
		};
		expect(() => parseClinicalEntryInput(raw)).toThrow(PatientOperationError);
		raw.createdAt = '2024-02-29T09:30';
		expect(parseClinicalEntryInput(raw).entry_type).toBe('Custom historical label');
	});
	it('uses the practice timezone instead of the server zone and rejects a nonexistent local DST hour', () => {
		const raw = {
			entryType: 'Consulta',
			description: 'Synthetic time',
			createdAt: '2026-01-15T09:30',
			teeth: '',
			amount: '',
			internalNote: ''
		};
		expect(parseClinicalEntryInput(raw, 'America/Argentina/Buenos_Aires').created_at).toBe(
			'2026-01-15T12:30:00.000Z'
		);
		expect(parseClinicalEntryInput(raw, 'UTC').created_at).toBe('2026-01-15T09:30:00.000Z');
		expect(() =>
			parseClinicalEntryInput({ ...raw, createdAt: '2026-03-08T02:30' }, 'America/New_York')
		).toThrow(PatientOperationError);
	});
});
