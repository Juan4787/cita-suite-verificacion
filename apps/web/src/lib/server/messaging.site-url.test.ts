import { beforeEach, describe, expect, it, vi } from 'vitest';

const envState = vi.hoisted(() => ({
	privateEnv: {} as Record<string, string | undefined>,
	publicEnv: {} as Record<string, string | undefined>
}));

vi.mock('$env/dynamic/private', () => ({ env: envState.privateEnv }));
vi.mock('$env/dynamic/public', () => ({ env: envState.publicEnv }));

import { getPublicSiteUrl } from './messaging';

describe('URL pública del sitio', () => {
	beforeEach(() => {
		for (const key of Object.keys(envState.privateEnv)) delete envState.privateEnv[key];
		for (const key of Object.keys(envState.publicEnv)) delete envState.publicEnv[key];
	});

	it('rechaza hosts históricos de Netlify y Vercel', () => {
		for (const host of ['cita-suite.netlify.app', 'cita-suite.vercel.app']) {
			envState.privateEnv.PUBLIC_SITE_URL = `https://${host}`;
			expect(getPublicSiteUrl()).toBe('https://app.cita-suite.workers.dev');
		}
	});

	it('conserva el dominio HTTPS configurado que no sea legado', () => {
		envState.publicEnv.PUBLIC_SITE_URL = 'https://agenda.cita-suite.example/';
		expect(getPublicSiteUrl()).toBe('https://agenda.cita-suite.example');
	});

	it('usa el Worker por defecto si la configuración no es una URL', () => {
		envState.privateEnv.PUBLIC_SITE_URL = 'no-es-una-url';
		expect(getPublicSiteUrl()).toBe('https://app.cita-suite.workers.dev');
	});

	it('rechaza HTTP en dominios públicos pero conserva localhost para desarrollo', () => {
		envState.privateEnv.PUBLIC_SITE_URL = 'http://agenda.cita-suite.example';
		expect(getPublicSiteUrl()).toBe('https://app.cita-suite.workers.dev');
		envState.privateEnv.PUBLIC_SITE_URL = 'http://localhost:5173/';
		expect(getPublicSiteUrl()).toBe('http://localhost:5173');
	});
});
