import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createFixtureClient, must } from './helpers/fixture-db';
import { loginWithSharedSession } from './helpers/shared-auth';
import { layoutIssues, type LayoutIssue } from './helpers/layout-usability';
import { alignTaskForCapture } from './helpers/task-capture';
import { observeRenderHealth } from './helpers/render-health';

// Real Auth/PostgREST/SQL and browser actions in the owned disposable fixture only. The one
// external destination (WhatsApp) is intercepted after our real redirect: no message is sent.
function ownedFixture() {
	const path = process.env.E2E_LOCAL_BOOKING_FIXTURE_PATH;
	const api = process.env.ODONTO_SUPABASE_URL;
	const key = process.env.ODONTO_SUPABASE_SERVICE_ROLE_KEY;
	const businessId = process.env.CITA_SUITE_TEST_BUSINESS_ID;
	const email = process.env.E2E_EMAIL;
	const password = process.env.E2E_PASSWORD;
	if (process.env.CITA_E2E_ENVIRONMENT !== 'disposable' || !path || !api || !key || !businessId || !email || !password || new URL(api).hostname !== '127.0.0.1') {
		throw new Error('The deposit audit requires the explicit owned disposable environment.');
	}
	const runtime: unknown = JSON.parse(readFileSync(path, 'utf8'));
	if (typeof runtime !== 'object' || runtime === null || !('container' in runtime) || typeof runtime.container !== 'string' ||
		!/^cita-booking-test-[a-f0-9]{12}$/.test(runtime.container) || !('businessId' in runtime) || runtime.businessId !== businessId ||
		!('key' in runtime) || typeof runtime.key !== 'string' || !/^[a-f0-9]{32}$/.test(runtime.key)) {
		throw new Error('The prepared fixture identity does not match the deposit audit.');
	}
	const container = runtime.container;
	const sql = (source: string, variables: Record<string, string> = {}) => {
		const result = spawnSync('docker', ['exec', '-i', container, 'psql', '-X', '-U', 'supabase_admin', '-d', 'postgres',
			'-v', 'ON_ERROR_STOP=1', '-qAt', '-v', `business=${businessId}`,
			...Object.entries(variables).flatMap(([name, value]) => ['-v', `${name}=${value}`])], {
			input: "set statement_timeout='10s';\n" + source,
			encoding: 'utf8', timeout: 20_000
		});
		if (result.error || result.status !== 0) throw new Error('Owned deposit SQL failed; no credentials or row values are logged.');
		return result.stdout.trim();
	};
	return { admin: createFixtureClient(api, key), businessId, integrationKey: runtime.key, email, password, sql };
}

async function matrix(page: Page, info: TestInfo, label: string, anchor: Locator, issues: Array<LayoutIssue & { width: number; screen: string }>) {
	const firstIssue = issues.length;
	for (const width of [320, 390, 768, 1280, 1600]) {
		await page.setViewportSize({ width, height: 900 });
		issues.push(...(await layoutIssues(page, 'main a:visible, main button:visible, main input:visible, main textarea:visible', 'main'))
			.map(issue => ({ ...issue, width, screen: label })));
		await alignTaskForCapture(anchor);
		await page.screenshot({ path: info.outputPath(`${label}-${width}.jpg`), type: 'jpeg', quality: 65 });
	}
	await info.attach(`${label}-layout`, { body: JSON.stringify({ widths: [320, 390, 768, 1280, 1600], issues: issues.slice(firstIssue) }), contentType: 'application/json' });
	await page.setViewportSize({ width: 1280, height: 900 });
}

test('appointment deposits: booking terms, registration, agenda and automatic cancellation stay consistent', {
	tag: '@candidate-behavior'
}, async ({ page, context }, info) => {
	test.setTimeout(300_000);
	const f = ownedFixture();
	// This spec owns the temporary policy, never a pre-existing configuration.
	expect(f.sql("select count(*) from public.deposit_policies where business_id=:'business'::uuid;")).toBe('0');
	const previousAutomation = f.sql('select enabled::text from private.deposit_automation where singleton;');
	expect(['true', 'false']).toContain(previousAutomation);
	const startedAt = new Date().toISOString();
	// Public names accept letters, not digits: retain uniqueness without defeating validation.
	const suffix = [...randomUUID().slice(0, 8)].map(char => String.fromCharCode(97 + parseInt(char, 16))).join('');
	const fullName = `Paciente de señas ${suffix} Apellido compuesto para verificar contenido extenso`;
	let appointmentId: string | null = null;
	let patientId: string | null = null;
	const issues: Array<LayoutIssue & { width: number; screen: string }> = [];
	const health = await observeRenderHealth(page);
	const link = await must(f.admin.from('professional_services')
		.select('professional_id, service_id').eq('business_id', f.businessId).limit(1).single());
	const business = await must(f.admin.from('businesses').select('timezone').eq('id', f.businessId).single());
	const date = new Intl.DateTimeFormat('sv-SE', { timeZone: business.timezone }).format(new Date(Date.now() + 4 * 86_400_000));
	try {
		f.sql('update private.deposit_automation set enabled=true where singleton;');
		await loginWithSharedSession(page, { email: f.email, password: f.password });
		await page.goto('/odonto/configuracion/senas');
		await expect(page.getByRole('heading', { name: 'Señas', exact: true, level: 1 })).toBeVisible();
		await page.getByRole('checkbox', { name: 'Pedir seña en las reservas', exact: true }).check();
		await page.getByRole('textbox', { name: /^Monto fijo, en pesos/ }).fill('40.000');
		await page.getByRole('checkbox', { name: 'Cancelar solo el turno si la seña no llega a tiempo', exact: true }).check();
		await page.getByRole('textbox', { name: /^Datos para transferir/ }).fill('Alias sena.prueba\nTitular sintético del consultorio de prueba');
		await matrix(page, info, 'configuracion', page.getByRole('button', { name: 'Guardar', exact: true }), issues);
		await page.getByRole('button', { name: 'Guardar', exact: true }).click();
		await expect(page.getByRole('status')).toHaveText('Configuración de señas guardada. Se aplica a las reservas nuevas.');
		const savedPolicy = await must(f.admin.from('deposit_policies').select('enabled, auto_cancel_enabled, fixed_amount, revision').eq('business_id', f.businessId).single());
		expect(savedPolicy).toMatchObject({ enabled: true, auto_cancel_enabled: true, fixed_amount: 40000, revision: 1 });

		const booking = `/embed/v1/${f.integrationKey}?${new URLSearchParams({ service_id: link.service_id, professional_id: link.professional_id, date, modality: 'in_person' })}`;
		for (const theme of ['light', 'dark']) {
			await page.goto(booking + `&color_mode=${theme}`);
			await expect(page.getByRole('heading', { name: 'Elegí un horario', exact: true })).toBeVisible();
			await page.getByRole('link', { name: /^\d{2}:\d{2}$/ }).first().click();
			const notice = page.locator('[data-deposit-notice]');
			await expect(notice).toContainText(/seña de \$\s*40\.000/);
			const confirm = page.getByRole('button', { name: 'Confirmar reserva', exact: true });
			expect(await notice.evaluate((node, button) => Boolean(node.compareDocumentPosition(button!) & Node.DOCUMENT_POSITION_FOLLOWING), await confirm.elementHandle())).toBe(true);
			await expect(page.locator('[data-booking-color-mode]').first()).toHaveAttribute('data-booking-color-mode', theme);
			await matrix(page, info, `condiciones-${theme}`, notice, issues);
		}
		await page.getByLabel('Nombre y apellido').fill(fullName);
		await page.getByLabel('Teléfono').fill('3425' + String(Date.now() % 1_000_000).padStart(6, '0'));
		await page.getByLabel('Obra social y plan').fill('Particular sintético');
		await page.getByLabel('Edad', { exact: true }).fill('35');
		await page.getByLabel('Obra social del perfil').fill('Particular sintético');
		await page.getByRole('group', { name: 'Estudios recientes', exact: true }).getByRole('radio', { name: 'No', exact: true }).check();
		expect(await page.locator('form').evaluate(form => form instanceof HTMLFormElement && form.checkValidity())).toBe(true);
		await page.getByRole('button', { name: 'Confirmar reserva', exact: true }).click();
		await expect(page).toHaveURL(/\/turno\/[^/?]+\?creado=1/);
		const publicPath = new URL(page.url()).pathname;
		const token = publicPath.split('/').at(-1)!;
		const appointment = await must(f.admin.from('appointments').select('id, patient_id, status, starts_at, ends_at')
			.eq('business_id', f.businessId).eq('confirmation_token', token).single());
		appointmentId = appointment.id;
		patientId = appointment.patient_id;
		const deposit = () => must(f.admin.from('appointment_deposits').select('status, amount, due_at, revision, reminder_opened_at, recorded_at')
			.eq('business_id', f.businessId).eq('appointment_id', appointment.id).single());
		expect(await deposit()).toMatchObject({ status: 'pending', amount: 40000, revision: 1 });
		await expect(page.getByRole('button', { name: 'Confirmo que voy', exact: true })).toHaveCount(0);
		await expect(page.getByRole('link', { name: 'Ya transferí: enviar el comprobante', exact: true })).toBeVisible();
		for (const theme of ['light', 'dark']) {
			await page.goto(`${publicPath}?creado=1&color_mode=${theme}`);
			await matrix(page, info, `turno-pendiente-${theme}`, page.getByRole('heading', { name: 'Seña del turno', exact: true }), issues);
		}

		await page.goto(`/odonto/agenda?date=${date}`);
		await expect(page.getByText('Reservado, seña pendiente', { exact: true })).toBeVisible();
		const agendaActions = page.locator(`[data-agenda-deposit="${appointment.id}"]`);
		await expect(agendaActions.getByRole('button', { name: 'Confirmar seña', exact: true })).toBeVisible();
		await matrix(page, info, 'agenda', agendaActions, issues);
		await page.getByRole('button', { name: 'Buscar', exact: true }).click();
		const searchResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/odonto/agenda/buscar' && response.request().method() === 'GET');
		await page.getByRole('searchbox', { name: 'Paciente o teléfono', exact: true }).fill(fullName.slice(0, 30));
		expect(await (await searchResponse).json()).toMatchObject({ upcoming: [expect.objectContaining({ id: appointment.id, appointment_deposits: { status: 'pending', revision: 1, waived_reason: null } })] });
		await expect(agendaActions.getByRole('button', { name: 'Confirmar seña', exact: true })).toBeVisible();
		await expect(page.getByText('Reservado, seña pendiente', { exact: true })).toBeVisible();

		await page.goto('/odonto/senas');
		const row = page.locator(`[data-deposit-row="${appointment.id}"]`);
		await expect(row).toContainText(fullName);
		await matrix(page, info, 'lista', row.getByRole('button', { name: 'Confirmar seña', exact: true }), issues);
		await context.route('https://web.whatsapp.com/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Destino externo interceptado</title>' }));
		const popupPromise = context.waitForEvent('page');
		await row.getByRole('link', { name: 'Pedir seña por WhatsApp', exact: true }).click();
		const popup = await popupPromise;
		await popup.waitForURL('https://web.whatsapp.com/**');
		const external = new URL(popup.url());
		expect(external.searchParams.get('text')).toContain(fullName);
		expect(external.searchParams.get('text')).toContain('Si ya la transferiste, desestimá este mensaje');
		expect((await deposit()).reminder_opened_at).not.toBeNull();
		await popup.close();
		await context.unroute('https://web.whatsapp.com/**');
		await page.reload();
		await expect(row.getByRole('link', { name: 'Abrir de todos modos', exact: true })).toBeVisible();
		await row.getByRole('button', { name: 'Confirmar seña', exact: true }).click();
		await expect(row).toHaveCount(0);
		expect(await deposit()).toMatchObject({ status: 'paid', revision: 2 });
		expect((await must(f.admin.from('appointments').select('status').eq('id', appointment.id).single())).status).toBe('confirmed');
		const paidAudits = await must(f.admin.from('audit_logs').select('action').eq('entity_id', appointment.id).eq('action', 'appointment.deposit_paid'));
		expect(paidAudits).toHaveLength(1);
		await page.goto(`${publicPath}?color_mode=light`);
		await expect(page.getByText('Recibimos tu seña. Tu turno está confirmado.', { exact: true })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Confirmo que voy', exact: true })).toHaveCount(0);
		await page.goto(`/odonto/agenda?date=${date}`);
		await expect(page.getByText('Confirmado, seña recibida', { exact: true })).toBeVisible();
		await page.goto(`/odonto/turnos/${appointment.id}`);
		const panel = page.locator('[data-deposit-panel]');
		await panel.locator('summary').filter({ hasText: 'Deshacer' }).click();
		await panel.getByRole('button', { name: 'Sí, deshacer el registro', exact: true }).click();
		await expect(page.getByText('Reservado, seña pendiente', { exact: true })).toBeVisible();
		expect(await deposit()).toMatchObject({ status: 'pending', revision: 3 });

		// Expired synthetic data exercises the actual job, without waiting or changing the machine clock.
		f.sql("update public.appointment_deposits set due_at=now()-interval '5 minutes', request_from=now()-interval '1 day', auto_cancel=true where business_id=:'business'::uuid and appointment_id=:'appointment'::uuid;\nselect private.expire_unpaid_deposits(now(),100);", { appointment: appointment.id });
		expect(await deposit()).toMatchObject({ status: 'expired', revision: 4 });
		expect((await must(f.admin.from('appointments').select('status, cancelled_by_user_id').eq('id', appointment.id).single()))).toMatchObject({ status: 'cancelled', cancelled_by_user_id: null });
		await page.goto(`${publicPath}?color_mode=dark`);
		await expect(page.getByRole('heading', { name: 'Turno cancelado', exact: true })).toBeVisible();
		await expect(page.getByText(/no se registró la seña antes del/)).toBeVisible();
		await expect(page.getByRole('link', { name: 'Reservar otro turno', exact: true })).toBeVisible();
		await matrix(page, info, 'turno-cancelado', page.getByRole('heading', { name: 'Turno cancelado', exact: true }), issues);
		await page.goto('/odonto/senas');
		await expect(row).toContainText('Se canceló porque no se registró la seña');
		const rebook = row.getByRole('link', { name: 'Volver a dar este horario', exact: true });
		const href = new URL((await rebook.getAttribute('href'))!, page.url());
		expect(Object.fromEntries(href.searchParams)).toMatchObject({ date, professional_id: link.professional_id, service_id: link.service_id, patient_id: appointment.patient_id });
		expect(href.searchParams.get('hora')).toMatch(/^\d{2}:\d{2}$/);
		await page.goto(booking);
		expect((await page.getByRole('link', { name: /^\d{2}:\d{2}$/ }).allTextContents()).map(text => text.trim())).toContain(href.searchParams.get('hora'));
		await health.assertAndAttach(info, 'deposit-real-browser-health');
		expect(issues).toEqual([]);
	} finally {
		// SQL cleanup is scoped to the test's IDs and its own policy, including audit rows. Global
		// automation is restored even if setup or a UI assertion failed.
		f.sql(`begin;
			delete from public.audit_logs where business_id=:'business'::uuid and ((entity_id=:'appointment'::uuid or entity_id=:'patient'::uuid) or (entity_id=:'business'::uuid and action='business.deposit_policy_saved' and created_at>=:'started'::timestamptz));
			delete from public.appointments where business_id=:'business'::uuid and (id=:'appointment'::uuid or patient_id in (select id from public.patients where business_id=:'business'::uuid and full_name=:'full_name'));
			delete from public.patients where business_id=:'business'::uuid and (id=:'patient'::uuid or full_name=:'full_name');
			delete from public.deposit_service_exclusions where business_id=:'business'::uuid;
			delete from public.deposit_policies where business_id=:'business'::uuid;
			update private.deposit_automation set enabled=:'previous'::boolean where singleton;
			commit;`, { appointment: appointmentId ?? '00000000-0000-0000-0000-000000000000', patient: patientId ?? '00000000-0000-0000-0000-000000000000', full_name: fullName, previous: previousAutomation, started: startedAt });
		expect(f.sql("select count(*) from public.deposit_policies where business_id=:'business'::uuid;")).toBe('0');
		expect(f.sql('select enabled::text from private.deposit_automation where singleton;')).toBe(previousAutomation);
		if (appointmentId) expect(await must(f.admin.from('appointments').select('id').eq('id', appointmentId))).toHaveLength(0);
		if (patientId) expect(await must(f.admin.from('patients').select('id').eq('id', patientId))).toHaveLength(0);
		expect(await must(f.admin.from('patients').select('id').eq('business_id', f.businessId).eq('full_name', fullName))).toHaveLength(0);
	}
});
