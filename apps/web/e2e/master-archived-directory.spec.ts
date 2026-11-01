import { expect, test, type Page } from '@playwright/test';
import { signInWithPassword } from './helpers/shared-auth';
import { createFixtureClient, must, write, type FixtureClient } from './helpers/fixture-db';
import fs from 'node:fs';
import path from 'node:path';

// Plan de señas y avisos, 12.16: an archived practice leaves the master directory, its filters, its
// counts and its search, and lives in its own view. A paused one stays and still reads as paused.

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
const password = 'E2eDirectory!2026';

type Fixture = { suffix: string; ownerId: string; ownerEmail: string; businessIds: string[]; names: { active: string; paused: string; archived: string } };

let fixture: Fixture | null = null;
let setupError: string | null = null;
let createdMasterUserId: string | null = null;

const adminClient = () => {
	if (!supabaseUrl || !serviceRoleKey) throw new Error('Faltan ODONTO_SUPABASE_URL u ODONTO_SUPABASE_SERVICE_ROLE_KEY.');
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
	let master = await findAuthUserByEmail(admin, masterEmail);
	if (!master?.id && isLocalSupabase && masterPassword) {
		const created = await admin.auth.admin.createUser({ email: masterEmail, password: masterPassword, email_confirm: true });
		if (created.error || !created.data.user?.id) throw created.error ?? new Error('No se creó el usuario maestro local.');
		createdMasterUserId = created.data.user.id;
		master = created.data.user;
	}
	if (!master?.id) throw new Error('MASTER_EMAIL no existe en Auth.');

	const suffix = `${Date.now()}-${Math.floor(Math.random() * 100000)}`;
	const ownerEmail = `e2e-directorio-${suffix}@example.com`;
	const owner = await admin.auth.admin.createUser({ email: ownerEmail, password, email_confirm: true });
	if (owner.error || !owner.data.user?.id) throw owner.error ?? new Error('No se creó la dueña.');
	const names = { active: `E2E Directorio activo ${suffix}`, paused: `E2E Directorio pausado ${suffix}`, archived: `E2E Directorio archivado ${suffix}` };
	const businessIds: string[] = [];
	for (const [kind, name] of Object.entries(names)) {
		const business = await must(admin.from('businesses').insert({
			name, slug: `e2e-directorio-${kind}-${suffix}`, industry: 'medicine', timezone: 'America/Argentina/Cordoba', public_booking_enabled: kind === 'active', is_active: true
		}).select('id').single());
		businessIds.push(business.id);
	}
	const [activeId, pausedId, archivedId] = businessIds;
	await write(admin.from('business_users').insert({ business_id: activeId, user_id: owner.data.user.id, role: 'owner', status: 'active', accepted_at: new Date().toISOString() }));
	await write(admin.from('business_subscriptions').update({
		commercial_access_enabled: true, is_permanent: true, subscription_status: 'active', paid_until: null, grace_until: null, restricted_until: null, archived_at: null
	}).in('business_id', businessIds));
	// Paused: access off, not archived. Archived: what archive_business leaves, archived_at and access off.
	await write(admin.from('business_subscriptions').update({ commercial_access_enabled: false, subscription_status: 'restricted' }).eq('business_id', pausedId));
	await write(admin.from('business_subscriptions').update({
		commercial_access_enabled: false, is_permanent: false, subscription_status: 'archived', archived_at: new Date().toISOString()
	}).eq('business_id', archivedId));
	return { suffix, ownerId: owner.data.user.id, ownerEmail, businessIds, names };
};

const cleanup = async (admin: FixtureClient) => {
	if (fixture) {
		await write(admin.from('businesses').delete().in('id', fixture.businessIds));
		if ((await admin.auth.admin.deleteUser(fixture.ownerId)).error) throw new Error('Owned directory owner cleanup failed.');
	}
	if (createdMasterUserId) {
		const memberships = await must(admin.from('business_users').select('business_id').eq('user_id', createdMasterUserId));
		const owned = memberships.map((row) => row.business_id);
		if (owned.length > 0) await write(admin.from('businesses').delete().in('id', owned));
		if ((await admin.auth.admin.deleteUser(createdMasterUserId)).error) throw new Error('Owned local master user cleanup failed.');
		createdMasterUserId = null;
	}
};

const card = (page: Page, name: string) => page.locator('.master-business-card').filter({ has: page.getByRole('heading', { name, exact: true }) });

test.describe('Panel maestro: consultorios archivados', () => {
	test.setTimeout(120_000);
	test.skip(!supabaseUrl || !serviceRoleKey, 'Definí ODONTO_SUPABASE_URL y ODONTO_SUPABASE_SERVICE_ROLE_KEY.');
	test.skip(!masterPassword, 'Definí E2E_MASTER_PASSWORD para validar el panel maestro.');

	test.beforeAll(async () => {
		try {
			fixture = await createFixture(adminClient());
		} catch (error) {
			setupError = error instanceof Error ? error.message : String(error);
		}
	});

	test.afterAll(async () => {
		if (supabaseUrl && serviceRoleKey) await cleanup(adminClient());
	});

	test('a practice archived from the panel leaves the directory and its search and lives in its own view', async ({ page }) => {
		test.skip(Boolean(setupError), setupError ?? 'No se pudo preparar el fixture.');
		if (!fixture) throw new Error('Fixture no preparado.');
		const { names, suffix } = fixture;
		await signInWithPassword(page, masterEmail, masterPassword);
		await page.goto('/odonto/maestro');
		await expect(page.getByRole('heading', { name: 'Consultorios', exact: true })).toBeVisible();

		// The directory and its search: the active and the paused practice, never the archived one.
		await page.locator('#master-search').fill(suffix);
		await expect(card(page, names.active)).toBeVisible();
		await expect(card(page, names.paused)).toBeVisible();
		await expect(card(page, names.paused).getByText('Pausado', { exact: true })).toBeVisible();
		await expect(card(page, names.archived)).toHaveCount(0);
		await expect(page.getByText('2 resultados')).toBeVisible();
		for (const view of ['En orden', 'Revisar', 'Todos']) {
			await page.locator('.master-filter').getByRole('button', { name: new RegExp(`^${view}`) }).click();
			await expect(card(page, names.archived)).toHaveCount(0);
		}

		// Its own view: only archived practices, with their own search, reading as archived.
		const entry = page.getByRole('button', { name: /^Ver consultorios archivados/ });
		await expect(entry).toBeVisible();
		await entry.click();
		await expect(page.getByRole('heading', { name: 'Consultorios archivados', exact: true })).toBeVisible();
		await expect(page.locator('.master-filter')).toHaveCount(0);
		await expect(card(page, names.archived)).toBeVisible();
		await expect(card(page, names.archived).getByText('Archivado', { exact: true })).toBeVisible();
		await expect(card(page, names.archived).getByText('Cuenta archivada', { exact: true })).toBeVisible();
		await expect(card(page, names.archived).getByText('Pausado', { exact: true })).toHaveCount(0);
		await expect(card(page, names.active)).toHaveCount(0);
		await expect(card(page, names.paused)).toHaveCount(0);
		await expect(page.getByText('1 resultado', { exact: true })).toBeVisible();
		await page.screenshot({ path: test.info().outputPath('archivados.png'), fullPage: true });

		await page.getByRole('button', { name: 'Volver a consultorios' }).click();
		await expect(page.getByRole('heading', { name: 'Consultorios', exact: true })).toBeVisible();
		await expect(card(page, names.archived)).toHaveCount(0);
		await expect(card(page, names.active)).toBeVisible();
	});
});
