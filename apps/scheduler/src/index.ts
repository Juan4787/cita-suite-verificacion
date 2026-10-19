import { isScheduledJobReceipt, type ScheduledJobReceipt } from '@cita-suite/shared/scheduled-jobs';
import { jobForEvent } from './schedule.ts';

// Small dedicated trigger. It holds no business rules and no Supabase or provider
// credentials: each scheduled event asks the app Worker, through its Service Binding,
// to run exactly one job category and waits for the receipt.
export interface Env {
	APP: Pick<Fetcher, 'fetch'>;
	INTERNAL_JOB_SECRET: string;
}

export async function runScheduledJob(cron: string, scheduledTime: number, env: Env): Promise<ScheduledJobReceipt> {
	const kind = jobForEvent(cron, scheduledTime);
	const response = await env.APP.fetch(`https://scheduler.cita-suite.internal/internal/jobs/${kind}`, {
		method: 'POST',
		headers: {
			authorization: `Bearer ${env.INTERNAL_JOB_SECRET}`,
			'x-cita-scheduled-time': new Date(scheduledTime).toISOString()
		}
	});
	// The app answers every job with a receipt; anything else is a failed event.
	const body: unknown = await response.json().catch(() => null);
	if (!response.ok || !isScheduledJobReceipt(body, kind))
		throw new Error(`Scheduled ${kind} job did not complete (HTTP ${response.status}).`);
	return body;
}

export async function handleScheduled(
	controller: Pick<ScheduledController, 'cron' | 'scheduledTime' | 'noRetry'>,
	env: Env
) {
	try {
		await runScheduledJob(controller.cron, controller.scheduledTime, env);
	} catch (error) {
		// Persistent claims, waits and recovery already resume the work on the next
		// event; an immediate platform retry would run the same category twice.
		controller.noRetry();
		throw error;
	}
}

export default {
	scheduled: (controller, env) => handleScheduled(controller, env)
} satisfies ExportedHandler<Env>;
