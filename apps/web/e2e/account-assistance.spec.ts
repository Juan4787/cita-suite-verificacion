import { expect, test } from '@playwright/test';
import { signInWithPassword } from './helpers/shared-auth';
import { createFixtureClient, must, write, type FixtureClient } from './helpers/fixture-db';
import fs from 'node:fs';
import path from 'node:path';

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

const env = { ...readEnvFile(), ...process.env };
const supabaseUrl = env.ODONTO_SUPABASE_URL;
const serviceRoleKey = env.ODONTO_SUPABASE_SERVICE_ROLE_KEY;
const masterEmail = (env.MASTER_EMAIL ?? 'juanpabloaltamira@protonmail.com').trim().toLowerCase();
const isLocalSupabase = Boolean(supabaseUrl?.startsWith('http://127.0.0.1') || supabaseUrl?.startsWith('http://localhost'));
const masterPassword = env.E2E_MASTER_PASSWORD ?? (isLocalSupabase ? 'E2eMasterLocal!2026' : '');
const password = 'E2eAssistance!2026';

type Fixture = {
	email: string;
	userId: string;
	adminEmail: string;
	adminUserId: string;
	businessId: string;
	businessName: string;
	businessSlug: string;
	professionalId: string;
};

let fixture: Fixture | null = null;
let setupError: string | null = null;
let createdMasterUserId: string | null = null;

const unique = () => `${Date.now()}-${Math.floor(Math.random() * 100000)}`;

const adminClient = () => {
	if (!supabaseUrl || !serviceRoleKey) {
		throw new Error('Faltan ODONTO_SUPABASE_URL u ODONTO_SUPABASE_SERVICE_ROLE_KEY.');
	}
	return createFixtureClient(supabaseUrl, serviceRoleKey);
};

const findAuthUserByEmail = async (admin: FixtureClient, email: string) => {
	for (let page = 1; page <= 20; page += 1) {
		const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
		if (error) throw error;
		const user = data.users.find((item) => item.email?.trim().toLowerCase() === email);
		if (user) return user;
		if (data.users.length < 1000) return null;
	}
	return null;
};

const createFixture = async (admin: FixtureClient): Promise<Fixture> => {
	const schemaProbe = await admin.from('account_assistance_grants').select('id').limit(1);
	if (schemaProbe.error) throw schemaProbe.error;

	let master = await findAuthUserByEmail(admin, masterEmail);
	if (!master?.id && isLocalSupabase && masterPassword) {
		const masterResult = await admin.auth.admin.createUser({
			email: masterEmail,
			password: masterPassword,
			email_confirm: true
		});
		if (masterResult.error || !masterResult.data.user?.id) {
			throw masterResult.error ?? new Error('No se creó el usuario maestro local.');
		}
		createdMasterUserId = masterResult.data.user.id;
		master = masterResult.data.user;
	}
	if (!master?.id) throw new Error('MASTER_EMAIL no existe en Auth para activar ayuda.');

	const suffix = unique();
	const email = `e2e-ayuda-${suffix}@example.com`;
	const adminEmail = `e2e-ayuda-admin-${suffix}@example.com`;
	const businessName = `E2E Ayuda ${suffix}`;
	const businessSlug = `e2e-ayuda-${suffix}`;
	const authResult = await admin.auth.admin.createUser({
		email,
		password,
		email_confirm: true
	});
	if (authResult.error || !authResult.data.user?.id) {
		throw authResult.error ?? new Error('No se creó el usuario owner.');
	}
	const userId = authResult.data.user.id;
	const adminAuthResult = await admin.auth.admin.createUser({
		email: adminEmail,
		password,
		email_confirm: true
	});
	if (adminAuthResult.error || !adminAuthResult.data.user?.id) {
		throw adminAuthResult.error ?? new Error('No se creó el usuario administrador.');
	}
	const adminUserId = adminAuthResult.data.user.id;

	const business = await must(
		admin
				.from('businesses')
				.insert({
					name: businessName,
					slug: businessSlug,
					industry: 'odontology',
					timezone: 'America/Argentina/Buenos_Aires',
					public_booking_enabled: true,
					is_active: true
				})
			.select('id')
			.single()
	);

	await write(
		admin.from('allowed_emails').upsert(
			[
				{ email, enabled: true },
				{ email: adminEmail, enabled: true }
			],
			{ onConflict: 'email' }
		)
	);
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
		admin.from('business_users').insert({
			business_id: business.id,
			user_id: adminUserId,
			role: 'admin',
			status: 'active',
			accepted_at: new Date().toISOString()
		})
	);
	await write(
		admin.from('business_subscriptions').upsert(
			{
				business_id: business.id,
				commercial_access_enabled: true,
				is_permanent: true,
				subscription_status: 'active',
				paid_until: null,
				grace_until: null,
				restricted_until: null,
				archived_at: null
			},
				{ onConflict: 'business_id' }
			)
	);

	const professional = await must(
		admin
			.from('professionals')
			.insert({
				business_id: business.id,
				name: `Dra. Ayuda ${suffix}`,
				specialty: 'Odontología general',
				is_public: true,
				is_active: true
			})
			.select('id')
			.single()
	);

	return {
		email,
		userId,
		adminEmail,
		adminUserId,
		businessId: business.id,
		businessName,
		businessSlug,
		professionalId: professional.id
	};
};

const cleanupFixture = async (admin: FixtureClient, target: Fixture | null) => {
	if (!target) return;
	await write(admin.from('businesses').delete().eq('id', target.businessId));
	await write(admin.from('allowed_emails').delete().in('email', [target.email, target.adminEmail]));
	for (const userId of [target.userId, target.adminUserId])
		if ((await admin.auth.admin.deleteUser(userId)).error)
			throw new Error('Owned account assistance user cleanup failed.');
};

const cleanupMasterFixture = async (admin: FixtureClient) => {
	if (!createdMasterUserId) return;
	const memberships = await must(
		admin.from('business_users').select('business_id').eq('user_id', createdMasterUserId)
	);
	const ownedBusinessIds = memberships.map((row) => row.business_id);
	if (ownedBusinessIds.length > 0)
		await write(admin.from('businesses').delete().in('id', ownedBusinessIds));
	if ((await admin.auth.admin.deleteUser(createdMasterUserId)).error)
		throw new Error('Owned local master user cleanup failed.');
	createdMasterUserId = null;
};

const login = async (page: import('@playwright/test').Page, email: string, targetPassword: string) => {
	await signInWithPassword(page, email, targetPassword);
};

const screenshotPath = (name: string) => {
	return test.info().outputPath(name);
};

test.describe('Ayuda para configurar', () => {
	test.setTimeout(120_000);
	test.skip(!supabaseUrl || !serviceRoleKey, 'Definí ODONTO_SUPABASE_URL y ODONTO_SUPABASE_SERVICE_ROLE_KEY.');
	test.skip(!masterPassword, 'Definí E2E_MASTER_PASSWORD para validar el ingreso desde panel maestro.');

	test.beforeAll(async () => {
		try {
			// El fixture usa identidades únicas y no necesita vulnerar la tabla
			// privada de rate limits para ser repetible en Supabase local.
			fixture = await createFixture(adminClient());
		} catch (error) {
			setupError = error instanceof Error ? error.message : String(error);
		}
	});

	test.afterAll(async () => {
		if (!supabaseUrl || !serviceRoleKey) return;
		await cleanupFixture(adminClient(), fixture);
		await cleanupMasterFixture(adminClient());
	});

	test('el dueño activa ayuda, el equipo configura datos operativos y luego pierde acceso al revocar', async ({
		page,
		browser
	}) => {
		test.skip(Boolean(setupError), setupError ?? 'No se pudo preparar el fixture.');
		if (!fixture) throw new Error('Fixture no preparado.');
		const admin = adminClient();
		const ownerPage = page;
		const masterContext = await browser.newContext();
		const masterPage = await masterContext.newPage();

		await login(ownerPage, fixture.email, password);
		await ownerPage.goto('/odonto/configuracion/ayuda');
		await expect(
			ownerPage.getByRole('heading', {
				name: '¿Querés que te ayudemos a configurar tu cuenta?',
				level: 1
			})
		).toBeVisible();
		await ownerPage.getByRole('button', { name: 'Quiero ayuda por 1 hora' }).first().click();
		await expect(ownerPage.getByText('Ayuda de Cita Suite activa').first()).toBeVisible();
		await expect(ownerPage.getByText(/hasta las \d{2}:\d{2}/).first()).toBeVisible();
		await ownerPage.goto('/odonto/agenda');
		await expect(ownerPage.getByRole('heading', { name: 'Ayuda de Cita Suite activa' })).toBeVisible();
		await expect(
			ownerPage.getByRole('button', { name: 'Quitar aviso: Ayuda de Cita Suite activa' })
		).toBeVisible();
		await ownerPage.screenshot({
			type: 'jpeg', quality: 65, path: screenshotPath('account-assistance-owner-desktop-active.jpg'),
			fullPage: false
		});
		await ownerPage.setViewportSize({ width: 390, height: 844 });
		await ownerPage.screenshot({
			type: 'jpeg', quality: 65, path: screenshotPath('account-assistance-owner-mobile-active.jpg'),
			fullPage: false
		});
		await ownerPage.setViewportSize({ width: 1280, height: 720 });

		const { data: activeRows, error: activeError } = await admin
			.from('account_assistance_grants')
			.select('id, status, expires_at, revoked_at')
			.eq('business_id', fixture.businessId)
			.eq('status', 'active')
			.is('revoked_at', null);
		if (activeError) throw activeError;
		expect(activeRows).toHaveLength(1);
		expect(new Date(activeRows[0].expires_at).getTime()).toBeGreaterThan(Date.now() + 45 * 60 * 1000);

		await login(masterPage, masterEmail, masterPassword);
		await expect(masterPage.getByRole('heading', { name: 'Consultorios y accesos' })).toBeVisible();
		const assistanceHeading = masterPage.getByRole('heading', {
			name: /^\d+ consultorios? (?:pidió|pidieron) ayuda para configurar$/
		});
		await expect(assistanceHeading).toBeVisible();
		const assistanceLabel = (await assistanceHeading.innerText()).trim();
		const assistanceNotice = masterPage.getByRole('region', {
			name: /^\d+ consultorios? (?:pidió|pidieron) ayuda para configurar$/
		});
		await expect(assistanceNotice.getByText(fixture.businessName, { exact: true })).toBeVisible();
		await assistanceNotice.getByRole('button', { name: 'Abrir', exact: true }).click();
		await expect(masterPage).toHaveURL(/\/odonto\/configuracion\/usuarios/);
		await expect(assistanceHeading).toBeVisible();
		await expect(
			masterPage.getByRole('heading', { name: 'Falta la dirección del consultorio.' })
		).toBeVisible();
		await expect(
			masterPage.getByRole('heading', { name: `Configurando ${fixture.businessName}` })
		).toBeVisible();
		for (const label of [
			assistanceLabel,
			'Falta la dirección del consultorio.',
			`Configurando ${fixture.businessName}`
		]) {
			await expect(masterPage.getByRole('button', { name: `Quitar aviso: ${label}` })).toBeVisible();
		}

		await masterPage.getByRole('button', { name: 'Configurar', exact: true }).click();
		await expect(masterPage.getByLabel('Persona del equipo')).toBeVisible();
		const memberSelect = masterPage.getByLabel('Persona del equipo');
		await expect(memberSelect.getByRole('option', { name: `${fixture.email} · Dueño` })).toHaveCount(1);
		await expect(
			memberSelect.getByRole('option', { name: `${fixture.adminEmail} · Administrador` })
		).toHaveCount(1);
		await masterPage.getByRole('button', { name: 'Cancelar', exact: true }).click();
		await masterPage.screenshot({
			type: 'jpeg', quality: 65, path: screenshotPath('account-assistance-master-configuring.jpg'),
			fullPage: false
		});
		await masterPage
			.getByRole('button', { name: 'Quitar aviso: Falta la dirección del consultorio.' })
			.click();

		const serviceName = `Limpieza E2E ${unique()}`;
		await masterPage.goto(`/odonto/profesionales/${fixture.professionalId}?tab=servicios`);
		await expect(
			masterPage.getByRole('heading', { name: `Configurando ${fixture.businessName}` })
		).toBeVisible();
		await expect(masterPage.getByText('Falta la dirección del consultorio.')).toHaveCount(0);
		const servicePanel = masterPage.locator('.ux-soft-card').filter({ hasText: '¿No encontrás el servicio?' });
		const closeServiceForm = servicePanel.getByRole('button', { name: 'Cerrar' });
		if (!(await closeServiceForm.isVisible().catch(() => false))) {
			await servicePanel.getByRole('button', { name: 'Crear servicio nuevo' }).click();
		}
		await expect(closeServiceForm).toBeVisible({ timeout: 10_000 });
		await servicePanel.getByLabel('Nombre').fill(serviceName);
		await servicePanel.getByLabel('Duración en minutos').fill('35');
		await servicePanel.getByRole('button', { name: 'Crear y asignar' }).click();
		await expect(masterPage.getByText('Servicio creado y asignado.')).toBeVisible();

		const { data: services, error: servicesError } = await admin
			.from('services')
			.select('id, duration_minutes, professional_services!inner(professional_id)')
			.eq('business_id', fixture.businessId)
			.eq('name', serviceName);
		if (servicesError) throw servicesError;
		expect(services).toHaveLength(1);
		expect(services[0].duration_minutes).toBe(35);

		await ownerPage.goto('/odonto/configuracion/ayuda');
		await ownerPage.getByRole('button', { name: 'Detener ayuda' }).first().click();
		await expect(ownerPage.getByRole('heading', { name: 'Ayuda detenida' })).toBeVisible();

		const { data: revoked, error: revokedError } = await admin
			.from('account_assistance_grants')
			.select('status, revoked_at')
			.eq('id', activeRows[0].id)
			.single();
		if (revokedError) throw revokedError;
		expect(revoked.status).toBe('revoked');
		expect(revoked.revoked_at).toBeTruthy();

		await masterPage.goto('/odonto/maestro');
		await expect(masterPage.getByRole('heading', { name: 'Consultorios y accesos' })).toBeVisible();
		await expect(masterPage.locator('.ux-soft-card').filter({ hasText: fixture.businessName })).toHaveCount(0);
		await masterPage.goto(`/odonto/profesionales/${fixture.professionalId}?tab=servicios`);
		await expect(
			masterPage.getByRole('heading', { name: /Página no encontrada|Activá tu suscripción/ })
		).toBeVisible();
		await expect(masterPage.getByText(serviceName)).toHaveCount(0);
		await expect(masterPage.getByText(`Configurando ${fixture.businessName}`)).toHaveCount(0);
		await masterContext.close();
	});
});
