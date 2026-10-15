import { fixturePath } from './lib/fixture-path.mjs';
// Own disposable fixture only. Real PostgreSQL, PostgREST and Storage; simulated Auth.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(new URL('../apps/web/package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const { PDFDocument } = require('pdf-lib');
const runtime = JSON.parse(readFileSync(fixturePath('runtime.json'), 'utf8'));
const { appOrigin, apiOrigin, key, businessId, professionalId, serviceId, container } = runtime;
assert.match(container, /^cita-booking-test-[a-f0-9]{12}$/);
assert.equal(
	spawnSync(
		'docker',
		['inspect', '--format', '{{index .Config.Labels "com.cita-suite.booking-fixture"}}', container],
		{ encoding: 'utf8' }
	).stdout.trim(),
	'true'
);
assert.equal(new URL(appOrigin).hostname, '127.0.0.1');
assert.equal(new URL(apiOrigin).hostname, '127.0.0.1');
const out = root + '.impeccable/review/booking-extensions';
mkdirSync(out, { recursive: true });
const results = {
	scope:
		'Local real PostgreSQL/PostgREST/Storage API; Auth simulated; loopback CSP/CORS transport adaptation; no production writes',
	checks: [],
	screenshots: [],
	errors: [],
	external: []
};
function sql(statement) {
	const r = spawnSync(
		'docker',
		[
			'exec',
			'-i',
			container,
			'psql',
			'-X',
			'-U',
			'supabase_admin',
			'-d',
			'postgres',
			'-v',
			'ON_ERROR_STOP=1',
			'-Atq'
		],
		{ input: statement, encoding: 'utf8' }
	);
	if (r.status) throw new Error(r.stderr);
	return r.stdout.trim();
}
function check(name) {
	results.checks.push(name);
	console.log('PASS ' + name);
	writeFileSync(out + '/results.json', JSON.stringify(results, null, 2));
}
async function json(response, expected = 200) {
	const body = await response.json();
	assert.equal(response.status(), expected, JSON.stringify(body));
	return body;
}
async function post(context, path, body, status = 200) {
	return json(await context.request.post(appOrigin + path, { data: body }), status);
}
async function pdf(size) {
	const doc = await PDFDocument.create();
	doc.addPage([200, 200]);
	const raw = Buffer.from(await doc.save({ useObjectStreams: false }));
	const eof = raw.lastIndexOf('%%EOF');
	assert(size > raw.length);
	return Buffer.concat([
		raw.subarray(0, eof),
		Buffer.alloc(size - raw.length - 1, 32),
		Buffer.from('\n'),
		raw.subarray(eof)
	]);
}
async function context(browser, role = null, width = 1440) {
	const c = await browser.newContext({
		viewport: { width, height: 900 },
		colorScheme: 'light',
		reducedMotion: 'reduce',
		acceptDownloads: true
	});
	await c.route('**/*', async (route) => {
		const u = new URL(route.request().url());
		if (
			['127.0.0.1', 'localhost'].includes(u.hostname) ||
			u.hostname.startsWith('172.') ||
			['fonts.googleapis.com', 'fonts.gstatic.com'].includes(u.hostname) ||
			u.protocol === 'data:'
		)
			await route.continue();
		else {
			results.external.push(u.origin);
			await route.abort();
		}
	});
	if (role)
		await c.addCookies([
			{ name: 'sb-module', value: 'odonto', url: appOrigin },
			{
				name: 'sb-access-token',
				value: runtime[role + 'Token'],
				url: appOrigin
			},
			{
				name: 'sb-refresh-token',
				value: 'disposable-fixture-only',
				url: appOrigin
			},
			{ name: 'active-business-id', value: businessId, url: appOrigin }
		]); // Only transport policy is adapted to loopback. No backend response or object bytes are fabricated.
	await c.route(appOrigin + '/**', async (route) => {
		const response = await route.fetch();
		const headers = { ...response.headers() };
		if (headers['content-security-policy'])
			headers['content-security-policy'] = headers['content-security-policy'].replace(
				'connect-src ',
				'connect-src ' + apiOrigin + ' '
			);
		await route.fulfill({ response, headers });
	});
	await c.route(apiOrigin + '/storage/v1/**', async (route) => {
		const cors = {
			'access-control-allow-origin': appOrigin,
			'access-control-allow-methods': 'GET,HEAD,POST,PUT,OPTIONS',
			'access-control-allow-headers': 'content-type,x-upsert,authorization,apikey,x-client-info'
		};
		if (route.request().method() === 'OPTIONS') {
			await route.fulfill({ status: 204, headers: cors, body: '' });
			return;
		}
		const response = await route.fetch();
		await route.fulfill({
			response,
			headers: { ...response.headers(), ...cors }
		});
	});
	return c;
}
async function capture(page, name, width = 1440) {
	await page.setViewportSize({ width, height: 900 });
	await page.evaluate(() => window.scrollTo(0, 0));
	await page.screenshot({
		path: out + '/' + name + '.png',
		fullPage: true,
		animations: 'disabled'
	});
	assert(
		await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
		'Horizontal overflow ' + name
	);
	results.screenshots.push(name + '.png');
}
// Repeated isolated scenarios share one test IP; reset only this owned fixture's limit counters.
sql(
	`delete from public.public_booking_attempts where business_id='${businessId}';delete from public.server_rate_limit_events;delete from private.booking_integration_read_limits;`
);
const browser = await chromium.launch({ args: ['--disable-dev-shm-usage'] });
let patientId,
	token,
	fileIds = [];
try {
	const c = await context(browser);
	const page = await c.newPage();
	page.on('pageerror', (error) => results.errors.push(error.message));
	const today = new Date();
	const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 5))
		.toISOString()
		.slice(0, 10);
	const booking =
		appOrigin +
		'/embed/v1/' +
		key +
		'?' +
		new URLSearchParams({
			service_id: serviceId,
			professional_id: professionalId,
			date,
			modality: 'in_person'
		});
	await page.goto(booking);
	await page.getByRole('heading', { name: 'Arancel para la fecha elegida' }).waitFor();
	assert.match(await page.locator('main').innerText(), /20\.400/);
	assert.match(await page.locator('main').innerText(), /ajustes mensuales/);
	await capture(page, 'booking-desktop');
	await capture(page, 'booking-mobile', 390);
	await capture(page, 'booking-320', 320);
	check(
		'Future date quotes ARS 20,400 as whole pesos before selecting a time; 1440/390/320 without overflow'
	);
	await page.locator('a[href*="slot="]').first().click();
	await page.locator('[name="patient_name"]').fill('Ana Pérez Sintética');
	await page
		.locator('[name="patient_phone"]')
		.fill(
			'3425' +
				String(
					500000 +
						Number(sql(`select count(*) from public.patients where business_id='${businessId}'`))
				)
		);
	await page.locator('[name="intake_profile_age"]').fill('35');
	await page.locator('[name="intake_profile_medication"]').fill('Medicación sintética declarada');
	await page.locator('[name="intake_profile_insurance"]').fill('Cobertura sintética');
	await page.locator('[name="intake_insurance"]').fill('Plan sintético de la integración');
	for (const select of await page.locator('select[name^="intake_"]').all())
		await select.selectOption('false');
	await page.locator('button[type="submit"]').click();
	await page.waitForURL(/\/turno\/[a-f0-9]{64}/);
	token = page.url().match(/\/turno\/([a-f0-9]{64})/)[1];
	patientId = sql(`select patient_id from public.appointments where confirmation_token='${token}'`);
	assert.match(patientId, /^[a-f0-9-]{36}$/);
	assert.equal(
		sql(
			`select price_quote_snapshot->>'amount' from public.appointments where confirmation_token='${token}'`
		),
		'20400'
	);
	await capture(page, 'receipt-mobile', 390);
	check('Real public booking persists its accepted whole-peso quote and instructions');
	await page.goto(appOrigin + '/turno/' + token + '/informacion');
	await page
		.locator('[name="intake_profile_medication"]')
		.fill('Actualización sintética del tratamiento');
	await page.getByRole('button', { name: 'Guardar información', exact: true }).click();
	await page.getByRole('status').filter({ hasText: 'información quedó guardada' }).waitFor();
	assert.equal(
		sql(`select medication from public.patient_clinical_profiles where patient_id='${patientId}'`),
		'Actualización sintética del tratamiento'
	);
	assert.equal(
		sql(
			`select count(*) from public.appointment_intake_submissions where patient_id='${patientId}'`
		),
		'2'
	);
	check('Post-booking questionnaire updates medical history and preserves submission history');
	// Upload through the actual patient UI, then two more through its actual HTTP endpoints.
	const first = await pdf(3_500_000);
	await page.locator('input[type="file"]').setInputFiles({
		name: 'estudio-uno.pdf',
		mimeType: 'application/pdf',
		buffer: first
	});
	await page.getByRole('button', { name: 'Adjuntar documento', exact: true }).click();
	await page
		.locator('[role="status"],[role="alert"]')
		.filter({ hasText: /documento quedó guardado|carga|PDF|archivo/ })
		.last()
		.waitFor({ timeout: 30000 });
	assert.match(await page.locator('body').innerText(), /El documento quedó guardado/);
	fileIds = sql(
		`select id from public.patient_radiographs where appointment_id=(select id from public.appointments where confirmation_token='${token}') order by created_at`
	).split('\n');
	await capture(page, 'information-mobile', 390);
	await capture(page, 'information-desktop');
	await page.emulateMedia({ colorScheme: 'dark' });
	await capture(page, 'information-dark-mobile', 390);
	await page.emulateMedia({ colorScheme: 'light' });
	check('Patient uploads an actual 3.5 MB PDF via the rendered form');
	for (const [size, name] of [
		[3_500_000, 'estudio-dos.pdf'],
		[200_000, 'estudio-tres.pdf']
	]) {
		const bytes = await pdf(size);
		const metadata = {
			requestId: randomUUID(),
			filename: name,
			mime: 'application/pdf',
			bytes: size,
			sha256: createHash('sha256').update(bytes).digest('hex')
		};
		const start = await post(c, `/turno/${token}/documentos`, metadata);
		fileIds.push(start.id);
		const upload = await c.request.put(start.upload_url, {
			multipart: {
				cacheControl: '0',
				'': { name, mimeType: 'application/pdf', buffer: bytes }
			}
		});
		assert(upload.ok(), await upload.text());
		await post(c, `/turno/${token}/documentos/${start.id}/complete`, {});
		await post(c, `/turno/${token}/documentos/${start.id}/complete`, {});
		const replay = await post(c, `/turno/${token}/documentos`, metadata);
		assert.equal(replay.id, start.id);
		assert.equal(replay.already_complete, true);
	}
	assert.equal(
		sql(
			`select sum(bytes) from public.patient_radiographs where appointment_id=(select id from public.appointments where confirmation_token='${token}')`
		),
		'7200000'
	);
	await post(
		c,
		`/turno/${token}/documentos`,
		{
			requestId: randomUUID(),
			filename: 'cuarto.pdf',
			mime: 'application/pdf',
			bytes: 100,
			sha256: 'a'.repeat(64)
		},
		409
	);
	check(
		'Two 3.5 MB PDFs plus 200 KB fit the 10 MB quota; fourth file denied; completion and request replay idempotent'
	);
	await post(c, `/turno/${'0'.repeat(64)}/documentos/${fileIds[0]}/complete`, {}, 404);
	check('Wrong reservation capability cannot complete another patient document');
	await c.close();
	const owner = await context(browser, 'owner');
	const admin = await owner.newPage();
	admin.on('pageerror', (error) => results.errors.push(error.message));
	await admin.goto(appOrigin + '/odonto/profesionales/' + professionalId + '/aranceles');
	await admin.locator('input[inputmode="numeric"]').first().waitFor();
	await capture(admin, 'price-desktop');
	await capture(admin, 'price-mobile', 390);
	await capture(admin, 'price-320', 320);
	await admin.goto(appOrigin + '/odonto/configuracion/consultorio-publico');
	await admin.getByRole('heading', { name: 'Documentos y contacto del consultorio' }).waitFor();
	await capture(admin, 'settings-desktop');
	await capture(admin, 'settings-mobile', 390);
	await capture(admin, 'settings-320', 320);
	// Keep another form's draft through success and through a server-side validation failure.
	await admin.locator('[name="instructions"]').fill('Borrador que se conserva');
	await admin.getByRole('button', { name: 'Guardar configuración', exact: true }).click();
	await admin.getByRole('status').waitFor();
	assert.equal(
		await admin.locator('[name="instructions"]').inputValue(),
		'Borrador que se conserva'
	);
	await admin.locator('[name="whatsapp_phone"]').fill('incorrecto');
	await admin.getByRole('button', { name: 'Guardar configuración', exact: true }).click();
	await admin.getByRole('alert').waitFor();
	assert.equal(await admin.locator('[name="whatsapp_phone"]').inputValue(), 'incorrecto');
	assert.equal(
		await admin.locator('[name="instructions"]').inputValue(),
		'Borrador que se conserva'
	);
	await capture(admin, 'settings-error-mobile', 390);
	check('Independent settings forms preserve drafts across successful and failed saves');
	const professionalPdf = await pdf(200_000);
	const started = await post(owner, `/odonto/pacientes/${patientId}/radiografias/uploads`, {
		clientRequestId: randomUUID(),
		originalFilename: 'profesional.pdf',
		mimeType: 'application/pdf',
		bytes: professionalPdf.length,
		sha256: createHash('sha256').update(professionalPdf).digest('hex'),
		takenAt: null,
		note: 'Documento profesional sintético'
	});
	assert.equal(started.thumbnail_upload_url, null);
	const sent = await owner.request.put(started.upload_url, {
		multipart: {
			cacheControl: '0',
			'': {
				name: 'profesional.pdf',
				mimeType: 'application/pdf',
				buffer: professionalPdf
			}
		}
	});
	assert(sent.ok(), await sent.text());
	await post(owner, `/odonto/pacientes/${patientId}/radiografias/${started.id}/complete`, {});
	const grant = await post(
		owner,
		`/odonto/pacientes/${patientId}/radiografias/${fileIds[0]}/access-grants`,
		{}
	);
	assert.match(grant.filename, /Ana_Pérez_Sintética.*\.pdf$/);
	const downloaded = await owner.request.get(grant.url);
	assert(downloaded.ok());
	assert.equal(
		createHash('sha256')
			.update(await downloaded.body())
			.digest('hex'),
		createHash('sha256').update(first).digest('hex')
	);
	assert.match(downloaded.headers()['content-disposition'], /attachment/);
	check(
		'Professional uploads PDF without preview; download preserves exact bytes and uses patient full name'
	);
	const partial = await owner.request.get(grant.url, { headers: { range: 'bytes=0-1023' } });
	assert.equal(partial.status(), 206);
	assert.equal((await partial.body()).length, 1024);
	assert.match(partial.headers()['content-range'], /^bytes 0-1023\/3500000$/);
	await post(
		owner,
		`/odonto/pacientes/${patientId}/radiografias/uploads`,
		{
			clientRequestId: randomUUID(),
			originalFilename: 'demasiado.pdf',
			mimeType: 'application/pdf',
			bytes: 5_000_001,
			sha256: 'a'.repeat(64),
			takenAt: null,
			note: null
		},
		400
	);
	const maxPdf = await pdf(5_000_000);
	const maxStart = await post(owner, `/odonto/pacientes/${patientId}/radiografias/uploads`, {
		clientRequestId: randomUUID(),
		originalFilename: 'limite.pdf',
		mimeType: 'application/pdf',
		bytes: maxPdf.length,
		sha256: createHash('sha256').update(maxPdf).digest('hex'),
		takenAt: null,
		note: null
	});
	const over = await owner.request.put(maxStart.upload_url, {
		multipart: {
			cacheControl: '0',
			'': {
				name: 'exceso.pdf',
				mimeType: 'application/pdf',
				buffer: Buffer.concat([maxPdf, Buffer.from(' ')])
			}
		}
	});
	assert(!over.ok(), 'Storage must enforce 5 MB independently of declared metadata');
	const exact = await owner.request.put(maxStart.upload_url, {
		multipart: {
			cacheControl: '0',
			'': { name: 'limite.pdf', mimeType: 'application/pdf', buffer: maxPdf }
		}
	});
	assert(exact.ok(), await exact.text());
	await post(owner, `/odonto/pacientes/${patientId}/radiografias/${maxStart.id}/complete`, {});
	check(
		'Native Storage enforces 5 MB independently; exact boundary upload completes; actual 1024-byte Range response verified'
	);
	await admin.goto(appOrigin + '/odonto/pacientes/' + patientId + '?tab=radiografias');
	await admin.getByText('Ana Pérez Sintética', { exact: true }).first().waitFor();
	await admin.getByText('estudio-uno.pdf', { exact: true }).first().waitFor();
	await capture(admin, 'patient-documents-mobile', 390);
	check('Patient profile lists the patient and professional PDFs');
	const revision = () =>
		Number(
			sql(`select booking_availability_revision from public.businesses where id='${businessId}'`)
		);
	async function ownerRpc(name, args) {
		const response = await owner.request.post(apiOrigin + '/rest/v1/rpc/' + name, {
			headers: { apikey: runtime.anon, authorization: 'Bearer ' + runtime.ownerToken },
			data: args
		});
		assert(response.ok(), await response.text());
	}
	await ownerRpc('replace_professional_schedule_blocks', {
		p_business_id: businessId,
		p_professional_id: professionalId,
		p_expected_revision: revision(),
		p_blocks: [
			{
				weekdays: [0, 1, 2, 3, 4, 5, 6],
				ranges: [{ start: '09:00', end: '17:00' }],
				slot_interval_minutes: 30,
				break_minutes: 0,
				service_scope: 'all'
			},
			{
				weekdays: [0, 1, 2, 3, 4, 5, 6],
				ranges: [{ start: '17:00', end: '19:00' }],
				slot_interval_minutes: 30,
				break_minutes: 0,
				service_scope: 'restricted',
				service_ids: [runtime.followupId]
			}
		]
	});
	await admin.goto(booking);
	assert.equal(await admin.locator('a[href*="slot="]').filter({ hasText: '17:00' }).count(), 0);
	await admin.goto(booking.replace(serviceId, runtime.followupId));
	await admin.locator('a[href*="slot="]').filter({ hasText: '17:00' }).waitFor();
	const blockedDates = [date.slice(0, 8) + '10', date.slice(0, 8) + '12'];
	const items = blockedDates.map((d) => ({
		professional_id: professionalId,
		type: 'blocked',
		starts_at: d + 'T03:00:00Z',
		ends_at: new Date(Date.parse(d + 'T03:00:00Z') + 86_400_000).toISOString(),
		reason: 'Ausencia sintética'
	}));
	sql(
		`delete from public.availability_exceptions where business_id='${businessId}' and reason='Ausencia sintética';`
	);
	await ownerRpc('create_availability_exception_batch', {
		p_business_id: businessId,
		p_expected_revision: revision(),
		p_request_id: randomUUID(),
		p_items: items,
		p_ack_existing: false
	});
	check(
		'Real availability excludes general appointments at 17:00, allows follow-up appointments there and accepts a non-contiguous block batch'
	);
	await admin.goto(appOrigin + '/odonto/profesionales/' + professionalId + '?tab=horarios');
	await admin.getByRole('heading', { name: 'Horarios de atención', exact: true }).waitFor();
	await admin
		.getByRole('heading', { name: /Profesional/ })
		.first()
		.waitFor();
	await capture(admin, 'schedule-desktop');
	await capture(admin, 'schedule-mobile', 390);
	await capture(admin, 'schedule-320', 320);
	await admin.setViewportSize({ width: 390, height: 900 });
	await admin
		.locator('form[action="?/save_weekly_rules"]')
		.screenshot({
			path: out + '/weekly-controls-mobile.png',
			animations: 'disabled',
			style: 'header, nav.fixed { visibility: hidden !important; }'
		});
	results.screenshots.push('weekly-controls-mobile.png');
	check('Professional scheduling editor renders at desktop, mobile and 320 px');
	await owner.close();
	assert.deepEqual(results.errors, []);
	assert.deepEqual(results.external, []);
	check('No browser exceptions or unexpected external requests in tested flows');
} catch (error) {
	for (const c of browser.contexts())
		for (const p of c.pages())
			try {
				await p.screenshot({
					path: out + '/failure.png',
					fullPage: true,
					animations: 'disabled'
				});
				results.failurePage = (await p.locator('body').innerText()).slice(-5000);
			} catch {}
	results.failure = error.message;
	console.error(error);
	process.exitCode = 1;
} finally {
	writeFileSync(out + '/results.json', JSON.stringify(results, null, 2));
	await browser.close();
}
