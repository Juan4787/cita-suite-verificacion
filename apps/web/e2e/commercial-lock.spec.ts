import { expect, test } from '@playwright/test';
import { signInWithPassword } from './helpers/shared-auth';
import { createFixtureClient, must, write, type FixtureClient } from './helpers/fixture-db';
import fs from 'node:fs';
import path from 'node:path';

const expiredEmail = process.env.E2E_EXPIRED_EMAIL;
const expiredPassword = process.env.E2E_EXPIRED_PASSWORD ?? 'E2eLocked!2026';
const validateMpRedirect = process.env.E2E_VALIDATE_MP_REDIRECT === 'true';

const readEnvFile = () => {
	let current = process.cwd();
	for (let depth = 0; depth < 5; depth += 1) {
		const candidate = path.join(current, '.env');
		if (fs.existsSync(candidate)) {
			const env: Record<string, string> = {};
			for (const line of fs.readFileSync(candidate, 'utf8').split(/\r?\n/)) {
				const trimmed = line.trim();
				if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
				const index = trimmed.indexOf('=');
				const key = trimmed.slice(0, index).trim();
				let value = trimmed.slice(index + 1).trim();
				if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
					value = value.slice(1, -1);
				}
				env[key] = value;
			}
			return env;
		}
		current = path.dirname(current);
	}
	return {};
};

const runtimeEnv = () => ({ ...readEnvFile(), ...process.env });
const env = runtimeEnv();
const supabaseUrl = env.ODONTO_SUPABASE_URL;
const serviceRoleKey = env.ODONTO_SUPABASE_SERVICE_ROLE_KEY;

type Fixture = {
	email: string;
	password: string;
	userId: string;
	businessId: string;
};

const unique = () => `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
const canCreateFixture = Boolean(supabaseUrl && serviceRoleKey);
let fixture: Fixture | null = null;

const adminClient = () => {
	if (!supabaseUrl || !serviceRoleKey) {
		throw new Error('Faltan ODONTO_SUPABASE_URL u ODONTO_SUPABASE_SERVICE_ROLE_KEY.');
	}
	return createFixtureClient(supabaseUrl, serviceRoleKey);
};

const createBlockedFixture = async (admin: FixtureClient): Promise<Fixture> => {
	const suffix = unique();
	const email = `e2e-commercial-lock-${suffix}@example.com`;
	const password = expiredPassword;
	const authResult = await admin.auth.admin.createUser({
		email,
		password,
		email_confirm: true
	});
	if (authResult.error || !authResult.data.user?.id) {
		throw authResult.error ?? new Error('No se creó el usuario de bloqueo comercial.');
	}
	const userId = authResult.data.user.id;

	const business = await must(
		admin
			.from('businesses')
			.insert({
				name: `E2E Bloqueado ${suffix}`,
				slug: `e2e-bloqueado-${suffix}`,
				industry: 'odontology',
				timezone: 'America/Argentina/Cordoba',
				public_booking_enabled: true,
				is_active: true
			})
			.select('id')
			.single()
	);

	await write(admin.from('allowed_emails').upsert({ email, enabled: true }, { onConflict: 'email' }));
	await write(
		admin.from('business_users').insert({
			business_id: business.id,
			user_id: userId,
			role: 'owner',
			status: 'active',
			accepted_at: new Date().toISOString()
		})
	);
	await write(
		admin.from('business_subscriptions').upsert(
			{
				business_id: business.id,
				commercial_access_enabled: true,
				is_permanent: false,
				subscription_status: 'restricted',
				paid_until: null,
				grace_until: null,
				restricted_until: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
				archived_at: null,
				last_payment_at: null
			},
			{ onConflict: 'business_id' }
		)
	);

	return { email, password, userId, businessId: business.id };
};

const cleanupFixture = async (admin: FixtureClient, target: Fixture | null) => {
	if (!target) return;
	await write(admin.from('businesses').delete().eq('id', target.businessId));
	await write(admin.from('allowed_emails').delete().eq('email', target.email));
	const { error } = await admin.auth.admin.deleteUser(target.userId);
	if (error) throw new Error('Owned commercial lock account cleanup failed.');
};

test.describe('Acceso comercial bloqueado', () => {
	test.skip(
		process.env.DEMO_MODE === 'true',
		'El modo demo no autentica la cuenta bloqueada ni debe crear fixtures comerciales reales.'
	);
	test.skip(
		!canCreateFixture && (!expiredEmail || !expiredPassword),
		'Definí ODONTO_SUPABASE_URL + ODONTO_SUPABASE_SERVICE_ROLE_KEY o E2E_EXPIRED_EMAIL/E2E_EXPIRED_PASSWORD.'
	);

	test.beforeAll(async () => {
		if (!canCreateFixture) return;
		fixture = await createBlockedFixture(adminClient());
	});

	test.afterAll(async () => {
		if (!canCreateFixture) return;
		await cleanupFixture(adminClient(), fixture);
	});

	const loginBlockedAccount = async (page: import('@playwright/test').Page) => {
		await signInWithPassword(page, fixture?.email ?? expiredEmail ?? '', fixture?.password ?? expiredPassword);
		await expect(
			page.getByRole('heading', { name: /Activá tu suscripción|Tu acceso a Cita Suite venció/ })
		).toBeVisible();
	};

	test('muestra la pantalla universal y el CTA inicia Mercado Pago sin página intermedia', async ({
		page
	}) => {
		await loginBlockedAccount(page);
		const cta = page.getByRole('button', { name: 'Activar suscripción con Mercado Pago' });
		await expect(cta).toBeVisible();

		if (!validateMpRedirect) return;

		await cta.click();
		await page.waitForURL(/mercadopago|mercadolibre/, { timeout: 45_000 });
		await expect(page).toHaveURL(/mercadopago|mercadolibre/);
	});

	test('en mobile mantiene salida disponible desde la pantalla de activación', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await loginBlockedAccount(page);
		await page.screenshot({ type: 'jpeg', quality: 65, path: test.info().outputPath('commercial-lock-mobile.jpg'), fullPage: false });

		const menuButton = page.getByRole('button', { name: 'Abrir menú' }).last();
		await expect(menuButton).toBeVisible();
		const dialog = page.getByRole('dialog', { name: 'Menú de navegación' });
		await menuButton.click();
		await expect(dialog).toBeVisible();
		const logout = dialog.getByRole('button', { name: 'Salir', exact: true });
		await expect(logout).toBeVisible();
		await expect(logout).toBeInViewport();
		await page.screenshot({ type: 'jpeg', quality: 65, path: test.info().outputPath('commercial-lock-mobile-menu.jpg'), fullPage: false });
	});
});
