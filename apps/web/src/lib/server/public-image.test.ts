import { beforeEach, describe, expect, it, vi } from 'vitest';

const envState = vi.hoisted(() => ({
	privateEnv: {} as Record<string, string | undefined>,
	publicEnv: {} as Record<string, string | undefined>
}));

vi.mock('$env/dynamic/private', () => ({ env: envState.privateEnv }));
vi.mock('$env/dynamic/public', () => ({ env: envState.publicEnv }));

import { isAllowedPublicImageUrl, sanitizePublicImageUrl } from './public-image';

describe('orígenes de imágenes públicas', () => {
	beforeEach(() => {
		for (const key of Object.keys(envState.privateEnv)) delete envState.privateEnv[key];
		for (const key of Object.keys(envState.publicEnv)) delete envState.publicEnv[key];
		envState.privateEnv.ODONTO_SUPABASE_URL = 'https://yjzferwuzbtgpmdnzlcb.supabase.co';
	});

	it('acepta recursos propios y del proyecto Supabase', () => {
		expect(isAllowedPublicImageUrl('/logo.png')).toBe(true);
		expect(isAllowedPublicImageUrl('https://app.cita-suite.workers.dev/logo.png')).toBe(true);
		expect(isAllowedPublicImageUrl('https://yjzferwuzbtgpmdnzlcb.supabase.co/storage/v1/object/public/logo.png')).toBe(true);
		envState.publicEnv.PUBLIC_SITE_URL = 'https://agenda.cita-suite.example/';
		expect(isAllowedPublicImageUrl('https://agenda.cita-suite.example/logo.png')).toBe(true);
	});

	it('rechaza terceros, look-alikes, protocolos inseguros y destinos ambiguos', () => {
		for (const value of [
			'https://example.com/logo.png',
			'https://yjzferwuzbtgpmdnzlcb.supabase.co.evil.example/logo.png',
			'http://app.cita-suite.workers.dev/logo.png',
			'https://app.cita-suite.workers.dev.evil.example/logo.png',
			'https://app.cita-suite.workers.dev:444/logo.png',
			'//example.com/logo.png',
			'javascript:alert(1)'
		]) {
			expect(isAllowedPublicImageUrl(value), value).toBe(false);
		}
	});

	it('limita tamaño y devuelve null para valores heredados no permitidos', () => {
		expect(isAllowedPublicImageUrl(`https://example.com/${'x'.repeat(2048)}`)).toBe(false);
		expect(sanitizePublicImageUrl('  /logo.png  ')).toBe('/logo.png');
		expect(sanitizePublicImageUrl('https://example.com/logo.png')).toBeNull();
	});
});
