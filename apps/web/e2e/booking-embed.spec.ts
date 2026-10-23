import { observeRenderHealth } from './helpers/render-health';
import { layoutIssues, type LayoutIssue } from './helpers/layout-usability';
import { alignTaskForCapture } from './helpers/task-capture';
import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { createFixtureClient } from './helpers/fixture-db';
import type { CitaDatabase } from '../src/lib/types/database';
import { randomUUID } from 'node:crypto';
import { clinicalPdfFixture } from './helpers/clinical-pdf';

// Deliberately opt-in and local only. Fixtures must belong to a disposable DB;
// the regular production/staging suites never create these records.
const path = process.env.E2E_LOCAL_BOOKING_FIXTURE_PATH;
const fixture = path ? JSON.parse(readFileSync(path, 'utf8')) : null;
test.describe('isolated booking integration', () => {
	test.use({ actionTimeout: 15_000, navigationTimeout: 30_000 });
	test.skip(!fixture, 'Requires an explicitly prepared disposable local booking fixture.');
	test('recovers a committed booking after a lost response and shares policy with the native page', async ({
		browser,
		request
	}) => {
		test.setTimeout(120_000);
		for (const origin of [fixture.appOrigin, fixture.apiOrigin, fixture.hostOrigin])
			expect(new URL(origin).hostname).toBe('127.0.0.1');
		const db = createFixtureClient(fixture.apiOrigin, fixture.service);
		const desktop = await browser.newContext({ viewport: { width: 1280, height: 900 } });
		const page = await desktop.newPage();
		const exceptions: string[] = [];
		page.on('pageerror', (error) => exceptions.push(error.message));
		await page.goto(fixture.hostOrigin + '/harness');
		await expect(page).toHaveTitle('Prueba aislada de integración');
		await page.getByRole('button', { name: 'Reservar consulta', exact: true }).click();
		const booking = page.frameLocator('iframe');
		await expect(booking.getByRole('heading', { name: '¿Qué necesitás?' })).toBeVisible();
		await booking.getByRole('link', { name: /Consulta de prueba/ }).click();
		await expect(booking.getByRole('heading', { name: 'Elegí un día' })).toBeVisible();
		// Use a future available day so today's final slot cannot make the shared-availability assertion time-dependent.
		await booking
			.getByRole('link', { name: /Horarios disponibles/ })
			.nth(1)
			.click();
		await booking
			.getByRole('link', { name: /^\d{2}:\d{2}$/ })
			.first()
			.click();
		await booking.getByLabel('Nombre y apellido').fill('Ana Prueba');
		// A fresh synthetic identity keeps a failed prior attempt from altering the history-count proof.
		const syntheticPhone = '3425' + String(Date.now() % 1_000_000).padStart(6, '0');
		await booking.getByLabel('Teléfono').fill(syntheticPhone);
		await booking.getByLabel('Obra social y plan').fill('Particular');
		await booking.getByLabel('Edad', { exact: true }).fill('35');
		await booking.getByLabel('Obra social del perfil').fill('Particular');
		await booking.getByLabel(/Medicación/).fill('Medicación sintética inicial');
		await booking
			.getByRole('group', { name: 'Estudios recientes', exact: true })
			.getByRole('radio', { name: 'No', exact: true })
			.check();
		await booking.getByLabel('Comentario').fill('Comentario clínico sintético privado');
		const frame = page
			.frames()
			.find((item) => item.url().startsWith(fixture.appOrigin + '/embed/'))!;
		const attempt = await booking.locator('[name="idempotency_key"]').inputValue();
		const date = new URL(frame.url()).searchParams.get('date')!;
		const slot = await booking.locator('[name="slot_starts_at"]').inputValue();
		await page.screenshot({
			type: 'jpeg', quality: 65, path: test.info().outputPath('cita-booking-desktop.jpg'),
			fullPage: true
		});
		let dropped = false;
		await page.route('**/embed/v1/**', async (route) => {
			if (route.request().method() !== 'POST' || dropped) return route.continue();
			dropped = true;
			const response = await route.fetch({ maxRedirects: 0 });
			expect(response.ok() || response.status() === 303).toBe(true);
			await route.abort('failed');
		});
		await booking.getByRole('button', { name: 'Confirmar reserva', exact: true }).click();
		await expect(
			booking.getByRole('link', { name: 'Revisar resultado de la reserva' })
		).toBeVisible();
		await booking.getByRole('link', { name: 'Revisar resultado de la reserva' }).click();
		await expect(booking.getByRole('heading', { name: 'Recuperamos tu reserva' })).toBeVisible();
		await expect.poll(() => page.evaluate(() => window.completions)).toEqual([[]]);
		const saved = await db
			.from('appointments')
			.select('id,patient_id,confirmation_token,internal_note')
			.eq('business_id', fixture.businessId)
			.eq('creation_request_key', attempt);
		expect(saved.error).toBeNull();
		expect(saved.data).toHaveLength(1);
		expect(saved.data![0].internal_note).toBeNull();
		const intake = await db
			.from('appointment_intake_responses')
			.select('answers,free_comment')
			.eq('appointment_id', saved.data![0].id)
			.single();
		expect(intake.error).toBeNull();
		expect(intake.data?.answers).toMatchObject({ labs: false });
		expect(intake.data!.free_comment).toBe('Comentario clínico sintético privado');
		const popupPromise = page.waitForEvent('popup');
		await booking.getByRole('link', { name: 'Ver y gestionar mi turno' }).click();
		const popup = await popupPromise;
		await expect(popup.locator('[data-booking-theme="natalia"]')).toBeVisible();
		expect(new URL(popup.url()).pathname).toBe('/turno/' + saved.data![0].confirmation_token);
		// Required answers reach the actual patient profile in the isolated database.
		const profile = await db
			.from('patient_clinical_profiles')
			.select('medication,custom_fields')
			.eq('patient_id', saved.data![0].patient_id)
			.single();
		expect(profile.error).toBeNull();
		expect(profile.data!.medication).toBe('Medicación sintética inicial');
		expect(profile.data?.custom_fields).toMatchObject({ booking_age: { years: 35 } });
		const patientRow = await db
			.from('patients')
			.select('insurance')
			.eq('id', saved.data![0].patient_id)
			.single();
		expect(patientRow.data!.insurance).toBe('Particular');
		await Promise.all([
			popup.waitForURL(
				(url) => url.pathname === '/turno/' + saved.data![0].confirmation_token + '/informacion'
			),
			popup.getByRole('link', { name: 'Ver y ampliar mis datos' }).click()
		]);
		await expect(
			popup.getByRole('heading', { name: 'Información para tu consulta' })
		).toBeVisible();
		await expect(popup.locator('[data-booking-theme="natalia"]')).toBeVisible();
		await popup.getByLabel(/Medicación/).fill('Medicación sintética ampliada');
		await expect(popup.getByLabel(/Medicación/)).toHaveValue('Medicación sintética ampliada');
		const sending = popup.waitForRequest(
			(r) => r.method() === 'POST' && r.url().includes('/informacion')
		);
		await popup.getByRole('button', { name: 'Guardar información' }).click();
		await expect(popup.getByRole('status')).toContainText('guardada');
		expect((await sending).postData()).toContain(
			encodeURIComponent('Medicación sintética ampliada').replaceAll('%20', '+')
		);
		const expanded = await db
			.from('patient_clinical_profiles')
			.select('medication')
			.eq('patient_id', saved.data![0].patient_id)
			.single();
		expect(expanded.data!.medication).toBe('Medicación sintética ampliada');
		// Use this existing booking, without another reservation or resetting IP limits.
		const patientPdf = clinicalPdfFixture();
		let releaseDocumentScripts!: () => void;
		const documentScripts = new Promise<void>((resolve) => {
			releaseDocumentScripts = resolve;
		});
		await popup.route('**/*', async (route) => {
			if (route.request().resourceType() === 'script') await documentScripts;
			await route.continue();
		});
		const documents = popup.getByRole('region', {
			name: 'Documentos para tu consulta',
			exact: true
		});
		try {
			await popup.goto(
				fixture.appOrigin + '/turno/' + saved.data![0].confirmation_token + '/informacion',
				{ waitUntil: 'commit' }
			);
			await expect(documents).toBeVisible();
			await documents.getByLabel('Documento', { exact: true }).setInputFiles({
				name: 'estudio-del-paciente.pdf',
				mimeType: 'application/pdf',
				buffer: patientPdf
			});
			await documents
				.getByLabel('Descripción (opcional)', { exact: true })
				.fill('PDF adjuntado por Ana');
		} finally {
			releaseDocumentScripts();
		}
		await expect(
			documents.getByRole('button', { name: 'Adjuntar documento', exact: true })
		).toBeEnabled();
		await documents.getByRole('button', { name: 'Adjuntar documento', exact: true }).click();
		await expect(documents.getByRole('status')).toContainText('El documento quedó guardado');
		const patientDocument = await db
			.from('patient_radiographs')
			.select('id,status,source,appointment_id,patient_id,bytes')
			.eq('business_id', fixture.businessId)
			.eq('appointment_id', saved.data![0].id)
			.single();
		expect(patientDocument.error).toBeNull();
		expect(patientDocument.data).toMatchObject({
			status: 'ready',
			source: 'patient',
			patient_id: saved.data![0].patient_id,
			bytes: patientPdf.length
		});
		await popup.getByRole('link', { name: 'Volver a mi turno' }).click();
		await popup.getByText('Cancelar turno', { exact: true }).first().click();
		await expect(popup.getByText('Confirmo que quiero cancelar este turno.')).toBeVisible();
		await popup.getByText('Confirmo que quiero cancelar este turno.').scrollIntoViewIfNeeded();
		await popup.screenshot({
			type: 'jpeg', quality: 65, path: test.info().outputPath('cita-booking-manage-cancel-light.jpg'),
			fullPage: true
		});
		await popup.close();
		const allowed = await request.get(
			fixture.appOrigin +
				'/embed/v1/' +
				fixture.key +
				'?parent_origin=' +
				encodeURIComponent(fixture.hostOrigin) +
				'&instance_id=' +
				'b'.repeat(32)
		);
		expect(allowed.status()).toBe(200);
		expect(allowed.headers()['x-frame-options']).toBeUndefined();
		expect(allowed.headers()['content-security-policy']).toContain(
			'frame-ancestors ' + fixture.hostOrigin
		);
		expect(allowed.headers()['cache-control']).toBe('no-store');
		expect(allowed.headers()['referrer-policy']).toBe('no-referrer');
		const denied = await request.get(
			fixture.appOrigin +
				'/embed/v1/' +
				fixture.key +
				'?parent_origin=https://attacker.example.test&instance_id=' +
				'b'.repeat(32)
		);
		expect(denied.status()).toBe(403);
		expect(denied.headers()['x-frame-options']).toBe('DENY');
		const native = await desktop.newPage();
		await native.goto(
			fixture.appOrigin +
				'/reservar/' +
				fixture.businessId +
				'?service_id=' +
				fixture.serviceId +
				'&professional_id=' +
				fixture.professionalId +
				'&date=' +
				date
		);
		await expect(native.locator('[data-booking-theme="cita-suite"]')).toBeVisible();
		await expect(native.getByRole('link', { name: /^\d{2}:\d{2}$/ }).first()).toBeVisible();
		const slots = await native
			.getByRole('link', { name: /^\d{2}:\d{2}$/ })
			.evaluateAll((links) =>
				links.map((link) => new URL((link as HTMLAnchorElement).href).searchParams.get('slot'))
			);
		expect(slots).not.toContain(slot);
		await native
			.getByRole('link', { name: /^\d{2}:\d{2}$/ })
			.first()
			.click();
		await expect(native.getByLabel('Obra social y plan')).toBeVisible();
		expect(
			(await request.get(fixture.appOrigin + '/reservar/' + fixture.businessId)).headers()[
				'x-frame-options'
			]
		).toBe('DENY');
		await native.close();
		await desktop.close();

		const mobile = await browser.newContext({
			viewport: { width: 390, height: 844 },
			isMobile: true,
			hasTouch: true
		});
		const phone = await mobile.newPage();
		phone.on('pageerror', (error) => exceptions.push(error.message));
		await phone.goto(fixture.hostOrigin + '/harness');
		await phone.evaluate(() => {
			if (!window.widget) throw new Error('The host page did not mount the booking widget.');
			window.widget.setTheme('dark');
		});
		await phone.getByRole('button', { name: 'Reservar consulta', exact: true }).click();
		const virtual = phone.frameLocator('iframe');
		await virtual.getByRole('link', { name: 'Virtual', exact: true }).click();
		await expect(virtual.getByRole('link', { name: 'Virtual', exact: true })).toHaveAttribute(
			'aria-current',
			'true'
		);
		await virtual.getByRole('link', { name: /Consulta de prueba/ }).click();
		await virtual
			.getByRole('link', { name: /Horarios disponibles/ })
			.first()
			.click();
		const virtualSlots = await virtual
			.getByRole('link', { name: /^\d{2}:\d{2}$/ })
			.evaluateAll((links) =>
				links.map((link) => new URL((link as HTMLAnchorElement).href).searchParams.get('slot'))
			);
		expect(virtualSlots).not.toContain(slot);
		await virtual
			.getByRole('link', { name: /^\d{2}:\d{2}$/ })
			.first()
			.click();
		await virtual.getByLabel('Nombre y apellido').fill('Paciente Virtual');
		await virtual.getByLabel('Teléfono').fill('3425048210');
		await virtual.getByLabel('Obra social y plan').fill('Particular');
		await virtual.getByLabel('Edad', { exact: true }).fill('40');
		await virtual.getByLabel('Obra social del perfil').fill('Particular');
		const phoneFrame = phone
			.frames()
			.find((item) => item.url().startsWith(fixture.appOrigin + '/embed/'))!;
		await expect
			.poll(() => phoneFrame.evaluate(() => document.documentElement.dataset.bookingColorMode))
			.toBe('dark');
		expect(
			await phoneFrame.evaluate(() => document.documentElement.scrollWidth <= innerWidth)
		).toBe(true);
		await phone.screenshot({
			type: 'jpeg', quality: 65, path: test.info().outputPath('cita-booking-mobile.jpg'),
			fullPage: true
		});
		await virtual.getByRole('button', { name: 'Confirmar reserva', exact: true }).click();
		await expect(virtual.getByRole('heading', { name: 'Tu turno quedó reservado' })).toBeVisible();
		await expect(
			virtual.getByText('Instrucciones virtuales sintéticas: se coordina el acceso.')
		).toBeVisible();
		await expect(virtual.getByText('Dirección sintética 123')).toHaveCount(0);
		await expect.poll(() => phone.evaluate(() => window.completions)).toEqual([[]]);
		const virtualPopupPromise = phone.waitForEvent('popup');
		await virtual.getByRole('link', { name: 'Ver y gestionar mi turno' }).click();
		const virtualPopup = await virtualPopupPromise;
		await expect(virtualPopup.getByText('Modalidad: Virtual', { exact: true })).toBeVisible();
		await expect(
			virtualPopup.getByText('Instrucciones virtuales sintéticas: se coordina el acceso.', {
				exact: true
			})
		).toBeVisible();
		await expect(virtualPopup.getByText('Dirección sintética 123')).toHaveCount(0);
		await virtualPopup.screenshot({
			type: 'jpeg', quality: 65, path: test.info().outputPath('cita-booking-manage-virtual.jpg'),
			fullPage: true
		});
		await virtualPopup.close();
		expect(await phone.evaluate(() => JSON.stringify(sessionStorage))).not.toContain(
			'Paciente Virtual'
		);
		await mobile.close();
		const manager = await browser.newContext({ viewport: { width: 1280, height: 900 } });
		await manager.addCookies([
			{ name: 'sb-module', value: 'odonto', url: fixture.appOrigin },
			{ name: 'sb-access-token', value: fixture.ownerToken, url: fixture.appOrigin },
			{
				name: 'sb-refresh-token',
				value: fixture.ownerRefreshToken ?? 'local-auth-simulator-only',
				url: fixture.appOrigin
			},
			{ name: 'active-business-id', value: fixture.businessId, url: fixture.appOrigin }
		]);
		const panel = await manager.newPage();
		panel.on('pageerror', (e) => exceptions.push(e.message));
		await panel.goto(
			fixture.appOrigin + '/odonto/pacientes/' + saved.data![0].patient_id + '/informacion-previa'
		);
		await expect(
			panel.getByRole('heading', { name: /Información previa de Ana Prueba/ })
		).toBeVisible();
		await expect(panel.getByRole('article')).toHaveCount(2);
		await panel.locator('summary').first().click();
		await expect(
			panel.getByText('Medicación sintética ampliada', { exact: true }).first()
		).toBeVisible();
		await panel.screenshot({ type: 'jpeg', quality: 65, path: test.info().outputPath('patient-history.jpg'), fullPage: true });
		await panel.goto(
			fixture.appOrigin + '/odonto/pacientes/' + saved.data![0].patient_id + '?tab=radiografias'
		);
		await expect(
			panel.getByRole('heading', { name: 'PDF adjuntado por Ana', exact: true })
		).toBeVisible();
		await expect(
			panel.getByText('Adjuntado desde el enlace del turno', { exact: true })
		).toBeVisible();
		const patientDownloadPromise = panel.waitForEvent('download');
		await panel.getByRole('button', { name: 'Descargar PDF', exact: true }).click();
		const patientDownload = await patientDownloadPromise;
		expect(patientDownload.suggestedFilename()).toMatch(/^Ana_Prueba_.+\.pdf$/);
		const patientDownloadPath = await patientDownload.path();
		if (!patientDownloadPath)
			throw new Error('No se generó el archivo de descarga del estudio del paciente.');
		expect(readFileSync(patientDownloadPath).equals(patientPdf)).toBe(true);
		await panel.goto(
			fixture.appOrigin + '/odonto/profesionales/' + fixture.professionalId + '/preguntas'
		);
		await expect(
			panel.getByRole('heading', { name: 'Preguntas al paciente', exact: true })
		).toBeVisible();
		await panel.getByRole('checkbox', { name: 'Antecedentes', exact: true }).check();
		const lastField = panel.locator('.question-row').filter({ hasText: 'Antecedentes' });
		await lastField.locator('summary').click();
		await lastField.getByLabel('Texto de la pregunta').fill('Antecedentes exigidos');
		await lastField.getByRole('checkbox', { name: 'Obligatorio', exact: true }).check();
		await panel.getByRole('button', { name: 'Guardar preguntas', exact: true }).click();
		await expect(panel.getByRole('status')).toContainText('Preguntas guardadas');
		const ownForm = await db
			.from('professional_booking_forms')
			.select('fields')
			.eq('professional_id', fixture.professionalId)
			.single();
		expect(ownForm.data!.fields).toHaveLength(4);
		expect(ownForm.data?.fields).toEqual(
			expect.arrayContaining([expect.objectContaining({ patientField: 'background', required: true })])
		);
		await panel.screenshot({
			type: 'jpeg', quality: 65, path: test.info().outputPath('professional-settings.jpg'),
			fullPage: true
		});
		await panel.goto(
			fixture.appOrigin + '/odonto/pacientes/' + saved.data![0].patient_id + '?tab=datos'
		);
		await expect(panel.getByText('Edad declarada: 35 años', { exact: false })).toBeVisible();
		await expect(
			panel.getByText('Última actualización informada por el paciente', { exact: false })
		).toBeVisible();
		await manager.close();
		const visitor = await browser.newContext();
		const future = await visitor.newPage();
		await future.goto(
			fixture.appOrigin +
				'/reservar/' +
				fixture.businessId +
				'?service_id=' +
				fixture.serviceId +
				'&professional_id=' +
				fixture.professionalId +
				'&date=' +
				date
		);
		await future
			.getByRole('link', { name: /^\d{2}:\d{2}$/ })
			.first()
			.click();
		await expect(future.getByLabel('Antecedentes exigidos')).toHaveAttribute('required', '');
		const payload = await future
			.locator('form')
			.last()
			.evaluate((element: HTMLFormElement) => Object.fromEntries(new FormData(element)));
		payload.patient_name = 'Paciente Sin Respuesta';
		payload.patient_phone = '3425048212';
		payload.intake_insurance = 'Particular';
		payload.intake_profile_insurance = 'Particular';
		payload.intake_profile_age = '36';
		const countBefore = await db
			.from('appointments')
			.select('id', { count: 'exact', head: true })
			.eq('business_id', fixture.businessId);
		const endpoint = await future
			.locator('form')
			.last()
			.evaluate((element: HTMLFormElement) => element.action);
		const rejected = await request.post(endpoint, {
			form: payload as Record<string, string>,
			headers: { origin: fixture.appOrigin, accept: 'text/html' },
			maxRedirects: 0
		});
		expect(rejected.status()).toBe(400);
		expect(await rejected.text()).toContain('Completá las respuestas obligatorias');
		const countAfter = await db
			.from('appointments')
			.select('id', { count: 'exact', head: true })
			.eq('business_id', fixture.businessId);
		expect(countAfter.count).toBe(countBefore.count);
		await future.goto(
			fixture.appOrigin + '/turno/' + saved.data![0].confirmation_token + '/informacion'
		);
		await expect(future.getByLabel('Antecedentes exigidos')).toHaveCount(0);
		await visitor.close();
		const doctor = await browser.newContext();
		await doctor.addCookies([
			{ name: 'sb-module', value: 'odonto', url: fixture.appOrigin },
			{ name: 'sb-access-token', value: fixture.doctorToken, url: fixture.appOrigin },
			{ name: 'sb-refresh-token', value: 'local-auth-simulator-only', url: fixture.appOrigin },
			{ name: 'active-business-id', value: fixture.businessId, url: fixture.appOrigin }
		]);
		const doctorPage = await doctor.newPage();
		await doctorPage.goto(fixture.appOrigin + '/odonto/configuracion/reserva-online');
		await expect(
			doctorPage.getByRole('heading', { name: 'Preguntas al paciente', exact: true })
		).toBeVisible();
		await expect(doctorPage).toHaveURL(
			new RegExp('/profesionales/' + fixture.professionalId + '/preguntas$')
		);
		await expect(doctorPage.getByRole('link', { name: 'Crear enlace', exact: true })).toHaveCount(
			0
		);
		await doctor.close();
		expect(exceptions).toEqual([]);
	});
	test('pages real dates after an empty window in shared and Natalia booking, with keyboard and mobile layout', async ({
		browser
	}) => {
		test.setTimeout(120_000);
		for (const origin of [fixture.appOrigin, fixture.apiOrigin])
			expect(new URL(origin).hostname).toBe('127.0.0.1');
		const db = createFixtureClient(fixture.apiOrigin, fixture.service);
		const business = await db
			.from('businesses')
			.select('timezone,max_booking_days_ahead')
			.eq('id', fixture.businessId)
			.single();
		expect(business.error).toBeNull();
		expect(business.data?.timezone).toBe('America/Argentina/Buenos_Aires');
		expect(business.data!.max_booking_days_ahead).toBeGreaterThanOrEqual(20);
		const today = new Intl.DateTimeFormat('sv-SE', {
			timeZone: business.data!.timezone,
			year: 'numeric',
			month: '2-digit',
			day: '2-digit'
		}).format(new Date());
		const addDays = (days: number) => {
			const date = new Date(today + 'T12:00:00Z');
			date.setUTCDate(date.getUTCDate() + days);
			return date.toISOString().slice(0, 10);
		};
		const exceptionId = randomUUID();
		const blocked = await db.from('availability_exceptions').insert({
			id: exceptionId,
			business_id: fixture.businessId,
			professional_id: null,
			type: 'blocked',
			starts_at: today + 'T03:00:00Z',
			ends_at: addDays(15) + 'T03:00:00Z',
			reason: 'Synthetic bounded-window proof'
		});
		expect(blocked.error).toBeNull();
		try {
			for (const variant of [
				{ theme: 'cita-suite', width: 1280, path: '/reservar/' + fixture.businessId },
				{ theme: 'cita-suite', width: 320, path: '/reservar/' + fixture.businessId },
				{ theme: 'natalia', width: 1280, path: '/embed/v1/' + fixture.key },
				{ theme: 'natalia', width: 320, path: '/embed/v1/' + fixture.key }
			]) {
				const context = await browser.newContext({
					viewport: { width: variant.width, height: 900 },
					colorScheme: 'light'
				});
				try {
					const page = await context.newPage();
					const errors: string[] = [];
					page.on('pageerror', (error) => errors.push(error.message));
					await page.goto(
						fixture.appOrigin +
							variant.path +
							'?service_id=' +
							fixture.serviceId +
							'&professional_id=' +
							fixture.professionalId +
							'&modality=in_person'
					);
					await expect(page.locator('[data-booking-theme="' + variant.theme + '"]')).toBeVisible();
					await expect(
						page.getByRole('heading', { name: 'Elegí un día', exact: true })
					).toBeVisible();
					await expect(
						page.getByText('No hay horarios disponibles entre estas fechas.', { exact: true })
					).toBeVisible();
					await expect(page.getByRole('link', { name: /Horarios disponibles/ })).toHaveCount(0);
					const navigation = page.getByRole('navigation', {
						name: 'Otras fechas para reservar',
						exact: true
					});
					const next = navigation.getByRole('link', { name: 'Fechas siguientes', exact: true });
					await expect(next).toBeVisible();
					if (variant.width === 320) {
						const box = await next.boundingBox();
						expect(box!.width).toBeGreaterThan(200);
						expect(box!.height).toBeLessThanOrEqual(64);
					}
					expect(
						new URL((await next.getAttribute('href')) ?? '', fixture.appOrigin).searchParams.get(
							'dates_from'
						)
					).toBe(addDays(15));
					await page.evaluate(() => window.scrollTo(0, 0));
					await page.screenshot({
						type: 'jpeg', quality: 65, path: test
							.info()
							.outputPath('availability-empty-' + variant.theme + '-' + variant.width + '.jpg'),
						fullPage: true
					});
					// Real keyboard activation, retaining the same service/professional/theme.
					await next.focus();
					await expect(next).toBeFocused();
					await next.press('Enter');
					await expect(page).toHaveURL(new RegExp('dates_from=' + addDays(15)));
					const days = page.getByRole('link', { name: /Horarios disponibles/ });
					await expect(days.first()).toBeVisible();
					const dates = await days.evaluateAll((links) =>
						links.map((link) => new URL((link as HTMLAnchorElement).href).searchParams.get('date')!)
					);
					expect(dates.length).toBeGreaterThan(0);
					expect(dates.every((date) => date >= addDays(15) && date <= addDays(29))).toBe(true);
					const previous = navigation.getByRole('link', { name: 'Fechas anteriores', exact: true });
					await expect(previous).toBeVisible();
					await page.evaluate(() => window.scrollTo(0, 0));
					await page.screenshot({
						type: 'jpeg', quality: 65, path: test
							.info()
							.outputPath('availability-dates-' + variant.theme + '-' + variant.width + '.jpg'),
						fullPage: true
					});
					expect(
						await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
					).toBe(true);
					const moreDays = page.getByRole('button', { name: 'Ver más días', exact: true });
					if (await moreDays.count()) await expect(next).toHaveCount(0);
					for (let expansion = 0; expansion < 3 && (await moreDays.count()); expansion++)
						await moreDays.click();
					await expect(next).toBeVisible();
					expect(
						new URL((await next.getAttribute('href')) ?? '', fixture.appOrigin).searchParams.get(
							'dates_from'
						)
					).toBe(addDays(30));
					if (variant.width === 320) {
						for (const box of await navigation.getByRole('link').evaluateAll((links) =>
							links.map((link) => ({
								width: link.getBoundingClientRect().width,
								height: link.getBoundingClientRect().height
							}))
						)) {
							expect(box.width).toBeGreaterThan(200);
							expect(box.height).toBeLessThanOrEqual(64);
						}
					}
					await days.first().click();
					await expect(page.getByRole('link', { name: /^\d{2}:\d{2}$/ }).first()).toBeVisible();
					await page.goBack();
					await expect(
						page.getByRole('heading', { name: 'Elegí un día', exact: true })
					).toBeVisible();
					await previous.click();
					await expect(
						page.getByText('No hay horarios disponibles entre estas fechas.', { exact: true })
					).toBeVisible();
					expect(new URL(page.url()).searchParams.get('dates_from')).toBe(today);
					expect(errors).toEqual([]);
				} finally {
					await context.close();
				}
			}
		} finally {
			const cleanup = await db
				.from('availability_exceptions')
				.delete()
				.eq('business_id', fixture.businessId)
				.eq('id', exceptionId);
			expect(cleanup.error).toBeNull();
		}
	});

	test('internal calendar requests only the visible week and exposes malformed responses with a working recovery', async ({
		browser
	}) => {
		test.setTimeout(90_000);
		for (const origin of [fixture.appOrigin, fixture.apiOrigin])
			expect(new URL(origin).hostname).toBe('127.0.0.1');
		const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
		try {
			await context.addCookies([
				{ name: 'sb-module', value: 'odonto', url: fixture.appOrigin },
				{ name: 'sb-access-token', value: fixture.ownerToken, url: fixture.appOrigin },
				{ name: 'sb-refresh-token', value: fixture.ownerRefreshToken, url: fixture.appOrigin },
				{ name: 'active-business-id', value: fixture.businessId, url: fixture.appOrigin }
			]);
			const page = await context.newPage();
			const health = await observeRenderHealth(page);
			let fail = false;
			const requests: URL[] = [];
			await page.route('**/odonto/disponibilidad/slots?**', async (route) => {
				requests.push(new URL(route.request().url()));
				if (fail) await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
				else await route.continue();
			});
			// These actions require client handlers. Do not advertise them as ready
			// while scripts and initial state are still pending (the first click was lost).
			let releaseScripts!: () => void;
			const scriptsReady = new Promise<void>((resolve) => {
				releaseScripts = resolve;
			});
			await page.route('**/*', async (route) => {
				if (route.request().resourceType() === 'script') await scriptsReady;
				await route.fallback();
			});
			try {
				await page.goto(fixture.appOrigin + '/odonto/agenda', { waitUntil: 'commit' });
				await expect(
					page.getByRole('button', { name: '+ Nuevo turno', exact: true })
				).toBeDisabled();
				await expect(page.getByRole('button', { name: 'Buscar', exact: true })).toBeDisabled();
			} finally {
				releaseScripts();
			}
			await page.getByRole('button', { name: '+ Nuevo turno', exact: true }).click();
			await expect(page.getByRole('button', { name: 'Cerrar', exact: true })).toBeVisible();
			await page.getByRole('button', { name: /Consulta de prueba/ }).click();
			await page.getByRole('button', { name: /Profesional de prueba/ }).click();
			await expect(page.getByRole('heading', { name: 'Elegí un día', exact: true })).toBeVisible();

			const manualCoverage: { width: number; theme: string }[] = [];
			const manualLayout: (LayoutIssue & { viewport: number; theme: string })[] = [];
			for (const width of [320, 390, 768, 1280, 1600])
				for (const theme of ['light', 'dark']) {
					await page.setViewportSize({ width, height: 900 });
					await page.emulateMedia({ colorScheme: theme === 'dark' ? 'dark' : 'light' });
					expect(
						await page.evaluate(() => document.documentElement.classList.contains('dark'))
					).toBe(true);
					for (const issue of await layoutIssues(
						page,
						'input:not(.ux-native-source):not([type="hidden"]):visible, select:not(.ux-native-source):visible, textarea:visible, .ux-control-trigger:visible'
					))
						manualLayout.push({ viewport: width, theme, ...issue });
					// The capture certifies the day selector, not the notices/agenda above it.
					await alignTaskForCapture(page.getByRole('heading', { name: 'Elegí un día', exact: true }));
					await page.screenshot({
						path: test.info().outputPath(`manual-appointment-${width}-${theme}.jpg`),
						type: 'jpeg',
						quality: 60,
						animations: 'disabled'
					});
					manualCoverage.push({ width, theme });
				}
			expect(manualCoverage).toHaveLength(10);
			expect(manualLayout).toEqual([]);
			await test.info().attach('manual-appointment-responsive-coverage', {
				body: JSON.stringify(manualCoverage),
				contentType: 'application/json'
			});
			await page.setViewportSize({ width: 1280, height: 900 });
			await page.emulateMedia({ colorScheme: 'light' });
			await page.getByRole('button', { name: 'Semana siguiente', exact: true }).click();
			fail = true;
			const failed = page.waitForResponse((response) =>
				response.url().includes('/odonto/disponibilidad/slots?')
			);
			await page.getByRole('button', { name: 'Semana siguiente', exact: true }).click();
			await failed;
			await expect(
				page.getByText('No pudimos actualizar los horarios.', { exact: false })
			).toBeVisible();
			await expect(
				page.getByText('No hay días disponibles esta semana.', { exact: true })
			).toHaveCount(0);
			const query = requests.at(-1)!;
			expect(
				(Date.parse(query.searchParams.get('to')!) - Date.parse(query.searchParams.get('from')!)) /
					86_400_000
			).toBe(6);
			for (const width of [1280, 320]) {
				await page.setViewportSize({ width, height: 900 });
				await page.evaluate(() => window.scrollTo(0, 0));
				await page.screenshot({
					type: 'jpeg', quality: 65, path: test
						.info()
						.outputPath(
							'availability-internal-error-' + (width === 320 ? 'mobile' : 'desktop') + '.jpg'
						),
					fullPage: true
				});
				expect(
					await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
				).toBe(true);
			}
			fail = false;
			const recovered = page.waitForResponse((response) =>
				response.url().includes('/odonto/disponibilidad/slots?')
			);
			await page.getByRole('button', { name: 'Reintentar búsqueda', exact: true }).click();
			const recoveredResponse = await recovered;
			expect(new URL(recoveredResponse.url()).searchParams.get('from')).toBe(
				query.searchParams.get('from')
			);
			expect(new URL(recoveredResponse.url()).searchParams.get('to')).toBe(
				query.searchParams.get('to')
			);
			expect(recoveredResponse.status()).toBe(200);
			expect((await recoveredResponse.json()).slots.length).toBeGreaterThan(0);
			await expect(
				page.getByText('No pudimos actualizar los horarios.', { exact: false })
			).toHaveCount(0);
			// Each recovered day is a task button with an actual date, not a fabricated successful empty list.
			await expect(
				page
					.getByRole('button', { name: /lunes|martes|miércoles|jueves|viernes|sábado|domingo/i })
					.first()
			).toBeVisible();
			const pricePath = '/odonto/profesionales/' + fixture.professionalId + '/aranceles';
			let priceWrites = 0;
			page.on('request', (request) => {
				if (request.method() === 'POST' && new URL(request.url()).pathname === pricePath)
					priceWrites++;
			});
			await page.goto(fixture.appOrigin + pricePath);
			const editor = page.locator('form.price-policy');
			await expect(editor).toBeVisible();
			const rate = editor.getByLabel(/^Aumento mensual desde el primer ajuste/);
			await rate.fill('1001');
			await expect(editor.getByRole('status')).toContainText('0 a 1.000 %');
			await expect(rate).toHaveAttribute('aria-invalid', 'true');
			await expect(
				editor.getByRole('button', { name: 'Guardar aranceles', exact: true })
			).toBeDisabled();
			for (const width of [1280, 320]) {
				await page.setViewportSize({ width, height: 900 });
				await page.evaluate(() => window.scrollTo(0, 0));
				await page.screenshot({
					type: 'jpeg', quality: 65, path: test
						.info()
						.outputPath('price-preview-error-' + (width === 320 ? 'mobile' : 'desktop') + '.jpg'),
					fullPage: true
				});
				expect(
					await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)
				).toBe(true);
			}
			await rate.fill('0');
			await expect(editor.getByRole('table')).toBeVisible();
			await expect(editor.getByRole('status')).toHaveCount(0);
			await expect(rate).not.toHaveAttribute('aria-invalid', 'true');
			await expect(
				editor.getByRole('button', { name: 'Guardar aranceles', exact: true })
			).toBeEnabled();
			expect(priceWrites).toBe(0);
			await health.assertAndAttach(test.info(), 'manual-render-health');
		} finally {
			await context.close();
		}
	});

	test('professional tasks preserve persisted edits, conflicts and layout across five widths and both themes', async ({
		browser
	}, testInfo) => {
		test.setTimeout(240_000);
		expect(new URL(fixture.apiOrigin).hostname).toBe('127.0.0.1');
		const db = createFixtureClient(fixture.apiOrigin, fixture.service);
		const suffix = randomUUID(),
			professionalId = randomUUID();
		const professionalName = 'Profesional sintético ' + 'NombreExtenso'.repeat(8);
		const serviceName = 'Prestación sintética ' + suffix;
		const createdServices: string[] = [];
		const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
		const coverage: { width: number; theme: string; tasks: string[] }[] = [];
		const errors: string[] = [];
		const must = async (operation: PromiseLike<{ error: unknown }>) => {
			const { error } = await operation;
			if (error) {
				const code =
					typeof error === 'object' &&
					'code' in error &&
					typeof error.code === 'string' &&
					/^[A-Z0-9]{5}$/.test(error.code)
						? error.code
						: 'unknown';
				throw new Error(`Owned team UX fixture operation failed (${code}).`);
			}
		};
		// Accumulated over the ten combinations and asserted once after the matrix.
		const layoutProblems: (LayoutIssue & { viewport: number; theme: string; task: string })[] = [];
		const geometry = async (
			page: import('@playwright/test').Page,
			where: { viewport: number; theme: string; task: string }
		) => {
			for (const issue of await layoutIssues(
				page,
				'main input:not(.ux-native-source):not([type="hidden"]):not([type="radio"]):not([type="checkbox"]):visible, main .ux-control-trigger:visible, [role="dialog"] input:not(.ux-native-source):not([type="hidden"]):not([type="radio"]):not([type="checkbox"]):visible, [role="dialog"] .ux-control-trigger:visible, [role="dialog"] textarea:visible'
			))
				layoutProblems.push({ ...where, ...issue });
		};
		try {
			await must(
				db.from('professionals').insert({
					id: professionalId,
					business_id: fixture.businessId,
					name: professionalName,
					is_active: true,
					is_public: true
				})
			);
			await must(
				db.from('professional_services').insert({
					business_id: fixture.businessId,
					professional_id: professionalId,
					service_id: fixture.serviceId
				})
			);
			// Restriction tables deliberately grant SELECT only, including service_role.
			// Prepare through the actual owner's transactional public command, not a bypass grant.
			const revision = await db
				.from('businesses')
				.select('booking_availability_revision')
				.eq('id', fixture.businessId)
				.single();
			expect(revision.error).toBeNull();
			if (!revision.data) throw new Error('Owned team revision is missing');
			const owner = createClient<CitaDatabase>(fixture.apiOrigin, fixture.anon, {
				auth: { persistSession: false, autoRefreshToken: false },
				global: { headers: { Authorization: 'Bearer ' + fixture.ownerToken } }
			});
			await must(
				owner.rpc('replace_professional_schedule_blocks', {
					p_business_id: fixture.businessId,
					p_professional_id: professionalId,
					p_expected_revision: revision.data.booking_availability_revision,
					p_blocks: [
						{
							weekdays: [1],
							ranges: [{ start: '09:00', end: '12:00' }],
							slot_interval_minutes: 15,
							break_minutes: 15,
							service_scope: 'restricted',
							service_ids: [fixture.serviceId]
						}
					]
				})
			);
			await context.addCookies([
				{ name: 'sb-module', value: 'odonto', url: fixture.appOrigin },
				{ name: 'sb-access-token', value: fixture.ownerToken, url: fixture.appOrigin },
				{ name: 'sb-refresh-token', value: fixture.ownerRefreshToken, url: fixture.appOrigin },
				{ name: 'active-business-id', value: fixture.businessId, url: fixture.appOrigin }
			]);
			const page = await context.newPage();
			const health = await observeRenderHealth(page);
			page.on('pageerror', (e) => errors.push(e.message));
			const editorURL = fixture.appOrigin + '/odonto/profesionales/' + professionalId;
			let releaseEditorScripts!: () => void;
			const editorScriptsReady = new Promise<void>((resolve) => {
				releaseEditorScripts = resolve;
			});
			const holdEditorScripts = async (route: import('@playwright/test').Route) => {
				if (route.request().resourceType() === 'script') await editorScriptsReady;
				await route.continue();
			};
			await page.route('**/*', holdEditorScripts);
			try {
				await page.goto(editorURL + '?tab=servicios', { waitUntil: 'commit' });
				await expect(page.getByRole('button', { name: /^Servicios y aranceles/ })).toBeDisabled();
				await expect(
					page.getByRole('button', { name: 'Crear servicio nuevo', exact: true })
				).toBeDisabled();
			} finally {
				releaseEditorScripts();
			}
			await expect(page.getByRole('button', { name: /^Servicios y aranceles/ })).toBeEnabled();
			await page.unroute('**/*', holdEditorScripts);
			await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
			await page.getByRole('button', { name: 'Crear servicio nuevo', exact: true }).click();
			const creation = page.locator('form[action="?/create_service"]');
			await creation.locator('[name="name"]').fill(serviceName);
			await creation.locator('[name="duration_minutes"]').fill('23');
			await creation.getByRole('button', { name: 'Crear y asignar', exact: true }).click();
			await expect(page.getByText('Servicio creado y asignado.', { exact: true })).toBeVisible();
			const created = await db
				.from('services')
				.select('id,updated_at,duration_minutes')
				.eq('business_id', fixture.businessId)
				.eq('name', serviceName)
				.single();
			expect(created.error).toBeNull();
			if (!created.data) throw new Error('Created service was not persisted.');
			expect(created.data.duration_minutes).toBe(23);
			createdServices.push(created.data.id);
			const assignment = await db
				.from('professional_services')
				.select('service_id')
				.eq('business_id', fixture.businessId)
				.eq('professional_id', professionalId)
				.eq('service_id', created.data.id);
			expect(assignment.error).toBeNull();
			expect(assignment.data).toHaveLength(1);
			const row = page.locator('.ux-choice').filter({ hasText: serviceName });
			await row.getByRole('button', { name: 'Editar', exact: true }).click();
			const dialog = page.getByRole('dialog', { name: 'Editar servicio', exact: true });
			await dialog
				.locator('[name="description"]')
				.fill('Borrador sintético que debe sobrevivir al conflicto');
			const openingVersion = await dialog.locator('[name="service_updated_at"]').inputValue();
			await must(
				db
					.from('services')
					.update({
						description: 'Edición concurrente sintética',
						updated_at: new Date(Date.now() + 1000).toISOString()
					})
					.eq('business_id', fixture.businessId)
					.eq('id', created.data.id)
			);
			const serviceConflict = page.waitForResponse((response) => {
				const url = new URL(response.url());
				return response.request().method() === 'POST' &&
					url.origin + url.pathname === editorURL && url.search === '?/update_service';
			});
			await dialog.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
			// Enhanced actions encode fail(409) in an HTTP 200 ActionResult envelope.
			const serviceConflictResponse = await serviceConflict;
			expect(serviceConflictResponse.status()).toBe(200);
			expect(await serviceConflictResponse.json()).toMatchObject({ type: 'failure', status: 409 });
			await expect(
				dialog.getByText('El servicio cambió. Cerrá el editor y recargá antes de guardar.', {
					exact: true
				})
			).toBeVisible();
			await expect(dialog.locator('[name="description"]')).toHaveValue(
				'Borrador sintético que debe sobrevivir al conflicto'
			);
			await expect(dialog.locator('[name="service_updated_at"]')).toHaveValue(openingVersion);
			await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
			await page.reload();
			await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
			await page
				.locator('.ux-choice')
				.filter({ hasText: serviceName })
				.getByRole('button', { name: 'Editar', exact: true })
				.click();
			await dialog.locator('[name="description"]').fill('Edición confirmada sintética');
			await dialog.locator('[name="buffer_before_minutes"]').fill('3');
			await dialog.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
			await expect(dialog).not.toBeVisible();
			const saved = await db
				.from('services')
				.select('description')
				.eq('business_id', fixture.businessId)
				.eq('id', created.data.id)
				.single();
			expect(saved.error).toBeNull();
			expect(saved.data?.description).toBe('Edición confirmada sintética');
			// A dirty local profile must not silently borrow a token from changed remote hours.
			await page.getByRole('button', { name: /^Perfil(?:\s|$)/ }).click();
			const localName = 'Borrador local que debe conservarse';
			await page.getByRole('textbox', { name: /^Nombre(?:\s|$)/ }).fill(localName);
			const openingRevision = await page
				.locator('form[action="?/save_all"] [name="availability_revision"]')
				.inputValue();
			const beforeRemote = await db
				.from('businesses')
				.select('booking_availability_revision')
				.eq('id', fixture.businessId)
				.single();
			expect(beforeRemote.error).toBeNull();
			if (!beforeRemote.data) throw new Error('Missing owned revision');
			await must(
				owner.rpc('replace_professional_schedule_blocks', {
					p_business_id: fixture.businessId,
					p_professional_id: professionalId,
					p_expected_revision: beforeRemote.data.booking_availability_revision,
					p_blocks: [
						{
							weekdays: [1],
							ranges: [{ start: '10:00', end: '12:00' }],
							slot_interval_minutes: 15,
							break_minutes: 15,
							service_scope: 'restricted',
							service_ids: [fixture.serviceId]
						}
					]
				})
			);
			// A real independent service edit invalidates the route while the name stays dirty.
			await page.getByRole('button', { name: /^Servicios y aranceles(?:\s|$)/ }).click();
			await page
				.locator('.ux-choice')
				.filter({ hasText: serviceName })
				.getByRole('button', { name: 'Editar', exact: true })
				.click();
			await dialog.locator('[name="description"]').fill('Edición que refresca la configuración');
			await dialog.getByRole('button', { name: 'Guardar cambios', exact: true }).click();
			await expect(dialog).not.toBeVisible();
			await expect(page.locator('[data-loaded-availability-revision]')).not.toHaveAttribute(
				'data-loaded-availability-revision',
				openingRevision
			);
			await expect(
				page.locator('form[action="?/save_all"] [name="availability_revision"]')
			).toHaveValue(openingRevision);
			const profileConflict = page.waitForResponse((response) => {
				const url = new URL(response.url());
				return response.request().method() === 'POST' &&
					url.origin + url.pathname === editorURL && url.search === '?/save_all';
			});
			await page.getByRole('button', { name: 'Guardar todo', exact: true }).click();
			const profileConflictResponse = await profileConflict;
			expect(profileConflictResponse.status()).toBe(200);
			expect(await profileConflictResponse.json()).toMatchObject({ type: 'failure', status: 409 });
			await expect(
				page.getByText(
					'La configuración cambió. Recargá la página antes de guardar; no se aplicó ningún cambio.',
					{ exact: true }
				)
			).toBeVisible();
			const unchanged = await db
				.from('professionals')
				.select('name')
				.eq('business_id', fixture.businessId)
				.eq('id', professionalId)
				.single();
			expect(unchanged.error).toBeNull();
			expect(unchanged.data?.name).toBe(professionalName);
			await page.getByRole('button', { name: /^Perfil(?:\s|$)/ }).click();
			await expect(page.getByRole('textbox', { name: /^Nombre(?:\s|$)/ })).toHaveValue(localName);
			await page.getByRole('link', { name: 'Volver', exact: true }).click();
			await page.getByRole('button', { name: 'Salir sin guardar', exact: true }).click();
			await expect(page).toHaveURL(/\/odonto\/configuracion\/usuarios/);
			await page.goto(editorURL);
			await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();

			for (const width of [320, 390, 768, 1280, 1600])
				for (const theme of ['light', 'dark']) {
					await page.setViewportSize({ width, height: 900 });
					await page.emulateMedia({ colorScheme: theme === 'dark' ? 'dark' : 'light' });
					await page.evaluate((theme) => localStorage.setItem('theme', theme), theme);
					await page.goto(editorURL);
					await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
					await expect
						.poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
						.toBe(true);
					await geometry(page, { viewport: width, theme, task: 'profile' });
					// Name and booking status share the header; it is captured on its own because the
					// profile task capture below starts at the form.
					if (theme === 'dark') {
						await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
						await page.screenshot({
							path: testInfo.outputPath(`team-${width}-${theme}-header.jpg`),
							type: 'jpeg',
							quality: 60,
							animations: 'disabled'
						});
					}
					await alignTaskForCapture(page.getByRole('heading', { name: 'Perfil', exact: true }));
					await page.screenshot({
						path: testInfo.outputPath(`team-${width}-${theme}-profile.jpg`),
						type: 'jpeg',
						quality: 60,
						animations: 'disabled'
					});
					await page.getByRole('button', { name: /^Servicios y aranceles/ }).click();
					await expect(
						page.getByRole('heading', { name: 'Servicios que ofrece', exact: true })
					).toBeVisible();
					await geometry(page, { viewport: width, theme, task: 'services' });
					if (theme === 'dark') {
						await alignTaskForCapture(
							page.getByRole('heading', { name: 'Servicios que ofrece', exact: true })
						);
						await page.screenshot({
							path: testInfo.outputPath(`team-${width}-${theme}-services.jpg`),
							type: 'jpeg',
							quality: 60,
							animations: 'disabled'
						});
					}
					await page
						.locator('.ux-choice')
						.filter({ hasText: serviceName })
						.getByRole('button', { name: 'Editar', exact: true })
						.click();
					await expect(dialog).toBeVisible();
					await expect
						.poll(() => dialog.evaluate((element) => element.contains(document.activeElement)))
						.toBe(true);
					await geometry(page, { viewport: width, theme, task: 'service-dialog' });
					if ((width === 390 && theme === 'light') || (width === 1280 && theme === 'dark'))
						await page.screenshot({
							path: testInfo.outputPath(`team-${width}-${theme}-service-dialog.jpg`),
							type: 'jpeg',
							quality: 60,
							animations: 'disabled'
						});
					await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
					await page.getByRole('button', { name: /^Horarios/ }).click();
					const scheduleHeading = page.getByRole('heading', { name: 'Horarios de atención', exact: true });
					await expect(scheduleHeading).toBeVisible();
					await geometry(page, { viewport: width, theme, task: 'schedule' });
					await alignTaskForCapture(scheduleHeading);
					await page.screenshot({
						path: testInfo.outputPath(`team-${width}-${theme}-schedule.jpg`),
						type: 'jpeg',
						quality: 60,
						animations: 'disabled'
					});
					coverage.push({
						width,
						theme,
						tasks: [
							'profile-long-content',
							'services',
							'versioned-dialog-focus',
							'restricted-schedule',
							'geometry'
						]
					});
				}
			expect(coverage).toHaveLength(10);
			expect(layoutProblems).toEqual([]);
			expect(errors).toEqual([]);
			await testInfo.attach('team-structure-coverage', {
				body: JSON.stringify({
					scope: 'Real disposable Auth/SQL and rendered UI; owned synthetic professional only.',
					coverage
				}),
				contentType: 'application/json'
			});
			await page.goto(editorURL);
			await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
			await page.getByRole('button', { name: 'Eliminar', exact: true }).click();
			const deletion = page.getByRole('dialog', { name: 'Eliminar profesional', exact: true });
			await expect(deletion).toBeVisible();
			await deletion.getByRole('button', { name: 'Eliminar profesional', exact: true }).click();
			await expect(page).toHaveURL(/\/odonto\/configuracion\/usuarios/);
			const absent = await db
				.from('professionals')
				.select('id')
				.eq('business_id', fixture.businessId)
				.eq('id', professionalId);
			expect(absent.error).toBeNull();
			expect(absent.data).toEqual([]);
			await health.assertAndAttach(testInfo, 'team-render-health');
		} finally {
			await context.close();
			await must(
				db
					.from('professionals')
					.delete()
					.eq('business_id', fixture.businessId)
					.eq('id', professionalId)
			);
			if (createdServices.length)
				await must(
					db
						.from('services')
						.delete()
						.eq('business_id', fixture.businessId)
						.in('id', createdServices)
				);
		}
	});

	test('native booking keeps required fields first and both visual identities responsive at every planned width', async ({
		browser
	}, testInfo) => {
		test.setTimeout(180_000);
		const context = await browser.newContext({
			viewport: { width: 1280, height: 900 },
			colorScheme: 'light'
		});
		const coverage: { brand: string; width: number; theme: string; renderedTheme: string }[] = [];
		const publicLayout: (LayoutIssue & { brand: string; viewport: number; theme: string })[] = [];
		const errors: string[] = [];
		let writes = 0;
		try {
			const page = await context.newPage();
			const health = await observeRenderHealth(page);
			page.on('pageerror', (error) => errors.push(error.message));
			page.on('request', (request) => {
				if (request.method() === 'POST' && new URL(request.url()).origin === fixture.appOrigin)
					writes++;
			});
			await page.goto(
				fixture.appOrigin +
					'/reservar/' +
					fixture.businessId +
					'?service_id=' +
					fixture.serviceId +
					'&professional_id=' +
					fixture.professionalId
			);
			await page
				.getByRole('link', { name: /Horarios disponibles/ })
				.nth(1)
				.click();
			await page
				.getByRole('link', { name: /^\d{2}:\d{2}$/ })
				.first()
				.click();
			await expect(page.getByLabel('Nombre y apellido', { exact: true })).toBeVisible();
			const selectedURL = new URL(page.url());
			for (const brand of ['cita-suite', 'natalia'])
				for (const width of [320, 390, 768, 1280, 1600])
					for (const theme of ['light', 'dark']) {
						await page.setViewportSize({ width, height: 900 });
						await page.emulateMedia({ colorScheme: theme === 'dark' ? 'dark' : 'light' });
						await page.evaluate((theme) => localStorage.setItem('theme', theme), theme);
						const url = new URL(selectedURL);
						url.pathname =
							brand === 'natalia' ? '/embed/v1/' + fixture.key : '/reservar/' + fixture.businessId;
						url.searchParams.set('color_mode', theme);
						await page.goto(url.toString());
						await expect(page.locator(`[data-booking-theme="${brand}"]`)).toBeVisible();
						const required = page.locator('.patient-required-fields'),
							optional = page.locator('.patient-optional-fields');
						await expect(required).toBeVisible();
						await expect(optional).toBeVisible();
						expect(
							await page.evaluate(() => {
								const required = document.querySelector('.patient-required-fields'),
									optional = document.querySelector('.patient-optional-fields');
								return Boolean(
									required &&
									optional &&
									required.compareDocumentPosition(optional) & Node.DOCUMENT_POSITION_FOLLOWING
								);
							})
						).toBe(true);
						expect(await page.locator('.patient-optional-fields [required]').count()).toBe(0);
						await expect(
							page.getByText('Información para el consultorio', { exact: true })
						).toHaveCount(0);
						await page
							.getByLabel('Nombre y apellido', { exact: true })
							.fill('Paciente sintético ' + 'NombreExtenso'.repeat(9));
						await page
							.getByLabel('Comentario', { exact: true })
							.fill('Comentario sintético ' + 'Contenido extenso de auditoría. '.repeat(20));
						for (const issue of await layoutIssues(
							page,
							'.patient-control:not(.ux-native-source):visible, .ux-control-trigger:visible'
						))
							publicLayout.push({ brand, viewport: width, theme, ...issue });
						if (brand === 'natalia')
							await expect(page.locator('[data-booking-theme="natalia"]')).toHaveAttribute(
								'data-booking-color-mode',
								theme
							);
						else
							await expect
								.poll(() =>
									page.evaluate(() => document.documentElement.classList.contains('dark'))
								)
								.toBe(true);
						// Certify the final form itself (summary, then required fields), not the steps above it.
						const form = page.locator('.patient-booking-form');
						await alignTaskForCapture(form);
						await page.screenshot({
							path: testInfo.outputPath(`public-${brand}-${width}-${theme}-final.jpg`),
							type: 'jpeg',
							quality: 60,
							animations: 'disabled'
						});
						// Region capture (not a simulated viewport) of the complete field order.
						if ((width === 390 && theme === 'light') || (width === 1280 && theme === 'dark'))
							await form.screenshot({
								path: testInfo.outputPath(`public-${brand}-${width}-${theme}-form-region.jpg`),
								type: 'jpeg',
								quality: 60,
								animations: 'disabled'
							});
						if (width === 320) {
							await page.getByLabel('Nombre y apellido', { exact: true }).fill('');
							await page.getByRole('button', { name: 'Confirmar reserva', exact: true }).click();
							await expect(page.getByLabel('Nombre y apellido', { exact: true })).toBeFocused();
						}
						coverage.push({
							brand,
							width,
							theme,
							renderedTheme: brand === 'natalia' ? theme : 'dark'
						});
					}
			expect(coverage).toHaveLength(20);
			expect(publicLayout).toEqual([]);
			await health.assertAndAttach(testInfo, 'public-render-health');
			expect(writes).toBe(0);
			expect(errors).toEqual([]);
			await testInfo.attach('public-structure-coverage', {
				body: JSON.stringify({
					scope: 'Real rendered native routes; no reservation writes, no disabled rate limits.',
					coverage
				}),
				contentType: 'application/json'
			});
		} finally {
			await context.close();
		}
	});
});
