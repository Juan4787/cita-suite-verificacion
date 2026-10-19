// Versioned schedule of the approved plan. Cloudflare evaluates cron expressions in UTC.
// The scheduler only decides *which* category runs; every rule lives in the app.
import type { ScheduledJobKind } from '@cita-suite/shared/scheduled-jobs';

export const CRON_SCHEDULE = {
	'*/5 * * * *': 'push',
	'1-59/5 * * * *': 'calendar',
	'2-59/10 * * * *': 'reviews',
	'3-59/15 * * * *': 'uploads',
	'17 */3 * * *': 'maintenance'
} as const satisfies Record<string, ScheduledJobKind | 'maintenance'>;

export type ScheduledCron = keyof typeof CRON_SCHEDULE;

const isScheduledCron = (cron: string): cron is ScheduledCron => Object.hasOwn(CRON_SCHEDULE, cron);

/**
 * One category per event. Maintenance runs every three hours and alternates, so the
 * commercial reconciliation and the storage reconciliation each run every six hours:
 * 00:17, 06:17, 12:17, 18:17 UTC are commercial; 03:17, 09:17, 15:17, 21:17 storage.
 */
export function jobForEvent(cron: string, scheduledTime: number): ScheduledJobKind {
	if (!isScheduledCron(cron)) throw new Error(`Unscheduled cron expression: ${cron}`);
	const entry = CRON_SCHEDULE[cron];
	if (entry !== 'maintenance') return entry;
	const hour = new Date(scheduledTime).getUTCHours();
	return Math.floor(hour / 3) % 2 === 0 ? 'commercial' : 'storage';
}
