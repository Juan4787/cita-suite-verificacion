import { execSync } from 'node:child_process';
import cloudflareAdapter from '@sveltejs/adapter-cloudflare';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const isProd = process.env.NODE_ENV === 'production';
const gitRevision = (() => {
	try {
		return execSync('git rev-parse HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
	} catch {
		return '';
	}
})();
const buildVersion = process.env.CITA_BUILD_VERSION?.trim() || process.env.GIT_COMMIT_SHA?.trim() || gitRevision;

if (isProd && !buildVersion) {
	throw new Error('CITA_BUILD_VERSION o GIT_COMMIT_SHA es obligatorio para un build de producción reproducible.');
}

// Cloudflare Workers es el único destino de publicación del candidato comercial.
const adapter = cloudflareAdapter();

const config = {
	// Consult https://svelte.dev/docs/kit/integrations
	// for more information about preprocessors
	preprocess: vitePreprocess(),

	kit: {
		env: {
			dir: '../..'
		},
		adapter,
		version: {
			name: buildVersion || 'development',
			pollInterval: 0
		},
		csp: isProd
			? {
					mode: 'auto',
					directives: {
						'default-src': ['self'],
						'script-src': ['self', 'https://accounts.google.com', 'https://challenges.cloudflare.com'],
						'style-src': ['self', 'https://fonts.googleapis.com'],
						'style-src-elem': ['self', 'https://fonts.googleapis.com'],
						'style-src-attr': ['unsafe-inline'],
						'font-src': ['self', 'https://fonts.gstatic.com'],
						'img-src': ['self', 'data:', 'blob:', 'https://*.supabase.co'],
						'connect-src': [
							'self',
							'https://accounts.google.com',
							'https://fonts.googleapis.com',
							'https://fonts.gstatic.com',
							'https://oauth2.googleapis.com',
							'https://www.googleapis.com',
							'https://*.supabase.co',
							'wss://*.supabase.co'
						],
						'frame-src': ['https://accounts.google.com', 'https://challenges.cloudflare.com'],
						'base-uri': ['self'],
						// Mercado Pago: el action de suscripción responde al POST del
						// form con un 303 al checkout de MP; los navegadores aplican
						// form-action a toda la cadena de redirects del envío.
						'form-action': [
							'self',
							'https://*.mercadopago.com.ar',
							'https://*.mercadopago.com'
						]
					}
			  }
			: undefined
	}
};

export default config;
