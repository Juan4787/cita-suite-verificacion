import { describe, expect, it } from 'vitest';
import { defaultManualAccessNote, visibleCommercialAccessNote } from './commercial-access-copy';

describe('commercial access copy', () => {
	it('hides stale activation copy after manual access is already usable', () => {
		expect(visibleCommercialAccessNote('Cuenta pendiente de activación de suscripción.', true)).toBeNull();
		expect(
			visibleCommercialAccessNote(
				'Suscripción pendiente de configuración explícita desde panel maestro.',
				true
			)
		).toBeNull();
	});

	it('keeps the activation copy while access is actually restricted', () => {
		expect(visibleCommercialAccessNote('Cuenta pendiente de activación de suscripción.', false)).toBe(
			'Cuenta pendiente de activación de suscripción.'
		);
	});

	it('keeps a specific administrator note on active access', () => {
		expect(visibleCommercialAccessNote('Bonificación acordada hasta agosto.', true)).toBe(
			'Bonificación acordada hasta agosto.'
		);
	});

	it('generates precise default notes for manual activation operations', () => {
		expect(defaultManualAccessNote('grant_access')).toBe(
			'Acceso habilitado manualmente por el administrador.'
		);
		expect(defaultManualAccessNote('set_permanent')).toBe(
			'Acceso permanente habilitado manualmente por el administrador.'
		);
		expect(defaultManualAccessNote('payment_registered')).toBeNull();
	});
});
