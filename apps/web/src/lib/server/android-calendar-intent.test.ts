import { describe, expect, it } from 'vitest';
import {
	buildAndroidCalendarIntentUrl,
	isAndroidCalendarIntentVariant,
	type AndroidCalendarIntentInput
} from './android-calendar-intent';

const input: AndroidCalendarIntentInput = {
	title: 'Turno en Consultorio Sabrina',
	// Cubre los caracteres que romperían el parseo del Intent si viajaran crudos:
	// ";" corta segmentos, "=" corta key=value, saltos de línea y tildes.
	description: 'Tenés un turno reservado.\n\nFecha: sábado 14; hora=10:30\nVer turno: https://cita.app/turno/abc',
	location: 'Av. Siempre Viva 742 · Timbre 3B',
	startsAt: new Date('2026-06-15T14:30:00.000Z'),
	endsAt: new Date('2026-06-15T15:00:00.000Z'),
	fallbackUrl: 'https://cita.app/turno/abc/ir/google?source=android_native_fallback'
};

const fragmentSegments = (url: string) => {
	const match = url.match(/^[^#]+#Intent;(.+);end$/);
	expect(match, `formato #Intent;…;end en ${url}`).not.toBeNull();
	return match![1].split(';');
};

const extraValue = (url: string, key: string) => {
	const segment = fragmentSegments(url).find((part) => part.startsWith(`${key}=`));
	expect(segment, `extra ${key} presente`).toBeDefined();
	return segment!.slice(key.length + 1);
};

describe('buildAndroidCalendarIntentUrl', () => {
	it('variante data: URI del CalendarProvider + scheme=content, sin type', () => {
		const url = buildAndroidCalendarIntentUrl('data', input);
		expect(url.startsWith('intent://com.android.calendar/events#Intent;')).toBe(true);
		expect(url.endsWith(';end')).toBe(true);
		expect(fragmentSegments(url)).toContain('scheme=content');
		expect(fragmentSegments(url)).toContain('action=android.intent.action.INSERT');
		expect(url).not.toContain('type=');
	});

	it('variante type: sin URI de datos, con MIME type explícito y sin scheme', () => {
		const url = buildAndroidCalendarIntentUrl('type', input);
		expect(url.startsWith('intent:#Intent;')).toBe(true);
		expect(url.endsWith(';end')).toBe(true);
		expect(fragmentSegments(url)).toContain('type=vnd.android.cursor.dir/event');
		expect(fragmentSegments(url)).toContain('action=android.intent.action.INSERT');
		expect(url).not.toContain('scheme=');
	});

	it('beginTime/endTime van como longs en epoch millis exactos', () => {
		const url = buildAndroidCalendarIntentUrl('data', input);
		expect(extraValue(url, 'l.beginTime')).toBe(String(input.startsAt.getTime()));
		expect(extraValue(url, 'l.endTime')).toBe(String(input.endsAt.getTime()));
	});

	it('los extras string hacen round-trip exacto vía decodeURIComponent', () => {
		for (const variant of ['data', 'type'] as const) {
			const url = buildAndroidCalendarIntentUrl(variant, input);
			expect(decodeURIComponent(extraValue(url, 'S.title'))).toBe(input.title);
			expect(decodeURIComponent(extraValue(url, 'S.description'))).toBe(input.description);
			expect(decodeURIComponent(extraValue(url, 'S.eventLocation'))).toBe(input.location);
			expect(decodeURIComponent(extraValue(url, 'S.browser_fallback_url'))).toBe(input.fallbackUrl);
		}
	});

	it('ningún valor viaja con ";", "=", saltos de línea ni espacios crudos', () => {
		const url = buildAndroidCalendarIntentUrl('data', input);
		expect(url).not.toMatch(/\s/);
		for (const segment of fragmentSegments(url)) {
			const eq = segment.indexOf('=');
			expect(eq, `segmento key=value: ${segment}`).toBeGreaterThan(0);
			const value = segment.slice(eq + 1);
			expect(value).not.toContain(';');
			expect(value).not.toContain('=');
		}
	});

	it('el fallback queda completamente encodeado (no se corta en ? ni &)', () => {
		const url = buildAndroidCalendarIntentUrl('type', input);
		const raw = extraValue(url, 'S.browser_fallback_url');
		expect(raw).not.toContain('?');
		expect(raw).not.toContain('&');
		expect(raw).not.toContain('/');
		expect(raw).toContain('%3A%2F%2F');
	});

	it('sin location no emite S.eventLocation', () => {
		const url = buildAndroidCalendarIntentUrl('data', { ...input, location: null });
		expect(url).not.toContain('S.eventLocation');
	});
});

describe('isAndroidCalendarIntentVariant', () => {
	it('acepta solo data/type', () => {
		expect(isAndroidCalendarIntentVariant('data')).toBe(true);
		expect(isAndroidCalendarIntentVariant('type')).toBe(true);
		expect(isAndroidCalendarIntentVariant('off')).toBe(false);
		expect(isAndroidCalendarIntentVariant('')).toBe(false);
	});
});
