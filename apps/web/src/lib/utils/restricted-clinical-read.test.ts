import { describe, expect, it } from 'vitest';
import { allowsRestrictedClinicalRead } from './restricted-clinical-read';

const restrictedOwner = {
	role: 'owner',
	commercialStatus: 'restricted',
	commercialAccessEnabled: true,
	canEnterApp: true
};

describe('restricted clinical read routes', () => {
	it.each([
		'/odonto/exportar-datos',
		'/odonto/pacientes',
		'/odonto/pacientes/papelera',
		'/odonto/pacientes/8b900b87-bcda-49b6-ad1a-6ff4e80b86dc',
		'/odonto/pacientes/018f22e2-3d75-7ee3-8f2d-47c8f9b5891a'
	])('lets a restricted owner reach %s in read-only mode', (pathname) => {
		expect(allowsRestrictedClinicalRead(pathname, restrictedOwner)).toBe(true);
	});

	it('also supports administrators', () => {
		expect(
			allowsRestrictedClinicalRead('/odonto/pacientes/papelera', {
				...restrictedOwner,
				role: 'admin'
			})
		).toBe(true);
	});

	it.each([
		'/odonto/pacientes/nuevo',
		'/odonto/pacientes/lista',
		'/odonto/pacientes/8b900b87-bcda-49b6-ad1a-6ff4e80b86dc/editar',
		'/odonto/agenda'
	])('does not broaden the exception to %s', (pathname) => {
		expect(allowsRestrictedClinicalRead(pathname, restrictedOwner)).toBe(false);
	});

	it.each([
		{ ...restrictedOwner, role: 'professional' },
		{ ...restrictedOwner, commercialStatus: 'archived', canEnterApp: false },
		{ ...restrictedOwner, commercialAccessEnabled: false, canEnterApp: false }
	])('keeps non-manager or unavailable accounts locked', (context) => {
		expect(allowsRestrictedClinicalRead('/odonto/pacientes', context)).toBe(false);
	});
});
