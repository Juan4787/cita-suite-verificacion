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

test('@candidate-behavior Lote 1 (P6, P7, P9, P10): horizonte 365d, leyenda estimada, Meet vivo, correo de contacto y «¿No tenés correo?»', async ({ page }, info) => {
	test.setTimeout(240_000);
	const f = ownedAppointmentFixture();
	const origin = new URL(process.env.E2E_BASE_URL!).origin;
	const owner = f.sql(`select user_id from public.business_users where business_id='${f.businessId}' and role='owner' and status='active' limit 1;`);
	const assignment = await must(
		f.admin.from('professional_services').select('service_id,professional_id').eq('business_id', f.businessId).limit(1).single()
	);
	const bizSnapshot = f.sql(
		`select jsonb_build_object(
			'slug', slug, 'timezone', timezone, 'email', email, 'phone', phone, 'address', address,
			'public_booking_enabled', public_booking_enabled, 'allow_same_day_booking', allow_same_day_booking,
			'public_contact_enabled', public_contact_enabled, 'whatsapp_contact_enabled', whatsapp_contact_enabled,
			'whatsapp_phone', whatsapp_phone, 'max_booking_days_ahead', max_booking_days_ahead,
			'min_booking_notice_minutes', min_booking_notice_minutes
		)::text from public.businesses where id='${f.businessId}';`
	);
	const prevProducer = f.sql('select email_producer_enabled::text from private.appointment_management_runtime where singleton;');
	const prevPolicy = f.sql(
		`select jsonb_build_object('email_enabled', email_enabled, 'sender_verified', sender_verified, 'require_email', require_email)::text from public.appointment_email_policies where business_id='${f.businessId}';`
	);
	const prevSender = f.sql(
		`select coalesce((select jsonb_build_object('sending_domain', sending_domain, 'domain_state', domain_state, 'provider_domain_key', provider_domain_key, 'reply_to_email', reply_to_email)::text from private.business_email_senders where business_id='${f.businessId}'), 'null');`
	);
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
	const prevPricePoliciesSnapshot = f.sql(
		`select coalesce((select jsonb_agg(jsonb_build_object(
			'id', id, 'professional_id', professional_id, 'base_amount', base_amount, 'currency', currency,
			'base_month', base_month::text, 'first_adjustment_month', first_adjustment_month::text,
			'monthly_percentage', monthly_percentage, 'rounding_unit', rounding_unit
		)) from public.service_price_policies where business_id='${f.businessId}' and service_id='${assignment.service_id}'), '[]'::jsonb)::text;`
	);

	const integrationId = randomUUID();
	const integrationKey = randomUUID().replaceAll('-', '');
	const pricePolicyId = randomUUID();
	const patientId = randomUUID();
	const virtualAptId = randomUUID();
	const virtualToken = (randomUUID() + randomUUID()).replaceAll('-', '');
	const ruleIds = Array.from({ length: 7 }, () => randomUUID());

	const health = await observeRenderHealth(page);
	const issues: LayoutIssue[] = [];

	try {
		const prevBiz = JSON.parse(bizSnapshot) as {
			slug: string;
			timezone: string;
			email: string | null;
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
		const day365 = addDaysIso(todayLocal, 365);
		const day366 = addDaysIso(todayLocal, 366);
		const nearDate = addDaysIso(todayLocal, 2);
		const baseMonth = `${todayLocal.slice(0, 7)}-01`;
		const nextMonthDate = new Date(`${baseMonth}T12:00:00Z`);
		nextMonthDate.setUTCMonth(nextMonthDate.getUTCMonth() + 1);
		const firstAdjMonth = nextMonthDate.toISOString().slice(0, 10);

		const ruleRowsSql = ruleIds
			.map(
				(id, weekday) =>
					`('${id}', '${f.businessId}', '${assignment.professional_id}', ${weekday}, '09:00', '12:00', 60, 0, true, 'all')`
			)
			.join(', ');

		f.sql(`begin;
			update private.appointment_management_runtime set email_producer_enabled = true;
			select public.operator_set_business_email_sender('${f.businessId}', 'lote1-e2e-${f.businessId.slice(0, 8)}.cita-suite.com.ar', 'verified');
			update public.appointment_email_policies set email_enabled = true, require_email = true where business_id = '${f.businessId}';
			update public.businesses
			set public_booking_enabled = true,
				allow_same_day_booking = true,
				public_contact_enabled = true,
				whatsapp_contact_enabled = true,
				whatsapp_phone = '+5493415550199',
				phone = '+54 341 555-0199',
				address = coalesce(address, 'Av. Prueba 123'),
				min_booking_notice_minutes = 0
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
				'${integrationId}', '${f.businessId}', '${integrationKey}', 'Web Natalia Lote 1', 'natalia', true, true,
				array['https://natalia-lote1.example.test'], array['${assignment.service_id}'::uuid], array['${assignment.professional_id}'::uuid],
				array['in_person', 'video'], 'Conectate en https://meet.google.com/viejo-meet-e2e', '[]'::jsonb, '[]'::jsonb
			);
			delete from public.service_price_policies where business_id = '${f.businessId}' and service_id = '${assignment.service_id}';
			insert into public.service_price_policies(id, business_id, service_id, professional_id, base_amount, currency, base_month, first_adjustment_month, monthly_percentage, rounding_unit)
			values ('${pricePolicyId}', '${f.businessId}', '${assignment.service_id}', null, 32000, 'ARS', '${baseMonth}'::date, '${firstAdjMonth}'::date, 5, 100);
			insert into public.patients(id, business_id, owner_id, full_name, phone_e164, email)
			values ('${patientId}', '${f.businessId}', '${owner}', 'Paciente Virtual Lote Uno', '+5493415550188', 'virtual-lote1@example.test');
			insert into public.appointments(
				id, business_id, patient_id, service_id, professional_id,
				starts_at, ends_at, blocking_starts_at, blocking_ends_at,
				status, source, confirmation_token,
				service_name_snapshot, professional_name_snapshot, duration_minutes_snapshot
			) values (
				'${virtualAptId}', '${f.businessId}', '${patientId}', '${assignment.service_id}', '${assignment.professional_id}',
				((('${day365}'::date)::timestamp + time '10:00') at time zone '${prevBiz.timezone}'),
				((('${day365}'::date)::timestamp + time '11:00') at time zone '${prevBiz.timezone}'),
				((('${day365}'::date)::timestamp + time '10:00') at time zone '${prevBiz.timezone}'),
				((('${day365}'::date)::timestamp + time '11:00') at time zone '${prevBiz.timezone}'),
				'reserved', 'manual', '${virtualToken}',
				'Primera consulta', 'Dra. Prueba', 60
			);
			insert into public.appointment_booking_contexts(
				appointment_id, business_id, integration_id, integration_revision, contract_version,
				theme_snapshot, entry_point, modality, video_instructions_snapshot, context_fingerprint
			) values (
				'${virtualAptId}', '${f.businessId}', '${integrationId}', 1, 1,
				'natalia', 'public_page', 'video', 'Conectate en https://meet.google.com/viejo-meet-e2e', repeat('a', 64)
			);
			commit;`);

		// 1. P6 y P9 en pantallas de configuración + API de contacto público
		await loginWithSharedSession(page, { email: f.email, password: f.password });
		await page.goto(origin + '/odonto/configuracion/reserva-online');
		await expect(page.locator('select[name="max_booking_days_ahead"] option[value="365"]')).toHaveText('Hasta un año');
		await page.locator('select[name="max_booking_days_ahead"]').selectOption('365', { force: true });
		await page.getByRole('button', { name: 'Guardar reglas' }).click();
		await expect(page.getByText('Reglas de reserva guardadas.')).toBeVisible();

		await page.goto(origin + '/odonto/configuracion/negocio');
		await page.locator('input[name="email"]').fill('contacto-lote1@consultorio.test');
		await page.getByRole('button', { name: 'Guardar' }).click();
		await expect(page.getByText('Consultorio guardado.')).toBeVisible();

		const contactOnRes = await page.request.get(`${origin}/api/public/contacto/${integrationKey}`, {
			headers: { origin: 'https://natalia-lote1.example.test' }
		});
		expect(contactOnRes.status()).toBe(200);
		expect(await contactOnRes.json()).toMatchObject({ contact: { email: 'contacto-lote1@consultorio.test' } });

		f.sql(`update public.businesses set public_contact_enabled = false where id = '${f.businessId}';`);
		const contactOffRes = await page.request.get(`${origin}/api/public/contacto/${integrationKey}`, {
			headers: { origin: 'https://natalia-lote1.example.test' }
		});
		expect(contactOffRes.status()).toBe(200);
		expect(await contactOffRes.json()).toMatchObject({ contact: { email: null } });
		f.sql(`update public.businesses set public_contact_enabled = true where id = '${f.businessId}';`);

		// 2. P7 + P6 en /turno/[token]: actualiza el enlace Meet en vivo, escapa HTML y muestra leyenda de valor estimado
		f.sql(
			`update public.booking_integrations set video_instructions = 'Enlace vigente: https://meet.google.com/nuevo-meet-e2e. <script>alert(1)</script> http://inseguro.test' where id = '${integrationId}';`
		);
		await page.goto(`${origin}/turno/${virtualToken}`);
		const meetLink = page.getByRole('link', { name: 'https://meet.google.com/nuevo-meet-e2e' });
		await expect(meetLink).toBeVisible();
		await expect(meetLink).toHaveAttribute('href', 'https://meet.google.com/nuevo-meet-e2e');
		await expect(page.getByRole('link', { name: /http:\/\/inseguro\.test/ })).toHaveCount(0);
		await expect(page.locator('main')).toContainText('<script>alert(1)</script>');
		await expect(page.locator('main')).toContainText(/valor estimado/i);
		await expect(page.locator('main')).toContainText(/puede actualizarse/i);

		// 3. P6 en /reservar/[slug]: día 365 disponible con leyenda estimada, día 366 sin disponibilidad
		const baseQuery = `service_id=${assignment.service_id}&professional_id=${assignment.professional_id}`;
		await page.goto(`${origin}/reservar/${prevBiz.slug}?${baseQuery}&date=${day365}`);
		await expect(page.getByRole('heading', { name: 'Elegí un horario' })).toBeVisible();
		await expect(page.locator('main')).toContainText(/valor estimado/i);
		await expect(page.locator('main')).toContainText('contacto-lote1@consultorio.test');

		const firstSlotHref = await page.locator('main a[href*="slot="]').first().getAttribute('href');
		expect(firstSlotHref).toBeTruthy();
		const chosenSlot = new URL(firstSlotHref!, origin).searchParams.get('slot')!;

		await page.goto(`${origin}/reservar/${prevBiz.slug}?${baseQuery}&date=${day366}`);
		await expect(page.getByText('No hay horarios para ese día. Probá con otro día.')).toBeVisible();

		// 4. P10: interacción real, preservación de datos, error sin correo, teclado, tamaño, contraste y área táctil
		const citaSuiteStep5 = `${origin}/reservar/${prevBiz.slug}?${baseQuery}&date=${day365}&slot=${encodeURIComponent(chosenSlot)}&modality=video`;
		const nataliaStep5 = `${origin}/embed/v1/${integrationKey}?${baseQuery}&date=${day365}&slot=${encodeURIComponent(chosenSlot)}&modality=video`;

		await page.setViewportSize({ width: 390, height: 850 });
		await chooseTheme(page, 'light');
		await page.goto(citaSuiteStep5, { waitUntil: 'networkidle' });

		const trigger = page.getByRole('button', { name: '¿No tenés correo?' });
		await expect(trigger).toBeVisible();
		const metrics = await trigger.evaluate((el) => {
			const rect = el.getBoundingClientRect();
			const style = getComputedStyle(el);
			return {
				width: rect.width,
				height: rect.height,
				fontSize: parseFloat(style.fontSize),
				backgroundColor: style.backgroundColor,
				textDecorationLine: style.textDecorationLine,
				color: style.color
			};
		});
		expect(metrics.fontSize).toBeGreaterThanOrEqual(14);
		expect(metrics.fontSize).toBeLessThanOrEqual(16);
		expect(metrics.width).toBeGreaterThanOrEqual(44);
		expect(metrics.height).toBeGreaterThanOrEqual(44);
		expect(metrics.backgroundColor).toMatch(/rgba?\(0,\s*0,\s*0,\s*0\)|transparent/);
		expect(metrics.textDecorationLine).toContain('underline');

		// Escribir nombre, abrir con teclado, verificar preservación y mensaje armado
		await page.getByLabel('Nombre y apellido').fill('Marta Gómez');
		await trigger.focus();
		await expect(trigger).toBeFocused();
		await page.keyboard.press('Enter');
		await expect(trigger).toHaveAttribute('aria-expanded', 'true');
		await expect(page.getByLabel('Nombre y apellido')).toHaveValue('Marta Gómez');

		const waLink = page.getByRole('link', { name: 'Pedir turno por WhatsApp' });
		await expect(waLink).toBeVisible();
		await expect(waLink).toHaveAttribute('target', '_blank');
		const waUrl = new URL((await waLink.getAttribute('href')) ?? 'https://invalid.test');
		const waText = waUrl.searchParams.get('text') ?? '';
		expect(waText).toContain('Marta Gómez');
		expect(waText).toContain('Virtual');
		await expect(page.locator('#patient-no-email-panel')).toContainText(/correo de un familiar/i);
		await expect(page.locator('#patient-no-email-panel')).toContainText(/no queda reservado hasta que el consultorio/i);

		// Cerrar el despliegue y enviar con correo vacío -> respaldo en error asociado al campo
		await trigger.click();
		await expect(trigger).toHaveAttribute('aria-expanded', 'false');
		await page.getByLabel('Teléfono de contacto').fill('3415550101');
		await page.getByRole('button', { name: 'Confirmar reserva' }).click();
		const emailAlert = page.locator('#patient-email-missing-error');
		await expect(emailAlert).toBeVisible();
		await expect(emailAlert).toContainText(/correo de un familiar/i);
		await expect(emailAlert.getByRole('link', { name: 'Pedir turno por WhatsApp' })).toBeVisible();
		await expect(page.getByLabel('Correo electrónico')).toHaveAttribute('aria-invalid', 'true');
		expect((await page.getByLabel('Correo electrónico').getAttribute('aria-describedby')) ?? '').toContain('patient-email-missing-error');

		// 5. P10 matriz completa de anchos, modos claro/oscuro y temas Cita Suite + Natalia
		const widths = [320, 360, 390, 414, 430, 768, 1280];
		for (const surface of ['cita-suite', 'natalia'] as const) {
			for (const theme of ['light', 'dark'] as const) {
				if (surface === 'cita-suite') await chooseTheme(page, theme);
				for (const width of widths) {
					await page.setViewportSize({ width, height: 850 });
					const targetUrl = surface === 'cita-suite' ? citaSuiteStep5 : `${nataliaStep5}&color_mode=${theme}`;
					await page.goto(targetUrl, { waitUntil: 'networkidle' });
					if (surface === 'cita-suite') await expectRenderedTheme(page, theme);
					const btn = page.getByRole('button', { name: '¿No tenés correo?' });
					await btn.click();
					await expect(page.locator('#patient-no-email-panel')).toBeVisible();
					expect((await contrastViolations(page)).violations).toEqual([]);
					issues.push(...(await layoutIssues(page, 'main a:visible, main button:visible', 'main')));
					if (width === 320 || width === 390 || width === 768 || width === 1280) {
						await alignTaskForCapture(btn);
						await page.screenshot({
							path: info.outputPath(`p10-${surface}-${theme}-${width}.jpg`),
							type: 'jpeg',
							quality: 60
						});
					}
				}
			}
		}

		// Confirmar también que una fecha en el mes actual (sin ajuste) NO muestra leyenda estimada
		if (nearDate.slice(0, 7) === todayLocal.slice(0, 7)) {
			await page.setViewportSize({ width: 1280, height: 850 });
			await chooseTheme(page, 'light');
			await page.goto(`${origin}/reservar/${prevBiz.slug}?${baseQuery}&date=${nearDate}`);
			await expect(page.getByRole('heading', { name: 'Elegí un horario' })).toBeVisible();
			await expect(page.locator('main')).not.toContainText(/valor estimado/i);
		}

		expect(issues).toEqual([]);
		await health.assertAndAttach(info, 'lote1-e2e-health');
	} finally {
		const prevBiz = JSON.parse(bizSnapshot) as {
			email: string | null;
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
		const policy = JSON.parse(prevPolicy) as { email_enabled: boolean; sender_verified: boolean; require_email: boolean };
		const sender = JSON.parse(prevSender) as { sending_domain: string | null; domain_state: string; provider_domain_key: string | null; reply_to_email: string | null } | null;
		const prevDefaults = JSON.parse(prevDefaultIntegrations) as string[];
		const sqlLit = (v: string | null) => (v === null ? 'null' : `'${v.replaceAll("'", "''")}'`);
		const restoreSenderSql = sender && sender.sending_domain
			? `select public.operator_set_business_email_sender('${f.businessId}', ${sqlLit(sender.sending_domain)}, ${sqlLit(sender.domain_state)}, ${sqlLit(sender.provider_domain_key)}, ${sqlLit(sender.reply_to_email)});`
			: `delete from private.business_email_senders where business_id='${f.businessId}';`;
		const restoreDefaultsSql = prevDefaults.length
			? `update public.booking_integrations set is_default = true where id in (${prevDefaults.map((id) => `'${id}'::uuid`).join(',')});`
			: '';
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
		const restoreRulesSql = prevRules.length
			? `insert into public.availability_rules(id, business_id, professional_id, weekday, start_time, end_time, slot_interval_minutes, break_minutes, is_active, service_scope) values ${prevRules
					.map(
						(r) =>
							`('${r.id}', '${f.businessId}', '${assignment.professional_id}', ${r.weekday}, '${r.start_time}', '${r.end_time}', ${r.slot_interval_minutes}, ${r.break_minutes}, ${r.is_active}, ${sqlLit(r.service_scope)})`
					)
					.join(', ')};`
			: '';
		const prevPolicies = JSON.parse(prevPricePoliciesSnapshot) as Array<{
			id: string;
			professional_id: string | null;
			base_amount: number;
			currency: string;
			base_month: string;
			first_adjustment_month: string;
			monthly_percentage: number;
			rounding_unit: number;
		}>;
		const restorePoliciesSql = prevPolicies.length
			? `insert into public.service_price_policies(id, business_id, service_id, professional_id, base_amount, currency, base_month, first_adjustment_month, monthly_percentage, rounding_unit) values ${prevPolicies
					.map(
						(p) =>
							`('${p.id}', '${f.businessId}', '${assignment.service_id}', ${p.professional_id ? `'${p.professional_id}'::uuid` : 'null'}, ${p.base_amount}, ${sqlLit(p.currency)}, '${p.base_month}'::date, '${p.first_adjustment_month}'::date, ${p.monthly_percentage}, ${p.rounding_unit})`
					)
					.join(', ')};`
			: '';
		f.sql(`begin;
			delete from private.appointment_email_events where business_id='${f.businessId}' and appointment_id='${virtualAptId}';
			delete from public.appointments where business_id='${f.businessId}' and id='${virtualAptId}';
			delete from public.patients where business_id='${f.businessId}' and id='${patientId}';
			delete from public.service_price_policies where business_id='${f.businessId}' and service_id='${assignment.service_id}';
			${restorePoliciesSql}
			delete from public.availability_rules where business_id='${f.businessId}' and professional_id='${assignment.professional_id}';
			${restoreRulesSql}
			delete from public.booking_integrations where business_id='${f.businessId}' and id='${integrationId}';
			${restoreDefaultsSql}
			update public.businesses
			set email=${sqlLit(prevBiz.email)}, phone=${sqlLit(prevBiz.phone)}, address=${sqlLit(prevBiz.address)},
				public_booking_enabled=${prevBiz.public_booking_enabled}, allow_same_day_booking=${prevBiz.allow_same_day_booking},
				public_contact_enabled=${prevBiz.public_contact_enabled}, whatsapp_contact_enabled=${prevBiz.whatsapp_contact_enabled},
				whatsapp_phone=${sqlLit(prevBiz.whatsapp_phone)}, max_booking_days_ahead=${prevBiz.max_booking_days_ahead},
				min_booking_notice_minutes=${prevBiz.min_booking_notice_minutes}
			where id='${f.businessId}';
			${restoreSenderSql}
			update public.appointment_email_policies set email_enabled=${policy.email_enabled}, sender_verified=${policy.sender_verified}, require_email=${policy.require_email} where business_id='${f.businessId}';
			update private.appointment_management_runtime set email_producer_enabled=${prevProducer === 'true' ? 'true' : 'false'};
			commit;`);
	}
});
