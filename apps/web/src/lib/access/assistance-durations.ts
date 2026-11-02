// The durations of the Cita Suite assistance (plan 12.17) and how its dates are written. The
// database gives each duration exactly and refuses anything else
// (20261101030000_account_assistance_durations.sql); this module only describes them.

export const ACCOUNT_ASSISTANCE_KINDS = ['hour', 'day', 'initial_setup'] as const;
export type AccountAssistanceKind = (typeof ACCOUNT_ASSISTANCE_KINDS)[number];

const HOUR_MS = 60 * 60 * 1000;

export const ACCOUNT_ASSISTANCE_DURATION_MS: Record<AccountAssistanceKind, number> = {
	hour: HOUR_MS,
	day: 24 * HOUR_MS,
	initial_setup: 7 * 24 * HOUR_MS
};

export const isAccountAssistanceKind = (value: unknown): value is AccountAssistanceKind =>
	typeof value === 'string' && (ACCOUNT_ASSISTANCE_KINDS as readonly string[]).includes(value);

// Each option is described by what it is for, never as access to patients or clinical records
// (Juan, 1 November: the initial setup has none of that yet).
export const ACCOUNT_ASSISTANCE_OPTIONS: Record<
	AccountAssistanceKind,
	{ title: string; description: string; activateLabel: string; activateTitle: string; extendLabel: string }
> = {
	hour: {
		title: '1 hora',
		description: 'Para resolver algo en el momento.',
		activateLabel: 'Dar ayuda por 1 hora',
		activateTitle: 'Dar ayuda por 1 hora',
		extendLabel: 'Pasar a 1 hora'
	},
	day: {
		title: '24 horas',
		description: 'Para resolverlo durante el día, sin que tengas que estar conectado.',
		activateLabel: 'Dar ayuda por 24 horas',
		activateTitle: 'Dar ayuda por 24 horas',
		extendLabel: 'Pasar a 24 horas'
	},
	initial_setup: {
		title: 'Configuración inicial, 7 días',
		description: 'Para cargar tus prestaciones, horarios y preguntas, conectar tu web y probar que todo funcione.',
		activateLabel: 'Dar ayuda para la configuración inicial',
		activateTitle: 'Dar ayuda para la configuración inicial',
		extendLabel: 'Pasar a la configuración inicial, 7 días'
	}
};

/** What the owner can give: the initial setup only while the practice has no patients. */
export const assistanceActivationKinds = (hasPatients: boolean): AccountAssistanceKind[] =>
	hasPatients ? ['hour', 'day'] : [...ACCOUNT_ASSISTANCE_KINDS];

/**
 * What the owner can move an active grant to: a longer duration, counted from that moment. The
 * initial setup can be renewed for seven more days even with patients; moving to it from a
 * shorter duration needs a practice without patients, as giving it does.
 */
export const assistanceExtensionKinds = (current: AccountAssistanceKind, hasPatients: boolean): AccountAssistanceKind[] => {
	if (current === 'initial_setup') return ['initial_setup'];
	const longer = ACCOUNT_ASSISTANCE_KINDS.slice(ACCOUNT_ASSISTANCE_KINDS.indexOf(current) + 1);
	return hasPatients ? longer.filter((kind) => kind !== 'initial_setup') : [...longer];
};

export type AssistanceMoment = {
	/** «domingo 8 de noviembre», with the year only when it is not the current one. */
	date: string;
	/** «10:15»; midnight is «00:00». */
	time: string;
	/** «el domingo 8 de noviembre a las 10:15». */
	full: string;
	/** «dom 8/11 10:15», for the mark in the menu. */
	short: string;
};

const WEEKDAY_SHORT: Record<string, string> = {
	domingo: 'dom',
	lunes: 'lun',
	martes: 'mar',
	miércoles: 'mié',
	jueves: 'jue',
	viernes: 'vie',
	sábado: 'sáb'
};
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const momentFormatters = new Map<string, Intl.DateTimeFormat>();
const partsIn = (date: Date, timeZone: string) => {
	let formatter = momentFormatters.get(timeZone);
	if (!formatter) {
		// h23 writes midnight as 00:00; es-AR with hour12 false would write 24:00.
		formatter = new Intl.DateTimeFormat('es-AR', {
			timeZone,
			weekday: 'long',
			day: 'numeric',
			month: 'long',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
			hourCycle: 'h23'
		});
		momentFormatters.set(timeZone, formatter);
	}
	return Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
};

/**
 * A moment of the assistance in the practice time zone, always with its date: with 24 hours or
 * seven days, «hasta las 10:15» alone does not say which day.
 */
export const formatAssistanceMoment = (
	value: string | Date | null | undefined,
	timeZone: string,
	now: Date = new Date()
): AssistanceMoment | null => {
	if (!value) return null;
	const date = value instanceof Date ? value : new Date(value);
	if (Number.isNaN(date.getTime())) return null;
	const parts = partsIn(date, timeZone);
	const month = MONTHS.indexOf(parts.month) + 1;
	const sameYear = parts.year === partsIn(now, timeZone).year;
	const day = `${parts.weekday} ${parts.day} de ${parts.month}${sameYear ? '' : ` de ${parts.year}`}`;
	const time = `${parts.hour}:${parts.minute}`;
	const weekday = WEEKDAY_SHORT[parts.weekday] ?? parts.weekday;
	return {
		date: day,
		time,
		full: `el ${day} a las ${time}`,
		short: `${weekday} ${parts.day}/${month}${sameYear ? '' : `/${parts.year}`} ${time}`
	};
};

/** How the last grant ended: it expired, the owner ended it, or Cita Suite did. */
export type AccountAssistanceEnd = 'expired' | 'owner' | 'support';

/** What the owner reads, for 24 hours, under «La ayuda de Cita Suite terminó». */
export const assistanceEndText = (endedBy: AccountAssistanceEnd | null, endedAt: AssistanceMoment | null) => {
	const when = endedAt ? ` ${endedAt.full}` : '';
	if (endedBy === 'support') return `Cita Suite la terminó${when}. Ya no puede entrar a tu cuenta.`;
	if (endedBy === 'owner') return `La terminaste${when}. Cita Suite ya no puede entrar a tu cuenta.`;
	return `Venció${when}. Cita Suite ya no puede entrar a tu cuenta.`;
};
