import { assertInternalJobRequest } from '$lib/server/internal-jobs';
import { generateReminderDispatches } from '$lib/server/messaging';
import { createSupabaseAdminClient } from '$lib/server/supabase';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, fetch, url }) => {
	const unauthorized = assertInternalJobRequest(request);
	if (unauthorized) return unauthorized;

	const supabase = await createSupabaseAdminClient('odonto', fetch);
	const result = await generateReminderDispatches(supabase, {
		businessId: url.searchParams.get('business_id'),
		limit: Number(url.searchParams.get('limit') ?? 50)
	});
	return json(result);
};
