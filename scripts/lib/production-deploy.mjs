import { CLOUDFLARE_ACCOUNT_ID } from './staging-deploy.mjs';

// The only Cloudflare targets the production deployment accepts: the Worker `app`, which
// serves https://app.cita-suite.workers.dev next to the production database, and its scheduler.
export const PRODUCTION_APP_WORKER = 'app';
export const PRODUCTION_SCHEDULER_WORKER = 'cita-suite-scheduler';
export const PRODUCTION_APP_ORIGIN = 'https://app.cita-suite.workers.dev';
// Natalia's published site and the public key of the integration it books through.
export const PRODUCTION_NATALIA_ORIGIN = 'https://natalia-frutos.vercel.app';
export const PRODUCTION_NATALIA_INTEGRATION_KEY = '9af3540420584670a6f1bad47711501b';
const refused = () => new Error('The configuration is not the production target. Nothing was deployed.');

// Secrets the application reads at runtime and production must already hold. The deployment
// never writes them: their values stay where they are.
export const PRODUCTION_APP_SECRETS = Object.freeze([
	'INTERNAL_JOB_SECRET', 'MASTER_EMAIL', 'ODONTO_SUPABASE_ANON_KEY', 'ODONTO_SUPABASE_SERVICE_ROLE_KEY', 'ODONTO_SUPABASE_URL',
	'PUBLIC_ODONTO_SUPABASE_ANON_KEY', 'PUBLIC_ODONTO_SUPABASE_URL', 'PUBLIC_VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_PUBLIC_KEY', 'VAPID_SUBJECT'
]);

/** The production app: its name, account, origin and placement next to the database; no routes and no crons. */
export function assertProductionAppConfig(config) {
	if (config?.name !== PRODUCTION_APP_WORKER || config.account_id !== CLOUDFLARE_ACCOUNT_ID ||
		config.vars?.PUBLIC_SITE_URL !== PRODUCTION_APP_ORIGIN || config.placement?.region !== 'aws:sa-east-1' ||
		'env' in config || 'routes' in config || 'route' in config || 'triggers' in config)
		throw refused();
	return config;
}

/** The production scheduler: its name, the plan's five crons and a binding to the production app. */
export function assertProductionSchedulerConfig(config) {
	const crons = config?.triggers?.crons;
	if (config?.name !== PRODUCTION_SCHEDULER_WORKER || config.account_id !== CLOUDFLARE_ACCOUNT_ID ||
		JSON.stringify(config.services) !== JSON.stringify([{ binding: 'APP', service: PRODUCTION_APP_WORKER }]) ||
		!Array.isArray(crons) || crons.length !== 5 || 'routes' in config || 'route' in config || config.workers_dev !== false)
		throw refused();
	return config;
}

/** Required secrets missing from the names `wrangler secret list` reports. */
export const missingSecrets = (names) => PRODUCTION_APP_SECRETS.filter((name) => !names.includes(name));
