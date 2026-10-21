import { afterEach, describe, expect, it, vi } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import type { CitaDatabase } from '$lib/types/database';
import { resolveActiveBusiness } from './business';

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

// The typed SDK over simulated HTTP. The contexts function answers with `code`; any
// other request would be another way of building memberships, assistance or access.
function fixture(code: string) {
	const requests: URL[] = [];
	const supabase = createClient<CitaDatabase>('https://supabase.example.test', 'synthetic-key', {
		auth: { persistSession: false, autoRefreshToken: false },
		global: {
			fetch: async (input) => {
				const url = new URL(input instanceof Request ? input.url : String(input));
				requests.push(url);
				if (url.pathname.endsWith('/rpc/list_user_business_contexts'))
					return Response.json(
						{ code, message: 'Could not find the function list_user_business_contexts' },
						{ status: code === 'PGRST202' ? 404 : 400 }
					);
				return Response.json([]);
			}
		}
	});
	return {
		requests,
		resolve: () =>
			resolveActiveBusiness({ supabase, verifiedUserId: 'synthetic-owner', ensureDefault: false })
	};
}

describe('business contexts come only from their SQL contract', () => {
	it.each(['PGRST202', '42883', 'XX000'])(
		'fails with %s instead of resolving the contexts another way',
		async (code) => {
			vi.spyOn(console, 'error').mockImplementation(() => {});
			const { resolve, requests } = fixture(code);
			await expect(resolve()).rejects.toMatchObject({ code });
			expect(requests.map((url) => url.pathname)).toEqual(['/rest/v1/rpc/list_user_business_contexts']);
		}
	);
});
