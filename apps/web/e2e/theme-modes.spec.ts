import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { must } from './helpers/fixture-db';
import { ownedAppointmentFixture } from './helpers/owned-appointment-fixture';
import { loginWithSharedSession } from './helpers/shared-auth';
import { layoutIssues, type LayoutIssue } from './helpers/layout-usability';
import { chooseTheme, contrastViolations, expectRenderedTheme, type ContrastViolation, type ThemeChoice } from './helpers/theme';

// Light mode plan (docs/plans/modo-claro-20261102.md), acceptance criteria C1 to C4: light by
// default, the chosen mode rendered by the server, the selector, and WCAG contrast everywhere.

type Finding = { route: string; theme: ThemeChoice; width: number };
const PALETTE_BACKGROUND = { light: 'rgb(245, 246, 248)', dark: 'rgb(11, 22, 38)' };

async function sweep(page: Page, info: TestInfo, routes: string[], label: string) {
	const contrast: (ContrastViolation & Finding)[] = [];
	const layout: (LayoutIssue & Finding)[] = [];
	const coverage: (Finding & { finalPath: string; passes: number; incomplete: number })[] = [];
	for (const theme of ['light', 'dark'] as const) {
		await chooseTheme(page, theme);
		for (const route of routes)
			for (const width of [390, 1280]) {
				await page.setViewportSize({ width, height: 900 });
				await page.goto(route);
				await page.waitForLoadState('networkidle');
				await expect(page.locator('body')).toBeVisible();
				await expectRenderedTheme(page, theme);
				const result = await contrastViolations(page);
				contrast.push(...result.violations.map((violation) => ({ ...violation, route, theme, width })));
				layout.push(...(await layoutIssues(page, 'main a:visible, main button:visible, main input:visible, main select:visible', 'main')).map((issue) => ({ ...issue, route, theme, width })));
				const name = `${label}-${route.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 60)}-${theme}-${width}.jpg`;
				await page.screenshot({ path: info.outputPath(name), type: 'jpeg', quality: 55, fullPage: true, animations: 'disabled' });
				coverage.push({ route, theme, width, finalPath: new URL(page.url()).pathname, passes: result.passes, incomplete: result.incomplete });
			}
	}
	await info.attach(`${label}-coverage`, { body: JSON.stringify({ coverage, contrast, layout }, null, 2), contentType: 'application/json' });
	expect(coverage.length).toBe(routes.length * 4);
	// A sweep that measured nothing would prove nothing.
	expect(coverage.every((entry) => entry.passes > 0)).toBe(true);
	expect(contrast).toEqual([]);
	expect(layout).toEqual([]);
}

test.describe('color modes', () => {
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
		await sweep(page, info, ['/login', '/reset', '/privacidad', '/terminos'], 'publicas');
		await context.close();
	});

	test('the account menus switch the mode at once and remember it on this device', async ({ page }) => {
		test.setTimeout(180_000);
		const f = ownedAppointmentFixture();
		await loginWithSharedSession(page, { email: f.email, password: f.password });
		await page.setViewportSize({ width: 1280, height: 900 });
		await page.goto('/odonto/agenda');
		await expectRenderedTheme(page, 'light');
		await page.locator('header button[aria-expanded]').last().click();
		const menu = page.getByRole('group', { name: 'Modo de color' });
		await expect(menu.getByRole('menuitemradio', { name: 'Claro' })).toHaveAttribute('aria-checked', 'true');
		await menu.getByRole('menuitemradio', { name: 'Oscuro' }).click();
		await expectRenderedTheme(page, 'dark');
		await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute('content', '#0b1626');
		await page.reload();
		await expectRenderedTheme(page, 'dark');
		expect((await page.context().cookies()).find((cookie) => cookie.name === 'cita-theme')).toMatchObject({ value: 'dark', sameSite: 'Lax' });

		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto('/odonto/agenda');
		await page.getByRole('button', { name: 'Abrir menú' }).last().click();
		const sheet = page.getByRole('dialog', { name: 'Menú de navegación' }).getByRole('group', { name: 'Modo de color' });
		await expect(sheet.getByRole('radio', { name: 'Oscuro' })).toBeChecked();
		await page.emulateMedia({ colorScheme: 'light' });
		await sheet.getByText('Automático', { exact: true }).click();
		expect(await page.evaluate(() => document.documentElement.className.split(' ').includes('theme-system'))).toBe(true);
		expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('light');
		// Automatic follows the device live, without reloading.
		await page.emulateMedia({ colorScheme: 'dark' });
		expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe('dark');
		await sheet.getByText('Claro', { exact: true }).click();
		await expectRenderedTheme(page, 'light');
		await page.reload();
		await expectRenderedTheme(page, 'light');
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
			await sweep(page, info, [
				`/odonto/agenda?date=${date}`, '/odonto/agenda/semana', '/odonto/pacientes', p, `${p}?tab=datos`, `${p}?tab=radiografias`,
				`${p}/informacion-previa`, '/odonto/pacientes/papelera', `/odonto/turnos/${appointment.id}`,
				'/odonto/configuracion', '/odonto/configuracion/negocio', '/odonto/configuracion/negocio/contacto', '/odonto/configuracion/consultorio-publico',
				'/odonto/configuracion/reserva-online', '/odonto/configuracion/reserva-online/webs', '/odonto/configuracion/senas',
				'/odonto/configuracion/comunicacion', '/odonto/configuracion/documentos', '/odonto/configuracion/whatsapp', '/odonto/configuracion/resena-google',
				'/odonto/configuracion/usuarios', '/odonto/configuracion/suscripcion', '/odonto/configuracion/ayuda',
				pro, `${pro}/aranceles`, `${pro}/historial`, `${pro}/preguntas`, '/odonto/servicios', '/odonto/seguimientos', '/odonto/seguimientos/importantes',
				'/odonto/mis-turnos', '/odonto/mis-preguntas', '/odonto/recordatorios', '/odonto/mensajes', '/odonto/senas', '/odonto/disponibilidad',
				'/odonto/exportar-datos', `/reservar/${f.businessId}`, `/turno/${appointment.confirmation_token}`, `/turno/${appointment.confirmation_token}/informacion`
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
});
