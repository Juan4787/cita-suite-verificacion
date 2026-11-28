import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { must } from './helpers/fixture-db';
import { layoutIssues, type LayoutIssue } from './helpers/layout-usability';
import { ownedAppointmentFixture } from './helpers/owned-appointment-fixture';
import { observeRenderHealth } from './helpers/render-health';
import { loginWithSharedSession } from './helpers/shared-auth';
import { alignTaskForCapture } from './helpers/task-capture';
import { chooseTheme, contrastViolations, expectRenderedTheme } from './helpers/theme';

const addDaysIso = (isoDate: string, days: number) => {
	const value = new Date(`${isoDate}T12:00:00Z`);
	value.setUTCDate(value.getUTCDate() + days);
	return value.toISOString().slice(0, 10);
};

test('@candidate-behavior Lote 2A (P5, P2, P3): límite de autogestión, reservas tardías, acordeón de señas y marca de paciente', async ({ page }, info) => {
	test.setTimeout(240_000);
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
	const prevEmailPolicy = f.sql(
		`select jsonb_build_object(
			'email_enabled', email_enabled, 'require_email', require_email,
			'show_cancel', show_cancel, 'show_reschedule', show_reschedule,
			'require_deposit_on_reschedule', require_deposit_on_reschedule,
			'previous_deposit_disposition', previous_deposit_disposition,
			'self_management_cutoff_hours', self_management_cutoff_hours
		)::text from public.appointment_email_policies where business_id='${f.businessId}';`
	);
	const prevDepositPolicy = f.sql(
		`select coalesce((select jsonb_build_object(
			'enabled', enabled, 'auto_cancel_enabled', auto_cancel_enabled,
			'amount_mode', amount_mode, 'fixed_amount', fixed_amount, 'percentage', percentage,
			'request_days', request_days, 'deadline_hours', deadline_hours,
			'min_payment_hours', min_payment_hours, 'late_booking_payment_hours', late_booking_payment_hours,
			'transfer_details', transfer_details, 'applies_to_manual', applies_to_manual
		)::text from public.deposit_policies where business_id='${f.businessId}'), 'null');`
	);
	const prevDepositAutomation = f.sql('select enabled::text from private.deposit_automation where singleton;');
	const prevDefaultIntegrations = f.sql(
		`select coalesce((select jsonb_agg(id) from public.booking_integrations where business_id='${f.businessId}' and is_default), '[]'::jsonb)::text;`
	);
	const prevRulesSnapshot = f.sql(
		`select coalesce((select jsonb_agg(jsonb_build_object(
			'id', id, 'weekday', weekday, 'start_time', start_time::text, 'end_time', end_time::text,
			'slot_interval_minutes', slot_interval_minutes, 'break_minutes', break_minutes,
			'is_active', is_active, 'service_scope', service_scope
		)) from public.availability_rules where business_id='${f.businessId}' and professional_id='${assignment.professional_id}'), '[]'::jsonb)::text;`
	);

	const integrationId = randomUUID();
	const integrationKey = randomUUID().replaceAll('-', '');
	const patientExemptId = randomUUID();
	const patientNoEmailId = randomUUID();
	const aptInsideId = randomUUID();
	const aptInsideToken = (randomUUID() + randomUUID()).replaceAll('-', '');
	const aptCancelledNoEmailId = randomUUID();
	const aptCancelledToken = (randomUUID() + randomUUID()).replaceAll('-', '');
	const ruleIds = Array.from({ length: 7 }, () => randomUUID());

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
			embedUrl?: string;
			anchor?: () => ReturnType<typeof page.locator>;
			afterLoad?: () => Promise<void>;
		}
	) => {
		const targetGetUrl = options?.embedUrl ? null : cleanGetUrl(options?.pageUrl ?? page.url());
		for (const mode of modes) {
			if (targetGetUrl) {
				await chooseTheme(page, mode);
				await page.goto(targetGetUrl, { waitUntil: 'networkidle' });
				await expectRenderedTheme(page, mode);
				if (options?.afterLoad) await options.afterLoad();
			}
			for (const width of widths) {
				await page.setViewportSize({ width, height: 860 });
				if (options?.embedUrl) {
					await page.goto(`${options.embedUrl}&color_mode=${mode}`, { waitUntil: 'networkidle' });
					if (options?.afterLoad) await options.afterLoad();
				}
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
		if (targetGetUrl) {
			await chooseTheme(page, 'light');
		}
	};

	try {
		const prevBiz = JSON.parse(bizSnapshot) as {
			slug: string;
			timezone: string;
			phone: string | null;
			address: string | null;
			public_booking_enabled: boolean;
			allow_same_day_booking: boolean;
			public_contact_enabled: boolean;
			whatsapp_contact_enabled: boolean;
			whatsapp_phone: string | null;
			max_booking_days_ahead: number;
			min_booking_notice_minutes: number;
		};
		const todayLocal = f.sql(`select (now() at time zone '${prevBiz.timezone}')::date::text;`);
		const day4 = addDaysIso(todayLocal, 4);
		const day1 = addDaysIso(todayLocal, 1);

		const ruleRowsSql = ruleIds
			.map(
				(id, weekday) =>
					`('${id}', '${f.businessId}', '${assignment.professional_id}', ${weekday}, '09:00', '12:00', 60, 0, true, 'all')`
			)
			.join(', ');

		f.sql(`begin;
			update private.deposit_automation set enabled = true where singleton;
			update public.businesses
			set public_booking_enabled = true,
				allow_same_day_booking = true,
				public_contact_enabled = true,
				whatsapp_contact_enabled = true,
				whatsapp_phone = '+5493415550199',
				phone = '+54 341 555-0199',
				address = coalesce(address, 'Av. Prueba 123'),
				min_booking_notice_minutes = 0,
				max_booking_days_ahead = 60
			where id = '${f.businessId}';
			update public.services set is_active = true, is_public = true where id = '${assignment.service_id}';
			update public.professionals set is_active = true, is_public = true where id = '${assignment.professional_id}';
			delete from public.availability_rules where business_id = '${f.businessId}' and professional_id = '${assignment.professional_id}';
			insert into public.availability_rules(id, business_id, professional_id, weekday, start_time, end_time, slot_interval_minutes, break_minutes, is_active, service_scope)
			values ${ruleRowsSql};
			update public.booking_integrations set is_default = false where business_id = '${f.businessId}' and is_default;
			insert into public.booking_integrations(
				id, business_id, public_key, name, theme, is_active, is_default,
				allowed_origins, allowed_service_ids, allowed_professional_ids,
				allowed_modalities, video_instructions, intake_schema, modality_windows
			) values (
				'${integrationId}', '${f.businessId}', '${integrationKey}', 'Web Natalia Lote 2A', 'natalia', true, true,
				array['https://natalia-lote2a.example.test'], array['${assignment.service_id}'::uuid], array['${assignment.professional_id}'::uuid],
				array['in_person'], null, '[]'::jsonb, '[]'::jsonb
			);
			insert into public.patients(id, business_id, owner_id, full_name, phone_e164, email)
			values
				('${patientExemptId}', '${f.businessId}', '${owner}', 'Paciente Exento Lote 2A', '+5493415550201', 'exento-l2a@example.test'),
				('${patientNoEmailId}', '${f.businessId}', '${owner}', 'Paciente Sin Correo Lote 2A', '+5493415550202', null);
			commit;`);

		// 1. P5 en /odonto/configuracion/correo: guardar límite 48 h
		await loginWithSharedSession(page, { email: f.email, password: f.password });
		await page.goto(origin + '/odonto/configuracion/correo', { waitUntil: 'networkidle' });
		const cutoffInput = page.locator('input[name="self_management_cutoff_hours"]');
		await cutoffInput.fill('48');
		await Promise.all([
			page.waitForResponse((res) => res.request().method() === 'POST' && res.url().includes('/odonto/configuracion/correo')),
			page.getByRole('button', { name: 'Guardar preferencias' }).click()
		]);
		await expect(page.getByText('Se guardaron las preferencias de correo.')).toBeVisible();
		await page.goto(origin + '/odonto/configuracion/correo', { waitUntil: 'networkidle' });
		await expect(page.locator('input[name="self_management_cutoff_hours"]')).toHaveValue('48');

		// 2. P2 en /odonto/configuracion/senas: configurar Natalia (168h / 48h / 24h), abrir acordeón y verificar ejemplos
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
		await page.locator('textarea[name="transfer_details"]').fill('Alias prueba.lote2a');

		// Verificar acordeón desplegable con teclado (Enter)
		const accordionSummary = page.locator('[data-deposit-examples-accordion] > summary');
		await accordionSummary.focus();
		await page.keyboard.press('Enter');
		const accordion = page.locator('[data-deposit-examples-accordion]');
		await expect(accordion).toHaveAttribute('open', '');
		await expect(accordion).toContainText(/más de una semana/i);
		await expect(accordion).toContainText(/7\s*días/i);
		await expect(accordion).toContainText(/entre 3 y 7 días/i);
		await expect(accordion).toContainText(/menos de 72 horas/i);
		await expect(accordion).toContainText(/no se cancela solo/i);

		await Promise.all([
			page.waitForResponse((res) => res.request().method() === 'POST' && res.url().includes('/odonto/configuracion/senas')),
			page.getByRole('button', { name: 'Guardar' }).click()
		]);
		await expect(page.getByText(/Configuración de señas guardada/i)).toBeVisible();
		await auditAndCapture('p2-config-senas-acordeon', [320, 390, 768, 1280], ['light', 'dark'], {
			afterLoad: async () => {
				const details = page.locator('[data-deposit-examples-accordion]');
				await details.locator('> summary').click();
				await expect(details).toHaveAttribute('open', '');
			},
			anchor: () => page.locator('[data-deposit-examples-accordion]')
		});

		// 3. P2 + P5 en paso 5 de reserva: Cita Suite y Natalia (4 días antes vs 1 día antes)
		const baseQuery = `service_id=${assignment.service_id}&professional_id=${assignment.professional_id}`;
		await page.setViewportSize({ width: 1280, height: 860 });
		await chooseTheme(page, 'light');
		await page.goto(`${origin}/reservar/${prevBiz.slug}?${baseQuery}&date=${day4}`, { waitUntil: 'networkidle' });
		const slot4Href = await page.locator('main a[href*="slot="]').first().getAttribute('href');
		expect(slot4Href).toBeTruthy();
		const slot4 = new URL(slot4Href!, origin).searchParams.get('slot')!;

		const citaSuite4dUrl = `${origin}/reservar/${prevBiz.slug}?${baseQuery}&date=${day4}&slot=${encodeURIComponent(slot4)}`;
		await page.goto(citaSuite4dUrl, { waitUntil: 'networkidle' });
		await expect(page.locator('[data-deposit-notice]')).toContainText(/se cancela automáticamente/i);
		await expect(page.locator('[data-self-management-notice]')).toContainText(/48\s*horas antes/i);
		await auditAndCapture('p2-p5-cita-suite-4d', [320, 390, 768, 1280], ['light', 'dark'], {
			anchor: () => page.locator('[data-deposit-notice]')
		});

		const natalia4dUrl = `${origin}/embed/v1/${integrationKey}?${baseQuery}&date=${day4}&slot=${encodeURIComponent(slot4)}`;
		await page.goto(`${natalia4dUrl}&color_mode=light`, { waitUntil: 'networkidle' });
		await expect(page.locator('[data-deposit-notice]')).toContainText(/se cancela automáticamente/i);
		await expect(page.locator('[data-self-management-notice]')).toContainText(/48\s*horas antes/i);
		await auditAndCapture('p2-p5-natalia-4d', [320, 390, 768, 1280], ['light', 'dark'], {
			embedUrl: natalia4dUrl,
			anchor: () => page.locator('[data-deposit-notice]')
		});

		// Slot dentro de 48 h (día 1): no promete cancelación automática + avisa sin autogestión online
		await page.setViewportSize({ width: 1280, height: 860 });
		await page.goto(`${origin}/reservar/${prevBiz.slug}?${baseQuery}&date=${day1}`, { waitUntil: 'networkidle' });
		const slot1Href = await page.locator('main a[href*="slot="]').first().getAttribute('href');
		expect(slot1Href).toBeTruthy();
		const slot1 = new URL(slot1Href!, origin).searchParams.get('slot')!;
		await page.goto(`${origin}/reservar/${prevBiz.slug}?${baseQuery}&date=${day1}&slot=${encodeURIComponent(slot1)}`, { waitUntil: 'networkidle' });
		await expect(page.locator('[data-deposit-notice]')).not.toContainText(/cancela automáticamente/i);
		await expect(page.locator('[data-self-management-notice]')).toContainText(/no se podrá cancelar ni reprogramar online/i);

		// 4. P3 en ficha del paciente + P5 en /turno/[token] + P2 en /odonto/senas (sin correo)
		f.sql(`begin;
			insert into public.appointments(
				id, business_id, patient_id, service_id, professional_id,
				starts_at, ends_at, blocking_starts_at, blocking_ends_at,
				status, source, confirmation_token,
				service_name_snapshot, professional_name_snapshot, duration_minutes_snapshot
			) values
				('${aptInsideId}', '${f.businessId}', '${patientExemptId}', '${assignment.service_id}', '${assignment.professional_id}',
				 now() + interval '24 hours', now() + interval '25 hours', now() + interval '24 hours', now() + interval '25 hours',
				 'reserved', 'manual', '${aptInsideToken}', 'Primera consulta', 'Prof Prueba', 60),
				('${aptCancelledNoEmailId}', '${f.businessId}', '${patientNoEmailId}', '${assignment.service_id}', '${assignment.professional_id}',
				 now() + interval '96 hours', now() + interval '97 hours', now() + interval '96 hours', now() + interval '97 hours',
				 'reserved', 'manual', '${aptCancelledToken}', 'Primera consulta', 'Prof Prueba', 60);
			-- Forzar vencimiento de aptCancelledNoEmailId para probar aviso «Sin correo» en /odonto/senas
			update public.appointment_deposits set due_at = now() - interval '10 minutes', auto_cancel = true where appointment_id = '${aptCancelledNoEmailId}';
			select private.expire_deposit_if_still_due('${aptCancelledNoEmailId}', now());
			commit;`);

		// Activar marca P3 desde la ficha del paciente (tab Datos)
		await page.setViewportSize({ width: 1280, height: 860 });
		await page.goto(`${origin}/odonto/pacientes/${patientExemptId}?tab=datos`, { waitUntil: 'networkidle' });
		const exemptionCard = page.locator('[data-patient-deposit-exemption]');
		await expect(exemptionCard).toBeVisible();
		const exemptionCheckbox = exemptionCard.getByRole('checkbox', { name: 'No cancelar sus turnos por seña impaga' });
		await expect(exemptionCheckbox).not.toBeChecked();
		await exemptionCheckbox.check();
		await Promise.all([
			page.waitForResponse((res) => res.request().method() === 'POST' && res.url().includes(`/odonto/pacientes/${patientExemptId}`)),
			exemptionCard.getByRole('button', { name: 'Guardar' }).click()
		]);
		await page.waitForLoadState('networkidle');
		await expect(page.locator('[data-patient-deposit-exemption]').getByRole('checkbox', { name: 'No cancelar sus turnos por seña impaga' })).toBeChecked();
		await expect(page.locator('[data-exemption-audit]')).toContainText(/Último cambio:/i);
		await auditAndCapture('p3-ficha-paciente', [320, 1280], ['light', 'dark'], {
			pageUrl: `${origin}/odonto/pacientes/${patientExemptId}?tab=datos`,
			anchor: () => page.locator('[data-patient-deposit-exemption]')
		});

		// Verificar /odonto/senas: badge «Sin correo: avisar por WhatsApp» en cancelada sin correo
		await page.goto(`${origin}/odonto/senas`, { waitUntil: 'networkidle' });
		const cancelledRow = page.locator(`[data-deposit-row="${aptCancelledNoEmailId}"]`);
		await expect(cancelledRow).toBeVisible();
		await expect(cancelledRow).toContainText('Sin correo: avisar por WhatsApp');
		await expect(cancelledRow.getByRole('button', { name: 'Avisar a la persona' })).toBeVisible();
		await auditAndCapture('p2-senas-sin-correo', [320, 1280], ['light', 'dark'], {
			anchor: () => page.locator(`[data-deposit-row="${aptCancelledNoEmailId}"]`)
		});

		// Verificar /turno/[token] dentro de ventana P5: oculta Cancelar/Reprogramar y muestra aviso + WhatsApp
		await page.goto(`${origin}/turno/${aptInsideToken}`, { waitUntil: 'networkidle' });
		await expect(page.locator('[data-self-management-closed-notice]')).toBeVisible();
		await expect(page.getByRole('link', { name: 'Cancelar turno' })).toHaveCount(0);
		await expect(page.getByRole('link', { name: 'Reprogramar turno' })).toHaveCount(0);
		await expect(page.locator('[data-deposit-card]')).not.toContainText(/cancela automáticamente/i);
		await auditAndCapture('p5-turno-ventana-cerrada', [320, 390, 768, 1280], ['light', 'dark'], {
			anchor: () => page.locator('[data-self-management-closed-notice]')
		});

		expect(issues, 'layout usability issues').toEqual([]);
		await health.assertAndAttach(info, 'lote2a-e2e-health');
	} finally {
		const prevBiz = JSON.parse(bizSnapshot);
		const prevEp = JSON.parse(prevEmailPolicy);
		const prevDp = prevDepositPolicy === 'null' ? null : JSON.parse(prevDepositPolicy);
		const prevDefaults = JSON.parse(prevDefaultIntegrations) as string[];
		const prevRules = JSON.parse(prevRulesSnapshot) as Array<{
			id: string;
			weekday: number;
			start_time: string;
			end_time: string;
			slot_interval_minutes: number;
			break_minutes: number;
			is_active: boolean;
			service_scope: string;
		}>;
		const esc = (v: string | null) => (v === null ? 'null' : `'${v.replaceAll("'", "''")}'`);
		const restoreRulesSql = prevRules.length
			? `insert into public.availability_rules(id, business_id, professional_id, weekday, start_time, end_time, slot_interval_minutes, break_minutes, is_active, service_scope) values ${prevRules
					.map(
						(r) =>
							`('${r.id}', '${f.businessId}', '${assignment.professional_id}', ${r.weekday}, '${r.start_time}'::time, '${r.end_time}'::time, ${r.slot_interval_minutes}, ${r.break_minutes}, ${r.is_active}, '${r.service_scope}')`
					)
					.join(', ')};`
			: '';
		const restoreDefaultsSql = prevDefaults.length
			? `update public.booking_integrations set is_default = true where id in (${prevDefaults.map((id) => `'${id}'`).join(', ')});`
			: '';
		const restoreDepositSql = prevDp
			? `insert into public.deposit_policies(business_id, enabled, auto_cancel_enabled, amount_mode, fixed_amount, percentage, request_days, deadline_hours, min_payment_hours, late_booking_payment_hours, transfer_details, applies_to_manual)
			   values ('${f.businessId}', ${prevDp.enabled}, ${prevDp.auto_cancel_enabled}, ${esc(prevDp.amount_mode)}, ${prevDp.fixed_amount ?? 'null'}, ${prevDp.percentage ?? 'null'}, ${prevDp.request_days}, ${prevDp.deadline_hours}, ${prevDp.min_payment_hours}, ${prevDp.late_booking_payment_hours ?? 'null'}, ${esc(prevDp.transfer_details)}, ${prevDp.applies_to_manual})
			   on conflict (business_id) do update set
			     enabled = excluded.enabled, auto_cancel_enabled = excluded.auto_cancel_enabled, amount_mode = excluded.amount_mode,
			     fixed_amount = excluded.fixed_amount, percentage = excluded.percentage, request_days = excluded.request_days,
			     deadline_hours = excluded.deadline_hours, min_payment_hours = excluded.min_payment_hours,
			     late_booking_payment_hours = excluded.late_booking_payment_hours, transfer_details = excluded.transfer_details,
			     applies_to_manual = excluded.applies_to_manual;`
			: `delete from public.deposit_policies where business_id = '${f.businessId}';`;

		f.sql(`begin;
			delete from public.appointments where id in ('${aptInsideId}', '${aptCancelledNoEmailId}');
			delete from public.patient_profile_change_events where patient_id in ('${patientExemptId}', '${patientNoEmailId}');
			delete from public.patients where id in ('${patientExemptId}', '${patientNoEmailId}');
			delete from public.booking_integrations where id = '${integrationId}';
			${restoreDefaultsSql}
			delete from public.availability_rules where business_id = '${f.businessId}' and professional_id = '${assignment.professional_id}';
			${restoreRulesSql}
			${restoreDepositSql}
			update private.deposit_automation set enabled = ${prevDepositAutomation} where singleton;
			update public.appointment_email_policies
			set email_enabled = ${prevEp.email_enabled},
				require_email = ${prevEp.require_email},
				show_cancel = ${prevEp.show_cancel},
				show_reschedule = ${prevEp.show_reschedule},
				require_deposit_on_reschedule = ${prevEp.require_deposit_on_reschedule},
				previous_deposit_disposition = ${esc(prevEp.previous_deposit_disposition)},
				self_management_cutoff_hours = ${prevEp.self_management_cutoff_hours ?? 'null'}
			where business_id = '${f.businessId}';
			update public.businesses
			set public_booking_enabled = ${prevBiz.public_booking_enabled},
				allow_same_day_booking = ${prevBiz.allow_same_day_booking},
				public_contact_enabled = ${prevBiz.public_contact_enabled},
				whatsapp_contact_enabled = ${prevBiz.whatsapp_contact_enabled},
				whatsapp_phone = ${esc(prevBiz.whatsapp_phone)},
				phone = ${esc(prevBiz.phone)},
				address = ${esc(prevBiz.address)},
				max_booking_days_ahead = ${prevBiz.max_booking_days_ahead},
				min_booking_notice_minutes = ${prevBiz.min_booking_notice_minutes}
			where id = '${f.businessId}';
			commit;`);
	}
});
