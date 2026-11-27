import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { must } from './helpers/fixture-db';
import { layoutIssues, type LayoutIssue } from './helpers/layout-usability';
import { ownedAppointmentFixture } from './helpers/owned-appointment-fixture';
import { observeRenderHealth } from './helpers/render-health';
import { loginWithSharedSession } from './helpers/shared-auth';
import { alignTaskForCapture } from './helpers/task-capture';
import { chooseTheme, contrastViolations, expectRenderedTheme } from './helpers/theme';

test('@candidate-behavior D3: recordatorios por correo cubren en la lista y en el aviso de la agenda', async ({ page }, info) => {
	test.setTimeout(120_000);
	const f = ownedAppointmentFixture();
	const origin = new URL(process.env.E2E_BASE_URL!).origin;
	const owner = f.sql(`select user_id from public.business_users where business_id='${f.businessId}' and role='owner' and status='active' limit 1;`);
	const assignment = await must(
		f.admin.from('professional_services').select('service_id,professional_id').eq('business_id', f.businessId).limit(1).single()
	);
	const patientWithEmail = randomUUID();
	const patientWithoutEmail = randomUUID();
	const aptCovered = randomUUID();
	const aptUncovered = randomUUID();
	const prevProducer = f.sql('select email_producer_enabled::text from private.appointment_management_runtime where singleton;');
	const prevPolicy = f.sql(`select jsonb_build_object('email_enabled', email_enabled, 'sender_verified', sender_verified)::text from public.appointment_email_policies where business_id='${f.businessId}';`);
	const prevSender = f.sql(`select coalesce((select jsonb_build_object('sending_domain', sending_domain, 'domain_state', domain_state, 'provider_domain_key', provider_domain_key, 'reply_to_email', reply_to_email)::text from private.business_email_senders where business_id='${f.businessId}'), 'null');`);
	const health = await observeRenderHealth(page);
	const issues: LayoutIssue[] = [];

	try {
		f.sql(`begin;
			update private.appointment_management_runtime set email_producer_enabled = true;
			select public.operator_set_business_email_sender('${f.businessId}', 'd3-e2e-${f.businessId.slice(0, 8)}.cita-suite.com.ar', 'verified');
			update public.appointment_email_policies set email_enabled = true where business_id = '${f.businessId}';
			insert into public.patients(id, business_id, owner_id, full_name, phone_e164, email) values
				('${patientWithEmail}', '${f.businessId}', '${owner}', 'Paciente Cubierto Correo D3', '+5493511111101', 'd3-cubierto@example.test'),
				('${patientWithoutEmail}', '${f.businessId}', '${owner}', 'Paciente Sin Correo D3', '+5493511111102', null);
			insert into public.appointments(id, business_id, patient_id, service_id, professional_id, starts_at, ends_at, blocking_starts_at, blocking_ends_at, status, source, service_name_snapshot, professional_name_snapshot, duration_minutes_snapshot)
			select id, '${f.businessId}', patient_id, '${assignment.service_id}', '${assignment.professional_id}', starts, starts + interval '15 minutes', starts, starts + interval '15 minutes', 'reserved', 'manual', 'Consulta D3', 'Profesional D3', 15
			from public.businesses b,
			lateral (values
				('${aptCovered}'::uuid, '${patientWithEmail}'::uuid, ((now() at time zone b.timezone)::date + 1 + time '23:30') at time zone b.timezone),
				('${aptUncovered}'::uuid, '${patientWithoutEmail}'::uuid, ((now() at time zone b.timezone)::date + 1 + time '23:45') at time zone b.timezone)
			) v(id, patient_id, starts)
			where b.id = '${f.businessId}';
			update public.appointment_management_states
			set schedule_changed_at = now() - interval '48 hours'
			where appointment_id in ('${aptCovered}', '${aptUncovered}');
			commit;`);

		await loginWithSharedSession(page, { email: f.email, password: f.password });

		// 1. La lista Recordatorios muestra el turno con correo en «Ya tienen aviso automático» y el otro en «Sin recordatorio confirmado»
		await page.goto(origin + '/odonto/recordatorios?dia=manana');
		const pendingSection = page.locator('div.ux-card', { has: page.getByRole('heading', { name: 'Calendario pendiente de actualizar' }) });
		const uncoveredSection = page.locator('div.ux-card', { has: page.getByRole('heading', { name: 'Sin recordatorio confirmado' }) });
		await expect(uncoveredSection).toContainText('Paciente Sin Correo D3');
		await expect(uncoveredSection).not.toContainText('Paciente Cubierto Correo D3');

		const automaticDetails = page.locator('details.ux-card');
		const automaticSummary = automaticDetails.locator('summary');
		await expect(automaticSummary).toContainText('Ya tienen aviso automático');
		await automaticSummary.focus();
		await expect(automaticSummary).toBeFocused();
		await page.keyboard.press('Enter');
		await expect(automaticDetails).toContainText('Paciente Cubierto Correo D3');
		await expect(automaticDetails).not.toContainText('Paciente Sin Correo D3');

		// 2. El aviso de la agenda cuenta exactamente los mismos turnos sin cobertura que la lista
		const pendingCount = (await pendingSection.count()) > 0 ? await pendingSection.locator('.ux-soft-card').count() : 0;
		const uncoveredCount = pendingCount + (await uncoveredSection.locator('.ux-soft-card').count());
		expect(uncoveredCount).toBeGreaterThanOrEqual(1);
		await page.goto(origin + '/odonto/agenda');
		const expectedBanner = uncoveredCount === 1
			? '1 turno de mañana sin recordatorio automático'
			: `${uncoveredCount} turnos de mañana sin recordatorio automático`;
		await expect(page.getByText(expectedBanner)).toBeVisible();

		// 3. Revisión visual, contraste y layout en claro y oscuro y en anchos móvil/tableta/escritorio
		for (const theme of ['light', 'dark'] as const) {
			for (const width of [320, 360, 390, 430, 768, 1280]) {
				await page.setViewportSize({ width, height: 850 });
				await page.goto(origin + '/odonto/recordatorios?dia=manana');
				await chooseTheme(page, theme);
				await page.reload();
				await expectRenderedTheme(page, theme);
				expect((await contrastViolations(page)).violations).toEqual([]);
				issues.push(...(await layoutIssues(page, 'main a:visible, main button:visible', 'main')));
				if (width === 320 || width === 1280) {
					await alignTaskForCapture(page.getByRole('heading', { name: 'Turnos para recordar', level: 1 }));
					await page.screenshot({ path: info.outputPath(`d3-recordatorios-${theme}-${width}.jpg`), type: 'jpeg', quality: 65 });
				}
			}
		}
		expect(issues).toEqual([]);
		await health.assertAndAttach(info, 'd3-reminder-email-coverage-health');
	} finally {
		const policy = JSON.parse(prevPolicy) as { email_enabled: boolean; sender_verified: boolean };
		const sender = JSON.parse(prevSender) as { sending_domain: string | null; domain_state: string; provider_domain_key: string | null; reply_to_email: string | null } | null;
		const sqlLit = (v: string | null) => (v === null ? 'null' : `'${v.replaceAll("'", "''")}'`);
		const restoreSenderSql = sender
			? `select public.operator_set_business_email_sender('${f.businessId}', ${sqlLit(sender.sending_domain)}, ${sqlLit(sender.domain_state)}, ${sqlLit(sender.provider_domain_key)}, ${sqlLit(sender.reply_to_email)});`
			: `delete from private.business_email_senders where business_id='${f.businessId}';`;
		f.sql(`begin;
			delete from private.appointment_email_events where business_id='${f.businessId}' and appointment_id in ('${aptCovered}','${aptUncovered}');
			delete from public.appointments where business_id='${f.businessId}' and id in ('${aptCovered}','${aptUncovered}');
			delete from public.patients where business_id='${f.businessId}' and id in ('${patientWithEmail}','${patientWithoutEmail}');
			${restoreSenderSql}
			update public.appointment_email_policies set email_enabled=${policy.email_enabled}, sender_verified=${policy.sender_verified} where business_id='${f.businessId}';
			update private.appointment_management_runtime set email_producer_enabled=${prevProducer === 'true' ? 'true' : 'false'};
			commit;`);
	}
});
