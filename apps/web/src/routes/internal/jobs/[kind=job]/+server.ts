import { assertInternalJobRequest } from '$lib/server/integrations/public/internal-jobs';
import { runScheduledJob } from '$lib/server/integrations/public/scheduled-jobs';
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

// One job category per request, started by the scheduler Worker through its Service
// Binding. The receipt tells the scheduler whether the run completed.
export const POST: RequestHandler = async ({ request, params, fetch }) => {
	const unauthorized = assertInternalJobRequest(request);
	if (unauthorized) return unauthorized;
	const receipt = await runScheduledJob(params.kind, fetch, {
		scheduledTime: request.headers.get('x-cita-scheduled-time')
	});
	return json(receipt, { status: receipt.ok ? 200 : 500 });
};
