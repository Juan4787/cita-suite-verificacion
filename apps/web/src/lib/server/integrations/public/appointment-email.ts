// One scheduled email run. Claiming commits before any provider call, each chunk's results are
// recorded before the next one starts, and a message whose result is unknown stays `uncertain`.
import { env } from '$env/dynamic/private';
import { readBoolean, readRecord } from '$lib/contracts/json';
import type { ScheduledJobRun } from '$lib/server/integrations/internal/job-budget';
import { JobBudgetExhaustedError, MAX_CONCURRENT_EXTERNAL_CALLS } from '$lib/server/integrations/internal/job-budget';
import { getPublicSiteUrl } from '$lib/server/integrations/public/messaging';
import { logServerFailure, logServerWarning } from '$lib/server/platform/logging';
import {
	buildAppointmentEmail,
	headerText,
	parseAppointmentEmailWork,
	type AppointmentEmailWork
} from './appointment-email-content';
import { sendZohoEmail, type EmailSendOutcome } from './zoho-email';

/** Per run. With five-minute runs this is about a hundred messages an hour, far above the daily quota. */
const EMAIL_MAX_CLAIM = 8;
/** Sends in flight at once: the budget allows no more, and results are recorded between chunks. */
const EMAIL_CHUNK_SIZE = MAX_CONCURRENT_EXTERNAL_CALLS;

export const isEmailConfigured = () => Boolean(env.ZOHO_CPAAS_API_KEY?.trim());

type EmailResult = { delivery_id: string; lease_token: string; outcome: string; request_id?: string; code?: string };

const resultFor = (work: AppointmentEmailWork, sent: EmailSendOutcome): EmailResult => ({
	delivery_id: work.deliveryId,
	lease_token: work.leaseToken,
	outcome: sent.outcome,
	...(sent.outcome === 'accepted' ? { request_id: sent.requestId } : { code: sent.code })
});

const deliver = async (job: ScheduledJobRun, apiKey: string, siteUrl: string, work: AppointmentEmailWork): Promise<EmailResult> => {
	let built;
	try {
		built = buildAppointmentEmail(work, { siteUrl, now: job.now });
	} catch (cause) {
		// Nothing left the system, so this is a definite failure of this message, not an uncertainty.
		logServerFailure('email.content_failed', cause);
		return resultFor(work, { outcome: 'failed', code: 'content_invalid' });
	}
	if (!built.send) return resultFor(work, { outcome: 'failed', code: built.reason });
	try {
		const sent = await sendZohoEmail(job.providerFetch, apiKey, {
			reference: work.deliveryId,
			from: { address: work.sender.fromAddress, name: built.fromName },
			to: work.recipient,
			subject: headerText(built.subject),
			html: built.html,
			text: built.text,
			headers: built.headers
		});
		return resultFor(work, sent);
	} catch (cause) {
		// The budget refuses before the request starts, so that one certainly did not leave.
		if (cause instanceof JobBudgetExhaustedError) return resultFor(work, { outcome: 'retry', code: 'budget' });
		throw cause;
	}
};

export const sendAppointmentEmailBatch = async (job: ScheduledJobRun) => {
	const summary = { configured: isEmailConfigured(), enabled: false, paused: false, claimed: 0, accepted: 0, retried: 0, failed: 0, uncertain: 0, discarded: 0 };
	const apiKey = env.ZOHO_CPAAS_API_KEY?.trim();
	if (!apiKey) return summary;
	// The claim, then per chunk its sends and one recording call.
	const fitting = Math.floor(((job.budget.remaining() - 2) * EMAIL_CHUNK_SIZE) / (EMAIL_CHUNK_SIZE + 1));
	const limit = Math.min(EMAIL_MAX_CLAIM, fitting);
	if (limit < 1) return summary;
	const { data, error } = await job.supabase.rpc('claim_appointment_email_batch', { p_limit: limit, p_now: job.now.toISOString() });
	if (error) throw error;
	const claim = readRecord(data, 'email.claim');
	summary.enabled = readBoolean(claim.enabled, 'email.claim.enabled');
	summary.paused = claim.paused === true;
	summary.discarded = typeof claim.discarded === 'number' ? claim.discarded : 0;
	if (summary.paused) logServerWarning('Los envíos de correo están en pausa');
	const items = Array.isArray(claim.items) ? claim.items : [];
	const queue: AppointmentEmailWork[] = [];
	for (const item of items) {
		try {
			queue.push(parseAppointmentEmailWork(item));
		} catch (cause) {
			// Its lease expires into `uncertain`: an unreadable claim is never sent blindly.
			logServerFailure('email.claim_unreadable', cause);
		}
	}
	summary.claimed = queue.length;
	const siteUrl = getPublicSiteUrl();
	while (queue.length) {
		const chunk = queue.splice(0, EMAIL_CHUNK_SIZE);
		const results = await Promise.all(chunk.map((work) => deliver(job, apiKey, siteUrl, work)));
		for (const result of results) {
			if (result.outcome === 'accepted') summary.accepted += 1;
			else if (result.outcome === 'uncertain') summary.uncertain += 1;
			else if (result.outcome === 'failed') summary.failed += 1;
			else summary.retried += 1;
		}
		const finishing = queue.length === 0 || !job.budget.admits({ calls: EMAIL_CHUNK_SIZE + 1 }, 1);
		if (finishing) {
			job.budget.enterFinalization();
			// What was claimed but not attempted goes back as pending: it certainly did not leave.
			for (const work of queue.splice(0)) results.push({ delivery_id: work.deliveryId, lease_token: work.leaseToken, outcome: 'released' });
		}
		const { error: recordError } = await job.supabase.rpc('record_appointment_email_results', {
			p_results: results,
			p_now: job.now.toISOString()
		});
		if (recordError) throw recordError;
	}
	return summary;
};
