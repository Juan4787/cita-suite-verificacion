// Budget of one scheduled chain (scheduler event -> Service Binding -> app job).
// Every external call is counted before it starts: database HTTP trips (PostgREST,
// Storage, Auth) and provider calls are kept apart, because a fetch counter is not a
// count of SQL queries. The budget covers the whole chain, so the Service Binding
// request that started the job is already spent when the app receives it.
// PostgREST retries idempotent GET requests by itself, also after a refused call:
// queries made by a job disable it (`.retry(false)`), the persistent retry of each
// queue already covers that failure and the worst case per item stays exact.
import type { CitaSupabaseClient } from '$lib/types/database';

export type JobBudgetProfile = 'free' | 'paid';
export type ExternalCallKind = 'database' | 'provider';

/** Application limits of the approved plan, kept below the platform limits (50 / 10.000). */
export const JOB_BUDGET_PROFILES: Record<JobBudgetProfile, { maxCalls: number }> = {
	free: { maxCalls: 40 },
	paid: { maxCalls: 300 }
};
export const MAX_CONCURRENT_EXTERNAL_CALLS = 4;
export const JOB_DEADLINE_MS = 20_000;
/** The end of the deadline is kept to record results; work calls stop before it. */
export const FINALIZATION_RESERVE_MS = 4_000;
export const WORK_DEADLINE_MS = JOB_DEADLINE_MS - FINALIZATION_RESERVE_MS;
/** New work starts only with at least this much work time left. */
export const MIN_WORK_START_MS = 2_000;
/** The scheduler's request to the app through the Service Binding. */
export const CHAIN_ENTRY_CALLS = 1;
/** Upper bound of one external call; the remaining time of its phase is applied when shorter. */
export const EXTERNAL_CALL_TIMEOUT_MS = 5_000;

export class JobBudgetExhaustedError extends Error {
	constructor(readonly reason: 'calls' | 'time') {
		super(`Scheduled job budget exhausted (${reason}).`);
		this.name = 'JobBudgetExhaustedError';
	}
}

export const parseJobBudgetProfile = (value: string | undefined): JobBudgetProfile =>
	value?.trim() === 'paid' ? 'paid' : 'free';

export type JobBudget = ReturnType<typeof createJobBudget>;

/** One run of a job: a database client and a provider fetch, both counted by its budget. */
export type ScheduledJobRun = {
	supabase: CitaSupabaseClient;
	budget: JobBudget;
	providerFetch: typeof fetch;
	now: Date;
};

export function createJobBudget(profile: JobBudgetProfile, now: () => number = Date.now) {
	const startedAt = now();
	const { maxCalls } = JOB_BUDGET_PROFILES[profile];
	const calls: Record<ExternalCallKind, number> = { database: 0, provider: 0 };
	let finalizing = false;
	let active = 0;
	const waiting: (() => void)[] = [];
	const used = () => CHAIN_ENTRY_CALLS + calls.database + calls.provider;
	const elapsedMs = () => now() - startedAt;
	const phaseRemainingMs = () => (finalizing ? JOB_DEADLINE_MS : WORK_DEADLINE_MS) - elapsedMs();

	const acquire = async () => {
		while (active >= MAX_CONCURRENT_EXTERNAL_CALLS) await new Promise<void>((resolve) => waiting.push(resolve));
		active++;
	};
	const release = () => {
		active--;
		waiting.shift()?.();
	};

	const call = async <T>(kind: ExternalCallKind, operation: (signal: AbortSignal) => Promise<T>): Promise<T> => {
		if (used() >= maxCalls) throw new JobBudgetExhaustedError('calls');
		if (phaseRemainingMs() <= 0) throw new JobBudgetExhaustedError('time');
		// Counted before waiting for a slot, so concurrent callers cannot overdraw the budget.
		calls[kind]++;
		await acquire();
		try {
			const remaining = phaseRemainingMs();
			if (remaining <= 0) {
				calls[kind]--;
				throw new JobBudgetExhaustedError('time');
			}
			return await operation(AbortSignal.timeout(Math.min(EXTERNAL_CALL_TIMEOUT_MS, remaining)));
		} finally {
			release();
		}
	};

	return {
		profile,
		maxCalls,
		get used() {
			return used();
		},
		remaining: () => maxCalls - used(),
		elapsedMs,
		/**
		 * True when more work still fits: its worst-case calls plus the calls reserved
		 * to record the results of the batch, and enough work time before the reserve.
		 */
		admits(work: { calls: number }, reservedCalls: number) {
			return (
				!finalizing &&
				used() + work.calls + reservedCalls <= maxCalls &&
				elapsedMs() + MIN_WORK_START_MS <= WORK_DEADLINE_MS
			);
		},
		/** From here on only results are recorded, bounded by the full deadline. */
		enterFinalization() {
			finalizing = true;
		},
		call,
		/** fetch counted as one external call; the caller's signal and the phase deadline both abort it. */
		fetchFor(kind: ExternalCallKind, fetchImpl: typeof fetch): typeof fetch {
			return (input, init) =>
				call(kind, (deadline) =>
					fetchImpl(input, {
						...init,
						signal: init?.signal ? AbortSignal.any([init.signal, deadline]) : deadline
					})
				);
		},
		summary: () => ({
			profile,
			maxCalls,
			usedCalls: used(),
			databaseRequests: calls.database,
			providerRequests: calls.provider,
			elapsedMs: elapsedMs()
		})
	};
}
