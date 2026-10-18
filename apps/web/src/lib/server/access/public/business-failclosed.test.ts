import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type { CitaDatabase } from '$lib/types/database';
import { demoBusinessContext, resolveActiveBusiness } from './business';

vi.mock('$lib/server/platform/supabase', async () => {
	const actual = await vi.importActual<typeof import('$lib/server/platform/supabase')>(
		'$lib/server/platform/supabase'
	);
	return {
		...actual,
		createSupabaseAdminClient: vi
			.fn()
			.mockRejectedValue(new Error('Synthetic unavailable admin client'))
	};
});
afterEach(() => vi.restoreAllMocks());

function fixture(options: { subscriptionError?: string; contextError?: string } = {}) {
	const requests: URL[] = [];
	const supabase = createClient<CitaDatabase>('https://supabase.example.test', 'synthetic-key', {
		auth: { persistSession: false, autoRefreshToken: false },
		global: {
			fetch: async (input) => {
				const url = new URL(input instanceof Request ? input.url : String(input));
				requests.push(url);
				if (url.pathname.endsWith('/rpc/list_user_business_contexts'))
					return Response.json(
						{
							code: options.contextError ?? 'PGRST202',
							message: options.contextError
								? 'list_user_business_contexts technical failure'
								: 'Could not find the function list_user_business_contexts'
						},
						{ status: 400 }
					);
				if (url.pathname.endsWith('/business_users'))
					return Response.json([{ role: 'owner', business: demoBusinessContext().business }]);
				if (url.pathname.endsWith('/account_assistance_grants')) return Response.json([]);
				if (url.pathname.endsWith('/business_subscriptions'))
					return Response.json(
						{
							code: options.subscriptionError ?? 'XX000',
							message: 'Synthetic subscription failure'
						},
						{ status: 400 }
					);
				throw new Error('Unexpected business context request');
			}
		}
	});
	return {
		requests,
		resolve: () =>
			resolveActiveBusiness({ supabase, verifiedUserId: 'synthetic-owner', ensureDefault: false })
	};
}
describe('legacy business context compatibility with typed SDK and simulated HTTP', () => {
	it.each(['XX000', '42501'])(
		'does not grant legacy access when subscription read fails with %s',
		async (code) => {
			vi.spyOn(console, 'error').mockImplementation(() => {});
			await expect(fixture({ subscriptionError: code }).resolve()).rejects.toMatchObject({ code });
		}
	);
	it('preserves legacy schema compatibility only when the subscription table is actually absent', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		expect(await fixture({ subscriptionError: 'PGRST205' }).resolve()).toMatchObject({
			access: { canUseBusiness: true }
		});
	});
	it('does not enter legacy resolution on a technical RPC error merely mentioning its function name', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const { resolve, requests } = fixture({ contextError: 'XX000' });
		await expect(resolve()).rejects.toMatchObject({ code: 'XX000' });
		expect(requests).toHaveLength(1);
	});
});
