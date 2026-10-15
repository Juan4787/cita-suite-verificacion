import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PATIENT_EXPORT_DATASETS } from '$lib/patient-export/contract';

const rateLimitMocks = vi.hoisted(() => ({ enforceRateLimits: vi.fn() }));

vi.mock('./rate-limits', async (importOriginal) => ({
	...(await importOriginal<typeof import('./rate-limits')>()),
	enforceRateLimits: rateLimitMocks.enforceRateLimits
}));

import { RateLimitExceededError, RateLimitUnavailableError } from './rate-limits';
import {
	PatientExportError,
	decodePatientExportCursor,
	readPatientExportJson,
	readPatientExportPage,
	startPatientExport,
	validatePatientExport
} from './patient-exports';

const exportId = '11111111-1111-4111-8111-111111111111';
const businessId = '22222222-2222-4222-8222-222222222222';
const userId = '33333333-3333-4333-8333-333333333333';
const requestKey = '44444444-4444-4444-8444-444444444444';

const counts = {
	patients: 2,
	custom_fields: 1,
	clinical_entries: 3,
	appointments: 4,
	appointment_professionals: 5,
	follow_ups: 6
};

const sessionResult = {
	ok: true,
	reused: false,
	export_id: exportId,
	scope: 'all_patients',
	patient_id: null,
	schema_version: 'cita-suite-patient-export/v1',
	expected_counts: counts,
	datasets: [...PATIENT_EXPORT_DATASETS],
	business: { name: 'Consultorio', timezone: 'America/Argentina/Buenos_Aires' },
	expires_at: '2026-08-28T00:00:00.000Z',
	status: 'requested'
};

const patientRow = {
	patient_id: exportId,
	full_name: 'Paciente de prueba',
	dni: '00123456',
	phone: '+54 11 4000-0000',
	email: null,
	birth_date: '1990-01-02',
	address: null,
	insurance: null,
	insurance_plan: null,
	allergies: null,
	medication: null,
	background: null,
	clinical_alert_note: null,
	clinical_notes: null,
	status: 'active',
	archived_at: null,
	created_at: '2026-08-27T20:00:00.000Z',
	updated_at: '2026-08-27T20:00:00.000Z'
};

const clientWithRpc = (rpc: ReturnType<typeof vi.fn>) =>
	({ rpc } as unknown as SupabaseClient);

describe('patient export server contract', () => {
	beforeEach(() => {
		rateLimitMocks.enforceRateLimits.mockReset();
		rateLimitMocks.enforceRateLimits.mockResolvedValue(undefined);
	});

	it('rate-limits a global export before starting the database session', async () => {
		const rpc = vi.fn().mockResolvedValue({ data: sessionResult, error: null });
		const result = await startPatientExport({
			supabase: clientWithRpc(rpc),
			businessId,
			actorUserId: userId,
			scope: 'all_patients',
			patientId: null,
			requestKey
		});

		expect(rateLimitMocks.enforceRateLimits).toHaveBeenCalledOnce();
		expect(rateLimitMocks.enforceRateLimits.mock.calls[0]?.[0]).toEqual([
			expect.objectContaining({
				action: 'patient_export_global_by_business',
				subject: businessId,
				limit: 2,
				windowSeconds: 3600
			})
		]);
		expect(rpc).toHaveBeenCalledWith('begin_patient_export', {
			p_actor_user_id: userId,
			p_business_id: businessId,
			p_scope: 'all_patients',
			p_patient_id: null,
			p_request_key: requestKey
		});
		expect(result).toMatchObject({ export_id: exportId, expected_counts: counts });
	});

	it('maps a real rate-limit denial and an unavailable limiter separately', async () => {
		rateLimitMocks.enforceRateLimits.mockRejectedValueOnce(
			new RateLimitExceededError('Esperá antes de volver a intentar.', 75)
		);
		await expect(
			startPatientExport({
				supabase: clientWithRpc(vi.fn()),
				businessId,
				actorUserId: userId,
				scope: 'patient',
				patientId: exportId,
				requestKey
			})
		).rejects.toMatchObject({
			code: 'EXPORT_RATE_LIMITED',
			status: 429,
			retryAfterSeconds: 75,
			userMessage: 'Esperá antes de volver a intentar.'
		});

		rateLimitMocks.enforceRateLimits.mockRejectedValueOnce(new RateLimitUnavailableError());
		await expect(
			startPatientExport({
				supabase: clientWithRpc(vi.fn()),
				businessId,
				actorUserId: userId,
				scope: 'all_patients',
				patientId: null,
				requestKey
			})
		).rejects.toMatchObject({ code: 'EXPORT_RATE_LIMIT_UNAVAILABLE', status: 503 });
	});

	it('converts database rule failures to stable human-safe errors', async () => {
		const rpc = vi.fn().mockResolvedValue({
			data: { ok: false, error_code: 'EXPORT_NOT_AUTHORIZED' },
			error: null
		});
		await expect(
			startPatientExport({
				supabase: clientWithRpc(rpc),
				businessId,
				actorUserId: userId,
				scope: 'all_patients',
				patientId: null,
				requestKey
			})
		).rejects.toMatchObject({
			code: 'EXPORT_NOT_AUTHORIZED',
			userMessage: expect.not.stringMatching(/SQL|PostgREST|uuid|403/i)
		});
	});

	it('keeps cursors opaque and requires complete page metadata', async () => {
		const rpc = vi.fn().mockResolvedValue({
			data: {
				ok: true,
				export_id: exportId,
				dataset: 'patients',
				rows: [{ ...patientRow, technical_secret: 'must-not-cross-boundary' }],
				row_count: 1,
				next_cursor: { id: exportId },
				done: false,
				expires_at: '2026-08-28T00:00:00.000Z'
			},
			error: null
		});

		const page = await readPatientExportPage({
			supabase: clientWithRpc(rpc),
			actorUserId: userId,
			exportId,
			dataset: 'patients',
			cursor: null
		});
		expect(page.next_cursor).not.toContain(exportId);
		expect(page.rows).toEqual([patientRow]);
		expect(page.rows[0]).not.toHaveProperty('technical_secret');
		expect(decodePatientExportCursor(page.next_cursor)).toEqual({ id: exportId });
		expect(rpc).toHaveBeenCalledWith('read_patient_export_page', {
			p_actor_user_id: userId,
			p_export_id: exportId,
			p_dataset: 'patients',
			p_cursor: null,
			p_limit: 100
		});
	});

	it('rejects malformed or contradictory page responses instead of truncating silently', async () => {
		const rpc = vi.fn().mockResolvedValue({
			data: {
				ok: true,
				export_id: exportId,
				dataset: 'patients',
				rows: [],
				row_count: 0,
				next_cursor: null,
				done: false,
				expires_at: '2026-08-28T00:00:00.000Z'
			},
			error: null
		});
		await expect(
			readPatientExportPage({
				supabase: clientWithRpc(rpc),
				actorUserId: userId,
				exportId,
				dataset: 'patients',
				cursor: null
			})
		).rejects.toMatchObject({ code: 'EXPORT_DEPENDENCY_UNAVAILABLE' });
	});

	it.each([
		[
			'custom_fields',
			{
				patient_id: exportId,
				field_key: 'preferencia',
				field_label: 'preferencia',
				value_type: 'string',
				value_text: '001',
				value_json: null
			}
		],
		[
			'clinical_entries',
			{
				clinical_entry_id: exportId,
				patient_id: businessId,
				occurred_at: '2026-08-27T20:00:00.000Z',
				entry_type: 'Consulta',
				description: '=texto',
				teeth: null,
				internal_note: null,
				amount: '12345.67',
				professional_id: null,
				professional_name: null,
				status: 'active',
				archived_at: null,
				created_at: '2026-08-27T20:00:00.000Z',
				updated_at: '2026-08-27T20:00:00.000Z'
			}
		],
		[
			'appointments',
			{
				appointment_id: exportId,
				patient_id: businessId,
				starts_at: '2026-08-27T20:00:00.000Z',
				ends_at: '2026-08-27T20:30:00.000Z',
				status: 'reschedule_requested',
				source: 'manual',
				service_name_snapshot: 'Consulta',
				internal_note: null,
				professional_name_snapshot: 'Dra. Uno',
				confirmed_at: null,
				cancelled_at: null,
				reschedule_requested_at: '2026-08-27T19:00:00.000Z',
				cancelled_reason: null,
				created_at: '2026-08-27T18:00:00.000Z',
				updated_at: '2026-08-27T19:00:00.000Z'
			}
		],
		[
			'appointment_professionals',
			{
				allocation_id: exportId,
				appointment_id: businessId,
				patient_id: userId,
				professional_id: requestKey,
				professional_name: 'Dra. Uno',
				is_primary: true,
				position: 0
			}
		],
		[
			'follow_ups',
			{
				follow_up_id: exportId,
				patient_id: businessId,
				remind_on: '2026-09-01',
				message: '@texto',
				status: 'pending',
				assigned_professional_id: null,
				assigned_professional_name: null,
				done_at: null,
				created_at: '2026-08-27T18:00:00.000Z',
				updated_at: '2026-08-27T19:00:00.000Z'
			}
		]
	] as const)('rebuilds allowlisted %s rows with exact runtime types', async (dataset, row) => {
		const rpc = vi.fn().mockResolvedValue({
			data: {
				ok: true,
				export_id: exportId,
				dataset,
				rows: [{ ...row, unexpected_private_field: 'never-forwarded' }],
				row_count: 1,
				next_cursor: null,
				done: true,
				expires_at: '2026-08-28T00:00:00.000Z'
			},
			error: null
		});
		const page = await readPatientExportPage({
			supabase: clientWithRpc(rpc),
			actorUserId: userId,
			exportId,
			dataset,
			cursor: null
		});
		expect(page.rows).toEqual([row]);
		expect(page.rows[0]).not.toHaveProperty('unexpected_private_field');
	});

	it('fails closed when a database row is missing a contracted field', async () => {
		const rpc = vi.fn().mockResolvedValue({
			data: {
				ok: true,
				export_id: exportId,
				dataset: 'patients',
				rows: [{ ...patientRow, created_at: null }],
				row_count: 1,
				next_cursor: null,
				done: true,
				expires_at: '2026-08-28T00:00:00.000Z'
			},
			error: null
		});
		await expect(
			readPatientExportPage({
				supabase: clientWithRpc(rpc),
				actorUserId: userId,
				exportId,
				dataset: 'patients',
				cursor: null
			})
		).rejects.toMatchObject({ code: 'EXPORT_DEPENDENCY_UNAVAILABLE' });
	});

	it('fails closed on an appointment origin outside the external contract', async () => {
		const rpc = vi.fn().mockResolvedValue({
			data: {
				ok: true,
				export_id: exportId,
				dataset: 'appointments',
				rows: [
					{
						appointment_id: exportId,
						patient_id: businessId,
						starts_at: '2026-08-27T20:00:00.000Z',
						ends_at: '2026-08-27T20:30:00.000Z',
						status: 'reserved',
						source: 'future_internal_source',
						service_name_snapshot: 'Consulta',
						internal_note: null,
						professional_name_snapshot: 'Dra. Uno',
						confirmed_at: null,
						cancelled_at: null,
						reschedule_requested_at: null,
						cancelled_reason: null,
						created_at: '2026-08-27T18:00:00.000Z',
						updated_at: '2026-08-27T19:00:00.000Z'
					}
				],
				row_count: 1,
				next_cursor: null,
				done: true,
				expires_at: '2026-08-28T00:00:00.000Z'
			},
			error: null
		});

		await expect(
			readPatientExportPage({
				supabase: clientWithRpc(rpc),
				actorUserId: userId,
				exportId,
				dataset: 'appointments',
				cursor: null
			})
		).rejects.toMatchObject({ code: 'EXPORT_DEPENDENCY_UNAVAILABLE' });
	});

	it('validates exact received counts before accepting the dataset', async () => {
		const rpc = vi.fn().mockResolvedValue({
			data: { ok: true, validated: true, validated_at: '2026-08-27T23:00:00.000Z' },
			error: null
		});
		await expect(
			validatePatientExport({
				supabase: clientWithRpc(rpc),
				actorUserId: userId,
				exportId,
				receivedCounts: counts
			})
		).resolves.toEqual({ validated: true, validated_at: '2026-08-27T23:00:00.000Z' });
		expect(rpc).toHaveBeenCalledWith('validate_patient_export', {
			p_actor_user_id: userId,
			p_export_id: exportId,
			p_received_counts: counts
		});
	});

	it('rejects oversized and non-object JSON request bodies', async () => {
		await expect(
			readPatientExportJson(
				new Request('https://app.test/export', { method: 'POST', body: '[]' })
			)
		).rejects.toBeInstanceOf(PatientExportError);
		await expect(
			readPatientExportJson(
				new Request('https://app.test/export', {
					method: 'POST',
					body: JSON.stringify({ value: 'x'.repeat(9_000) })
				})
			)
		).rejects.toMatchObject({ code: 'EXPORT_INVALID_REQUEST' });
	});
});
