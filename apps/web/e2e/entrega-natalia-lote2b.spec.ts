import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { must } from './helpers/fixture-db';
import { layoutIssues, type LayoutIssue } from './helpers/layout-usability';
import { ownedAppointmentFixture } from './helpers/owned-appointment-fixture';
import { observeRenderHealth } from './helpers/render-health';
import { loginWithSharedSession } from './helpers/shared-auth';
import { alignTaskForCapture } from './helpers/task-capture';
import { chooseTheme, contrastViolations, expectRenderedTheme } from './helpers/theme';

test('@candidate-behavior Lote 2B (P1 y P4): aviso de seña por vencer, «Ya transferí», señas a cuenta, «Aplicar» y decisiones de cancelación/reprogramación', async ({ page }, info) => {
	test.setTimeout(300_000);
	const f = ownedAppointmentFixture();
	const origin = new URL(process.env.E2E_BASE_URL!).origin;
	const owner = f.sql(`select user_id from public.business_users where business_id='${f.businessId}' and role='owner' and status='active' limit 1;`);
	const assignment = await must(
		f.admin.from('professional_services').select('service_id,professional_id').eq('business_id', f.businessId).limit(1).single()
	);

	const bizSnapshot = f.sql(
		`select jsonb_build_object(
			'slug', slug, 'timezone', timezone, 'phone', phone, 'address', address,
			'public_booking_enabled', public_booking_enabled, 'allow_same_day_booking', allow_same_day_booking,
			'public_contact_enabled', public_contact_enabled, 'whatsapp_contact_enabled', whatsapp_contact_enabled,
			'whatsapp_phone', whatsapp_phone, 'max_booking_days_ahead', max_booking_days_ahead,
			'min_booking_notice_minutes', min_booking_notice_minutes
		)::text from public.businesses where id='${f.businessId}';`
	);
	const prevDepositPolicy = f.sql(
		`select coalesce((select jsonb_build_object(
			'enabled', enabled, 'auto_cancel_enabled', auto_cancel_enabled,
			'amount_mode', amount_mode, 'fixed_amount', fixed_amount, 'percentage', percentage,
			'request_days', request_days, 'deadline_hours', deadline_hours,
			'min_payment_hours', min_payment_hours, 'late_booking_payment_hours', late_booking_payment_hours,
			'expiring_reminder_hours', expiring_reminder_hours, 'deposit_credit_cutoff_hours', deposit_credit_cutoff_hours,
			'transfer_details', transfer_details, 'applies_to_manual', applies_to_manual
		)::text from public.deposit_policies where business_id='${f.businessId}'), 'null');`
	);
	const prevDepositAutomation = f.sql('select enabled::text from private.deposit_automation where singleton;');

	const patientId = randomUUID();
	const apt1Id = randomUUID();
	const apt1Token = (randomUUID() + randomUUID()).replaceAll('-', '');
	const apt2Id = randomUUID();
	const apt2Token = (randomUUID() + randomUUID()).replaceAll('-', '');
	const startedAt = new Date().toISOString();

	const health = await observeRenderHealth(page);
	const issues: LayoutIssue[] = [];

	const cleanGetUrl = (rawUrl: string) => {
		const u = new URL(rawUrl);
		for (const key of [...u.searchParams.keys()]) {
			if (key.startsWith('/')) u.searchParams.delete(key);
		}
		return u.toString();
	};

	const auditAndCapture = async (
		name: string,
		widths: number[],
		modes: Array<'light' | 'dark'>,
		options?: {
			pageUrl?: string;
			anchor?: () => ReturnType<typeof page.locator>;
			afterLoad?: () => Promise<void>;
		}
	) => {
		const targetGetUrl = cleanGetUrl(options?.pageUrl ?? page.url());
		for (const mode of modes) {
			await chooseTheme(page, mode);
			await page.goto(targetGetUrl, { waitUntil: 'networkidle' });
			await expectRenderedTheme(page, mode);
			if (options?.afterLoad) await options.afterLoad();
			for (const width of widths) {
				await page.setViewportSize({ width, height: 860 });
				expect((await contrastViolations(page)).violations, `${name} ${mode} ${width}px contrast`).toEqual([]);
				const found = await layoutIssues(page, 'main a:visible, main button:visible', 'main');
				issues.push(...found);
				if (width === 320 || width === 1280) {
					if (options?.anchor) await alignTaskForCapture(options.anchor());
					await health.duringCapture(async () => {
						await page.screenshot({
							path: info.outputPath(`${name}-${mode}-${width}.jpg`),
							type: 'jpeg',
							quality: 65
						});
					});
				}
			}
		}
		await chooseTheme(page, 'light');
		await page.setViewportSize({ width: 1280, height: 860 });
	};

	try {
		f.sql(`begin;
			update private.deposit_automation set enabled = true where singleton;
			update public.businesses
			set public_booking_enabled = true,
				public_contact_enabled = true,
				whatsapp_contact_enabled = true,
				whatsapp_phone = '+5493415550199',
				phone = '+54 341 555-0199'
			where id = '${f.businessId}';
			insert into public.patients(id, business_id, owner_id, full_name, phone_e164, email)
			values ('${patientId}', '${f.businessId}', '${owner}', 'Lucía Lote Dos B', '+5493415550299', 'lucia-l2b@example.test');
			commit;`);

		// 1. Configuración de señas (P1 aviso 24h + P4 corte 48h) y verificación en Correo
		await loginWithSharedSession(page, { email: f.email, password: f.password });
		await page.goto(origin + '/odonto/configuracion/senas', { waitUntil: 'networkidle' });
		const enabledCheck = page.locator('input[name="enabled"]');
		if (!(await enabledCheck.isChecked())) await enabledCheck.check();
		const autoCancelCheck = page.locator('input[name="auto_cancel_enabled"]');
		if (!(await autoCancelCheck.isChecked())) await autoCancelCheck.check();
		const appliesManualCheck = page.locator('input[name="applies_to_manual"]');
		if (!(await appliesManualCheck.isChecked())) await appliesManualCheck.check();
		await page.locator('input[name="fixed_amount"]').fill('40.000');
		await page.locator('input[name="request_days"]').fill('7');
		await page.locator('input[name="deadline_hours"]').fill('168');
		await page.locator('input[name="min_payment_hours"]').fill('24');
		await page.locator('input[name="late_booking_payment_hours"]').fill('48');
		await page.locator('input[name="expiring_reminder_hours"][value="24"]').check();
		await page.locator('input[name="deposit_credit_cutoff_hours"]').fill('48');
		await page.locator('textarea[name="transfer_details"]').fill('Alias prueba.lote2b\nTitular Consultorio Prueba');
		await Promise.all([
			page.waitForResponse((res) => res.request().method() === 'POST' && res.url().includes('/odonto/configuracion/senas')),
			page.getByRole('button', { name: 'Guardar' }).click()
		]);
		await expect(page.getByText(/Configuración de señas guardada/i)).toBeVisible();
		await auditAndCapture('lote2b-config-senas', [320, 1280], ['light', 'dark'], {
			pageUrl: origin + '/odonto/configuracion/senas',
			anchor: () => page.locator('[data-deposit-credit-cutoff-fieldset]')
		});

		await page.goto(origin + '/odonto/configuracion/correo', { waitUntil: 'networkidle' });
		const p4Rule = page.locator('[data-p4-reschedule-rule]');
		await expect(p4Rule).toBeVisible();
		await expect(p4Rule).toContainText(/48\s*horas/i);
		await expect(p4Rule.getByRole('link', { name: /Señas/i })).toHaveAttribute('href', '/odonto/configuracion/senas');
		await auditAndCapture('lote2b-config-correo', [320, 1280], ['light', 'dark'], {
			anchor: () => page.locator('[data-p4-reschedule-rule]')
		});

		// 2. P1: Turno con seña pendiente ($ 40.000), «Ya transferí» con confirmación breve, «Avisó que pagó: verificar», «No llegó el pago» y «Registrar pago»
		f.sql(`begin;
			insert into public.appointments(
				id, business_id, patient_id, service_id, professional_id,
				starts_at, ends_at, blocking_starts_at, blocking_ends_at,
				status, source, confirmation_token,
				service_name_snapshot, professional_name_snapshot, duration_minutes_snapshot
			) values (
				'${apt1Id}', '${f.businessId}', '${patientId}', '${assignment.service_id}', '${assignment.professional_id}',
				now() + interval '96 hours', now() + interval '97 hours', now() + interval '96 hours', now() + interval '97 hours',
				'reserved', 'manual', '${apt1Token}', 'Primera consulta', 'Prof Prueba', 60
			);
			commit;`);

		// Evitar navegación real a WhatsApp al confirmar «Sí, ya transferí»
		await page.addInitScript(() => {
			window.open = () => null;
		});

		const turnUrl = `${origin}/turno/${apt1Token}`;
		await page.goto(turnUrl, { waitUntil: 'networkidle' });
		await expect(page.locator('[data-deposit-card]')).toContainText(/se cancela automáticamente/i);
		await page.locator('[data-payment-notice-trigger]').click();
		await expect(page.locator('[data-payment-notice-confirm]')).toBeVisible();
		await expect(page.locator('[data-payment-notice-confirm]')).toContainText(/40\.000/);

		await auditAndCapture('p1-turno-confirmacion', [320, 1280], ['light', 'dark'], {
			pageUrl: turnUrl,
			afterLoad: async () => {
				await page.locator('[data-payment-notice-trigger]').click();
				await expect(page.locator('[data-payment-notice-confirm]')).toBeVisible();
			},
			anchor: () => page.locator('[data-payment-notice-confirm]')
		});

		await page.goto(turnUrl, { waitUntil: 'networkidle' });
		await page.locator('[data-payment-notice-trigger]').click();
		await Promise.all([
			page.waitForResponse((res) => res.request().method() === 'POST' && res.url().includes('/report_deposit_payment')),
			page.getByRole('button', { name: 'Sí, ya transferí' }).click()
		]);
		await expect(page.locator('[data-payment-notice-recorded]')).toBeVisible();
		await expect(page.locator('[data-deposit-card]')).not.toContainText(/cancela automáticamente/i);
		await expect(page.locator('[data-payment-notice-whatsapp-link]')).toBeVisible();
		expect(f.sql(`select (patient_payment_notice_at is not null)::text from public.appointment_deposits where appointment_id='${apt1Id}';`)).toBe('true');

		await auditAndCapture('p1-turno-aviso-registrado', [320, 1280], ['light', 'dark'], {
			pageUrl: turnUrl,
			anchor: () => page.locator('[data-payment-notice-recorded]')
		});

		// Verificar alerta en /odonto/agenda y fila en /odonto/senas
		await page.goto(origin + '/odonto/agenda', { waitUntil: 'networkidle' });
		await expect(page.locator('[data-deposit-alert]')).toContainText(/avisó que pagó|avisaron que pagaron/i);

		await page.goto(origin + '/odonto/senas', { waitUntil: 'networkidle' });
		await expect(page.getByRole('heading', { name: /Avisó que pagó: verificar/ })).toBeVisible();
		const apt1Row = page.locator(`[data-deposit-row="${apt1Id}"]`);
		await expect(apt1Row).toBeVisible();
		await expect(apt1Row.locator('[data-payment-notice-elapsed]')).toContainText(/Avisó que pagó/);
		await auditAndCapture('p1-senas-aviso-pago', [320, 1280], ['light', 'dark'], {
			pageUrl: origin + '/odonto/senas',
			anchor: () => page.locator(`[data-deposit-row="${apt1Id}"]`)
		});

		// Acción «No llegó el pago» limpia el aviso y devuelve al circuito normal
		await apt1Row.locator('summary').filter({ hasText: 'No llegó el pago' }).click();
		await Promise.all([
			page.waitForResponse((res) => res.request().method() === 'POST' && res.url().includes('/clear_payment_notice')),
			apt1Row.getByRole('button', { name: 'Sí, no llegó el pago' }).click()
		]);
		await page.waitForLoadState('networkidle');
		expect(f.sql(`select (patient_payment_notice_at is null)::text from public.appointment_deposits where appointment_id='${apt1Id}';`)).toBe('true');

		// Confirmar la seña de apt1 ($ 40.000) para probar P4
		await page.goto(origin + '/odonto/senas', { waitUntil: 'networkidle' });
		await page.locator(`[data-deposit-row="${apt1Id}"]`).getByRole('button', { name: 'Confirmar seña' }).click();
		await page.waitForLoadState('networkidle');
		expect(f.sql(`select status from public.appointment_deposits where appointment_id='${apt1Id}';`)).toBe('paid');

		// 3. P4: Cancelar apt1 (>= 48h) -> crédito de $ 40.000 en la ficha -> nuevo turno de $ 50.000 -> «Aplicar» -> nota de diferencia -> «Deshacer» -> re-aplicar
		await page.goto(`${origin}/odonto/turnos/${apt1Id}`, { waitUntil: 'networkidle' });
		const cancelPanel1 = page.locator('[data-cancel-panel]');
		await cancelPanel1.locator('> summary').click();
		await expect(cancelPanel1).toContainText(/quedará a cuenta en la ficha del paciente/i);
		await cancelPanel1.getByLabel('Confirmo que quiero cancelar este turno.').check();
		await Promise.all([
			page.waitForResponse((res) => res.request().method() === 'POST' && res.url().includes('/update_status')),
			cancelPanel1.getByRole('button', { name: 'Cancelar turno' }).click()
		]);
		await page.waitForLoadState('networkidle');
		expect(f.sql(`select count(*) from public.patient_deposit_credits where patient_id='${patientId}' and status='available' and amount=40000;`)).toBe('1');

		// Verificar ficha del paciente (tab Datos -> Señas a cuenta)
		await page.goto(`${origin}/odonto/pacientes/${patientId}?tab=datos`, { waitUntil: 'networkidle' });
		await expect(page.locator('[data-patient-deposit-credits]')).toContainText(/\$[\s\u00a0]*40\.000/);
		await auditAndCapture('p4-ficha-sena-a-cuenta', [320, 1280], ['light', 'dark'], {
			pageUrl: `${origin}/odonto/pacientes/${patientId}?tab=datos`,
			anchor: () => page.locator('[data-patient-deposit-credits]')
		});

		// Subir monto de seña a $ 50.000 y crear segundo turno pendiente para el mismo paciente
		f.sql(`begin;
			update public.deposit_policies set fixed_amount = 50000 where business_id = '${f.businessId}';
			insert into public.appointments(
				id, business_id, patient_id, service_id, professional_id,
				starts_at, ends_at, blocking_starts_at, blocking_ends_at,
				status, source, confirmation_token,
				service_name_snapshot, professional_name_snapshot, duration_minutes_snapshot
			) values (
				'${apt2Id}', '${f.businessId}', '${patientId}', '${assignment.service_id}', '${assignment.professional_id}',
				now() + interval '120 hours', now() + interval '121 hours', now() + interval '120 hours', now() + interval '121 hours',
				'reserved', 'manual', '${apt2Token}', 'Primera consulta', 'Prof Prueba', 60
			);
			commit;`);

		// En /odonto/senas aparece crédito de $ 40.000 con diferencia de $ 10.000 y botón «Aplicar»
		await page.goto(origin + '/odonto/senas', { waitUntil: 'networkidle' });
		const apt2Row = page.locator(`[data-deposit-row="${apt2Id}"]`);
		await expect(apt2Row).toBeVisible();
		await expect(apt2Row).toContainText(/Tiene 1 seña a cuenta/i);
		await expect(apt2Row).toContainText(/Falta cobrar \$[\s\u00a0]*10\.000 de diferencia/i);
		await auditAndCapture('p4-senas-aplicar', [320, 1280], ['light', 'dark'], {
			pageUrl: origin + '/odonto/senas',
			anchor: () => page.locator(`[data-deposit-row="${apt2Id}"]`)
		});

		await Promise.all([
			page.waitForResponse((res) => res.request().method() === 'POST' && res.url().includes('/apply_credit')),
			apt2Row.getByRole('button', { name: 'Aplicar', exact: true }).click()
		]);
		await page.waitForLoadState('networkidle');
		expect(f.sql(`select status from public.appointment_deposits where appointment_id='${apt2Id}';`)).toBe('paid');
		expect(f.sql(`select status from public.patient_deposit_credits where patient_id='${patientId}';`)).toBe('applied');

		// Detalle del turno muestra nota de diferencia + «Deshacer» devuelve crédito a la ficha (Decisión #4)
		await page.goto(`${origin}/odonto/turnos/${apt2Id}`, { waitUntil: 'networkidle' });
		await expect(page.locator('[data-deposit-difference-note]')).toContainText(/Falta cobrar \$[\s\u00a0]*10\.000 de diferencia/i);
		await page.locator('[data-deposit-panel] summary').filter({ hasText: 'Deshacer' }).click();
		await Promise.all([
			page.waitForResponse((res) => res.request().method() === 'POST' && res.url().includes('?/deposit')),
			page.locator('[data-deposit-panel]').getByRole('button', { name: 'Sí, deshacer el registro' }).click()
		]);
		await page.waitForLoadState('networkidle');
		expect(f.sql(`select status from public.patient_deposit_credits where patient_id='${patientId}';`)).toBe('available');

		// Volver a aplicar desde el detalle del turno
		await Promise.all([
			page.waitForResponse((res) => res.request().method() === 'POST' && res.url().includes('/apply_credit')),
			page.locator('[data-deposit-panel]').getByRole('button', { name: 'Aplicar', exact: true }).click()
		]);
		await page.waitForLoadState('networkidle');
		expect(f.sql(`select status from public.patient_deposit_credits where patient_id='${patientId}';`)).toBe('applied');

		// 4. Mover apt2 a < 48h (24h): verificar pregunta obligatoria «¿Quién pidió el cambio?» (Decisión #1) + excepción por fuerza mayor al cancelar (y devuelve $ 40.000 reales, Decisión #3)
		f.sql(`update public.appointments set starts_at = now() + interval '24 hours', ends_at = now() + interval '25 hours', blocking_starts_at = now() + interval '24 hours', blocking_ends_at = now() + interval '25 hours' where id = '${apt2Id}';`);
		await page.goto(`${origin}/odonto/turnos/${apt2Id}`, { waitUntil: 'networkidle' });
		await page.locator('#reprogramar > summary').click();
		const requesterFieldset = page.locator('[data-reschedule-requester-fieldset]');
		await expect(requesterFieldset).toBeVisible();
		await expect(requesterFieldset).toContainText('¿Quién pidió el cambio?');
		await expect(requesterFieldset.locator('input[value="patient"]')).not.toBeChecked();
		await expect(requesterFieldset.locator('input[value="practice_or_force_majeure"]')).not.toBeChecked();

		const cancelPanel2 = page.locator('[data-cancel-panel]');
		await cancelPanel2.locator('> summary').click();
		await expect(cancelPanel2.locator('[data-force-majeure-credit]')).toBeVisible();

		await auditAndCapture('p4-turno-decision-y-fuerza-mayor', [320, 1280], ['light', 'dark'], {
			pageUrl: `${origin}/odonto/turnos/${apt2Id}`,
			afterLoad: async () => {
				await page.locator('#reprogramar > summary').click();
				await expect(page.locator('[data-reschedule-requester-fieldset]')).toBeVisible();
				await page.locator('[data-cancel-panel] > summary').click();
				await expect(page.locator('[data-force-majeure-credit]')).toBeVisible();
			},
			anchor: () => page.locator('[data-reschedule-requester-fieldset]')
		});

		// Cancelar con fuerza mayor -> devuelve los $ 40.000 realmente pagados (no $ 50.000)
		await page.goto(`${origin}/odonto/turnos/${apt2Id}`, { waitUntil: 'networkidle' });
		await page.locator('[data-cancel-panel] > summary').click();
		await page.locator('input[name="keep_deposit_as_credit"]').check();
		await page.locator('[data-cancel-panel]').getByLabel('Confirmo que quiero cancelar este turno.').check();
		await Promise.all([
			page.waitForResponse((res) => res.request().method() === 'POST' && res.url().includes('/update_status')),
			page.locator('[data-cancel-panel]').getByRole('button', { name: 'Cancelar turno' }).click()
		]);
		await page.waitForLoadState('networkidle');
		expect(f.sql(`select count(*) from public.patient_deposit_credits where patient_id='${patientId}' and status='available' and amount=40000 and reason='force_majeure';`)).toBe('1');

		expect(issues, 'layout usability issues').toEqual([]);
		await health.assertAndAttach(info, 'lote2b-e2e-health');
	} finally {
		const prevBiz = JSON.parse(bizSnapshot);
		const prevDp = prevDepositPolicy === 'null' ? null : JSON.parse(prevDepositPolicy);
		const esc = (v: string | null) => (v === null ? 'null' : `'${v.replaceAll("'", "''")}'`);
		const restoreDepositSql = prevDp
			? `insert into public.deposit_policies(business_id, enabled, auto_cancel_enabled, amount_mode, fixed_amount, percentage, request_days, deadline_hours, min_payment_hours, late_booking_payment_hours, expiring_reminder_hours, deposit_credit_cutoff_hours, transfer_details, applies_to_manual)
			   values ('${f.businessId}', ${prevDp.enabled}, ${prevDp.auto_cancel_enabled}, ${esc(prevDp.amount_mode)}, ${prevDp.fixed_amount ?? 'null'}, ${prevDp.percentage ?? 'null'}, ${prevDp.request_days}, ${prevDp.deadline_hours}, ${prevDp.min_payment_hours}, ${prevDp.late_booking_payment_hours ?? 'null'}, ${prevDp.expiring_reminder_hours ?? 'null'}, ${prevDp.deposit_credit_cutoff_hours ?? 'null'}, ${esc(prevDp.transfer_details)}, ${prevDp.applies_to_manual})
			   on conflict (business_id) do update set
			     enabled = excluded.enabled, auto_cancel_enabled = excluded.auto_cancel_enabled, amount_mode = excluded.amount_mode,
			     fixed_amount = excluded.fixed_amount, percentage = excluded.percentage, request_days = excluded.request_days,
			     deadline_hours = excluded.deadline_hours, min_payment_hours = excluded.min_payment_hours,
			     late_booking_payment_hours = excluded.late_booking_payment_hours,
			     expiring_reminder_hours = excluded.expiring_reminder_hours,
			     deposit_credit_cutoff_hours = excluded.deposit_credit_cutoff_hours,
			     transfer_details = excluded.transfer_details,
			     applies_to_manual = excluded.applies_to_manual;`
			: `delete from public.deposit_policies where business_id = '${f.businessId}';`;

		f.sql(`begin;
			delete from public.audit_logs where business_id='${f.businessId}' and (entity_id in ('${apt1Id}', '${apt2Id}', '${patientId}') or (entity_id='${f.businessId}' and action='business.deposit_policy_saved' and created_at>='${startedAt}'::timestamptz));
			delete from public.appointments where id in ('${apt1Id}', '${apt2Id}');
			delete from public.patient_deposit_credits where patient_id='${patientId}';
			delete from public.patient_profile_change_events where patient_id='${patientId}';
			delete from public.patients where id='${patientId}';
			${restoreDepositSql}
			update private.deposit_automation set enabled = ${prevDepositAutomation} where singleton;
			update public.businesses
			set public_booking_enabled = ${prevBiz.public_booking_enabled},
				public_contact_enabled = ${prevBiz.public_contact_enabled},
				whatsapp_contact_enabled = ${prevBiz.whatsapp_contact_enabled},
				whatsapp_phone = ${esc(prevBiz.whatsapp_phone)},
				phone = ${esc(prevBiz.phone)}
			where id = '${f.businessId}';
			commit;`);
	}
});
