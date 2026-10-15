import { fixturePath } from './lib/fixture-path.mjs';
// Local static Natalia + real disposable Cita backend. No remote writes/messages.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(new URL('../apps/web/package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const r = JSON.parse(readFileSync(fixturePath('runtime.json'), 'utf8'));
assert.match(r.container, /^cita-booking-test-[a-f0-9]{12}$/);
assert.equal(
	spawnSync(
		'docker',
		[
			'inspect',
			'--format',
			'{{index .Config.Labels "com.cita-suite.booking-fixture"}}',
			r.container
		],
		{ encoding: 'utf8' }
	).stdout.trim(),
	'true'
);
assert.equal(new URL(r.appOrigin).hostname, '127.0.0.1');
function sql(s) {
	const x = spawnSync(
		'docker',
		[
			'exec',
			'-i',
			r.container,
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
		{ input: s, encoding: 'utf8' }
	);
	if (x.status) throw new Error(x.stderr);
	return x.stdout.trim();
}
const dist = resolve(root, 'apps/natalia/dist');
const out = resolve(root, '.impeccable/review/booking-extensions');
mkdirSync(out, { recursive: true });
const result = {
	scope:
		'Static local Natalia; real isolated Cita PostgreSQL and APIs; no production writes or WhatsApp messages',
	checks: [],
	screenshots: [],
	errors: [],
	unexpected: []
};
const server = createServer((req, res) => {
	const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
	let target = resolve(dist, '.' + pathname);
	if (!target.startsWith(dist + sep) && target !== dist) {
		res.writeHead(404).end();
		return;
	}
	if (!extname(target)) target += sep + 'index.html';
	if (!existsSync(target)) {
		res.writeHead(404).end();
		return;
	}
	let body = readFileSync(target);
	if (extname(target) === '.html')
		body = Buffer.from(
			body
				.toString()
				.replace(/data-booking-key(?:="")?(?=\s|>)/, `data-booking-key="${r.key}"`)
				.replace(/data-booking-base="[^"]*"/, `data-booking-base="${r.appOrigin}"`)
				.replaceAll('href="/turnos"', `href="${r.appOrigin}/embed/v1/${r.key}"`)
		);
	res.setHeader(
		'content-type',
		{
			'.html': 'text/html; charset=utf-8',
			'.js': 'text/javascript',
			'.css': 'text/css',
			'.webp': 'image/webp',
			'.woff2': 'font/woff2'
		}[extname(target)] ?? 'application/octet-stream'
	);
	res.end(body);
});
await new Promise((done) => server.listen(0, '127.0.0.1', done));
const local = 'http://127.0.0.1:' + server.address().port;
sql(
	`update public.booking_integrations set allowed_origins=array_append(allowed_origins,'${local}') where business_id='${r.businessId}';`
);
let browser;
function check(name) {
	result.checks.push(name);
	console.log('PASS ' + name);
}
async function capture(p, name, width) {
	await p.setViewportSize({ width, height: 900 });
	await p.evaluate(async () => {
		await document.fonts.ready;
		for (let y = 0; y < document.documentElement.scrollHeight; y += 800) {
			window.scrollTo(0, y);
			await new Promise(requestAnimationFrame);
		}
		window.scrollTo(0, 0);
		await new Promise(requestAnimationFrame);
		await new Promise(requestAnimationFrame);
	});
	await p.screenshot({ path: out + '/' + name + '.png', fullPage: true, animations: 'disabled' });
	assert(
		await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1),
		name + ' overflow'
	);
	result.screenshots.push(name + '.png');
}
try {
	browser = await chromium.launch({ args: ['--disable-dev-shm-usage'] });
	const c = await browser.newContext({
		viewport: { width: 390, height: 900 },
		reducedMotion: 'reduce'
	});
	await c.route('**/*', async (route) => {
		const u = new URL(route.request().url());
		if (
			u.hostname === '127.0.0.1' ||
			u.hostname === 'localhost' ||
			['fonts.googleapis.com', 'fonts.gstatic.com'].includes(u.hostname)
		)
			await route.continue();
		else {
			result.unexpected.push(u.origin);
			await route.abort();
		}
	});
	const p = await c.newPage();
	p.on('pageerror', (e) => result.errors.push(e.message));
	let sdk = 0;
	p.on('request', (q) => {
		if (q.url().endsWith('/booking/embed-v1.js')) sdk++;
	});
	await p.goto(local + '/');
	assert.equal(sdk, 0);
	assert.equal(await p.locator('iframe').count(), 0);
	await p.locator('#public-catalogue').scrollIntoViewIfNeeded();
	await p.locator('#public-catalogue .service-commercial-card').first().waitFor();
	await p.locator('#contacto a[href^="https://wa.me/"]').waitFor();
	const link = p.locator('#contacto a[href^="https://wa.me/"]');
	assert.equal(new URL(await link.getAttribute('href')).pathname, '/5491112345678');
	assert.equal(
		new URL(await link.getAttribute('href')).searchParams.get('text'),
		'Consulta general sintética'
	);
	assert.equal(await link.getAttribute('rel'), 'noopener noreferrer');
	await capture(p, 'natalia-desktop', 1440);
	await p
		.locator('#contacto')
		.screenshot({
			path: out + '/natalia-contact-desktop.png',
			animations: 'disabled',
			style: 'header, .skip-link { visibility: hidden !important; }'
		});
	result.screenshots.push('natalia-contact-desktop.png');
	await capture(p, 'natalia-mobile', 390);
	await p
		.locator('#contacto')
		.screenshot({
			path: out + '/natalia-contact-mobile.png',
			animations: 'disabled',
			style: 'header, .skip-link { visibility: hidden !important; }'
		});
	result.screenshots.push('natalia-contact-mobile.png');
	check(
		'Natalia retains its complete public layout and obtains contact/catalogue from actual isolated APIs; SDK waits for intent'
	);
	await p.locator('a[data-booking]:visible').first().click();
	await p
		.frameLocator('.cita-booking-host iframe')
		.getByRole('heading', { name: 'Consultorio de prueba', exact: true })
		.waitFor();
	assert.equal(sdk, 1);
	await p.keyboard.press('Escape');
	assert.equal(await p.locator('.cita-booking-host[open]').count(), 0);
	check('Actual SDK opens the actual booking iframe and Escape closes it');
	sql(`update public.businesses set public_booking_enabled=false where id='${r.businessId}';`);
	await p.goto(local + '/contacto/');
	await p.locator('a[href^="https://wa.me/"]').waitFor();
	await capture(p, 'contact-mobile', 390);
	await capture(p, 'contact-320', 320);
	check('Approved WhatsApp contact remains available with booking disabled');
	sql(`update public.businesses set whatsapp_contact_enabled=false where id='${r.businessId}';`);
	await p.reload();
	await p.getByText('Dirección sintética 123', { exact: true }).waitFor();
	assert.equal(await p.locator('a[href^="https://wa.me/"]').count(), 0);
	check('Disabling the WhatsApp contact flag removes the link while keeping the approved address');
	await c.close();
	const token = sql(
		`select confirmation_token from public.appointments where business_id='${r.businessId}' order by created_at desc limit 1`
	);
	const nojs = await browser.newContext({
		javaScriptEnabled: false,
		viewport: { width: 390, height: 900 }
	});
	const info = await nojs.newPage();
	await info.goto(r.appOrigin + '/turno/' + token + '/informacion');
	assert.match(await info.locator('[name="intake_profile_medication"]').inputValue(), /sintética/);
	await info
		.locator('[name="intake_profile_medication"]')
		.fill('Declaración sintética sin JavaScript');
	await Promise.all([
		info.waitForURL((url) => url.search === '?/save', { waitUntil: 'load' }),
		info.getByRole('button', { name: 'Guardar información', exact: true }).click()
	]);
	await info.getByRole('status').waitFor();
	const patient = sql(
		`select patient_id from public.appointments where confirmation_token='${token}'`
	);
	assert.equal(
		sql(`select medication from public.patient_clinical_profiles where patient_id='${patient}'`),
		'Declaración sintética sin JavaScript'
	);
	await info.screenshot({
		path: out + '/information-nojs-mobile.png',
		fullPage: true,
		animations: 'disabled'
	});
	result.screenshots.push('information-nojs-mobile.png');
	check('Questionnaire renders existing values and saves medical history without JavaScript');
	await nojs.close();
	assert.deepEqual(result.errors, []);
	assert.deepEqual(result.unexpected, []);
} catch (e) {
	result.failure = e.message;
	console.error(e);
	process.exitCode = 1;
} finally {
	sql(
		`update public.businesses set public_booking_enabled=true,whatsapp_contact_enabled=true where id='${r.businessId}';`
	);
	writeFileSync(out + '/natalia-results.json', JSON.stringify(result, null, 2));
	await browser?.close();
	await new Promise((done) => server.close(done));
}
