import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { must } from './helpers/fixture-db';
import { ownedAppointmentFixture } from './helpers/owned-appointment-fixture';
import { layoutIssues, type LayoutIssue } from './helpers/layout-usability';
import { alignTaskForCapture } from './helpers/task-capture';
import { observeRenderHealth } from './helpers/render-health';
import { pastDevProxy } from './helpers/dev-proxy';

// Browser plugin not available: use the existing sequential CI Playwright
// harness, real isolated Auth/PostgREST/SQL, and synthetic owned businesses.
// No Zoho/Google delivery or production proof is inferred from this spec.
async function matrix(page: Page, info: TestInfo, name: string, anchor: Locator, issues: LayoutIssue[]) {
 for (const width of [320, 390, 768, 1280, 1600]) {
  await page.setViewportSize({ width, height: 900 });
  issues.push(...await layoutIssues(page, 'main a:visible, main button:visible, main input:visible', 'main'));
  await alignTaskForCapture(anchor);
  await page.screenshot({ path: info.outputPath(`${name}-${width}.jpg`), type: 'jpeg', quality: 65 });
 }
 await page.setViewportSize({ width: 1280, height: 900 });
}

for (const brand of ['cita-suite', 'natalia'] as const) {
 test(`@candidate-behavior isolated patient management ${brand}: context, money, replay, revocation and no JavaScript`, async ({ page, context, request, browser }, info) => {
  test.setTimeout(180_000);
  const f = ownedAppointmentFixture();
  const ownerId = randomUUID();
  const businessId = randomUUID(), professionalId = randomUUID(), serviceId = randomUUID(), patientId = randomUUID();
  const appointmentId = randomUUID(), noJsAppointmentId = randomUUID(), integrationId = randomUUID();
  const integrationKey = randomUUID().replaceAll('-', '');
  const app = new URL(process.env.E2E_BASE_URL!);
  if (app.protocol !== 'http:' || app.hostname !== '127.0.0.1') throw new Error('Management browser audit requires its owned loopback app');
  const appOrigin = app.origin;
  const previous: unknown = JSON.parse(f.sql(`select jsonb_build_object('deposit',(select enabled from private.deposit_automation where singleton),
   'reschedule',(select reschedule_enabled from private.appointment_management_runtime where singleton),
   'producer',(select email_producer_enabled from private.appointment_management_runtime where singleton));`));
  if (typeof previous !== 'object' || previous === null || !('deposit' in previous) || typeof previous.deposit !== 'boolean' ||
   !('reschedule' in previous) || typeof previous.reschedule !== 'boolean' || !('producer' in previous) || typeof previous.producer !== 'boolean') throw new Error('Invalid owned fixture switch snapshot');
  const health = await observeRenderHealth(page);
  const issues: LayoutIssue[] = [];
  let noJsContext: Awaited<ReturnType<typeof browser.newContext>> | null = null;
  try {
   f.sql(`begin;
    \\echo CITA_FIXTURE_PHASE account
    insert into auth.users(id,email) values('${ownerId}','management-owner-${ownerId}@example.test');
    \\echo CITA_FIXTURE_PHASE business
    insert into public.businesses(id,name,slug,industry,timezone,public_booking_enabled,max_booking_days_ahead)
     values('${businessId}','Consultorio sintético de gestión','management-${businessId}','other','America/Argentina/Cordoba',true,180);
    update public.business_subscriptions set commercial_access_enabled=true,is_permanent=true,subscription_status='active',
     paid_until=null,grace_until=null,restricted_until=null,archived_at=null where business_id='${businessId}';
    \\echo CITA_FIXTURE_PHASE membership
    insert into public.business_users(business_id,user_id,role,status,accepted_at) values('${businessId}','${ownerId}','owner','active',now());
    \\echo CITA_FIXTURE_PHASE professional_service
    insert into public.professionals(id,business_id,name,is_public) values('${professionalId}','${businessId}','Profesional de gestión',true);
    insert into public.services(id,business_id,name,duration_minutes,is_public) values('${serviceId}','${businessId}','Consulta sintética',45,true);
    insert into public.professional_services(business_id,professional_id,service_id) values('${businessId}','${professionalId}','${serviceId}');
    insert into public.availability_rules(business_id,professional_id,weekday,start_time,end_time,slot_interval_minutes,break_minutes)
     select '${businessId}','${professionalId}',n,'09:00','17:00',30,0 from generate_series(0,6)n;
    \\echo CITA_FIXTURE_PHASE patient_deposit
    insert into public.patients(id,business_id,owner_id,full_name,email)
     values('${patientId}','${businessId}','${ownerId}','Paciente sintético de autogestión','synthetic+${patientId}@example.test');
    insert into public.deposit_policies(business_id,enabled,auto_cancel_enabled,amount_mode,fixed_amount,transfer_details,applies_to_manual)
     values('${businessId}',true,true,'fixed',40000,'Alias de prueba sin cuenta bancaria',true);
    update private.deposit_automation set enabled=true;
    update private.appointment_management_runtime set reschedule_enabled=true,email_producer_enabled=false;
    \\echo CITA_FIXTURE_PHASE appointments
    insert into public.appointments(id,business_id,patient_id,professional_id,service_id,starts_at,ends_at,status,source,
     service_name_snapshot,professional_name_snapshot,duration_minutes_snapshot)
     select appointment,'${businessId}','${patientId}','${professionalId}','${serviceId}',starts,starts+interval '45 minutes','reserved','manual',
      'Consulta sintética','Profesional de gestión',45 from (values
       ('${appointmentId}'::uuid,((now() at time zone 'America/Argentina/Cordoba')::date+20+time '12:00') at time zone 'America/Argentina/Cordoba'),
       ('${noJsAppointmentId}'::uuid,((now() at time zone 'America/Argentina/Cordoba')::date+22+time '12:00') at time zone 'America/Argentina/Cordoba')) v(appointment,starts);
    update public.appointment_management_states set terms_acknowledged=true,require_deposit_on_reschedule=true,
     previous_deposit_disposition='forfeit',accepted_at=now(),accepted_policy_revision=1 where business_id='${businessId}';
    \\echo CITA_FIXTURE_PHASE record_payment
    do $$ begin
     perform set_config('request.jwt.claim.sub','${ownerId}',true);
     perform public.set_appointment_deposit('${businessId}','${appointmentId}','paid',1,null);
    end $$;
    \\echo CITA_FIXTURE_PHASE integration
    insert into public.booking_integrations(id,business_id,public_key,name,is_active,theme,allowed_origins,allowed_service_ids,allowed_professional_ids)
     values('${integrationId}','${businessId}','${integrationKey}','Synthetic management',true,'${brand}',array['${appOrigin}'],array['${serviceId}']::uuid[],array['${professionalId}']::uuid[]);
    insert into public.appointment_booking_contexts(appointment_id,business_id,integration_id,integration_revision,contract_version,
     theme_snapshot,entry_point,modality,context_fingerprint)
     values('${appointmentId}','${businessId}','${integrationId}',1,1,'${brand}','embedded','in_person',repeat('a',64));
    commit;`);
   const capability = f.sql(`select public.issue_appointment_management_capability('${businessId}','${appointmentId}',1);`);
   const noJsCapability = f.sql(`select public.issue_appointment_management_capability('${businessId}','${noJsAppointmentId}',1);`);
   expect(capability).toMatch(/^[a-f0-9]{64}$/); expect(noJsCapability).toMatch(/^[a-f0-9]{64}$/);
   const original = await must(f.admin.from('appointments').select('confirmation_token,starts_at,status,calendar_sequence').eq('id', appointmentId).single());
   const targetDate = f.sql(`select to_char((starts_at at time zone 'America/Argentina/Cordoba')::date+1,'YYYY-MM-DD') from public.appointments where id='${appointmentId}';`);
   const path = `/gestion/${capability}`;
   const state = () => f.sql(`select jsonb_build_array(a.starts_at,a.ends_at,a.status,
    (select jsonb_agg(jsonb_build_array(status,amount,allocation,is_current) order by ordinal) from public.appointment_deposit_requirements where appointment_id=a.id),
    (select count(*) from public.audit_logs where entity_id=a.id),
    (select count(*) from private.appointment_management_operations where appointment_id=a.id)) from public.appointments a where a.id='${appointmentId}';`);
   const beforeOpen = state();
   const preview = await request.get(`${path}?accion=cancelar`, { headers: { 'user-agent': 'Googlebot' } });
   expect(preview.status()).toBe(200); expect(preview.headers()['cache-control']).toContain('no-store');
   expect(preview.headers()['x-robots-tag']).toContain('noindex'); expect(state()).toBe(beforeOpen);
   // Unrelated expired practice cookies must not send a patient to login.
   await context.addCookies([
    { name: 'sb-module', value: 'odonto', url: appOrigin }, { name: 'sb-access-token', value: 'expired', url: appOrigin },
    { name: 'sb-refresh-token', value: 'irrelevant', url: appOrigin }
   ]);
   for (const theme of ['light', 'dark'] as const) {
    await context.addCookies([{ name: 'cita-theme', value: theme, url: appOrigin }]);
    await page.goto(`${path}?accion=cancelar&color_mode=${theme}`);
    await expect(page.getByRole('heading', { name: '¿Querés cancelar este turno?' })).toBeVisible();
    await expect(page.getByRole('heading', { name: '¿Querés cancelar este turno?' })).toBeInViewport();
    await expect(page.getByRole('heading', { name: /Último paso/ })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Prefiero reprogramar' })).toBeVisible();
    if (brand === 'natalia') await expect(page.locator('[data-booking-color-mode]').first()).toHaveAttribute('data-booking-color-mode', theme);
    else expect(await page.locator('html').evaluate(el => el.classList.contains('dark'))).toBe(theme === 'dark');
    await page.screenshot({ path: info.outputPath(`first-viewport-${theme}.jpg`), type: 'jpeg', quality: 65 });
    await matrix(page, info, `cancel-${theme}`, page.getByRole('heading', { name: '¿Querés cancelar este turno?' }), issues);
   }
   expect(state()).toBe(beforeOpen);
   await page.getByRole('link', { name: 'Prefiero reprogramar' }).click();
   await expect(page.getByRole('heading', { name: '¿Querés reprogramar este turno?' })).toBeVisible();
   for (const theme of ['light', 'dark'] as const) {
    await context.addCookies([{ name: 'cita-theme', value: theme, url: appOrigin }]);
    const choice = new URL(page.url()); choice.searchParams.set('color_mode', theme); await page.goto(choice.href);
    await expect(page.getByRole('heading', { name: '¿Querés reprogramar este turno?' })).toBeInViewport();
    await page.screenshot({ path: info.outputPath(`first-selection-${theme}.jpg`), type: 'jpeg', quality: 65 });
    await matrix(page, info, `day-selection-${theme}`, page.getByRole('button', { name: /^Día para el nuevo turno/ }), issues);
   }
   await page.locator('[name="fecha"]').fill(targetDate);
   await page.getByRole('button', { name: 'Ver horarios', exact: true }).click();
   await expect(page).toHaveURL(url => url.searchParams.get('fecha') === targetDate);
   await expect(page.locator('[name="fecha"]')).toHaveValue(targetDate);
   await expect(page.locator('[aria-label="Horarios disponibles"] a').first()).toHaveAttribute('href', new RegExp(`horario=${targetDate}T`));
   await page.locator('[aria-label="Horarios disponibles"] a').first().click();
   await expect(page.getByRole('heading', { name: 'Revisá el cambio antes de confirmar' })).toBeVisible();
   await expect(page.locator('input[name="starts_at"]')).toHaveValue(new RegExp(`^${targetDate}T`));
   await expect(page.getByText(/La seña anterior de.*dejará de aplicarse/)).toBeVisible();
   await expect(page.getByText(/Nueva seña pendiente/)).toBeVisible();
   await expect(page.getByText('Duración vigente: 45 minutos.')).toBeVisible();
   for (const theme of ['light', 'dark'] as const) {
    await context.addCookies([{ name: 'cita-theme', value: theme, url: appOrigin }]);
    const selected = new URL(page.url()); selected.searchParams.set('color_mode', theme); await page.goto(selected.href);
    await matrix(page, info, `reschedule-${theme}`, page.getByRole('button', { name: 'Confirmar reprogramación' }), issues);
   }
   expect(state()).toBe(beforeOpen);
   const form = page.getByRole('button', { name: 'Confirmar reprogramación' }).locator('..');
   const submitted = await form.evaluate(node => Object.fromEntries([...new FormData(node as HTMLFormElement)].map(([key, value]) => [key, String(value)])));
   await page.getByRole('button', { name: 'Confirmar reprogramación' }).click();
   await expect(page.getByText('La reprogramación quedó registrada.', { exact: true })).toBeVisible();
   await expect(page.getByText('La reprogramación quedó registrada.', { exact: true })).toBeInViewport();
   const moved = await must(f.admin.from('appointments').select('status,starts_at,calendar_sequence').eq('id', appointmentId).single());
   expect(moved.status).toBe('reserved'); expect(new Date(moved.starts_at).toISOString()).toBe(new Date(submitted.starts_at).toISOString());
   expect(moved.calendar_sequence).toBe(original.calendar_sequence + 1);
   expect(f.sql(`select count(*) from public.appointment_deposit_requirements where appointment_id='${appointmentId}' and status='paid' and allocation='forfeited';`)).toBe('1');
   expect(f.sql(`select count(*) from public.appointment_deposit_requirements where appointment_id='${appointmentId}' and is_current and status='pending' and amount=40000;`)).toBe('1');
   const afterMove = state();
   // The replay is idempotent by contract: the assertions below prove that it changes nothing.
   const replay = await pastDevProxy(() => request.post(`${path}?/reschedule`, { form: submitted, headers: { origin: appOrigin } }));
   expect(replay.status()).toBe(200); expect(state()).toBe(afterMove);
   await page.getByRole('link', { name: 'Cancelar turno', exact: true }).click();
   await page.getByRole('button', { name: 'Sí, cancelar turno', exact: true }).click();
   await expect(page.getByRole('heading', { name: 'Turno cancelado', exact: true })).toBeVisible();
   await expect(page.getByRole('link', { name: 'Reservar otro turno', exact: true })).toBeVisible();
   await expect(page.getByRole('link', { name: 'Cancelar turno', exact: true })).toHaveCount(0);
   await expect(page.getByRole('link', { name: 'Reprogramar turno', exact: true })).toHaveCount(0);
   expect((await must(f.admin.from('appointments').select('status').eq('id', appointmentId).single())).status).toBe('cancelled');
   const icsBefore = await request.get(`/turno/${original.confirmation_token}/calendario.ics`);
   expect(icsBefore.status()).toBe(200); const uid = /^UID:(.+)$/m.exec(await icsBefore.text())?.[1]?.trim(); expect(uid).toBeTruthy();
   f.sql(`do $$ begin
    perform set_config('request.jwt.claim.sub','${ownerId}',true);
    perform public.revoke_appointment_management_access('${businessId}','${appointmentId}','${randomUUID()}',private.appointment_semantic_revision('${businessId}','${appointmentId}'));
   end $$;`);
   for (const revoked of [path, `/turno/${original.confirmation_token}`]) {
    await page.goto(revoked); await expect(page.getByText('No encontramos un turno asociado a este enlace.')).toBeVisible();
   }
   const icsAfter = await request.get(`/turno/${original.confirmation_token}/calendario.ics`);
   expect(/^UID:(.+)$/m.exec(await icsAfter.text())?.[1]?.trim()).toBe(uid);
   noJsContext = await browser.newContext({ javaScriptEnabled: false, baseURL: appOrigin });
   const noJsPage = await noJsContext.newPage();
   await noJsPage.goto(`/gestion/${noJsCapability}?accion=cancelar`);
   await noJsPage.getByRole('button', { name: 'Sí, cancelar turno', exact: true }).click();
   await expect(noJsPage.getByRole('heading', { name: 'Turno cancelado', exact: true })).toBeVisible();
   expect((await must(f.admin.from('appointments').select('status').eq('id', noJsAppointmentId).single())).status).toBe('cancelled');
   expect(issues).toEqual([]);
   await info.attach('layout', { body: JSON.stringify({ brand, widths: [320, 390, 768, 1280, 1600], themes: ['light', 'dark'], issues }), contentType: 'application/json' });
   await health.assertAndAttach(info, 'patient-management-render-health');
  } finally {
   await noJsContext?.close();
   f.sql(`begin;
    update private.deposit_automation set enabled=${previous.deposit};
    update private.appointment_management_runtime set reschedule_enabled=${previous.reschedule},email_producer_enabled=${previous.producer};
    delete from public.appointments where business_id='${businessId}';
    delete from public.booking_integrations where business_id='${businessId}';
    delete from public.businesses where id='${businessId}' and slug='management-${businessId}';
    delete from auth.users where id='${ownerId}' and email='management-owner-${ownerId}@example.test';
    commit;`);
   expect(f.sql(`select count(*) from public.businesses where id='${businessId}';`)).toBe('0');
   expect(f.sql(`select count(*) from auth.users where id='${ownerId}';`)).toBe('0');
  }
 });
}
