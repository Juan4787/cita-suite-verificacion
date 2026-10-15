import { describe, expect, it } from 'vitest';
import {
	alarmsForProximity,
	buildIcs,
	escapeIcsText,
	foldIcsLine,
	formatIcsDateUtc,
	type IcsEventInput
} from './ics';

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;
const now = new Date('2026-06-11T12:00:00.000Z');

const baseInput = (overrides: Partial<IcsEventInput> = {}): IcsEventInput => ({
	uid: 'appointment-abc123@app.cita-suite.workers.dev',
	startsAt: new Date('2026-06-15T17:30:00.000Z'),
	endsAt: new Date('2026-06-15T18:00:00.000Z'),
	summary: 'Turno en Clínica Sabrina',
	description: 'Tenés un turno reservado.\n\nFecha: lunes 15 de junio\nHora local del consultorio: 14:30',
	location: 'Av. Santa Fe 1234, Piso 3, CABA',
	url: 'https://app.cita-suite.workers.dev/turno/tok123',
	sequence: 0,
	status: 'CONFIRMED',
	method: 'PUBLISH',
	alarms: alarmsForProximity(new Date('2026-06-15T17:30:00.000Z'), now),
	now,
	...overrides
});

describe('escapeIcsText', () => {
	it('escapa backslash, punto y coma, coma y saltos de línea', () => {
		expect(escapeIcsText('a\\b;c,d\ne\r\nf')).toBe('a\\\\b\\;c\\,d\\ne\\nf');
	});
});

describe('foldIcsLine', () => {
	it('no parte líneas cortas', () => {
		expect(foldIcsLine('SUMMARY:Hola')).toEqual(['SUMMARY:Hola']);
	});

	it('limita cada línea a 75 octetos con continuación de espacio', () => {
		const folded = foldIcsLine('DESCRIPTION:' + 'a'.repeat(200));
		expect(folded.length).toBeGreaterThan(1);
		for (const line of folded) {
			expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
		}
		expect(folded[1]?.startsWith(' ')).toBe(true);
		expect(folded.join('').replace(/^DESCRIPTION:/, '').replaceAll(' ', '')).toBe('a'.repeat(200));
	});

	it('mide en bytes UTF-8 sin partir caracteres con tilde', () => {
		const folded = foldIcsLine('DESCRIPTION:' + 'á'.repeat(100));
		for (const line of folded) {
			expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
			// si se partiera un carácter, aparecería el replacement char al re-decodificar
			expect(line.includes('�')).toBe(false);
		}
	});
});

describe('formatIcsDateUtc', () => {
	it('formatea en UTC compacto con Z', () => {
		expect(formatIcsDateUtc(new Date('2026-06-15T17:30:00.000Z'))).toBe('20260615T173000Z');
	});
});

describe('alarmsForProximity', () => {
	it('más de 24h: alarmas de 24h y 2h', () => {
		const triggers = alarmsForProximity(new Date(now.getTime() + 48 * HOUR), now).map((a) => a.trigger);
		expect(triggers).toEqual(['-PT24H', '-PT2H']);
	});

	it('entre 2h y 24h: solo 2h', () => {
		const triggers = alarmsForProximity(new Date(now.getTime() + 5 * HOUR), now).map((a) => a.trigger);
		expect(triggers).toEqual(['-PT2H']);
	});

	it('entre 30min y 2h: 30 minutos', () => {
		const triggers = alarmsForProximity(new Date(now.getTime() + 60 * MINUTE), now).map((a) => a.trigger);
		expect(triggers).toEqual(['-PT30M']);
	});

	it('menos de 30min o pasado: sin alarmas', () => {
		expect(alarmsForProximity(new Date(now.getTime() + 10 * MINUTE), now)).toEqual([]);
		expect(alarmsForProximity(new Date(now.getTime() - HOUR), now)).toEqual([]);
	});
});

describe('buildIcs', () => {
	it('genera el evento completo con CRLF y estructura RFC 5545', () => {
		const ics = buildIcs(baseInput());
		expect(ics).toContain('BEGIN:VCALENDAR\r\n');
		expect(ics).toContain('METHOD:PUBLISH\r\n');
		expect(ics).toContain('UID:appointment-abc123@app.cita-suite.workers.dev\r\n');
		expect(ics).toContain('DTSTART:20260615T173000Z\r\n');
		expect(ics).toContain('DTEND:20260615T180000Z\r\n');
		expect(ics).toContain('DTSTAMP:20260611T120000Z\r\n');
		expect(ics).toContain('STATUS:CONFIRMED\r\n');
		expect(ics).toContain('SEQUENCE:0\r\n');
		expect(ics).toContain('TRANSP:OPAQUE\r\n');
		expect(ics).toContain('TRIGGER:-PT24H\r\n');
		expect(ics).toContain('TRIGGER:-PT2H\r\n');
		expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
		// la coma de la dirección queda escapada
		expect(ics).toContain('LOCATION:Av. Santa Fe 1234\\, Piso 3\\, CABA');
	});

	it('ninguna línea supera 75 octetos', () => {
		const ics = buildIcs(
			baseInput({
				description:
					'Descripción larga con tildes: ' + 'ñandú águila Ñuñoa Río Cuarto, '.repeat(20),
				location: 'Avenida Rafael Núñez 4750, Cerro de las Rosas, Córdoba, Argentina, Galería Norte, Local 12'
			})
		);
		for (const line of ics.split('\r\n')) {
			expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
		}
	});

	it('UID estable: dos generaciones del mismo turno comparten UID', () => {
		const a = buildIcs(baseInput());
		const b = buildIcs(baseInput());
		expect(a).toBe(b);
	});

	it('variante cancelada: METHOD:CANCEL + STATUS:CANCELLED sin alarmas', () => {
		const ics = buildIcs(
			baseInput({ status: 'CANCELLED', method: 'CANCEL', sequence: 2, alarms: [] })
		);
		expect(ics).toContain('METHOD:CANCEL\r\n');
		expect(ics).toContain('STATUS:CANCELLED\r\n');
		expect(ics).toContain('SEQUENCE:2\r\n');
		expect(ics).not.toContain('BEGIN:VALARM');
	});

	it('omite LOCATION si no hay dirección', () => {
		const ics = buildIcs(baseInput({ location: null }));
		expect(ics).not.toContain('LOCATION:');
	});
});
