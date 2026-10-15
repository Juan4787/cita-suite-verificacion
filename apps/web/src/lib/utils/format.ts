// Sin timeZone, Intl usa la zona del runtime: en SSR eso puede ser UTC y diferir
// del navegador del paciente. Toda superficie pública debe pasar la timezone del negocio.
const dateFormatters = new Map<string, Intl.DateTimeFormat>();
const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>();
const dayFormatters = new Map<string, Intl.DateTimeFormat>();
const timeFormatters = new Map<string, Intl.DateTimeFormat>();

const formatterFor = (
	cache: Map<string, Intl.DateTimeFormat>,
	options: Intl.DateTimeFormatOptions,
	timeZone?: string
) => {
	const key = timeZone ?? '';
	let formatter = cache.get(key);
	if (!formatter) {
		formatter = new Intl.DateTimeFormat('es-AR', timeZone ? { ...options, timeZone } : options);
		cache.set(key, formatter);
	}
	return formatter;
};

export const formatDate = (value?: string | null, timeZone?: string) => {
	if (!value) return '';
	// A date-only value represents a calendar day, not an instant. Parsing
	// `YYYY-MM-DD` with the browser's local zone can move it to the previous day
	// in Argentina (for example, 2004-02-03 becomes February 2 at 21:00).
	// Format those values in UTC so the stored calendar day is preserved.
	const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
	return formatterFor(
		dateFormatters,
		{ day: 'numeric', month: 'long', year: 'numeric' },
		dateOnly ? 'UTC' : timeZone
	).format(new Date(dateOnly ? `${value}T00:00:00.000Z` : value));
};

export const formatDateTime = (value?: string | null, timeZone?: string) => {
	if (!value) return '';
	return formatterFor(
		dateTimeFormatters,
		{
			day: 'numeric',
			month: 'long',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
			hourCycle: 'h23'
		},
		timeZone
	).format(new Date(value));
};

export type ZonedDateTimeLabels = {
	dateLabel: string;
	timeLabel: string;
	full: string;
};

export const formatInTimeZone = (value: string | Date, timeZone: string): ZonedDateTimeLabels => {
	const date = typeof value === 'string' ? new Date(value) : value;
	const dateLabel = formatterFor(
		dayFormatters,
		{ weekday: 'long', day: '2-digit', month: 'long' },
		timeZone
	).format(date);
	const timeLabel = formatterFor(
		timeFormatters,
		// h23 representa medianoche como 00:00. `hour12: false` elige h24 en
		// es-AR dentro de Node y producía el ambiguo “24:00”.
		{ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' },
		timeZone
	).format(date);
	return { dateLabel, timeLabel, full: `${dateLabel} a las ${timeLabel}` };
};

const MINUTE_MS = 60 * 1000;
const HOUR_MINUTES = 60;
const DAY_MINUTES = 24 * HOUR_MINUTES;

/**
 * Human-readable remaining commercial access time.
 *
 * Short grants deliberately stay in minutes/hours. In particular, a one-hour
 * grant must never be rounded up to "1 día" just because the legacy status
 * model also exposes daysUntilExpiration.
 */
export const formatAccessRemaining = (
	value?: string | null,
	now: Date = new Date()
): string | null => {
	if (!value) return null;
	const expiresAtMs = Date.parse(value);
	if (!Number.isFinite(expiresAtMs)) return null;

	const diffMs = expiresAtMs - now.getTime();
	if (diffMs <= 0) return 'Vencido';

	const minutes = Math.max(1, Math.ceil(diffMs / MINUTE_MS));
	if (minutes < HOUR_MINUTES) {
		return `${minutes} min ${minutes === 1 ? 'restante' : 'restantes'}`;
	}
	if (minutes === HOUR_MINUTES) return '1 hora restante';
	if (minutes < DAY_MINUTES) {
		const hours = Math.ceil(minutes / HOUR_MINUTES);
		return `${hours} horas restantes`;
	}

	const days = Math.ceil(minutes / DAY_MINUTES);
	return `${days} ${days === 1 ? 'día restante' : 'días restantes'}`;
};

export const normalizePhone = (phone: string) => phone.replace(/\D/g, '');
