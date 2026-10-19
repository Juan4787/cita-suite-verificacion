// Contract between the scheduler Worker and the app's internal job endpoints.
// The scheduler only names a category; every rule of the job lives in the app.

export const SCHEDULED_JOB_KINDS = ['push', 'calendar', 'reviews', 'uploads', 'commercial', 'storage'] as const;
export type ScheduledJobKind = (typeof SCHEDULED_JOB_KINDS)[number];

export const isScheduledJobKind = (value: string): value is ScheduledJobKind =>
	SCHEDULED_JOB_KINDS.some((kind) => kind === value);

/** Minimal receipt every completed job returns; the app adds counts without clinical data. */
export type ScheduledJobReceipt = { ok: true; kind: ScheduledJobKind };

export const isScheduledJobReceipt = (value: unknown, kind: ScheduledJobKind): value is ScheduledJobReceipt =>
	typeof value === 'object' &&
	value !== null &&
	'ok' in value &&
	value.ok === true &&
	'kind' in value &&
	value.kind === kind;
