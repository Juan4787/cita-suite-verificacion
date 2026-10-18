import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type { CitaDatabase } from '$lib/types/database';
import { getProfessionalDependencies, deleteProfessional } from './professional-lifecycle';
import { createProfessionalService } from './service-editor';
const business = 'e8900000-0000-4000-8000-000000000001',
	professional = 'e8900000-0000-4000-8000-000000000002';
afterEach(() => vi.restoreAllMocks());
function sdk(reply: (path: string, body: Record<string, unknown>) => Response) {
	const calls: { path: string; body: Record<string, unknown> }[] = [];
	const client = createClient<CitaDatabase>('https://supabase.example.test', 'synthetic-key', {
		auth: { persistSession: false, autoRefreshToken: false },
		global: {
			fetch: async (input, init) => {
				const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
				const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
				calls.push({ path, body });
				return reply(path, body);
			}
		}
	});
	return { client, calls };
}
describe('team lifecycle operations with real SDK and simulated HTTP', () => {
	it('creates and assigns in one authenticated call and validates its returned identity', async () => {
		const { client, calls } = sdk((_path, body) => Response.json(body.p_service_id));
		const form = new FormData();
		form.set('name', 'Prestación sintética');
		form.set('duration_minutes', '30');
		const result = await createProfessionalService(client, business, professional, form);
		expect(result.ok).toBe(true);
		expect(calls).toHaveLength(1);
		expect(calls[0]).toMatchObject({
			path: '/rest/v1/rpc/create_professional_service_safely',
			body: {
				p_business_id: business,
				p_professional_id: professional,
				p_name: 'Prestación sintética',
				p_duration_minutes: 30
			}
		});
		if (result.ok) expect(result.data?.serviceId).toBe(calls[0].body.p_service_id);
	});
	it('does not report a successful creation with a malformed confirmation or retry via table writes', async () => {
		const { client, calls } = sdk(() => Response.json({ id: 'unknown' }));
		const form = new FormData();
		form.set('name', 'Prestación sintética');
		form.set('duration_minutes', '30');
		expect(await createProfessionalService(client, business, professional, form)).toMatchObject({
			ok: false,
			status: 500
		});
		expect(calls).toHaveLength(1);
	});
	it.each([
		{ rows: [] },
		{ rows: [{}] },
		{ rows: [{ appointment_count: 0, clinical_entry_count: 0, follow_up_count: '0' }] }
	])('rejects incomplete count projection %j', async ({ rows }) => {
		const { client, calls } = sdk(() => Response.json(rows));
		expect(await getProfessionalDependencies(client, business, professional)).toMatchObject({
			ok: false,
			status: 503
		});
		expect(calls).toHaveLength(1);
	});
	it('reads the complete dependency projection as informational data', async () => {
		const counts = { appointment_count: 2, clinical_entry_count: 3, follow_up_count: 1 };
		const { client, calls } = sdk(() => Response.json([counts]));
		expect(await getProfessionalDependencies(client, business, professional)).toEqual({
			ok: true,
			data: counts
		});
		expect(calls[0].path).toBe('/rest/v1/rpc/get_professional_dependency_counts');
	});
	it.each([
		['P0001', 'TEAM_PROFESSIONAL_HAS_HISTORY', 409],
		['P0001', 'TEAM_ACCESS_DENIED', 403],
		['55P03', 'PRIVATE_SENTINEL', 409]
	])(
		'keeps %s / %s deletion failure recoverable without administrative cleanup',
		async (code, message, status) => {
			vi.spyOn(console, 'error').mockImplementation(() => {});
			const { client, calls } = sdk(() => Response.json({ code, message }, { status: 400 }));
			const result = await deleteProfessional(client, business, professional);
			expect(result).toMatchObject({ ok: false, status });
			expect(JSON.stringify(result)).not.toContain('PRIVATE_SENTINEL');
			expect(calls).toEqual([
				{
					path: '/rest/v1/rpc/delete_professional_safely',
					body: { p_business_id: business, p_professional_id: professional }
				}
			]);
		}
	);
});
