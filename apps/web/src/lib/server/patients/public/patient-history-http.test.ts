import { describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type { CitaDatabase } from '$lib/types/database';
import { patientContext, patientId, userId } from '../__fixtures__/patient-context';

const mocks = vi.hoisted(() => ({ getContext: vi.fn() }));
vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/server/access/public/odonto-context', () => ({ getOdontoContext: mocks.getContext }));
const { GET } = await import('../../../../routes/odonto/pacientes/[id]/historial/+server');

async function readHistory(options: { costError?: boolean; reception?: boolean } = {}) {
	const requests: URL[] = [];
	const supabase = createClient<CitaDatabase>('https://supabase.example.test', 'synthetic-key', {
		auth: { persistSession: false, autoRefreshToken: false },
		global: {
			fetch: async (request) => {
				const url = new URL(request instanceof Request ? request.url : String(request));
				requests.push(url);
				if (url.pathname.endsWith('/clinical_entries'))
					return Response.json([
						{
							id: userId,
							created_at: '2026-01-01T12:00:00Z',
							entry_type: 'Consulta',
							description: 'Synthetic entry',
							teeth: null,
							internal_note: null,
							created_by_user_id: userId,
							locked_after: null
						}
					]);
				if (url.pathname.endsWith('/clinical_entry_costs'))
					return options.costError
						? Response.json({ code: 'XX000', message: 'PRIVATE_SENTINEL' }, { status: 400 })
						: Response.json([{ clinical_entry_id: userId, amount: 125.5 }]);
				throw new Error('Unexpected history request');
			}
		}
	});
	const context = patientContext();
	if (options.reception) context.role = 'reception';
	mocks.getContext.mockResolvedValueOnce({ supabase, business: context });
	const response = await GET({
		params: { id: patientId },
		url: new URL('https://app.test/history'),
		locals: { auth: { module: 'odonto', access_token: 'synthetic', refresh_token: 'synthetic' } },
		fetch: globalThis.fetch,
		cookies: {}
	} as never);
	return { response, requests };
}

describe('clinical history endpoint with typed SDK and simulated HTTP', () => {
	it('rejects a failed cost read instead of reporting success with a false missing amount', async () => {
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});
		try {
			const { response } = await readHistory({ costError: true });
			expect(response.status).toBe(500);
			const body = await response.json();
			expect(body).not.toHaveProperty('items');
			expect(JSON.stringify(body)).not.toMatch(/PRIVATE_SENTINEL|XX000/);
		} finally {
			log.mockRestore();
		}
	});
	it('preserves actual decimal clinical costs and terminates the page explicitly', async () => {
		const { response, requests } = await readHistory();
		expect(response.status).toBe(200);
		expect(await response.json()).toMatchObject({
			items: [{ amount: 125.5 }],
			has_more: false,
			next_cursor_created_at: null,
			next_cursor_id: null
		});
		expect(requests).toHaveLength(2);
	});
	it('keeps reception outside clinical history before any table request', async () => {
		const { response, requests } = await readHistory({ reception: true });
		expect(response.status).toBe(403);
		expect(requests).toEqual([]);
	});
});
