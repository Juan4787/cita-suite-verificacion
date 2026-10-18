#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import crypto from 'node:crypto';

const REQUIRED_ENV = [
	'ODONTO_SUPABASE_URL',
	'ODONTO_SUPABASE_ANON_KEY',
	'ODONTO_SUPABASE_SERVICE_ROLE_KEY',
	'PUBLIC_ODONTO_SUPABASE_URL',
	'PUBLIC_ODONTO_SUPABASE_ANON_KEY',
	'PUBLIC_SITE_URL',
	'INTERNAL_JOB_SECRET',
	'VAPID_PUBLIC_KEY',
	'PUBLIC_VAPID_PUBLIC_KEY',
	'VAPID_PRIVATE_KEY',
	'VAPID_SUBJECT',
	'DEMO_MODE',
	'MASTER_EMAIL',
	'MP_ACCESS_TOKEN',
	'MP_WEBHOOK_SECRET',
	'MP_ENVIRONMENT'
];

const RECOMMENDED_ENV = [
	'ADMIN_SUPABASE_URL',
	'ADMIN_SUPABASE_ANON_KEY',
	'ADMIN_SUPABASE_SERVICE_ROLE_KEY',
	'PUBLIC_TURNSTILE_SITE_KEY',
	'TURNSTILE_SECRET_KEY',
	'MP_SUBSCRIPTION_AMOUNT_ARS'
];

const SECRET_KEYS = new Set([
	'ODONTO_SUPABASE_ANON_KEY',
	'ODONTO_SUPABASE_SERVICE_ROLE_KEY',
	'ADMIN_SUPABASE_ANON_KEY',
	'ADMIN_SUPABASE_SERVICE_ROLE_KEY',
	'PUBLIC_ODONTO_SUPABASE_ANON_KEY',
	'TURNSTILE_SECRET_KEY',
	'PUBLIC_TURNSTILE_SITE_KEY',
	'INTERNAL_JOB_SECRET',
	'VAPID_PRIVATE_KEY',
	'WHATSAPP_VERIFY_TOKEN',
	'WHATSAPP_APP_SECRET',
	'WHATSAPP_ACCESS_TOKEN',
	'MP_ACCESS_TOKEN',
	'MP_WEBHOOK_SECRET'
]);

const PLACEHOLDER_PARTS = ['your-', 'xxxxx', 'odonto-anon-key', 'odonto-service-role-key', 'admin-anon-key', 'admin-service-role-key'];

const REQUIRED_FILES = [
	'supabase/migrations/20251231000000_existing_odonto_base.sql',
	'supabase/migrations/20260513000000_multi_tenant_base.sql',
	'supabase/migrations/20260513010000_agenda_core.sql',
	'supabase/migrations/20260513020000_panel_operational_hardening.sql',
	'supabase/migrations/20260513030000_public_booking.sql',
	'supabase/migrations/20260513040000_whatsapp_messaging.sql',
	'supabase/migrations/20260528052136_business_subscriptions_access.sql',
	'apps/web/src/routes/reservar/[businessSlug]/+page.server.ts',
	'apps/web/src/routes/reservar/[businessSlug]/+page.svelte',
	'apps/web/src/routes/turno/[token]/+page.server.ts',
	'apps/web/src/routes/turno/[token]/+page.svelte',
	'apps/web/src/routes/confirmar/[token]/+page.server.ts',
	'apps/web/src/routes/cancelar/[token]/+page.server.ts',
	'apps/web/src/routes/reprogramar/[token]/+page.server.ts',
	'apps/web/src/routes/api/whatsapp/webhook/+server.ts',
	'apps/web/src/routes/api/mercadopago/webhook/+server.ts',
	'apps/web/src/lib/server/integrations/public/mercadopago.ts',
	'supabase/migrations/20260704120000_mercadopago_billing.sql',
	'supabase/migrations/20260704130000_mp_billing_hardening.sql',
	'supabase/migrations/20260710210000_prevent_cross_business_email_association.sql',
	'supabase/migrations/20260711010000_limit_public_bookings_by_patient_name.sql',
	'supabase/migrations/20260711013000_restore_audit_security_event.sql',
	'supabase/migrations/20260802235900_push_delivery_observability.sql',
	'supabase/migrations/20260823010000_decouple_patient_phone_identity.sql',
	'supabase/migrations/20260823020000_safe_appointment_patient_reassignment.sql',
	'supabase/migrations/20260823040000_protect_appointment_identity_fields.sql',
	'apps/web/src/routes/internal/jobs/generate-reminder-dispatches/+server.ts',
	'apps/web/src/routes/internal/jobs/process-message-dispatches/+server.ts',
	'apps/web/src/routes/internal/jobs/send-push-reminders/+server.ts',
	'apps/web/src/routes/turno/[token]/push/+server.ts',
	'apps/web/src/routes/turno/[token]/push/receipt/+server.ts',
	'apps/web/src/lib/server/integrations/public/push.ts',
	'apps/web/static/push-sw.js',
	'apps/web/src/routes/odonto/configuracion/whatsapp/+page.server.ts',
	'apps/web/src/routes/odonto/configuracion/whatsapp/+page.svelte',
	'apps/web/src/routes/odonto/configuracion/suscripcion/+page.server.ts',
	'apps/web/src/routes/odonto/configuracion/suscripcion/+page.svelte',
	'apps/web/src/routes/odonto/mensajes/+page.server.ts',
	'apps/web/src/routes/odonto/mensajes/+page.svelte',
	'apps/web/src/routes/odonto/recordatorios/+page.server.ts',
	'apps/web/src/routes/odonto/recordatorios/+page.svelte',
	'apps/web/src/lib/server/scheduling/public/public-booking.ts',
	'apps/web/src/lib/server/scheduling/public/public-appointments.ts',
	'apps/web/src/lib/access/commercial-access.ts',
	'apps/web/src/lib/server/integrations/public/messaging.ts',
	'apps/web/src/lib/server/integrations/public/internal-jobs.ts'
];

const REQUIRED_REMOTE_TABLES = [
	'allowed_emails',
	'businesses',
	'business_users',
	'professionals',
	'professional_users',
	'services',
	'professional_services',
	'availability_rules',
	'availability_exceptions',
	'patients',
	'appointments',
	'audit_logs',
	'public_booking_attempts',
	'business_subscriptions',
	'access_grants',
	'messaging_accounts',
	'message_templates',
	'message_dispatches',
	'push_subscriptions',
	'push_delivery_attempts',
	'inbound_messages',
	'whatsapp_webhook_events',
	'mp_subscriptions',
	'mp_webhook_events'
];

const REQUIRED_REMOTE_RPCS = [
	'create_appointment_with_patient_identity',
	'get_public_booking_active_future_count_for_request',
	'reassign_appointment_patient_safely',
	'claim_due_push_reminders'
];

const args = new Set(process.argv.slice(2));
const shouldCheckRemote = args.has('--remote');

const log = (message = '') => console.log(message);
const ok = (message) => log(`[OK] ${message}`);
const warn = (message) => log(`[WARN] ${message}`);
const failLine = (message) => log(`[FAIL] ${message}`);

const findRepoRoot = (start) => {
	let current = path.resolve(start);
	while (current !== path.dirname(current)) {
		if (fs.existsSync(path.join(current, 'pnpm-workspace.yaml'))) return current;
		current = path.dirname(current);
	}
	return path.resolve(start);
};

const parseEnvFile = (filePath) => {
	if (!fs.existsSync(filePath)) return {};
	const result = {};
	const lines = fs.readFileSync(filePath, 'utf8').split(/\r?\n/);
	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#')) continue;
		const index = trimmed.indexOf('=');
		if (index === -1) continue;
		const key = trimmed.slice(0, index).trim();
		let value = trimmed.slice(index + 1).trim();
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}
		result[key] = value;
	}
	return result;
};

const repoRoot = findRepoRoot(process.cwd());
const envPath = path.join(repoRoot, '.env');
const envFile = parseEnvFile(envPath);
const env = { ...envFile, ...process.env };

const valueOf = (key) => String(env[key] ?? '').trim();
const isMissing = (key) => valueOf(key).length === 0;
const isPlaceholder = (key) => {
	const value = valueOf(key).toLowerCase();
	return Boolean(value && PLACEHOLDER_PARTS.some((part) => value.includes(part)));
};

const describeValue = (key) => {
	const value = valueOf(key);
	if (!value) return 'missing';
	if (key.endsWith('_URL') || key === 'PUBLIC_SITE_URL') {
		try {
			return new URL(value).origin;
		} catch {
			return 'invalid-url';
		}
	}
	if (key === 'DEMO_MODE' || key === 'MASTER_EMAIL') return value;
	if (SECRET_KEYS.has(key)) return `set (${value.length} chars)`;
	return 'set';
};

const validateUrl = (key, failures) => {
	const value = valueOf(key);
	if (!value) return;
	try {
		new URL(value);
	} catch {
		failures.push(`${key} is not a valid URL`);
	}
};

const decodeBase64Url = (value) => {
	const padding = '='.repeat((4 - (value.length % 4)) % 4);
	return Buffer.from((value + padding).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
};

const validateVapidPair = (failures) => {
	const publicKeyValue = valueOf('VAPID_PUBLIC_KEY');
	const publicBrowserValue = valueOf('PUBLIC_VAPID_PUBLIC_KEY');
	const privateKeyValue = valueOf('VAPID_PRIVATE_KEY');
	if (!publicKeyValue || !publicBrowserValue || !privateKeyValue) return;
	try {
		const publicKey = decodeBase64Url(publicKeyValue);
		const browserPublicKey = decodeBase64Url(publicBrowserValue);
		const privateKey = decodeBase64Url(privateKeyValue);
		if (publicKey.length !== 65 || browserPublicKey.length !== 65 || privateKey.length !== 32) {
			throw new Error('invalid VAPID key length');
		}
		if (!crypto.timingSafeEqual(publicKey, browserPublicKey)) {
			failures.push('VAPID_PUBLIC_KEY and PUBLIC_VAPID_PUBLIC_KEY must match');
			failLine('VAPID public keys do not match');
			return;
		}
		const ecdh = crypto.createECDH('prime256v1');
		ecdh.setPrivateKey(privateKey);
		const derivedPublicKey = ecdh.getPublicKey();
		if (!crypto.timingSafeEqual(publicKey, derivedPublicKey)) {
			failures.push('VAPID public and private keys are not a cryptographic pair');
			failLine('VAPID public/private keys do not form a pair');
		}
	} catch {
		failures.push('VAPID keys are not valid P-256 base64url keys');
		failLine('VAPID keys have an invalid format');
	}

	const subject = valueOf('VAPID_SUBJECT');
	if (subject && !subject.startsWith('mailto:') && !subject.startsWith('https://')) {
		failures.push('VAPID_SUBJECT must start with mailto: or https://');
		failLine('VAPID_SUBJECT must start with mailto: or https://');
	}
};

const main = async () => {
	const failures = [];
	const warnings = [];

	log('Staging preflight for Bloque 3.5 / Bloque 4');
	log(`Repo root: ${repoRoot}`);
	log(`Env file: ${fs.existsSync(envPath) ? envPath : 'missing .env'}`);
	log(`Remote DB check: ${shouldCheckRemote ? 'enabled' : 'disabled (use --remote)'}`);
	log('');

	log('Required files');
	for (const relative of REQUIRED_FILES) {
		const exists = fs.existsSync(path.join(repoRoot, relative));
		if (exists) ok(relative);
		else {
			failLine(relative);
			failures.push(`Missing file: ${relative}`);
		}
	}

	log('');
	log('Required env');
	for (const key of REQUIRED_ENV) {
		if (isMissing(key)) {
			failLine(`${key}: missing`);
			failures.push(`${key} is missing`);
			continue;
		}
		if (isPlaceholder(key)) {
			failLine(`${key}: placeholder value`);
			failures.push(`${key} still has a placeholder value`);
			continue;
		}
		ok(`${key}: ${describeValue(key)}`);
	}

	log('');
	log('Recommended env');
	for (const key of RECOMMENDED_ENV) {
		if (isMissing(key)) {
			warn(`${key}: missing`);
			warnings.push(`${key} is missing`);
			continue;
		}
		if (isPlaceholder(key)) {
			warn(`${key}: placeholder value`);
			warnings.push(`${key} still has a placeholder value`);
			continue;
		}
		ok(`${key}: ${describeValue(key)}`);
	}

	validateUrl('ODONTO_SUPABASE_URL', failures);
	validateUrl('PUBLIC_ODONTO_SUPABASE_URL', failures);
	validateUrl('PUBLIC_SITE_URL', failures);
	validateVapidPair(failures);

	if (valueOf('DEMO_MODE') !== 'false') {
		failures.push('DEMO_MODE must be false for staging');
		failLine('DEMO_MODE must be false for staging');
	}

	if (valueOf('ODONTO_SUPABASE_URL') && valueOf('PUBLIC_ODONTO_SUPABASE_URL') && valueOf('ODONTO_SUPABASE_URL') !== valueOf('PUBLIC_ODONTO_SUPABASE_URL')) {
		warnings.push('ODONTO_SUPABASE_URL and PUBLIC_ODONTO_SUPABASE_URL do not match');
		warn('ODONTO_SUPABASE_URL and PUBLIC_ODONTO_SUPABASE_URL do not match');
	}

	if (valueOf('ODONTO_SUPABASE_ANON_KEY') && valueOf('PUBLIC_ODONTO_SUPABASE_ANON_KEY') && valueOf('ODONTO_SUPABASE_ANON_KEY') !== valueOf('PUBLIC_ODONTO_SUPABASE_ANON_KEY')) {
		warnings.push('ODONTO_SUPABASE_ANON_KEY and PUBLIC_ODONTO_SUPABASE_ANON_KEY do not match');
		warn('ODONTO_SUPABASE_ANON_KEY and PUBLIC_ODONTO_SUPABASE_ANON_KEY do not match');
	}

	if (valueOf('ODONTO_SUPABASE_ANON_KEY') && valueOf('ODONTO_SUPABASE_ANON_KEY') === valueOf('ODONTO_SUPABASE_SERVICE_ROLE_KEY')) {
		failures.push('Anon key and service role key must not be the same');
		failLine('Anon key and service role key must not be the same');
	}

	if (valueOf('PUBLIC_SITE_URL').includes('localhost') || valueOf('PUBLIC_SITE_URL').includes('127.0.0.1')) {
		warnings.push('PUBLIC_SITE_URL points to localhost; OK for local, not OK for deployed staging');
		warn('PUBLIC_SITE_URL points to localhost; OK for local, not OK for deployed staging');
	}

	if (!['test', 'production'].includes(valueOf('MP_ENVIRONMENT'))) {
		failures.push('MP_ENVIRONMENT must be test or production');
		failLine('MP_ENVIRONMENT must be test or production');
	}
	if (valueOf('MP_ENVIRONMENT') === 'production' && valueOf('MP_ACCESS_TOKEN').startsWith('TEST-')) {
		failures.push('MP_ENVIRONMENT=production cannot use a TEST- access token');
		failLine('MP_ENVIRONMENT=production cannot use a TEST- access token');
	}

	const hasTurnstileSite = Boolean(valueOf('PUBLIC_TURNSTILE_SITE_KEY'));
	const hasTurnstileSecret = Boolean(valueOf('TURNSTILE_SECRET_KEY'));
	if (hasTurnstileSite !== hasTurnstileSecret) {
		failures.push('Turnstile must set both PUBLIC_TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY, or neither');
		failLine('Turnstile must set both PUBLIC_TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY, or neither');
	}

	if (shouldCheckRemote && failures.length === 0) {
		log('');
		log('Remote Supabase schema');
		const restBaseUrl = `${valueOf('ODONTO_SUPABASE_URL').replace(/\/$/, '')}/rest/v1`;
		const serviceRoleKey = valueOf('ODONTO_SUPABASE_SERVICE_ROLE_KEY');
		for (const table of REQUIRED_REMOTE_TABLES) {
			const response = await fetch(`${restBaseUrl}/${table}?select=id&limit=1`, {
				headers: {
					apikey: serviceRoleKey,
					Authorization: `Bearer ${serviceRoleKey}`,
					Accept: 'application/json'
				}
			});
			if (!response.ok) {
				const detail = await response.text().catch(() => '');
				failLine(`${table}: HTTP ${response.status}${detail ? ` - ${detail.slice(0, 180)}` : ''}`);
				failures.push(`Remote table check failed for ${table}: HTTP ${response.status}`);
			} else {
				ok(`${table}`);
			}
		}

		const schemaResponse = await fetch(`${restBaseUrl}/`, {
			headers: {
				apikey: serviceRoleKey,
				Authorization: `Bearer ${serviceRoleKey}`,
				Accept: 'application/openapi+json'
			}
		});
		if (!schemaResponse.ok) {
			failLine(`PostgREST OpenAPI: HTTP ${schemaResponse.status}`);
			failures.push(`Remote PostgREST schema check failed: HTTP ${schemaResponse.status}`);
		} else {
			const schema = await schemaResponse.json();
			const paths = new Set(Object.keys(schema?.paths ?? {}));
			for (const rpc of REQUIRED_REMOTE_RPCS) {
				if (paths.has(`/rpc/${rpc}`)) ok(`rpc/${rpc}`);
				else {
					failLine(`rpc/${rpc}: missing`);
					failures.push(`Remote RPC is missing: ${rpc}`);
				}
			}
		}
	} else if (shouldCheckRemote) {
		warn('Skipping remote Supabase schema check because env/file checks failed first');
	}

	log('');
	log('Summary');
	log(`Failures: ${failures.length}`);
	log(`Warnings: ${warnings.length}`);
	if (warnings.length > 0) {
		for (const item of warnings) warn(item);
	}
	if (failures.length > 0) {
		for (const item of failures) failLine(item);
		process.exitCode = 1;
		return;
	}
	ok('Preflight passed');
};

main().catch((error) => {
	failLine(error?.message ?? String(error));
	process.exitCode = 1;
});
