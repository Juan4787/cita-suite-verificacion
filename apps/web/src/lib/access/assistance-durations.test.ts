import { describe, expect, it } from 'vitest';
import {
	ACCOUNT_ASSISTANCE_DURATION_MS,
	ACCOUNT_ASSISTANCE_KINDS,
	ACCOUNT_ASSISTANCE_OPTIONS,
	assistanceActivationKinds,
	assistanceEndText,
	assistanceExtensionKinds,
	formatAssistanceMoment,
	isAccountAssistanceKind
} from './assistance-durations';

const BUENOS_AIRES = 'America/Argentina/Buenos_Aires';
const NOW = new Date('2026-11-01T21:00:00.000Z');

describe('account assistance durations', () => {
	it('knows exactly three durations, as the database does', () => {
		expect(ACCOUNT_ASSISTANCE_KINDS).toEqual(['hour', 'day', 'initial_setup']);
		expect(ACCOUNT_ASSISTANCE_DURATION_MS).toEqual({
			hour: 60 * 60 * 1000,
			day: 24 * 60 * 60 * 1000,
			initial_setup: 7 * 24 * 60 * 60 * 1000
		});
		expect(isAccountAssistanceKind('day')).toBe(true);
		for (const value of ['week', '', null, undefined, 'HOUR', 3]) expect(isAccountAssistanceKind(value)).toBe(false);
	});

	it('offers the initial setup only while the practice has no patients', () => {
		expect(assistanceActivationKinds(false)).toEqual(['hour', 'day', 'initial_setup']);
		expect(assistanceActivationKinds(true)).toEqual(['hour', 'day']);
	});

	it('extends only to a longer duration, and renews the initial setup even with patients', () => {
		expect(assistanceExtensionKinds('hour', false)).toEqual(['day', 'initial_setup']);
		expect(assistanceExtensionKinds('hour', true)).toEqual(['day']);
		expect(assistanceExtensionKinds('day', false)).toEqual(['initial_setup']);
		expect(assistanceExtensionKinds('day', true)).toEqual([]);
		expect(assistanceExtensionKinds('initial_setup', false)).toEqual(['initial_setup']);
		expect(assistanceExtensionKinds('initial_setup', true)).toEqual(['initial_setup']);
	});

	it('describes each option with the approved texts', () => {
		expect(ACCOUNT_ASSISTANCE_OPTIONS.hour).toMatchObject({
			title: '1 hora',
			description: 'Para resolver algo en el momento.'
		});
		expect(ACCOUNT_ASSISTANCE_OPTIONS.day).toMatchObject({
			title: '24 horas',
			description: 'Para resolverlo durante el día, sin que tengas que estar conectado.'
		});
		expect(ACCOUNT_ASSISTANCE_OPTIONS.initial_setup).toMatchObject({
			title: 'Configuración inicial, 7 días',
			description: 'Para cargar tus prestaciones, horarios y preguntas, conectar tu web y probar que todo funcione.'
		});
	});

	it('never words the help as access to every patient or clinical record', () => {
		const texts = Object.values(ACCOUNT_ASSISTANCE_OPTIONS).flatMap((option) => Object.values(option));
		expect(texts.length).toBeGreaterThan(9);
		for (const text of texts) expect(text).not.toMatch(/historia|historial|clínic|todos tus pacientes/i);
	});
});

describe('assistance date and time', () => {
	it('always says the date as well as the time, in the practice time zone', () => {
		expect(formatAssistanceMoment('2026-11-08T13:15:00.000Z', BUENOS_AIRES, NOW)).toEqual({
			date: 'domingo 8 de noviembre',
			time: '10:15',
			full: 'el domingo 8 de noviembre a las 10:15',
			short: 'dom 8/11 10:15'
		});
	});

	it('writes midnight as 00:00 of the new day', () => {
		expect(formatAssistanceMoment('2026-11-02T03:00:00.000Z', BUENOS_AIRES, NOW)).toMatchObject({
			date: 'lunes 2 de noviembre',
			time: '00:00',
			short: 'lun 2/11 00:00'
		});
	});

	it('uses the practice time zone, not the one of the server', () => {
		expect(formatAssistanceMoment('2026-11-02T02:00:00.000Z', BUENOS_AIRES, NOW)?.full).toBe(
			'el domingo 1 de noviembre a las 23:00'
		);
		expect(formatAssistanceMoment('2026-11-02T02:00:00.000Z', 'UTC', NOW)?.full).toBe(
			'el lunes 2 de noviembre a las 02:00'
		);
	});

	it('adds the year only when it is not the current one', () => {
		const lateDecember = new Date('2026-12-30T15:00:00.000Z');
		expect(formatAssistanceMoment('2027-01-04T02:59:00.000Z', BUENOS_AIRES, lateDecember)).toEqual({
			date: 'domingo 3 de enero de 2027',
			time: '23:59',
			full: 'el domingo 3 de enero de 2027 a las 23:59',
			short: 'dom 3/1/2027 23:59'
		});
	});

	it('returns nothing for a date it cannot read', () => {
		expect(formatAssistanceMoment('', BUENOS_AIRES, NOW)).toBeNull();
		expect(formatAssistanceMoment('not a date', BUENOS_AIRES, NOW)).toBeNull();
	});
});

describe('how the assistance ended', () => {
	it('says who ended it and when, in the words approved', () => {
		const at = formatAssistanceMoment('2026-11-08T13:15:00.000Z', BUENOS_AIRES, NOW);
		expect(assistanceEndText('expired', at)).toBe('Venció el domingo 8 de noviembre a las 10:15. Cita Suite ya no puede entrar a tu cuenta.');
		expect(assistanceEndText('owner', at)).toBe('La terminaste el domingo 8 de noviembre a las 10:15. Cita Suite ya no puede entrar a tu cuenta.');
		expect(assistanceEndText('support', at)).toBe('Cita Suite la terminó el domingo 8 de noviembre a las 10:15. Ya no puede entrar a tu cuenta.');
	});
});
