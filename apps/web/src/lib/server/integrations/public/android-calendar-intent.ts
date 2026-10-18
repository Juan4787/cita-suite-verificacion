// Link "intent://" para abrir el formulario de nuevo evento del calendario nativo
// de Android sin descargar archivos (FASE 12). Solo se emite tras el gate de UA de
// lib/device.ts (Chromium con UI real). Hay DOS variantes porque el matching de
// intent-filters difiere entre apps de calendario; cuál queda la decide la matriz
// de dispositivos reales, no la especulación:
// - 'data': URI de datos content://com.android.calendar/events (la autoridad del
//   CalendarProvider es la misma en todos los Android, sea cual sea la app); el
//   sistema resuelve el MIME type consultando al provider.
// - 'type': sin URI de datos, declarando el MIME type del Intent explícito.
//
// Reglas de formato (doc oficial "Android Intents with Chrome"):
// - extras string: S.<key>=<valor URL-encoded>; extras long: l.<key>=<dígitos>.
// - S.browser_fallback_url: Chrome la consume (no le llega a la app) y navega ahí
//   si ninguna Activity resuelve el intent o el lanzamiento no está permitido.
// - Android parsea el fragmento cortando por ";" y tomando key=value: ningún valor
//   puede llevar ";", "=" ni saltos de línea crudos → encodeURIComponent SIEMPRE.
//
// IMPORTANTE (regla del plan): este link debe renderizarse como <a href> directo y
// dispararse con un gesto real del usuario. Nada de redirects server-side previos
// ni window.location desde JS: Chrome lo mandaría directo al fallback.

export type AndroidCalendarIntentVariant = 'data' | 'type';

export const ANDROID_CALENDAR_INTENT_VARIANTS = ['data', 'type'] as const;

export const isAndroidCalendarIntentVariant = (
	value: string
): value is AndroidCalendarIntentVariant =>
	(ANDROID_CALENDAR_INTENT_VARIANTS as readonly string[]).includes(value);

export type AndroidCalendarIntentInput = {
	title: string;
	description: string;
	location: string | null;
	startsAt: Date;
	endsAt: Date;
	/** URL absoluta propia (ir/google?source=…) para que el fallback quede registrado. */
	fallbackUrl: string;
};

const stringExtra = (key: string, value: string) => `S.${key}=${encodeURIComponent(value)}`;

export const buildAndroidCalendarIntentUrl = (
	variant: AndroidCalendarIntentVariant,
	input: AndroidCalendarIntentInput
): string => {
	const segments = ['action=android.intent.action.INSERT'];
	if (variant === 'data') {
		segments.push('scheme=content');
	} else {
		segments.push('type=vnd.android.cursor.dir/event');
	}
	segments.push(stringExtra('title', input.title));
	segments.push(stringExtra('description', input.description));
	if (input.location) {
		segments.push(stringExtra('eventLocation', input.location));
	}
	segments.push(`l.beginTime=${input.startsAt.getTime()}`);
	segments.push(`l.endTime=${input.endsAt.getTime()}`);
	segments.push(stringExtra('browser_fallback_url', input.fallbackUrl));

	const prefix = variant === 'data' ? 'intent://com.android.calendar/events' : 'intent:';
	return `${prefix}#Intent;${segments.join(';')};end`;
};
