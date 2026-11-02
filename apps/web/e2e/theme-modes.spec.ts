import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { must } from './helpers/fixture-db';
import { ownedAppointmentFixture } from './helpers/owned-appointment-fixture';
import { loginWithSharedSession, signInWithPassword } from './helpers/shared-auth';
import { syntheticMasterId } from './helpers/master-identity';
import { layoutIssues, type LayoutIssue } from './helpers/layout-usability';
import { chooseTheme, contrastViolations, expectRenderedTheme, type ContrastViolation, type ThemeChoice, type UndecidedContrast } from './helpers/theme';

// Light mode plan (docs/plans/modo-claro-20261102.md), acceptance criteria C1 to C4: light by
// default, the chosen mode rendered by the server, the selector, and WCAG contrast everywhere.

type Finding = { route: string; theme: ThemeChoice; viewport: number };
/**
 * A route, or a state of it that is not a route of its own (a menu, a dialog, an emptied field). `open`
 * prepares the state and returns the element to measure when an overlay covers the page on purpose.
 */
type Screen = string | { route: string; state: string; viewports?: number[]; open: (page: Page, viewport: number) => Promise<string | undefined> };
const VIEWPORTS = [390, 1280];
const PALETTE_BACKGROUND = { light: 'rgb(245, 246, 248)', dark: 'rgb(11, 22, 38)' };
// Native sources behind the styled calendars and selects (`.ux-native-source`) and file inputs opened
// by a button (`.sr-only`) measure 1 px on purpose: the visible control is their trigger.
const CONTROLS = ['a', 'button', 'input:not(.ux-native-source):not(.sr-only):not([type="hidden"])', 'select:not(.ux-native-source):not(.sr-only)', 'textarea', '.ux-control-trigger']
	.map((control) => `main ${control}:visible`)
	.join(', ');

async function sweep(page: Page, info: TestInfo, screens: Screen[], label: string) {
	const contrast: (ContrastViolation & Finding)[] = [];
	const layout: (LayoutIssue & Finding)[] = [];
	const coverage: (Finding & { finalPath: string; passes: number; incomplete: number; worstCase: number })[] = [];
	const undecided: (UndecidedContrast & Finding)[] = [];
	for (const theme of ['light', 'dark'] as const) {
		await chooseTheme(page, theme);
		for (const screen of screens)
			for (const viewport of typeof screen === 'string' ? VIEWPORTS : (screen.viewports ?? VIEWPORTS)) {
				const path = typeof screen === 'string' ? screen : screen.route;
				const route = typeof screen === 'string' ? screen : `${screen.route} (${screen.state})`;
				await page.setViewportSize({ width: viewport, height: 900 });
				await page.goto(path);
				await page.waitForLoadState('networkidle');
				await expect(page.locator('body')).toBeVisible();
				// Natalia's appearance follows only her site's color_mode (light without one), never the app mode.
				if (await page.locator('[data-booking-theme="natalia"]').count())
					await expect
						.poll(() => page.evaluate(() => ({ canvas: document.documentElement.dataset.bookingCanvas, scheme: getComputedStyle(document.documentElement).colorScheme })))
						.toEqual({ canvas: 'natalia', scheme: 'light' });
				else await expectRenderedTheme(page, theme);
				const scope = typeof screen === 'string' ? undefined : await screen.open(page, viewport);
				const result = await contrastViolations(page, scope);
				contrast.push(...result.violations.map((violation) => ({ ...violation, route, theme, viewport })));
				undecided.push(...result.undecided.map((node) => ({ ...node, route, theme, viewport })));
				layout.push(...(await layoutIssues(page, CONTROLS, 'main')).map((issue) => ({ ...issue, route, theme, viewport })));
				const name = `${label}-${route.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 60)}-${theme}-${viewport}.jpg`;
				await page.screenshot({ path: info.outputPath(name), type: 'jpeg', quality: 55, fullPage: true, animations: 'disabled' });
				coverage.push({ route, theme, viewport, finalPath: new URL(page.url()).pathname, passes: result.passes, incomplete: result.incomplete, worstCase: result.worstCase });
			}
	}
	await info.attach(`${label}-coverage`, { body: JSON.stringify({ coverage, contrast, layout, undecided }, null, 2), contentType: 'application/json' });
	const expected = screens.reduce((total, screen) => total + 2 * (typeof screen === 'string' ? VIEWPORTS : (screen.viewports ?? VIEWPORTS)).length, 0);
	expect(coverage.length).toBe(expected);
	// A sweep that measured nothing would prove nothing.
	expect(coverage.every((entry) => entry.passes > 0)).toBe(true);
	expect(contrast).toEqual([]);
	expect(layout).toEqual([]);
	// Every text is decided, by axe or by its worst case; an empty field has no text to read.
	expect(undecided.filter((node) => node.reason !== 'emptyValue')).toEqual([]);
}

// The account menu: a menu under the avatar on a computer, a sheet over a backdrop on a phone.
async function openAccountMenu(page: Page, viewport: number) {
	if (viewport < 1024) {
		await page.getByRole('button', { name: 'Abrir menú' }).last().click();
		await expect(page.getByRole('dialog', { name: 'Menú de navegación' }).getByRole('group', { name: 'Modo de color' })).toBeVisible();
		return '[role="dialog"][aria-label="Menú de navegación"]';
	}
	await page.locator('header button[aria-expanded]').last().click();
	await expect(page.locator('header [role="menu"]').getByRole('group', { name: 'Modo de color' })).toBeVisible();
	return 'header [role="menu"]';
}

// Moves the keyboard focus forward until it reaches the wanted option of the selector.
async function tabTo(page: Page, wanted: { role?: string; text?: string; radio?: string }) {
	for (let step = 0; step < 40; step++) {
		await page.keyboard.press('Tab');
		const focused = await page.evaluate(() => {
			const element = document.activeElement as HTMLInputElement | null;
			return element ? { role: element.getAttribute('role'), text: (element.textContent ?? '').trim(), type: element.type, value: element.value } : null;
		});
		if (wanted.role && focused?.role === wanted.role && focused.text === wanted.text) return;
		if (wanted.radio && focused?.type === 'radio' && focused.value === wanted.radio) return;
	}
	throw new Error(`The keyboard never reached ${JSON.stringify(wanted)}.`);
}

// The Configuración menu of the computer header (on a phone, its links live in the sheet above).
async function openConfigurationMenu(page: Page) {
	await page.locator('header button[aria-haspopup="menu"]').filter({ hasText: 'Configuración' }).click();
	await expect(page.locator('header [role="menu"]')).toBeVisible();
	return 'header [role="menu"]';
}

test.describe('color modes', () => {
	test('the contrast measure reports what axe leaves undecided and keeps what it cannot read', async ({ page }) => {
		// A one pixel image: text over it has no knowable background.
		const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
		await page.setContent(`<!doctype html><html lang="es"><body style="margin:0;background:#ffffff;font:16px sans-serif">
			<div style="background:linear-gradient(#ffffff,#777777);padding:8px"><p id="gris" style="color:#6b6b6b">Texto gris sobre la parte oscura</p></div>
			<div style="background:linear-gradient(#ffffff,#f2f2f2);padding:8px"><p id="legible" style="color:#1a1a1a">Texto legible</p></div>
			<div style="background:linear-gradient(#ffffff,#ffffff);opacity:0.3;padding:8px"><p id="tenue" style="color:#000000">Texto dentro de un contenedor tenue</p></div>
			<label>Tipo <select id="desplegable" style="background:#ffffff url(${image}) no-repeat right center;color:#1a1a1a"><option>Consulta</option></select></label>
			<div style="background-image:url(${image});padding:8px"><p id="imagen" style="color:#1a1a1a">Texto sobre una imagen</p></div>
		</body></html>`);
		const result = await contrastViolations(page);
		const targets = result.violations.map((violation) => violation.target).sort();
		expect(targets).toEqual(['#gris', '#tenue']);
		const gray = result.violations.find((violation) => violation.target === '#gris');
		expect(gray).toMatchObject({ measure: 'worst-case', expected: 4.5, background: '#777777' });
		expect(gray!.ratio).toBeLessThan(1.5);
		expect(result.undecided.map(({ target, reason }) => ({ target, reason }))).toEqual([{ target: '#imagen', reason: 'image' }]);
		expect(result.worstCase).toBeGreaterThanOrEqual(2);
	});

	test('light is the default, the server renders the chosen mode and automatic follows the device', async ({ browser }, info) => {
		test.setTimeout(240_000);
		const cases = [
			{ cookie: null, device: 'dark', serverClass: '', scheme: 'light' },
			{ cookie: 'dark', device: 'light', serverClass: 'dark', scheme: 'dark' },
			{ cookie: 'system', device: 'dark', serverClass: 'theme-system', scheme: 'dark' },
			{ cookie: 'system', device: 'light', serverClass: 'theme-system', scheme: 'light' },
			{ cookie: 'oscuro', device: 'dark', serverClass: '', scheme: 'light' }
		] as const;
		for (const entry of cases) {
			const context = await browser.newContext({ colorScheme: entry.device, viewport: { width: 390, height: 844 } });
			const page = await context.newPage();
			if (entry.cookie) await chooseTheme(page, entry.cookie as ThemeChoice);
			// The first document, before any script runs: no flash of the other mode.
			const html = await (await page.request.get('/login')).text();
			expect(html).toContain(`<html lang="es" class="${entry.serverClass}">`);
			expect(html).not.toContain('%cita.theme');
			const meta = html.match(/<meta name="theme-color"[^>]*>/g) ?? [];
			expect(meta).toHaveLength(entry.cookie === 'system' ? 2 : 1);
			await page.goto('/login');
			expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe(entry.scheme);
			expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(PALETTE_BACKGROUND[entry.scheme]);
			await context.close();
		}
		// Public pages without a session, in both modes.
		const context = await browser.newContext();
		const page = await context.newPage();
		await page.goto('/login');
		await sweep(page, info, ['/login', '/reset', '/reset/callback', '/confirmar-correo', '/privacidad', '/terminos', '/pagina-que-no-existe'], 'publicas');
		await context.close();
	});

	test('the account menus switch the mode at once by keyboard and remember it on this device', async ({ page }) => {
		test.setTimeout(180_000);
		const f = ownedAppointmentFixture();
		await loginWithSharedSession(page, { email: f.email, password: f.password });
		await page.setViewportSize({ width: 1280, height: 900 });
		await page.goto('/odonto/agenda');
		await expectRenderedTheme(page, 'light');
		// The fixed bars keep the exact opacity they had: content passes behind them (plan, 12.4).
		const header = page.locator('header').first();
		await expect(header).toHaveCSS('background-color', 'rgba(255, 255, 255, 0.95)');
		// Computer: the account menu opens with Enter and Tab reaches each option, with a visible focus.
		await page.locator('header button[aria-expanded]').last().focus();
		await page.keyboard.press('Enter');
		const menu = page.getByRole('group', { name: 'Modo de color' });
		await expect(menu.getByRole('menuitemradio', { name: 'Claro' })).toHaveAttribute('aria-checked', 'true');
		await tabTo(page, { role: 'menuitemradio', text: 'Oscuro' });
		await expect(page.locator(':focus')).toHaveCSS('outline-style', 'solid');
		await page.keyboard.press('Enter');
		await expectRenderedTheme(page, 'dark');
		await expect(menu.getByRole('menuitemradio', { name: 'Oscuro' })).toHaveAttribute('aria-checked', 'true');
		await expect(header).toHaveCSS('background-color', 'rgba(15, 31, 54, 0.95)');
		await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#0b1626');
		await page.reload();
		await expectRenderedTheme(page, 'dark');
		expect((await page.context().cookies()).find((cookie) => cookie.name === 'cita-theme')).toMatchObject({ value: 'dark', sameSite: 'Lax' });

		// Phone: the sheet opens with Enter; the options are native radio buttons moved with the arrows.
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto('/odonto/agenda');
		const bottomNavigation = page.getByRole('navigation', { name: 'Navegación principal' });
		await expect(bottomNavigation).toHaveCSS('background-color', 'rgba(11, 29, 50, 0.95)');
		await page.getByRole('button', { name: 'Abrir menú' }).last().focus();
		await page.keyboard.press('Enter');
		const sheet = page.getByRole('dialog', { name: 'Menú de navegación' }).getByRole('group', { name: 'Modo de color' });
		await expect(sheet.getByRole('radio', { name: 'Oscuro' })).toBeChecked();
		await page.emulateMedia({ colorScheme: 'light' });
		await tabTo(page, { radio: 'dark' });
		expect(await page.evaluate(() => getComputedStyle(document.activeElement!.closest('label')!).outlineStyle)).toBe('solid');
		await page.keyboard.press('ArrowDown');
		await expect(sheet.getByRole('radio', { name: 'Automático' })).toBeChecked();
		expect(await page.evaluate(() => document.documentElement.className.split(' ').includes('theme-system'))).toBe(true);
		expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('light');
		// Automatic follows the device live, without reloading.
		await page.emulateMedia({ colorScheme: 'dark' });
		expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('dark');
		await page.keyboard.press('ArrowUp');
		await expectRenderedTheme(page, 'dark');
		await page.keyboard.press('ArrowUp');
		await expect(sheet.getByRole('radio', { name: 'Claro' })).toBeChecked();
		await expectRenderedTheme(page, 'light');
		await page.reload();
		await expectRenderedTheme(page, 'light');
		await expect(bottomNavigation).toHaveCSS('background-color', 'rgba(255, 255, 255, 0.95)');
	});

	test('every screen of the app and of the patient meets WCAG contrast in both modes', async ({ page }, info) => {
		test.setTimeout(900_000);
		const f = ownedAppointmentFixture();
		const link = await must(f.admin.from('professional_services').select('professional_id, service_id').eq('business_id', f.businessId).limit(1).single());
		const service = await must(f.admin.from('services').select('name, duration_minutes').eq('id', link.service_id).eq('business_id', f.businessId).single());
		const professional = await must(f.admin.from('professionals').select('name').eq('business_id', f.businessId).eq('id', link.professional_id).single());
		const business = await must(f.admin.from('businesses').select('timezone').eq('id', f.businessId).single());
		const owner = await must(f.admin.from('business_users').select('user_id').eq('business_id', f.businessId).eq('role', 'owner').single());
		const date = new Intl.DateTimeFormat('sv-SE', { timeZone: business.timezone }).format(new Date(Date.now() + 6 * 86_400_000));
		const startsAt = new Date(f.sql("select (:'date'||' 10:00')::timestamp at time zone (select timezone from public.businesses where id=:'business'::uuid);", { date })).toISOString();
		const endsAt = new Date(Date.parse(startsAt) + service.duration_minutes * 60_000).toISOString();
		const suffix = [...randomUUID().slice(0, 8)].map((char) => String.fromCharCode(97 + parseInt(char, 16))).join('');
		const patientName = `Paciente de modos ${suffix}`;
		let patientId: string | null = null;
		try {
			const patient = await must(f.admin.from('patients').insert({ business_id: f.businessId, owner_id: owner.user_id, full_name: patientName }).select('id').single());
			patientId = patient.id;
			const appointment = await must(f.admin.from('appointments').insert({ business_id: f.businessId, patient_id: patient.id,
				service_id: link.service_id, professional_id: link.professional_id, starts_at: startsAt, ends_at: endsAt,
				blocking_starts_at: startsAt, blocking_ends_at: endsAt, status: 'reserved', source: 'manual',
				service_name_snapshot: service.name, professional_name_snapshot: professional.name, duration_minutes_snapshot: service.duration_minutes,
				patient_name_at_booking: patientName }).select('id, confirmation_token').single());
			await loginWithSharedSession(page, { email: f.email, password: f.password });
			const p = `/odonto/pacientes/${patient.id}`;
			const pro = `/odonto/profesionales/${link.professional_id}`;
			const agenda = `/odonto/agenda?date=${date}`;
			await sweep(page, info, [
				agenda, { route: agenda, state: 'menú de cuenta', open: openAccountMenu },
				{ route: agenda, state: 'menú de configuración', viewports: [1280], open: openConfigurationMenu },
				{ route: agenda, state: 'turno nuevo', open: async () => {
					// The control is enabled once hydrated, so its first click opens the wizard, inside the page.
					await page.getByRole('button', { name: '+ Nuevo turno', exact: true }).click();
					await expect(page.locator('form').filter({ has: page.locator('input[name="booking_mode"]') })).toBeVisible({ timeout: 15_000 });
					return undefined;
				} },
				'/odonto/agenda/semana', '/odonto/pacientes',
				{ route: '/odonto/pacientes', state: 'alta de paciente', open: async () => {
					await page.getByRole('button', { name: '+ Nuevo paciente', exact: true }).click();
					await expect(page.getByRole('dialog', { name: 'Alta rápida de paciente' })).toBeVisible();
					return '[role="dialog"][aria-label="Alta rápida de paciente"]';
				} },
				p, `${p}?tab=datos`, `${p}?tab=radiografias`,
				`${p}/informacion-previa`, '/odonto/pacientes/papelera', `/odonto/turnos/${appointment.id}`,
				'/odonto/configuracion', '/odonto/configuracion/negocio',
				// A practice without an address shows the hint of the field, which must fit at 390 px.
				{ route: '/odonto/configuracion/negocio', state: 'dirección vacía', open: async () => {
					const address = page.locator('input[name="address"]');
					await expect(address).toBeEditable();
					await address.fill('');
					return undefined;
				} },
				'/odonto/configuracion/negocio/contacto', '/odonto/configuracion/consultorio-publico',
				'/odonto/configuracion/reserva-online', '/odonto/configuracion/reserva-online/webs', '/odonto/configuracion/senas',
				'/odonto/configuracion/comunicacion', '/odonto/configuracion/documentos', '/odonto/configuracion/whatsapp', '/odonto/configuracion/resena-google',
				'/odonto/configuracion/usuarios', '/odonto/configuracion/suscripcion', '/odonto/configuracion/ayuda',
				'/odonto/profesionales', pro, `${pro}/aranceles`, `${pro}/historial`, `${pro}/preguntas`, '/odonto/servicios', '/odonto/seguimientos', '/odonto/seguimientos/importantes',
				'/odonto/mis-turnos', '/odonto/mis-preguntas', '/odonto/recordatorios', '/odonto/mensajes', '/odonto/senas', '/odonto/disponibilidad',
				'/odonto/exportar-datos', '/odonto/pago/procesando', '/odonto/pendiente', '/odonto/pagina-que-no-existe',
				`/reservar/${f.businessId}`, `/turno/${appointment.confirmation_token}`, `/turno/${appointment.confirmation_token}/informacion`,
				`/turno/${appointment.confirmation_token}/reprogramado`, `/embed/v1/${f.integrationKey}`, `/embed/v1/${f.integrationKey}/turno/${appointment.confirmation_token}`
			], 'app');
		} finally {
			f.sql(`begin;
				delete from public.audit_logs where business_id=:'business'::uuid and (entity_id=:'patient'::uuid or entity_id in (select id from public.appointments where business_id=:'business'::uuid and patient_id=:'patient'::uuid));
				delete from public.appointments where business_id=:'business'::uuid and patient_id=:'patient'::uuid;
				delete from public.patients where business_id=:'business'::uuid and id=:'patient'::uuid;
				commit;`, { patient: patientId ?? '00000000-0000-0000-0000-000000000000' });
			if (patientId) {
				expect(await must(f.admin.from('patients').select('id').eq('business_id', f.businessId).eq('id', patientId))).toHaveLength(0);
				expect(await must(f.admin.from('appointments').select('id').eq('business_id', f.businessId).eq('patient_id', patientId))).toHaveLength(0);
			}
		}
	});

	test('the master panel meets WCAG contrast in both modes', async ({ page }, info) => {
		test.setTimeout(240_000);
		const f = ownedAppointmentFixture();
		const masterEmail = process.env.MASTER_EMAIL;
		const masterPassword = process.env.E2E_MASTER_PASSWORD;
		if (!masterEmail || !masterPassword) throw new Error('Explicit synthetic master identity is required.');
		await syntheticMasterId(f.admin.auth.admin, masterEmail, masterPassword);
		await signInWithPassword(page, masterEmail, masterPassword);
		await sweep(page, info, ['/odonto/maestro', '/odonto/maestro/almacenamiento'], 'maestro');
	});
});
