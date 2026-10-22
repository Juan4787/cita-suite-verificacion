import { defineConfig } from '@playwright/test';
import { assertE2EEnvironment } from '../../scripts/lib/e2e-environment.mjs';

const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5173';
assertE2EEnvironment(process.env, baseURL);
const shouldStartServer = !process.env.E2E_BASE_URL;
const cloudflareVersion = process.env.E2E_CLOUDFLARE_VERSION?.trim();
const extraHTTPHeaders = cloudflareVersion
	? {
			'Cloudflare-Workers-Version-Overrides': `app="${cloudflareVersion}"`
		}
	: undefined;

export default defineConfig({
	testDir: 'e2e',
	outputDir: process.env.PLAYWRIGHT_OUTPUT_DIR ?? 'test-results',
	timeout: 60_000,
	expect: {
		timeout: 10_000
	},
	fullyParallel: false,
	workers: 1,
	retries: process.env.CI ? 1 : 0,
	use: {
		baseURL,
		// The disposable fixture serves its embedding website over loopback HTTPS, with a
		// certificate created for that run only; every other origin there is loopback too.
		ignoreHTTPSErrors: process.env.CITA_E2E_ENVIRONMENT === 'disposable',
		actionTimeout: 15_000,
		navigationTimeout: 60_000,
		extraHTTPHeaders,
		trace: 'on-first-retry',
		screenshot: 'only-on-failure',
		video: 'retain-on-failure'
	},
	webServer: shouldStartServer
		? {
				command: 'pnpm dev -- --host 127.0.0.1 --port 5173',
				url: baseURL,
				reuseExistingServer: !process.env.CI,
				timeout: 120_000
			}
		: undefined
});
