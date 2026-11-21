export const DEFAULT_CALENDAR_TIME_ZONE = 'America/Argentina/Buenos_Aires';

const dayFormatters = new Map<string, Intl.DateTimeFormat>();

const dateInTimeZone = (date: Date, timeZone: string): string => {
	const safeTimeZone = timeZone || DEFAULT_CALENDAR_TIME_ZONE;
	let formatter = dayFormatters.get(safeTimeZone);
	if (!formatter) {
		try {
			formatter = new Intl.DateTimeFormat('en-CA', {
				timeZone: safeTimeZone,
				year: 'numeric',
				month: '2-digit',
				day: '2-digit'
			});
		} catch {
			formatter = new Intl.DateTimeFormat('en-CA', {
				timeZone: DEFAULT_CALENDAR_TIME_ZONE,
				year: 'numeric',
				month: '2-digit',
				day: '2-digit'
			});
		}
		dayFormatters.set(safeTimeZone, formatter);
	}
	const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
	return `${parts.year}-${parts.month}-${parts.day}`;
};

/**
 * Whole calendar days from `now` to `targetIso` in `timeZone`.
 * Example: on 2026-11-19 (any hour in Argentina) for 2026-12-03T23:59:59-03:00 -> 14.
 * Returns null if `targetIso` is absent or invalid.
 */
export const calendarDaysUntil = (
	targetIso: string | null | undefined,
	now: Date = new Date(),
	timeZone: string = DEFAULT_CALENDAR_TIME_ZONE
): number | null => {
	if (!targetIso) return null;
	const targetMs = Date.parse(targetIso);
	if (!Number.isFinite(targetMs)) return null;
	const nowDay = dateInTimeZone(now, timeZone);
	const targetDay = dateInTimeZone(new Date(targetMs), timeZone);
	return Math.round(
		(Date.parse(`${targetDay}T00:00:00.000Z`) - Date.parse(`${nowDay}T00:00:00.000Z`)) / 86_400_000
	);
};
