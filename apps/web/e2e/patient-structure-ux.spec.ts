import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import WebSocket from 'ws';
import { expect, test } from '@playwright/test';
import type { CitaDatabase } from '../src/lib/types/database';
import { loginWithSharedSession } from './helpers/shared-auth';

test.use({ timezoneId: 'America/Argentina/Buenos_Aires' });

test('patient structure preserves role scope, keyboard access and long content across five widths and both browser color preferences (the private design remains dark)', async ({
	page
}, testInfo) => {
	test.setTimeout(180_000);
	const api = process.env.ODONTO_SUPABASE_URL,
		key = process.env.ODONTO_SUPABASE_SERVICE_ROLE_KEY;
	const parentBusiness = process.env.CITA_SUITE_TEST_BUSINESS_ID;
	if (
		process.env.CITA_E2E_ENVIRONMENT !== 'disposable' ||
		!api ||
		!key ||
		!parentBusiness ||
		new URL(api).hostname !== '127.0.0.1'
	)
		throw new Error('Patient UX matrix requires the owned disposable environment.');
	const admin = createClient<CitaDatabase>(api, key, {
		auth: { persistSession: false, autoRefreshToken: false },
		realtime: { transport: WebSocket }
	});
	const suffix = randomUUID(),
		slug = `e2e-patient-ux-${suffix}`;
	const ownerEmail = `patient-ux-owner-${suffix}@example.test`;
	const email = `patient-ux-${suffix}@example.test`,
		password = 'CitaPatientMatrixLocal!2026';
	const name = `Paciente sintético de auditoría ${'NombreExtenso'.repeat(8)}`;
	const description = `Descripción clínica sintética\n${'Contenido largo de auditoría. '.repeat(70)}\n${'ReferenciaExtensa'.repeat(20)}`;
	let actorId: string | undefined, ownerId: string | undefined, businessId: string | undefined;
	const errors: string[] = [],
		coverage: {
			role: string;
			width: number;
			theme: string;
			renderedTheme: 'dark';
			checks: string[];
		}[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	async function must<T>(
		operation: PromiseLike<{ data: T; error: unknown }>
	): Promise<NonNullable<T>> {
		const { data, error } = await operation;
		if (error || data == null)
			throw new Error('Could not prepare or read owned patient UX fixture.');
		return data;
	}
	async function write(operation: PromiseLike<{ error: unknown }>) {
		const { error } = await operation;
		if (error) {
			const code = typeof error === 'object' && 'code' in error ? String(error.code) : 'unknown';
			throw new Error(`Owned patient UX fixture write failed (${code}).`);
		}
	}
	async function geometry() {
		expect(await page.locator('meta[name="viewport"]').getAttribute('content')).not.toMatch(
			/user-scalable\s*=\s*no|maximum-scale\s*=\s*1(?:[,\s]|$)/
		);
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
			true
		);
		const clipped = await page
			.locator(
				'main input:visible, [role="dialog"] input:visible, [role="dialog"] textarea:visible, [role="dialog"] select:visible'
			)
			.evaluateAll((elements) =>
				elements.some((element) => {
					const box = element.getBoundingClientRect();
					return box.left < -1 || box.right > innerWidth + 1 || box.width < 20;
				})
			);
		expect(clipped).toBe(false);
		expect(await page.locator('vite-error-overlay').count()).toBe(0);
	}
	try {
		const owner = await admin.auth.admin.createUser({
			email: ownerEmail,
			password,
			email_confirm: true
		});
		if (owner.error || !owner.data.user)
			throw new Error('Could not prepare owned UX clinic owner.');
		ownerId = owner.data.user.id;
		const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
		if (created.error || !created.data.user)
			throw new Error('Could not prepare synthetic UX Auth actor.');
		actorId = created.data.user.id;
		await write(
			admin.from('allowed_emails').insert([
				{ email, enabled: true },
				{ email: ownerEmail, enabled: true }
			])
		);
		const business = await must(
			admin
				.from('businesses')
				.insert({
					name: 'Consultorio sintético de auditoría visual',
					slug,
					industry: 'other',
					timezone: 'America/Argentina/Buenos_Aires'
				})
				.select('id')
				.single()
		);
		businessId = business.id;
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
				.eq('business_id', businessId)
		);
		await write(
			admin.from('business_users').insert([
				{
					business_id: businessId,
					user_id: ownerId,
					role: 'owner',
					status: 'active',
					accepted_at: new Date().toISOString()
				},
				{
					business_id: businessId,
					user_id: actorId,
					role: 'owner',
					status: 'active',
					accepted_at: new Date().toISOString()
				}
			])
		);
		const patient = await must(
			admin
				.from('patients')
				.insert({
					business_id: businessId,
					owner_id: actorId,
					full_name: name,
					phone: '+54 11 1234 5678',
					phone_raw: '+54 11 1234 5678',
					phone_e164: '+541112345678',
					email: 'contacto.sintetico.extenso@example.test',
					address: 'Dirección sintética '.repeat(8),
					insurance: 'Obra social sintética',
					birth_date: '1990-01-02'
				})
				.select('id')
				.single()
		);
		await write(
			admin.from('patient_clinical_profiles').insert({
				business_id: businessId,
				patient_id: patient.id,
				allergies: 'ALERTA_CLINICA_SINTETICA',
				medication: 'Medicación sintética de auditoría',
				background: 'Antecedentes sintéticos. '.repeat(30)
			})
		);
		const professional = await must(
			admin
				.from('professionals')
				.insert({
					business_id: businessId,
					name: 'Profesional sintético de auditoría visual',
					is_active: true
				})
				.select('id')
				.single()
		);
		await write(
			admin
				.from('professional_users')
				.insert({ business_id: businessId, professional_id: professional.id, user_id: actorId })
		);
		await write(
			admin.from('professional_patient_links').insert({
				business_id: businessId,
				professional_id: professional.id,
				patient_id: patient.id
			})
		);
		const entry = await must(
			admin
				.from('clinical_entries')
				.insert({
					business_id: businessId,
					patient_id: patient.id,
					owner_id: actorId,
					created_by_user_id: actorId,
					created_by_professional_id: professional.id,
					created_at: new Date().toISOString(),
					locked_after: new Date(Date.now() + 86400_000).toISOString(),
					entry_type: 'Consulta',
					description,
					internal_note: 'Nota sintética\ncon segunda línea.'
				})
				.select('id')
				.single()
		);
		await write(
			admin
				.from('clinical_entry_costs')
				.insert({ business_id: businessId, clinical_entry_id: entry.id, amount: 125.5 })
		);
		await loginWithSharedSession(page, { email, password });
		for (const role of ['owner', 'admin', 'professional', 'reception', 'readonly'] as const) {
			await write(
				admin
					.from('business_users')
					.update({ role })
					.eq('business_id', businessId)
					.eq('user_id', actorId)
			);
			for (const width of [320, 390, 768, 1280, 1600])
				for (const theme of ['light', 'dark']) {
					await page.setViewportSize({ width, height: 900 });
					await page.emulateMedia({ colorScheme: theme === 'dark' ? 'dark' : 'light' });
					await page.evaluate((theme) => localStorage.setItem('theme', theme), theme);
					await page.goto(`/odonto/pacientes/${patient.id}`);
					await expect(
						page.getByRole('main').getByRole('heading', { name, exact: true })
					).toBeVisible();
					await expect
						.poll(() => page.evaluate(() => document.documentElement.classList.contains('dark')))
						.toBe(true);
					expect(
						await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)
					).toBe('dark');
					const checks = ['identity', 'fixed-dark-theme', 'system-preference-' + theme, 'geometry'];
					// All fifty combinations are asserted; captures retain owner at every width/theme
					// plus each other role on mobile/light and desktop/dark within the evidence budget.
					const capture =
						role === 'owner' ||
						(width === 390 && theme === 'light') ||
						(width === 1280 && theme === 'dark');
					await geometry();
					if (role !== 'reception') {
						const toggle = page.getByRole('button', { name: /^Detalles de Consulta/ });
						await expect(toggle).toBeEnabled();
						await toggle.focus();
						await page.keyboard.press('Space');
						await expect(toggle).toHaveAttribute('aria-expanded', 'true');
						await expect(
							page.locator(`[id="clinical-entry-${patient.id}-${entry.id}"]`)
						).toContainText('ReferenciaExtensa');
						await geometry();
						checks.push('keyboard-full-description');
					} else {
						await expect(page.getByRole('button', { name: 'Historial', exact: true })).toHaveCount(
							0
						);
						await expect(
							page.getByText('Descripción clínica sintética', { exact: false })
						).toHaveCount(0);
					}
					if (capture)
						await page.screenshot({
							path: testInfo.outputPath(`${role}-${width}-${theme}-history.jpg`),
							type: 'jpeg',
							quality: 65,
							animations: 'disabled'
						});
					if (role === 'owner' && width === 390 && theme === 'light') {
						const pattern = `**/odonto/pacientes/${patient.id}/datos`;
						let release!: () => void;
						const gate = new Promise<void>((resolve) => {
							release = resolve;
						});
						const held = async (route: import('@playwright/test').Route) => {
							await gate;
							await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
						};
						await page.route(pattern, held);
						try {
							await page.getByRole('button', { name: 'Datos', exact: true }).click();
							await expect(
								page.getByText('Cargando últimos cambios…', { exact: true })
							).toBeVisible();
							await page.screenshot({
								path: testInfo.outputPath('simulated-profile-loading.jpg'),
								type: 'jpeg',
								quality: 65
							});
							release();
							await expect(
								page.getByText('No pudimos cargar los últimos cambios. Volvé a intentar.', {
									exact: true
								})
							).toBeVisible();
							await page.screenshot({
								path: testInfo.outputPath('simulated-profile-error.jpg'),
								type: 'jpeg',
								quality: 65
							});
						} finally {
							release();
							await page.unroute(pattern, held);
						}
						await page.getByRole('button', { name: 'Reintentar', exact: true }).click();
						await expect(
							page.getByText('No pudimos cargar los últimos cambios. Volvé a intentar.', {
								exact: true
							})
						).toHaveCount(0);
						await expect(page.getByText('Cargando últimos cambios…', { exact: true })).toHaveCount(
							0
						);
						checks.push('simulated-audit-load-error', 'real-audit-load-recovery');
					} else await page.getByRole('button', { name: 'Datos', exact: true }).click();
					await expect(
						page.getByRole('heading', { name: 'Datos del paciente', exact: true })
					).toBeVisible();
					if (role === 'reception' || role === 'readonly') {
						await expect(page.getByText('Alertas médicas', { exact: true })).toHaveCount(0);
						await expect(page.getByText('ALERTA_CLINICA_SINTETICA', { exact: true })).toHaveCount(
							0
						);
					} else
						await expect(page.getByText('ALERTA_CLINICA_SINTETICA', { exact: true })).toBeVisible();
					await geometry();
					checks.push('profile-role-scope');
					if (capture)
						await page.screenshot({
							path: testInfo.outputPath(`${role}-${width}-${theme}-profile.jpg`),
							type: 'jpeg',
							quality: 65,
							animations: 'disabled'
						});
					const edit = page.getByRole('button', { name: 'Editar datos del paciente', exact: true });
					if (role === 'readonly') await expect(edit).toHaveCount(0);
					else {
						await edit.click();
						const dialog = page.getByRole('dialog', { name: 'Editar datos', exact: true });
						await expect(dialog).toBeVisible();
						await expect
							.poll(() => dialog.evaluate((element) => element.contains(document.activeElement)))
							.toBe(true);
						if (role === 'reception')
							await expect(dialog.locator('[name="allergies"]')).toHaveCount(0);
						else await expect(dialog.locator('[name="allergies"]')).toBeVisible();
						await geometry();
						if (capture)
							await page.screenshot({
								path: testInfo.outputPath(`${role}-${width}-${theme}-edit.jpg`),
								type: 'jpeg',
								quality: 65,
								animations: 'disabled'
							});
						await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
						await expect(dialog).not.toBeVisible();
						await expect(edit).toBeFocused();
						checks.push('edit-scope-focus');
					}
					coverage.push({ role, width, theme, renderedTheme: 'dark', checks });
				}
		}
		expect(coverage).toHaveLength(50);
		expect(errors).toEqual([]);
		await testInfo.attach('patient-ux-coverage', {
			body: JSON.stringify({
				scope: 'Real disposable Auth/PostgREST and rendered UI; synthetic fixture only.',
				coverage
			}),
			contentType: 'application/json'
		});
	} finally {
		if (businessId) {
			const removed = await must(
				admin.from('businesses').delete().eq('id', businessId).eq('slug', slug).select('id')
			);
			expect(removed).toHaveLength(1);
		}
		await write(admin.from('allowed_emails').delete().in('email', [email, ownerEmail]));
		if (ownerId && (await admin.auth.admin.deleteUser(ownerId)).error)
			throw new Error('Owned patient UX owner cleanup failed.');
		if (actorId && (await admin.auth.admin.deleteUser(actorId)).error)
			throw new Error('Owned patient UX actor cleanup failed.');
	}
});
