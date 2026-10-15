import { assertInternalJobRequest } from '$lib/server/internal-jobs';
import { processQueuedMessageDispatches } from '$lib/server/messaging';
import { createSupabaseAdminClient } from '$lib/server/supabase';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, fetch, url }) => {
	const unauthorized = assertInternalJobRequest(request);
	if (unauthorized) return unauthorized;

	const supabase = await createSupabaseAdminClient('odonto', fetch);
	const result = await processQueuedMessageDispatches(supabase, {
		limit: Number(url.searchParams.get('limit') ?? 20)
	});
	return json(result);
};
