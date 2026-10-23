import { expect, test, type Page } from '@playwright/test';
import { signInWithPassword } from './helpers/shared-auth';
import { createFixtureClient, must, write, type FixtureClient } from './helpers/fixture-db';
import { browserRequest } from './helpers/browser-request';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { clinicalPdfFixture } from './helpers/clinical-pdf';
import { syntheticMasterId } from './helpers/master-identity';

const supabaseUrl = process.env.ODONTO_SUPABASE_URL;
const serviceRoleKey = process.env.ODONTO_SUPABASE_SERVICE_ROLE_KEY;
const databaseUrl = process.env.SUPABASE_DB_URL;
const isLocalSupabase = Boolean(
	supabaseUrl?.startsWith('http://127.0.0.1') || supabaseUrl?.startsWith('http://localhost')
);
const password = 'E2eClinicalFiles!2026';
const onePixelPng = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl3pGQAAAAASUVORK5CYII=',
	'base64'
);

type Fixture = {
	ownerEmail: string;
	ownerUserId: string;
	professionalEmail: string;
	professionalUserId: string;
	receptionEmail: string;
	receptionUserId: string;
	businessId: string;
	patientId: string;
	patientName: string;
	hiddenPatientName: string;
	archivedPatientName: string;
};

let fixture: Fixture | null = null;

const adminClient = () => {
	if (!supabaseUrl || !serviceRoleKey) throw new Error('Faltan credenciales Supabase locales.');
	return createFixtureClient(supabaseUrl, serviceRoleKey);
};

const psqlEnvironment = (connectionString: string) => {
	const parsed = new URL(connectionString);
	return {
		...process.env,
		PGHOST: parsed.hostname,
		PGPORT: parsed.port || '5432',
		PGUSER: decodeURIComponent(parsed.username),
		PGPASSWORD: decodeURIComponent(parsed.password),
		PGDATABASE: parsed.pathname.replace(/^\//, '') || 'postgres',
		PGSSLMODE: isLocalSupabase ? 'disable' : 'require',
		PGCONNECT_TIMEOUT: '10'
	};
};

const createFixture = async (admin: FixtureClient): Promise<Fixture> => {
	const suffix = `${Date.now()}-${Math.floor(Math.random() * 100_000)}`;
	const ownerEmail = `e2e-clinical-owner-${suffix}@example.com`;
	const professionalEmail = `e2e-clinical-professional-${suffix}@example.com`;
	const receptionEmail = `e2e-clinical-reception-${suffix}@example.com`;
	const patientName = `Paciente archivos ${suffix}`;
	const hiddenPatientName = `Único lejano ${suffix}`;
	const archivedPatientName = `Paciente archivado ${suffix}`;

	const ownerAuth = await admin.auth.admin.createUser({
		email: ownerEmail,
		password,
		email_confirm: true
	});
	if (ownerAuth.error || !ownerAuth.data.user?.id) {
		throw ownerAuth.error ?? new Error('No se creó el dueño E2E.');
	}
	const ownerUserId = ownerAuth.data.user.id;

	const professionalAuth = await admin.auth.admin.createUser({
		email: professionalEmail,
		password,
		email_confirm: true
	});
	if (professionalAuth.error || !professionalAuth.data.user?.id) {
		await admin.auth.admin.deleteUser(ownerUserId);
		throw professionalAuth.error ?? new Error('No se creó el profesional E2E.');
	}
	const professionalUserId = professionalAuth.data.user.id;
	const receptionAuth = await admin.auth.admin.createUser({
		email: receptionEmail,
		password,
		email_confirm: true
	});
	if (receptionAuth.error || !receptionAuth.data.user?.id) {
		await admin.auth.admin.deleteUser(ownerUserId);
		await admin.auth.admin.deleteUser(professionalUserId);
		throw receptionAuth.error ?? new Error('No se creó la recepción E2E.');
	}
	const receptionUserId = receptionAuth.data.user.id;

	const business = await must(
		admin
			.from('businesses')
			.insert({
				name: `E2E Archivos clínicos ${suffix}`,
				slug: `e2e-clinical-files-${suffix}`,
				industry: 'odontology',
				timezone: 'America/Argentina/Buenos_Aires',
				is_active: true
			})
			.select('id')
			.single()
	);

	await write(
		admin.from('business_subscriptions').upsert(
			{
				business_id: business.id,
				commercial_access_enabled: true,
				is_permanent: true,
				subscription_status: 'active',
				access_starts_at: new Date().toISOString(),
				paid_until: null,
				grace_until: null,
				restricted_until: null,
				archived_at: null
			},
			{ onConflict: 'business_id' }
		)
	);
	await write(
		admin.from('allowed_emails').upsert(
			[
				{ email: ownerEmail, enabled: true },
				{ email: professionalEmail, enabled: true },
				{ email: receptionEmail, enabled: true }
			],
			{ onConflict: 'email' }
		)
	);
	await write(
		admin.from('business_users').insert([
			{
				business_id: business.id,
				user_id: ownerUserId,
				role: 'owner',
				status: 'active',
				accepted_at: new Date().toISOString()
			},
			{
				business_id: business.id,
				user_id: professionalUserId,
				role: 'professional',
				status: 'active',
				accepted_at: new Date().toISOString()
			},
			{
				business_id: business.id,
				user_id: receptionUserId,
				role: 'reception',
				status: 'active',
				accepted_at: new Date().toISOString()
			}
		])
	);

	const professional = await must(
		admin
			.from('professionals')
			.insert({
				business_id: business.id,
				name: `Profesional archivos ${suffix}`,
				email: professionalEmail,
				is_active: true,
				is_public: true
			})
			.select('id')
			.single()
	);
	await write(
		admin.from('professional_users').insert({
			business_id: business.id,
			professional_id: professional.id,
			user_id: professionalUserId
		})
	);

	const patient = await must(
		admin
			.from('patients')
			.insert({
				business_id: business.id,
				owner_id: ownerUserId,
				full_name: patientName,
				dni: `9${String(Date.now()).slice(-7)}`
			})
			.select('id')
			.single()
	);
	await write(
		admin.from('professional_patient_links').insert({
			business_id: business.id,
			professional_id: professional.id,
			patient_id: patient.id,
			source: 'manual',
			is_active: true,
			created_by: ownerUserId
		})
	);

	const activityBase = Date.now() - 60_000;
	await write(
		admin.from('patients').insert([
			...Array.from({ length: 30 }, (_, index) => ({
				business_id: business.id,
				owner_id: ownerUserId,
				full_name: `Paciente paginado ${String(index + 1).padStart(2, '0')} ${suffix}`,
				activity_at: new Date(activityBase - index * 60_000).toISOString()
			})),
			{
				business_id: business.id,
				owner_id: ownerUserId,
				full_name: hiddenPatientName,
				activity_at: new Date('2020-01-01T12:00:00.000Z').toISOString()
			},
			{
				business_id: business.id,
				owner_id: ownerUserId,
				full_name: archivedPatientName,
				activity_at: new Date('2019-01-01T12:00:00.000Z').toISOString(),
				archived_at: new Date().toISOString()
			}
		])
	);

	return {
		ownerEmail,
		ownerUserId,
		professionalEmail,
		professionalUserId,
		receptionEmail,
		receptionUserId,
		businessId: business.id,
		patientId: patient.id,
		patientName,
		hiddenPatientName,
		archivedPatientName
	};
};

const cleanupFixture = async (admin: FixtureClient, target: Fixture | null) => {
	if (!target) return;
	// A failed listing must not leave Storage objects (and the clinical budget) behind silently.
	const radiographs = await must(
		admin
			.from('patient_radiographs')
			.select('storage_bucket, storage_path, thumbnail_path')
			.eq('business_id', target.businessId)
			.eq('storage_provider', 'supabase_storage')
	);
	for (const row of radiographs) {
		const paths = [row.storage_path, row.thumbnail_path].filter((path): path is string => Boolean(path));
		if (row.storage_bucket && paths.length > 0) {
			const { error } = await admin.storage.from(row.storage_bucket).remove(paths);
			if (error) throw error;
		}
	}
	// patient_radiographs deliberately grants service_role only SELECT: production
	// mutations go through the audited RPCs.  E2E cleanup therefore uses the
	// privileged database connection for this disposable fixture, never the app
	// client and never a production DDL operation.
	if (!databaseUrl) throw new Error('SUPABASE_DB_URL es necesario para limpiar el fixture de archivos.');
	const businessId = target.businessId;
	const sql = `begin;
select private.clinical_budget_lock();
with released as (
 delete from public.clinical_upload_slots
 where file_id in (select id from public.patient_radiographs where business_id='${businessId}')
 returning reserved_bytes
)
update public.clinical_storage_budget
set reserved_bytes=reserved_bytes-(select coalesce(sum(reserved_bytes),0) from released),updated_at=clock_timestamp()
where singleton;
delete from public.push_delivery_attempts where business_id='${businessId}';
delete from public.push_subscriptions where business_id='${businessId}';
delete from public.appointment_google_calendar_events where business_id='${businessId}';
delete from public.patient_radiographs where business_id='${businessId}';
delete from public.appointments where business_id='${businessId}';
delete from public.clinical_entries where business_id='${businessId}';
delete from public.patient_clinical_profiles where business_id='${businessId}';
delete from public.professional_patient_links where business_id='${businessId}';
delete from public.professional_users where business_id='${businessId}';
delete from public.professional_services where business_id='${businessId}';
delete from public.availability_rules where business_id='${businessId}';
delete from public.availability_exceptions where business_id='${businessId}';
delete from public.patients where business_id='${businessId}';
delete from public.professionals where business_id='${businessId}';
delete from public.services where business_id='${businessId}';
delete from public.patient_export_sessions where business_id='${businessId}';
delete from public.business_user_invites where business_id='${businessId}';
delete from public.business_users where business_id='${businessId}';
delete from public.business_subscriptions where business_id='${businessId}';
delete from public.business_data_revisions where business_id='${businessId}';
delete from public.audit_logs where business_id='${businessId}';
delete from public.businesses where id='${businessId}';
commit;`;
	const result = spawnSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-q', '-c', sql], {
		// No poner la URL completa (y su contraseña) en argv: así no queda
		// expuesta en process listings ni en diagnósticos del runner.
		env: psqlEnvironment(databaseUrl),
		encoding: 'utf8'
	});
	if (result.status !== 0) {
		throw new Error(`No se pudo limpiar el fixture en la base aislada: ${result.stderr || 'psql falló.'}`);
	}
	await write(admin
		.from('allowed_emails')
		.delete()
		.in('email', [target.ownerEmail, target.professionalEmail]));
	await write(admin.from('allowed_emails').delete().eq('email', target.receptionEmail));
	for (const userId of [target.ownerUserId, target.professionalUserId, target.receptionUserId]) {
		const { error } = await admin.auth.admin.deleteUser(userId);
		if (error) throw error;
	}
};

const login = async (page: Page, email: string) => {
	await signInWithPassword(page, email, password);
};

const clinicalExample = {
	description: 'Panorámica compartida del equipo', filename: 'panoramica-equipo.png',
	professionalDescription: 'Aporte clínico del profesional', professionalFilename: 'aporte-profesional.png'
};

const uploadFixtureImage = async (page: Page, filename: string, description: string) => {
	// Test setup uses the same real upload and finalization path; it never forges
	// ready clinical rows or bypasses Storage validation and quota accounting.
	await page.locator('input[type="file"]:not([capture])').setInputFiles({ name: filename, mimeType: 'image/png', buffer: onePixelPng });
	await expect(page.getByRole('heading', { name: 'Añadir documento clínico' })).toBeVisible();
	await page.getByLabel('Descripción (opcional)').fill(description);
	await page.getByRole('button', { name: 'Guardar documento' }).click();
	await expect(page.getByText('Documento guardado en la ficha del paciente.')).toBeVisible({ timeout: 30_000 });
	await expect(page.getByRole('heading', { name: description })).toBeVisible();
};

test.describe('Archivos clínicos privados', () => {
	test.setTimeout(120_000);
	test.skip(
		(!isLocalSupabase && process.env.E2E_ALLOW_PRODUCTION_CLINICAL !== 'true') || !serviceRoleKey || !databaseUrl,
		'Requiere ODONTO_SUPABASE_URL, ODONTO_SUPABASE_SERVICE_ROLE_KEY y SUPABASE_DB_URL; para Worker real, E2E_ALLOW_PRODUCTION_CLINICAL=true.'
	);

	test.beforeEach(async () => {
		const admin = adminClient();
		// Cada corrida usa correos únicos y permanece debajo del límite por IP.
		// La tabla de rate limits es deliberadamente inaccesible incluso al cliente
		// service_role; el E2E debe respetar ese contrato en vez de vaciarla.
		fixture = await createFixture(admin);
	});

	test.afterEach(async () => {
		if (!supabaseUrl || !serviceRoleKey) return;
		try { await cleanupFixture(adminClient(), fixture); } finally { fixture = null; }
	});

	test('carga un PDF real, lo guarda en la ficha y descarga los mismos bytes con el nombre del paciente', async ({ page }) => {
		if (!fixture) throw new Error('Fixture no preparado.');
		const pdf = clinicalPdfFixture();
		await login(page, fixture.ownerEmail);
		await page.goto(`/odonto/pacientes/${fixture.patientId}?tab=radiografias`);
		await expect(page.getByRole('heading', { name: 'Estudios y documentos' })).toBeVisible();
		await page.locator('input[type="file"]:not([capture])').setInputFiles({ name: 'informe-sintetico.pdf', mimeType: 'application/pdf', buffer: pdf });
		await expect(page.getByRole('heading', { name: 'Añadir documento clínico' })).toBeVisible();
		await page.getByLabel('Descripción (opcional)').fill('Informe PDF sintético');
		await page.getByRole('button', { name: 'Guardar documento', exact: true }).click();
		await expect(page.getByText('Documento guardado en la ficha del paciente.')).toBeVisible();
		await expect(page.getByRole('heading', { name: 'Informe PDF sintético', exact: true })).toBeVisible();
		const downloadPromise = page.waitForEvent('download');
		await page.getByRole('button', { name: 'Descargar PDF', exact: true }).click();
		const download = await downloadPromise;
		expect(download.suggestedFilename().startsWith(fixture.patientName.replaceAll(' ', '_') + '_')).toBe(true);
		expect(download.suggestedFilename().endsWith('.pdf')).toBe(true);
		const downloaded = await download.path();
		if (!downloaded) throw new Error('La descarga real no generó archivo verificable.');
		expect(readFileSync(downloaded).equals(pdf)).toBe(true);
		const account = await adminClient().from('clinical_business_storage_budget').select('used_bytes,reserved_bytes').eq('business_id', fixture.businessId).single();
		expect(account.error).toBeNull();
		expect(account.data).toMatchObject({ used_bytes: pdf.length, reserved_bytes: 0 });
	});

	test('el dueño carga una imagen privada y la consulta en escritorio y móvil', async ({ page, browser }) => {
		if (!fixture) throw new Error('Fixture no preparado.');
		const { description, filename } = clinicalExample;
		await login(page, fixture.ownerEmail);
		await page.goto(`/odonto/pacientes/${fixture.patientId}?tab=radiografias`);
		await expect(page.getByRole('heading', { name: 'Estudios y documentos' })).toBeVisible();
		await expect(page.getByText('Todavía no hay documentos en esta ficha')).toBeVisible();
		await page.locator('input[type="file"]:not([capture])').setInputFiles({
			name: filename,
			mimeType: 'image/png',
			buffer: onePixelPng
		});
		await expect(page.getByRole('heading', { name: 'Añadir documento clínico' })).toBeVisible();
		const businessToday = new Intl.DateTimeFormat('en-CA', {
			timeZone: 'America/Argentina/Buenos_Aires',
			year: 'numeric',
			month: '2-digit',
			day: '2-digit'
		}).format(new Date());
		await expect(page.getByLabel('Fecha de toma (opcional)')).toHaveAttribute(
			'max',
			businessToday
		);
		await page.getByLabel('Descripción (opcional)').fill(description);
		await page.getByRole('button', { name: 'Guardar documento' }).click();
		await expect(page.getByText('Documento guardado en la ficha del paciente.')).toBeVisible({
			timeout: 30_000
		});
		await expect(page.getByRole('heading', { name: description })).toBeVisible();

		await page.getByRole('button', { name: 'Ver imagen' }).click();
		const ownerViewer = page.getByRole('img', { name: description });
		await expect(ownerViewer).toBeVisible();
		expect(await ownerViewer.getAttribute('src')).toMatch(/^blob:/);
		await expect.poll(() => ownerViewer.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(1);
		const ownerViewerDialog = page.getByRole('dialog', { name: description });
		const ownerViewerBox = await ownerViewerDialog.boundingBox();
		expect(ownerViewerBox?.width ?? 0).toBeGreaterThan(page.viewportSize()!.width * 0.9);
		expect(ownerViewerBox?.height ?? 0).toBeGreaterThan(page.viewportSize()!.height * 0.9);
		const desktopZoom = ownerViewerDialog.getByRole('group', { name: 'Controles de zoom' });
		await desktopZoom.getByRole('button', { name: 'Acercar imagen' }).click();
		await expect(desktopZoom.getByLabel('Nivel de zoom')).toHaveText('140%');
		await desktopZoom.getByRole('button', { name: 'Ajustar' }).click();
		await expect(desktopZoom.getByLabel('Nivel de zoom')).toHaveText('Ajustada');
		await ownerViewerDialog.getByRole('button', { name: 'Cerrar visor' }).click();

		const mobileContext = await browser.newContext({
			viewport: { width: 390, height: 844 },
			deviceScaleFactor: 1,
			isMobile: true,
			hasTouch: true
		});
		try {
			const mobilePage = await mobileContext.newPage();
			await login(mobilePage, fixture.ownerEmail);
			await mobilePage.goto(`/odonto/pacientes/${fixture.patientId}?tab=radiografias`);
			await mobilePage.getByRole('button', { name: 'Ver imagen' }).click();
			const mobileViewerDialog = mobilePage.getByRole('dialog', { name: description });
			await expect(mobileViewerDialog).toBeVisible();
			const mobileViewer = mobileViewerDialog.getByRole('img', { name: description });
			await expect(mobileViewer).toBeVisible();
			expect(await mobileViewer.getAttribute('src')).toMatch(/^blob:/);
			await expect
				.poll(() => mobileViewer.evaluate((image: HTMLImageElement) => image.naturalWidth))
				.toBe(1);
			const mobileViewerBox = await mobileViewerDialog.boundingBox();
			expect(mobileViewerBox?.width ?? 0).toBeGreaterThanOrEqual(390);
			expect(mobileViewerBox?.width ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(391);
			expect(mobileViewerBox?.height ?? 0).toBeGreaterThanOrEqual(844);
			await expect(mobileViewerDialog.getByText('Pellizcá para ampliar')).toBeVisible();
			const touchControls = mobileViewerDialog.locator('.clinical-viewer-touch-controls');
			const touchZoom = touchControls.getByLabel('Nivel de zoom');
			await expect(touchZoom).toHaveText('Ajustada');

			const stage = mobileViewerDialog.getByRole('group', {
				name: 'Área de observación de la imagen'
			});
			const stageBox = await stage.boundingBox();
			if (!stageBox) throw new Error('El lienzo clínico móvil no tiene dimensiones.');
			const centerX = stageBox.x + stageBox.width / 2;
			const centerY = stageBox.y + stageBox.height / 2;
			const cdp = await mobileContext.newCDPSession(mobilePage);
			await cdp.send('Input.dispatchTouchEvent', {
				type: 'touchStart',
				touchPoints: [
					{ x: centerX - 40, y: centerY, id: 1 },
					{ x: centerX + 40, y: centerY, id: 2 }
				]
			});
			await cdp.send('Input.dispatchTouchEvent', {
				type: 'touchMove',
				touchPoints: [
					{ x: centerX - 90, y: centerY, id: 1 },
					{ x: centerX + 90, y: centerY, id: 2 }
				]
			});
			await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
			await expect
				.poll(async () => Number.parseInt((await touchZoom.textContent()) ?? '0', 10))
				.toBeGreaterThan(150);
			expect(
				await mobileViewerDialog.evaluate((dialog) => dialog.scrollWidth <= dialog.clientWidth)
			).toBe(true);
			await expect(mobileViewerDialog.getByRole('button', { name: 'Cerrar visor' })).toBeInViewport();
			await expect(touchControls.getByRole('button', { name: 'Restablecer' })).toBeInViewport();
			await touchControls.getByRole('button', { name: 'Restablecer' }).click();
			await expect(touchZoom).toHaveText('Ajustada');
			await mobileViewerDialog.getByRole('button', { name: 'Cerrar visor' }).click();
		} finally {
			await mobileContext.close();
		}

	});

	test('el profesional vinculado ve el estudio y su aporte aparece para el dueño', async ({ page, browser }) => {
		if (!fixture) throw new Error('Fixture no preparado.');
		const { description, filename, professionalDescription, professionalFilename } = clinicalExample;
		await login(page, fixture.ownerEmail);
		await page.goto(`/odonto/pacientes/${fixture.patientId}?tab=radiografias`);
		await uploadFixtureImage(page, filename, description);
		const professionalContext = await browser.newContext();
		const professionalPage = await professionalContext.newPage();
		await login(professionalPage, fixture.professionalEmail);
		await professionalPage.goto(`/odonto/pacientes/${fixture.patientId}?tab=radiografias`);
		await expect(professionalPage.getByRole('heading', { name: description })).toBeVisible();
		await expect(professionalPage.getByRole('button', { name: 'Añadir documento' })).toBeVisible();
		await expect(professionalPage.getByRole('button', { name: 'Mover a papelera' })).toHaveCount(0);
		await professionalPage.getByRole('button', { name: 'Ver imagen' }).click();
		const professionalViewer = professionalPage.getByRole('img', { name: description });
		await expect(professionalViewer).toBeVisible();
		expect(await professionalViewer.getAttribute('src')).toMatch(/^blob:/);
		await expect
			.poll(() => professionalViewer.evaluate((image: HTMLImageElement) => image.naturalWidth))
			.toBe(1);
		await professionalPage
			.getByRole('dialog', { name: description })
			.getByRole('button', { name: 'Cerrar visor' })
			.click();
		await professionalPage.locator('input[type="file"]:not([capture])').setInputFiles({
			name: professionalFilename,
			mimeType: 'image/png',
			buffer: onePixelPng
		});
		await professionalPage.getByLabel('Descripción (opcional)').fill(professionalDescription);
		await professionalPage.getByRole('button', { name: 'Guardar documento' }).click();
		await expect(
			professionalPage.getByText('Documento guardado en la ficha del paciente.')
		).toBeVisible({ timeout: 30_000 });
		await expect(
			professionalPage.getByRole('heading', { name: professionalDescription })
		).toBeVisible();
		await professionalContext.close();

		await page.reload();
		await expect(page.getByRole('heading', { name: professionalDescription })).toBeVisible();
		const contribution = await must(adminClient().from('patient_radiographs')
			.select('uploaded_by,integrity_status,status').eq('business_id', fixture.businessId)
			.eq('patient_id', fixture.patientId).eq('original_filename', professionalFilename).single());
		expect(contribution).toMatchObject({ uploaded_by: fixture.professionalUserId, integrity_status: 'ok', status: 'ready' });
	});

	test('la papelera conserva lectura restringida y restaura el archivo y su auditoría', async ({ page, browser }) => {
		if (!fixture) throw new Error('Fixture no preparado.');
		const { description, filename, professionalDescription, professionalFilename } = clinicalExample;
		await login(page, fixture.ownerEmail);
		await page.goto(`/odonto/pacientes/${fixture.patientId}?tab=radiografias`);
		await uploadFixtureImage(page, filename, description);
		const professionalContext = await browser.newContext();
		try {
			const professionalPage = await professionalContext.newPage();
			await login(professionalPage, fixture.professionalEmail);
			await professionalPage.goto(`/odonto/pacientes/${fixture.patientId}?tab=radiografias`);
			await uploadFixtureImage(professionalPage, professionalFilename, professionalDescription);
		} finally { await professionalContext.close(); }
		await page.reload();
		await expect(page.getByRole('heading', { name: professionalDescription })).toBeVisible();
		const ownerFileCard = page.locator('article').filter({
			has: page.getByRole('heading', { name: description })
		});
		await ownerFileCard.getByRole('button', { name: 'Mover a papelera' }).click();
		await expect(page.getByRole('heading', { name: 'Mover documento a la papelera' })).toBeVisible();
		await page.getByRole('button', { name: 'Mover a papelera' }).last().click();
		await expect(page.getByText('Imagen movida a la papelera. Podés restaurarla cuando la necesites.')).toBeVisible();

		await page.goto('/odonto/pacientes/papelera');
		await expect(page.getByRole('heading', { name: 'Papelera de documentos' })).toBeVisible();
		await expect(page.getByText(fixture.patientName)).toBeVisible();
		await expect(page.getByText(filename)).toBeVisible();

		const admin = adminClient();
		const restrictedSubscription = await must(
			admin
				.from('business_subscriptions')
				.update({
					commercial_access_enabled: true,
					is_permanent: false,
					subscription_status: 'restricted',
					paid_until: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
					grace_until: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
					restricted_until: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
					archived_at: null
				})
				.eq('business_id', fixture.businessId)
				.select('is_permanent, subscription_status, paid_until, grace_until, restricted_until')
				.single()
		);
		expect(restrictedSubscription).toMatchObject({
			is_permanent: false,
			subscription_status: 'restricted'
		});
		await page.reload();
		await expect(page.getByText(fixture.patientName)).toBeVisible();
		await expect(page.getByText(filename)).toBeVisible();
		await expect(
			page.getByText(
				'Podés consultar la papelera. Para restaurar documentos, activá nuevamente la suscripción.'
			)
		).toBeVisible();
		await expect(page.getByRole('button', { name: 'Restaurar' })).toHaveCount(0);
		await page.goto('/odonto/agenda');
		// La suscripción se muta directamente en el fixture; forzamos una carga
		// completa para que el layout vuelva a resolver el contexto comercial.
		await page.reload();
		await expect(page.getByRole('heading', { name: 'Tu acceso a Cita Suite venció' })).toBeVisible();
		await page.getByRole('link', { name: 'Pacientes', exact: true }).click();
		await expect(page).toHaveURL(/\/odonto\/pacientes$/);
		await expect(page.getByRole('heading', { name: 'Pacientes', exact: true })).toBeVisible();

		await page.goto(`/odonto/pacientes/${fixture.patientId}?tab=radiografias`);
		await expect(page.getByRole('heading', { name: professionalDescription })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Añadir documento' })).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Mover a papelera' })).toHaveCount(0);
		await page.getByRole('button', { name: 'Ver imagen' }).click();
		const restrictedViewerDialog = page.getByRole('dialog', { name: professionalDescription });
		await expect(restrictedViewerDialog.getByRole('img', { name: professionalDescription })).toBeVisible();
		await restrictedViewerDialog.getByRole('button', { name: 'Cerrar visor' }).click();
		await page.goto('/odonto/pacientes/papelera');

		await write(
			admin
				.from('business_subscriptions')
				.update({
					commercial_access_enabled: true,
					is_permanent: true,
					subscription_status: 'active',
					paid_until: null,
					grace_until: null,
					restricted_until: null,
					archived_at: null
				})
				.eq('business_id', fixture.businessId)
		);
		await page.reload();
		await page.getByRole('button', { name: 'Restaurar' }).click();
		await page.getByRole('button', { name: 'Restaurar documento' }).click();
		await expect(page.getByText('Imagen restaurada en la ficha del paciente.')).toBeVisible();

		await page.goto(`/odonto/pacientes/${fixture.patientId}?tab=radiografias`);
		await expect(page.getByRole('heading', { name: description })).toBeVisible();

		const stored = await must(
			admin
				.from('patient_radiographs')
				.select('status, storage_provider, integrity_status, uploaded_by, deleted_at, restored_by')
					.eq('business_id', fixture.businessId)
					.eq('patient_id', fixture.patientId)
					.eq('uploaded_by', fixture.ownerUserId)
					.single()
		);
		expect(stored).toMatchObject({
			status: 'ready',
			storage_provider: 'supabase_storage',
			integrity_status: 'ok',
			uploaded_by: fixture.ownerUserId,
			deleted_at: null,
			restored_by: fixture.ownerUserId
		});
		const audit = await must(
			admin
				.from('audit_logs')
				.select('action, result')
				.eq('business_id', fixture.businessId)
				.in('action', [
					'radiograph.upload_started',
					'radiograph.upload_completed',
					'radiograph.original_access_granted',
					'radiograph.trashed',
					'radiograph.restored'
				])
		);
		const actions = new Set(audit.map((row) => row.action));
		for (const action of [
			'radiograph.upload_started',
			'radiograph.upload_completed',
			'radiograph.original_access_granted',
			'radiograph.trashed',
			'radiograph.restored'
		]) {
			expect(actions.has(action)).toBe(true);
		}
		expect(audit.every((row) => row.result === 'success')).toBe(true);
	});

	test('la lista pagina y busca globalmente, conserva contexto y recepción no descubre documentos ni historia clínica', async ({
		page,
		browser
	}) => {
		if (!fixture) throw new Error('Fixture no preparado.');

		await login(page, fixture.ownerEmail);
		const privateClinicalDescription = 'Historia clínica sintética reservada al equipo clínico';
		await write(adminClient().from('clinical_entries').insert({
			business_id: fixture.businessId,
			patient_id: fixture.patientId,
			owner_id: fixture.ownerUserId,
			created_by_user_id: fixture.ownerUserId,
			entry_type: 'Consulta',
			description: privateClinicalDescription
		}));
		await page.goto(`/odonto/pacientes/${fixture.patientId}?tab=historial`);
		await expect(page.getByText(privateClinicalDescription, { exact: true })).toBeVisible();
		await page.goto(`/odonto/pacientes/${fixture.patientId}?tab=radiografias`);
		await uploadFixtureImage(page, clinicalExample.filename, clinicalExample.description);
		await page.goto('/odonto/pacientes');
		await expect(page.locator('tbody tr')).toHaveCount(30);
		await expect(page.getByRole('button', { name: 'Ver más pacientes' })).toBeVisible();

		const search = page.getByLabel('Buscar pacientes');
		const singleCharacterRequest = page.waitForRequest(
			(request) => {
				const requestUrl = new URL(request.url());
				return (
					requestUrl.pathname.endsWith('/odonto/pacientes/lista') &&
					requestUrl.searchParams.get('q') === 'a'
				);
			},
			{ timeout: 10_000 }
		);
		await search.fill('a');
		await singleCharacterRequest;

		await search.fill('unico lejano');
		await expect(
			page.locator('tbody').getByText(fixture.hiddenPatientName, { exact: true })
		).toBeVisible();
		await expect(page).toHaveURL(/q=unico(?:%20|\+)lejano/);

		await search.fill('');
		await expect(page.locator('tbody tr')).toHaveCount(30);
		await page.getByRole('button', { name: 'Ver más pacientes' }).click();
		await expect(page.locator('tbody tr')).toHaveCount(32);
		await expect(page.getByRole('button', { name: 'Ver más pacientes' })).toHaveCount(0);

		const distantRow = page.locator('tbody tr').filter({ hasText: fixture.hiddenPatientName });
		await distantRow.getByRole('button', { name: 'Abrir paciente' }).click();
		await expect(page.getByRole('heading', { name: fixture.hiddenPatientName })).toBeVisible();
		await page.getByRole('link', { name: 'Atrás' }).click();
		await expect(page.locator('tbody tr')).toHaveCount(32);

		await page.getByRole('link', { name: /^Archivados \(1\)$/ }).click();
		await expect(page).toHaveURL(/estado=archivados/);
		await expect(
			page.locator('tbody').getByText(fixture.archivedPatientName, { exact: true })
		).toBeVisible();
		await expect(page.locator('tbody tr')).toHaveCount(1);

		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto(`/odonto/pacientes/${fixture.patientId}?tab=radiografias`);
		await expect(page.getByRole('heading', { name: 'Estudios y documentos' })).toBeVisible();
		await expect
			.poll(() =>
				page.evaluate(
					() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1
				)
			)
			.toBe(true);

		const receptionContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
		const receptionPage = await receptionContext.newPage();
		await login(receptionPage, fixture.receptionEmail);
		await receptionPage.goto(`/odonto/pacientes/${fixture.patientId}?tab=radiografias`);
		await expect(receptionPage.getByText('Tu rol no permite ver documentos clínicos.')).toBeVisible();
		await expect(receptionPage.getByText('Panorámica compartida del equipo')).toHaveCount(0);
		await expect(receptionPage.getByRole('button', { name: 'Añadir documento' })).toHaveCount(0);
		const receptionHtml = await browserRequest(receptionPage, `/odonto/pacientes/${fixture.patientId}?tab=historial`);
		expect(receptionHtml.status).toBe(200);
		expect(receptionHtml.headers.get('cache-control')).toContain('no-store');
		const receptionBody = await receptionHtml.text();
		expect(receptionBody.includes(privateClinicalDescription), 'Reception SSR must omit private clinical history.').toBe(false);
		expect(receptionBody.includes('Datos del paciente'), 'Reception must receive its authorized patient data, not a login page.').toBe(true);
		await receptionPage.goto(`/odonto/pacientes/${fixture.patientId}?tab=historial`);
		await expect(receptionPage.getByRole('main').getByRole('heading', { name: fixture.patientName })).toBeVisible();
		await expect(receptionPage.getByRole('button', { name: 'Historial', exact: true })).toHaveCount(0);
		await expect(receptionPage.getByText(privateClinicalDescription)).toHaveCount(0);
		await expect(receptionPage.getByRole('heading', { name: 'Datos del paciente', exact: true })).toBeVisible();
		const deniedHistory = await browserRequest(receptionPage, `/odonto/pacientes/${fixture.patientId}/historial`);
		expect(deniedHistory.status).toBe(403);
		expect((await deniedHistory.text()).includes(privateClinicalDescription), 'Denied history must omit private clinical data.').toBe(false);
		await receptionPage.setViewportSize({ width: 1280, height: 900 });
		await expect(receptionPage.getByRole('button', { name: 'Historial', exact: true })).toHaveCount(0);
		await expect(receptionPage.getByText(privateClinicalDescription)).toHaveCount(0);
		await receptionContext.close();
	});

	// Final audit of the plan: raising a practice's quota and the global capacity, as a plan change
	// does, keeps stored documents, their permissions and a pending upload. The master raises the
	// quota with its own form; the operator raises the capacity as a versioned migration would.
	test('ampliar la cuota y la capacidad global conserva documentos, permisos y cargas pendientes', async ({ page, browser }) => {
		if (!fixture || !databaseUrl) throw new Error('Fixture no preparado.');
		const target = fixture;
		const connection = databaseUrl;
		const masterEmail = process.env.MASTER_EMAIL;
		const masterPassword = process.env.E2E_MASTER_PASSWORD;
		if (!masterEmail || !masterPassword) throw new Error('Explicit synthetic master identity is required.');
		const admin = adminClient();
		const masterId = await syntheticMasterId(admin.auth.admin, masterEmail, masterPassword);
		const operator = (sql: string) => {
			const result = spawnSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-qAt', '-c', sql], { env: psqlEnvironment(connection), encoding: 'utf8' });
			if (result.status !== 0) throw new Error(`No se pudo operar la capacidad global: ${result.stderr || 'psql falló.'}`);
			return result.stdout.trim();
		};
		const endpoint = `/odonto/pacientes/${target.patientId}/radiografias`;
		const accounting = async () => ({
			business: await must(admin.from('clinical_business_storage_budget').select('max_bytes,used_bytes,reserved_bytes,uploads_enabled')
				.eq('business_id', target.businessId).single()),
			global: await must(admin.from('clinical_storage_budget').select('max_bytes,used_bytes,reserved_bytes').eq('singleton', true).single()),
			files: await must(admin.from('patient_radiographs').select('id,status,bytes,storage_bucket,storage_path')
				.eq('business_id', target.businessId).order('created_at'))
		});

		await login(page, target.ownerEmail);
		await page.goto(`/odonto/pacientes/${target.patientId}?tab=radiografias`);
		await uploadFixtureImage(page, 'antes-del-cambio.png', 'Documento anterior al cambio');
		// A pending upload: its signed URL is issued and its reservation stays while the resources change.
		const started = await browserRequest(page, `${endpoint}/uploads`, { method: 'POST', data: {
			clientRequestId: randomUUID(), originalFilename: 'pendiente.png', mimeType: 'image/png', bytes: onePixelPng.length,
			sha256: createHash('sha256').update(onePixelPng).digest('hex'), takenAt: null, note: 'Carga pendiente durante el cambio' } });
		expect(started.status).toBe(200);
		const pending = (await started.json()) as { id: string; upload_url: string };
		const before = await accounting();
		expect(before.files.map((file) => file.status)).toEqual(['ready', 'uploading']);
		expect(before.business.reserved_bytes).toBeGreaterThan(0);
		const capacity = Number(operator('select max_bytes from public.clinical_storage_budget where singleton'));
		const masterContext = await browser.newContext();
		try {
			const masterPage = await masterContext.newPage();
			await signInWithPassword(masterPage, masterEmail, masterPassword);
			await masterPage.goto('/odonto/maestro/almacenamiento');
			const { name } = await must(admin.from('businesses').select('name').eq('id', target.businessId).single());
			const row = masterPage.locator('form').filter({ has: masterPage.getByRole('heading', { name, exact: true }) });
			const quota = before.business.max_bytes + 50_000_000;
			await row.getByLabel(`Límite de ${name} (MB)`).fill(String(quota / 1_000_000));
			await row.getByRole('button', { name: 'Guardar límite', exact: true }).click();
			await expect(row.getByRole('status')).toContainText('Los documentos y las cargas pendientes se conservaron.');
			operator(`update public.clinical_storage_budget set max_bytes=${capacity + 100_000_000} where singleton`);
			// The new limit still refuses a reduction below what is stored and reserved.
			const below = await admin.rpc('set_business_clinical_storage_policy', { p_actor_id: masterId, p_business_id: target.businessId,
				p_max_bytes: before.business.used_bytes + before.business.reserved_bytes - 1, p_uploads_enabled: true });
			expect(below.error?.message).toContain('CLINICAL_STORAGE_COMMITTED');
			const changed = await accounting();
			expect(changed).toEqual({ business: { ...before.business, max_bytes: quota }, global: { ...before.global, max_bytes: capacity + 100_000_000 },
				files: before.files });

			// The pending upload completes under the new limits: its original's 5 MB become the stored bytes.
			// Its thumbnail URL was not used and stays backed until it expires.
			const uploaded = await page.request.put(pending.upload_url, { headers: { 'x-upsert': 'false', 'content-type': 'image/png' }, data: onePixelPng });
			expect(uploaded.ok()).toBe(true);
			const completed = await browserRequest(page, `${endpoint}/${pending.id}/complete`, { method: 'POST', data: { thumbnailUploaded: false } });
			expect(completed.status).toBe(200);
			const after = await accounting();
			expect(after.files.map((file) => [file.id, file.status])).toEqual([[before.files[0].id, 'ready'], [pending.id, 'ready']]);
			expect(after.business).toEqual({ ...changed.business, used_bytes: before.business.used_bytes + onePixelPng.length,
				reserved_bytes: before.business.reserved_bytes - 5_000_000 });
			expect(after.global.used_bytes - before.global.used_bytes).toBe(onePixelPng.length);
			expect(before.global.reserved_bytes - after.global.reserved_bytes).toBe(5_000_000);
			for (const file of after.files) {
				if (!file.storage_bucket || !file.storage_path) throw new Error('A stored document lost its object.');
				const { data, error } = await admin.storage.from(file.storage_bucket).download(file.storage_path);
				if (error || !data) throw error ?? new Error('A stored document could not be read.');
				expect(Buffer.from(await data.arrayBuffer()).equals(onePixelPng)).toBe(true);
			}

			// Permissions are unchanged: the owner reads both documents, reception reads none.
			const listed = await browserRequest(page, endpoint);
			expect(listed.status).toBe(200);
			const { items } = (await listed.json()) as { items: { id: string }[] };
			expect(items.map((item) => item.id).sort()).toEqual(after.files.map((file) => file.id).sort());
			const receptionContext = await browser.newContext();
			try {
				const receptionPage = await receptionContext.newPage();
				await login(receptionPage, target.receptionEmail);
				expect((await browserRequest(receptionPage, endpoint)).status).toBe(403);
			} finally { await receptionContext.close(); }
			// Reconciliation of the stored objects finds this practice's counters already exact.
			await write(admin.rpc('reconcile_clinical_storage_budget', { p_max_businesses: 1000 }));
			expect((await accounting()).business).toEqual(after.business);
		} finally {
			await masterContext.close();
			operator(`update public.clinical_storage_budget set max_bytes=${capacity} where singleton`);
		}
	});
});
