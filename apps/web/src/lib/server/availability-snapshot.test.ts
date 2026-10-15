import type { SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import type { Business } from './business';
import { loadInternalAvailabilitySnapshot } from './availability-snapshot';

const business = {
	id: '00000000-0000-0000-0000-000000000001',
	timezone: 'America/Argentina/Buenos_Aires',
	max_booking_days_ahead: 60,
	min_booking_notice_minutes: 0,
	is_active: true,
	public_booking_enabled: true
} as Business;

const rpcPayload = {
	generated_at: '2026-07-25T12:00:00.000Z',
	services: [
		{
			id: 'service-1',
			business_id: business.id,
			name: 'Consulta',
			duration_minutes: 30,
			buffer_before_minutes: 0,
			buffer_after_minutes: 0,
			is_public: true,
			is_active: true,
			sort_order: 0
		}
	],
	professionals: [
		{
			id: 'professional-1',
			name: 'Dra. Uno',
			specialty: null,
			is_public: true,
			is_active: true,
			sort_order: 0
		}
	],
	assignments: [{ service_id: 'service-1', professional_id: 'professional-1' }],
	rules: [],
	exceptions: [],
	blocks: []
};

const fallbackBuilder = (result: { data: unknown[]; error: unknown }) => {
	const builder: Record<string, unknown> = {};
	for (const method of ['select', 'eq', 'order', 'in', 'lt', 'gt']) {
		builder[method] = () => builder;
	}
	(builder as { then: unknown }).then = (
		resolve: (value: unknown) => unknown,
		reject: (reason: unknown) => unknown
	) => Promise.resolve(result).then(resolve, reject);
	return builder;
};

describe('internal availability snapshot', () => {
	it('normaliza una única respuesta RPC y sólo expone datos de agenda', async () => {
		const rpc = vi.fn().mockResolvedValue({ data: rpcPayload, error: null });
		const snapshot = await loadInternalAvailabilitySnapshot(
			{ rpc } as unknown as SupabaseClient,
			{ business, fromDate: '2026-07-25', toDate: '2026-07-26' }
		);

		expect(rpc).toHaveBeenCalledOnce();
		expect(rpc).toHaveBeenCalledWith('get_availability_snapshot', {
			p_business_id: business.id,
			p_from: '2026-07-25T03:00:00.000Z',
			p_to: '2026-07-27T03:00:00.000Z'
		});
		expect(snapshot).toMatchObject({
			schema_version: 1,
			generated_at: rpcPayload.generated_at,
			valid_until: '2026-07-25T12:00:20.000Z',
			from_date: '2026-07-25',
			to_date: '2026-07-26',
			services: rpcPayload.services,
			professionals: rpcPayload.professionals
		});
		expect(snapshot.business).not.toHaveProperty('id');
		expect(JSON.stringify(snapshot)).not.toContain('patient');
	});

	it('usa el respaldo sólo cuando falta la función RPC', async () => {
		const results: Record<string, unknown[]> = {
			services: rpcPayload.services,
			professionals: rpcPayload.professionals,
			professional_services: rpcPayload.assignments,
			availability_rules: [],
			availability_exceptions: [],
			appointment_professionals: []
		};
		const from = vi.fn((table: string) =>
			fallbackBuilder({ data: results[table] ?? [], error: null })
		);
		const supabase = {
			rpc: vi.fn().mockResolvedValue({
				data: null,
				error: { code: 'PGRST202', message: 'function is missing from the schema cache' }
			}),
			from
		} as unknown as SupabaseClient;

		const snapshot = await loadInternalAvailabilitySnapshot(supabase, {
			business,
			fromDate: '2026-07-25',
			toDate: '2026-07-26'
		});

		expect(from.mock.calls.map(([table]) => table)).toEqual([
			'services',
			'professionals',
			'professional_services',
			'availability_rules',
			'availability_exceptions',
			'appointment_professionals'
		]);
		expect(snapshot.services).toEqual(rpcPayload.services);
		expect(snapshot.assignments).toEqual(rpcPayload.assignments);
	});

	it('no oculta errores reales detrás del respaldo', async () => {
		const originalError = { code: '42501', message: 'insufficient privilege' };
		const from = vi.fn();
		const supabase = {
			rpc: vi.fn().mockResolvedValue({ data: null, error: originalError }),
			from
		} as unknown as SupabaseClient;

		await expect(
			loadInternalAvailabilitySnapshot(supabase, {
				business,
				fromDate: '2026-07-25',
				toDate: '2026-07-26'
			})
		).rejects.toBe(originalError);
		expect(from).not.toHaveBeenCalled();
	});

	it('rechaza rangos excesivos antes de consultar la base', async () => {
		const rpc = vi.fn();
		await expect(
			loadInternalAvailabilitySnapshot(
				{ rpc } as unknown as SupabaseClient,
				{ business, fromDate: '2026-07-01', toDate: '2026-08-01' }
			)
		).rejects.toThrow('supera el rango permitido');
		expect(rpc).not.toHaveBeenCalled();
	});

	it('rechaza fechas que parecen ISO pero no existen', async () => {
		const rpc = vi.fn();
		await expect(
			loadInternalAvailabilitySnapshot(
				{ rpc } as unknown as SupabaseClient,
				{ business, fromDate: '2026-02-30', toDate: '2026-03-01' }
			)
		).rejects.toThrow('Rango inválido');
		expect(rpc).not.toHaveBeenCalled();
	});
});
