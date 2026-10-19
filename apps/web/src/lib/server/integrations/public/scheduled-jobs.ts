// Runs one scheduled job category inside the budget of its whole chain. The
// scheduler Worker names the category; every rule of the job lives here and in the
// modules it calls. A receipt carries counts and measurements, never clinical data,
// tokens or signed URLs.
import { env } from '$env/dynamic/private';
import type { ScheduledJobKind } from '@cita-suite/shared/scheduled-jobs';
import { logScheduledJob, logServerFailure, logServerWarning } from '$lib/server/platform/logging';
import { createSupabaseAdminClient } from '$lib/server/platform/supabase';
import {
	WORK_DEADLINE_MS,
	createJobBudget,
	parseJobBudgetProfile,
	type ScheduledJobRun
} from '$lib/server/integrations/internal/job-budget';
import { processGoogleCalendarSyncBatch } from '$lib/server/integrations/public/google-calendar';
import { sendGoogleReviewRequestBatch } from '$lib/server/integrations/public/google-reviews';
import { reconcileMercadoPago } from '$lib/server/integrations/public/mercadopago';
import { sendPushReminderBatch } from '$lib/server/integrations/public/push';
import {
	cleanupAbandonedClinicalUploads,
	reconcileClinicalStorage
} from '$lib/server/patients/public/clinical-files';

/** Largest cleanup claim the database accepts: at most two objects per file. */
const UPLOAD_CLEANUP_LIMIT = 200;
/** Subscriptions reviewed per commercial run; the oldest synchronized go first. */
const COMMERCIAL_SUBSCRIPTIONS_PER_RUN = 20;

type JobResult = Record<string, number | boolean>;

const jobs: Record<ScheduledJobKind, (run: ScheduledJobRun) => Promise<JobResult>> = {
	push: sendPushReminderBatch,
	calendar: processGoogleCalendarSyncBatch,
	reviews: sendGoogleReviewRequestBatch,
	uploads: (run) => cleanupAbandonedClinicalUploads(run.supabase, UPLOAD_CLEANUP_LIMIT),
	commercial: async (run) => {
		const { scanned, credited, attention, errors } = await reconcileMercadoPago(run.supabase, run.providerFetch, {
			limit: COMMERCIAL_SUBSCRIPTIONS_PER_RUN,
			// The budget decides when to stop; the run summary is its last database trip.
			budgetMs: WORK_DEADLINE_MS,
			admits: (calls) => run.budget.admits({ calls }, 1)
		});
		return { scanned, credited, attention, errors };
	},
	storage: async (run) => {
		const result = await reconcileClinicalStorage(run.supabase);
		if (result.overGlobalLimit || result.overBusinessLimit > 0)
			logServerWarning('El almacenamiento clínico supera un límite configurado');
		return result;
	}
};

export type ScheduledJobRunReceipt = {
	ok: boolean;
	kind: ScheduledJobKind;
	scheduledFor: string | null;
	budget: ReturnType<ReturnType<typeof createJobBudget>['summary']>;
	result: JobResult | null;
};

const scheduledFor = (header: string | null) => {
	if (!header) return null;
	const time = Date.parse(header);
	return Number.isFinite(time) ? new Date(time).toISOString() : null;
};

export async function runScheduledJob(
	kind: ScheduledJobKind,
	fetchFn: typeof fetch,
	options: { scheduledTime?: string | null; now?: Date } = {}
): Promise<ScheduledJobRunReceipt> {
	const budget = createJobBudget(parseJobBudgetProfile(env.JOB_BUDGET_PROFILE));
	let result: JobResult | null = null;
	try {
		const supabase = await createSupabaseAdminClient('odonto', budget.fetchFor('database', fetchFn));
		result = await jobs[kind]({
			supabase,
			budget,
			providerFetch: budget.fetchFor('provider', fetchFn),
			now: options.now ?? new Date()
		});
	} catch (error) {
		logServerFailure('Una tarea programada no terminó', error);
	}
	const receipt = {
		ok: result !== null,
		kind,
		scheduledFor: scheduledFor(options.scheduledTime ?? null),
		budget: budget.summary(),
		result
	};
	logScheduledJob({ kind, ok: receipt.ok, scheduledFor: receipt.scheduledFor, ...receipt.budget, ...result });
	return receipt;
}

/** False once the release step stopped the previous scheduler's entry points. */
export async function legacyJobEntrypointsEnabled(fetchFn: typeof fetch): Promise<boolean> {
	const admin = await createSupabaseAdminClient('odonto', fetchFn);
	const { data, error } = await admin.rpc('legacy_job_entrypoints_enabled');
	if (error) throw error;
	return data;
}
