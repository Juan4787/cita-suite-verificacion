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

const WEEKDAY = '(?:lunes|martes|miércoles|jueves|viernes|sábado|domingo)';
// Every text says the date as well as the time: «el domingo 8 de noviembre a las 10:15».
const DATE_TIME = `el ${WEEKDAY} \\d{1,2} de [a-záéíóú]+(?: de \\d{4})? a las \\d{2}:\\d{2}`;

type GrantRow = {
	id: string;
	status: string;
	kind: string;
	expires_at: string;
	extended_at: string | null;
	revoked_by_role: string | null;
	dismissed_at: string | null;
};

const grants = async (admin: FixtureClient, businessId: string): Promise<GrantRow[]> =>
	must(
		admin
			.from('account_assistance_grants')
			.select('id, status, kind, expires_at, extended_at, revoked_by_role, dismissed_at')
			.eq('business_id', businessId)
			.order('created_at', { ascending: true })
	);

const confirmIn = async (page: import('@playwright/test').Page, trigger: string, dialogTitle: string, confirm: string) => {
	await page.getByRole('button', { name: trigger, exact: true }).first().click();
	const dialog = page.getByRole('dialog', { name: dialogTitle });
	await expect(dialog).toBeVisible();
	const text = (await dialog.innerText()).replace(/\s+/g, ' ');
	await dialog.getByRole('button', { name: confirm, exact: true }).click();
	return text;
};

test.describe('Ayuda para configurar', () => {
	test.setTimeout(300_000);
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

	test('la dueña elige la duración y confirma; el maestro configura y la termina; ella extiende y termina otra', async ({
		page,
		browser
	}) => {
		test.skip(Boolean(setupError), setupError ?? 'No se pudo preparar el fixture.');
		if (!fixture) throw new Error('Fixture no preparado.');
		const admin = adminClient();
		const ownerPage = page;
		const masterContext = await browser.newContext();
		const masterPage = await masterContext.newPage();

		await test.step('sin pacientes, la dueña ve las tres duraciones y nada se da sin confirmar', async () => {
			await login(ownerPage, fixture!.email, password);
			await ownerPage.goto('/odonto/configuracion/ayuda');
			await expect(ownerPage.getByRole('heading', { name: '¿Querés que te ayudemos con tu cuenta?', level: 1 })).toBeVisible();
			for (const label of ['Dar ayuda por 1 hora', 'Dar ayuda por 24 horas', 'Dar ayuda para la configuración inicial'])
				await expect(ownerPage.getByRole('button', { name: label, exact: true })).toBeVisible();
			await expect(ownerPage.locator('main .ux-card').getByText(/historia|historial|clínic/i)).toHaveCount(0);

			await ownerPage.getByRole('button', { name: 'Dar ayuda por 24 horas', exact: true }).click();
			const dialog = ownerPage.getByRole('dialog', { name: 'Dar ayuda por 24 horas' });
			await expect(dialog).toContainText(new RegExp(`hasta el ${WEEKDAY} \\d{1,2} de [a-záéíóú]+(?: de \\d{4})?, alrededor de las \\d{2}:\\d{2}`));
			await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
			await expect(dialog).toHaveCount(0);

			// The server requires the confirmation too: a form sent without the dialog gives nothing.
			const unconfirmed = await ownerPage.request.post('/odonto/configuracion/ayuda?/activate', {
				form: { kind: 'day', return_to: '/odonto/configuracion/ayuda' },
				headers: { origin: new URL(ownerPage.url()).origin },
				maxRedirects: 0
			});
			expect(unconfirmed.status()).toBe(400);
			expect(await grants(admin, fixture!.businessId)).toHaveLength(0);
		});

		let firstGrant = '';
		await test.step('la dueña da 24 horas: aviso con fecha y hora, y una marca fija en el menú', async () => {
			const text = await confirmIn(ownerPage, 'Dar ayuda por 24 horas', 'Dar ayuda por 24 horas', 'Dar ayuda');
			expect(text).toContain('Cita Suite va a poder entrar a tu cuenta hasta el');
			await expect(ownerPage.getByRole('heading', { name: 'Ayuda de Cita Suite activa', level: 1 })).toBeVisible();
			await expect(ownerPage.getByText(new RegExp(`Cita Suite puede entrar a tu cuenta hasta ${DATE_TIME}\\.`))).toBeVisible();
			await expect(ownerPage.getByRole('button', { name: 'Pasar a la configuración inicial, 7 días', exact: true })).toBeVisible();

			const rows = await grants(admin, fixture!.businessId);
			expect(rows).toHaveLength(1);
			expect(rows[0]).toMatchObject({ status: 'active', kind: 'day', extended_at: null });
			const hoursLeft = (Date.parse(rows[0].expires_at) - Date.now()) / 3_600_000;
			expect(hoursLeft).toBeGreaterThan(23.9);
			expect(hoursLeft).toBeLessThanOrEqual(24);
			firstGrant = rows[0].id;

			await ownerPage.goto('/odonto/agenda');
			const notice = ownerPage.getByRole('region', { name: 'Ayuda de Cita Suite activa' });
			await expect(notice).toContainText(new RegExp(`hasta ${DATE_TIME}`));
			await expect(notice.getByRole('button', { name: 'Terminar ayuda', exact: true })).toBeVisible();
			const mark = ownerPage.getByRole('link', { name: /^Ayuda activa hasta / });
			await expect(mark).toBeVisible();
			await expect(mark).toHaveAccessibleName(
				new RegExp(`^Ayuda activa hasta (dom|lun|mar|mié|jue|vie|sáb) \\d{1,2}/\\d{1,2}(?:/\\d{4})? \\d{2}:\\d{2}: ayuda de Cita Suite activa hasta ${DATE_TIME}$`)
			);
			await ownerPage.screenshot({ type: 'jpeg', quality: 65, path: screenshotPath('account-assistance-owner-desktop-active.jpg') });
			// Closing the notice leaves the mark: she stays told while it lasts.
			await ownerPage.getByRole('button', { name: 'Quitar aviso: Ayuda de Cita Suite activa' }).click();
			await expect(notice).toHaveCount(0);
			await expect(mark).toBeVisible();
			await ownerPage.setViewportSize({ width: 390, height: 844 });
			await expect(ownerPage.getByRole('button', { name: 'Abrir menú. Ayuda de Cita Suite activa.' }).last()).toBeVisible();
			await ownerPage.screenshot({ type: 'jpeg', quality: 65, path: screenshotPath('account-assistance-owner-mobile-active.jpg') });
			await ownerPage.setViewportSize({ width: 1280, height: 720 });
		});

		await test.step('el maestro ve la duración, entra y configura', async () => {
			await login(masterPage, masterEmail, masterPassword);
			await expect(masterPage.getByRole('heading', { name: 'Consultorios y accesos' })).toBeVisible();
			const helpSection = masterPage.locator('#solicitudes-ayuda');
			const card = helpSection.locator('.ux-soft-card').filter({ hasText: fixture!.businessName });
			await expect(card).toContainText('24 horas ·');
			await expect(card).toContainText(new RegExp(`Hasta ${DATE_TIME}`));
			await expect(card.getByRole('button', { name: 'Terminar ayuda', exact: true })).toBeVisible();

			const assistanceNotice = masterPage.getByRole('region', { name: /^\d+ consultorios? (?:pidió|pidieron) ayuda para configurar$/ });
			await expect(assistanceNotice.getByText(fixture!.businessName, { exact: true })).toBeVisible();
			await assistanceNotice.getByRole('button', { name: 'Abrir', exact: true }).click();
			await expect(masterPage).toHaveURL(/\/odonto\/configuracion\/usuarios/);
			const configuring = masterPage.getByRole('region', { name: `Configurando ${fixture!.businessName}` });
			await expect(configuring).toContainText(new RegExp(`Hasta ${DATE_TIME}\\. Al vencer, volvés automáticamente al panel maestro\\.`));

			const serviceName = `Limpieza E2E ${unique()}`;
			await masterPage.goto(`/odonto/profesionales/${fixture!.professionalId}?tab=servicios`);
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
			const services = await must(admin.from('services').select('id, duration_minutes').eq('business_id', fixture!.businessId).eq('name', serviceName));
			expect(services).toHaveLength(1);
			expect(services[0].duration_minutes).toBe(35);
		});

		await test.step('cargar un paciente no corta ni acorta la ayuda', async () => {
			const before = (await grants(admin, fixture!.businessId))[0];
			await write(
				admin.from('patients').insert({ business_id: fixture!.businessId, owner_id: fixture!.userId, full_name: `Paciente E2E ayuda ${unique()}` })
			);
			expect((await grants(admin, fixture!.businessId))[0]).toEqual(before);
			await masterPage.goto('/odonto/configuracion/usuarios');
			await expect(masterPage.getByRole('region', { name: `Configurando ${fixture!.businessName}` })).toBeVisible();
			// With a patient the owner can no longer move to the initial setup.
			await ownerPage.goto('/odonto/configuracion/ayuda');
			await expect(ownerPage.getByRole('heading', { name: 'Ayuda de Cita Suite activa', level: 1 })).toBeVisible();
			await expect(ownerPage.getByRole('button', { name: 'Pasar a la configuración inicial, 7 días' })).toHaveCount(0);
		});

		await test.step('el maestro la termina desde el consultorio y la dueña ve que la terminó Cita Suite', async () => {
			const text = await confirmIn(masterPage, 'Terminar ayuda', 'Terminar la ayuda', 'Terminar ayuda');
			expect(text).toContain(`Vas a dejar de poder entrar a ${fixture!.businessName} ahora.`);
			await expect(masterPage).toHaveURL(/\/odonto\/maestro/);
			await expect(masterPage.locator('#solicitudes-ayuda .ux-soft-card').filter({ hasText: fixture!.businessName })).toHaveCount(0);
			expect((await grants(admin, fixture!.businessId))[0]).toMatchObject({ id: firstGrant, status: 'revoked', revoked_by_role: 'support' });

			await ownerPage.goto('/odonto/agenda');
			const ended = ownerPage.getByRole('region', { name: 'La ayuda de Cita Suite terminó' });
			await expect(ended).toContainText(new RegExp(`Cita Suite la terminó ${DATE_TIME}\\. Ya no puede entrar a tu cuenta\\.`));
			await expect(ended.getByRole('link', { name: 'Pedir ayuda otra vez' })).toBeVisible();
			await expect(ownerPage.getByRole('link', { name: /^Ayuda activa hasta / })).toHaveCount(0);

			await ownerPage.goto('/odonto/configuracion/ayuda');
			await ownerPage.getByRole('button', { name: 'Cerrar aviso', exact: true }).click();
			await expect(ownerPage.getByText('La ayuda de Cita Suite terminó')).toHaveCount(0);
			expect((await grants(admin, fixture!.businessId))[0].dismissed_at).toBeTruthy();
		});

		await test.step('con pacientes, la dueña da 1 hora, la pasa a 24 horas y la termina', async () => {
			await expect(ownerPage.getByRole('button', { name: 'Dar ayuda para la configuración inicial' })).toHaveCount(0);
			await confirmIn(ownerPage, 'Dar ayuda por 1 hora', 'Dar ayuda por 1 hora', 'Dar ayuda');
			await expect(ownerPage.getByRole('heading', { name: 'Ayuda de Cita Suite activa', level: 1 })).toBeVisible();
			const hourGrant = (await grants(admin, fixture!.businessId))[1];
			expect(hourGrant).toMatchObject({ status: 'active', kind: 'hour' });

			const text = await confirmIn(ownerPage, 'Pasar a 24 horas', 'Extender la ayuda', 'Extender ayuda');
			expect(text).toContain('contando desde ahora');
			await expect(ownerPage.getByText('Ayuda activa · 24 horas')).toBeVisible();
			const extended = (await grants(admin, fixture!.businessId))[1];
			expect(extended).toMatchObject({ id: hourGrant.id, status: 'active', kind: 'day' });
			expect(extended.extended_at).toBeTruthy();

			await confirmIn(ownerPage, 'Terminar ayuda', 'Terminar la ayuda', 'Terminar ayuda');
			await expect(ownerPage.getByText(new RegExp(`La terminaste ${DATE_TIME}\\. Cita Suite ya no puede entrar a tu cuenta\\.`))).toBeVisible();
			expect((await grants(admin, fixture!.businessId))[1]).toMatchObject({ status: 'revoked', revoked_by_role: 'owner' });
		});

		await test.step('el maestro termina otra desde el panel y pierde el acceso', async () => {
			await confirmIn(ownerPage, 'Dar ayuda por 1 hora', 'Dar ayuda por 1 hora', 'Dar ayuda');
			await masterPage.goto('/odonto/maestro');
			const card = masterPage.locator('#solicitudes-ayuda .ux-soft-card').filter({ hasText: fixture!.businessName });
			await expect(card).toContainText('1 hora ·');
			await card.getByRole('button', { name: 'Terminar ayuda', exact: true }).click();
			await masterPage.getByRole('dialog', { name: 'Terminar la ayuda' }).getByRole('button', { name: 'Terminar ayuda', exact: true }).click();
			await expect(
				masterPage.getByRole('status').filter({ hasText: `Terminaste la ayuda de ${fixture!.businessName}: ya no podés entrar a su cuenta.` })
			).toBeVisible();
			expect((await grants(admin, fixture!.businessId))[2]).toMatchObject({ status: 'revoked', revoked_by_role: 'support' });

			await masterPage.goto(`/odonto/profesionales/${fixture!.professionalId}?tab=servicios`);
			await expect(masterPage.getByRole('heading', { name: /Página no encontrada|Activá tu suscripción/ })).toBeVisible();
			await expect(masterPage.getByText(`Configurando ${fixture!.businessName}`)).toHaveCount(0);
		});
		await masterContext.close();
	});
});
