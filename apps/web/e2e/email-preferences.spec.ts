import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { ownedAppointmentFixture } from './helpers/owned-appointment-fixture';
import { loginWithSharedSession } from './helpers/shared-auth';
import { observeRenderHealth, pageErrorCollector } from './helpers/render-health';
import { layoutIssues, type LayoutIssue } from './helpers/layout-usability';
import { applyThemeInPage } from './helpers/theme';

test('@candidate-behavior isolated email preferences: independent settings, stale saves and native recovery', async ({ page, context, browser }, info) => {
 test.setTimeout(120_000);
 const f = ownedAppointmentFixture(), businessId = randomUUID();
 const health = await observeRenderHealth(page), issues: LayoutIssue[] = [];
 const pageErrors = pageErrorCollector();
 pageErrors.watch(page);
 const base = new URL(process.env.E2E_BASE_URL!).origin;
 const ownerEmail = `email-preferences-${randomUUID()}@example.test`, ownerPassword = `Owned-fixture-${randomUUID()}`;
 let ownerId: string | null = null;
 const policy = () => JSON.parse(f.sql(`select to_jsonb(p) from public.appointment_email_policies p where business_id='${businessId}';`));
 const audits = () => Number(f.sql(`select count(*) from public.audit_logs where business_id='${businessId}' and action='business.appointment_email_policy_updated';`));
 let native: Awaited<ReturnType<typeof browser.newContext>> | null = null;
 try {
  const created = await f.admin.auth.admin.createUser({ email: ownerEmail, password: ownerPassword, email_confirm: true });
  if (created.error || !created.data.user?.id) throw new Error('Could not create the owned email preferences account.');
  ownerId = created.data.user.id;
  f.sql(`begin;
   insert into public.businesses(id,name,slug,industry) values('${businessId}','Preferencias sintéticas','email-${businessId}','other');
   update public.business_subscriptions set commercial_access_enabled=true,is_permanent=true,subscription_status='active',paid_until=null,grace_until=null,restricted_until=null,archived_at=null where business_id='${businessId}';
   insert into public.business_users(business_id,user_id,role,status,accepted_at)
    values('${businessId}','${ownerId}','owner','active',now()); commit;`);
  await loginWithSharedSession(page, { email: ownerEmail, password: ownerPassword });
  await context.addCookies([{ name: 'active-business-id', value: businessId, url: base }]);
  const before = policy();
  await page.goto('/odonto/configuracion/correo');
  await expect(page.getByRole('heading', { name: 'Correo y autogestión', exact: true })).toBeVisible();
  // A new practice has no sending domain: the page says so and that nothing is sent.
  await expect(page.locator('[data-email-readiness]')).toHaveText('Todavía no se preparó el dominio de envío de este consultorio. No salen correos.');
  expect(policy()).toEqual(before);
  await expect(page.getByLabel('Enviar comprobantes y recordatorios por email')).toBeChecked();
  await expect(page.getByLabel('Pedir email obligatorio al reservar online')).toBeChecked();
  for (const theme of ['light', 'dark'] as const) {
   await applyThemeInPage(page, theme);
   for (const width of [320, 390, 768, 1280, 1600]) {
    await page.setViewportSize({ width, height: 900 });
    issues.push(...await layoutIssues(page, 'main input:visible, main button:visible, main a:visible', 'main'));
    await page.screenshot({ path: info.outputPath(`email-preferences-${theme}-${width}.jpg`), type: 'jpeg', quality: 65, fullPage: true });
   }
  }
  await page.getByLabel('Enviar comprobantes y recordatorios por email').uncheck();
  await page.getByRole('button', { name: 'Guardar preferencias', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Se guardaron' })).toBeVisible();
  expect(policy()).toMatchObject({ email_enabled: false, require_email: true, sender_verified: false, revision: before.revision + 1 });
  const afterSave = policy();
  expect(audits()).toBe(1);
  // A second writer changes the same policy after this page observed it.
  f.sql(`begin; select set_config('request.jwt.claim.sub',user_id::text,true) from public.business_users where business_id='${businessId}' and role='owner';
   select public.save_appointment_email_policy('${businessId}',jsonb_build_object('email_enabled',false,'require_email',false,'show_cancel',true,'show_reschedule',true,'require_deposit_on_reschedule',true,'previous_deposit_disposition','forfeit'),${afterSave.revision}); commit;`);
  await page.getByLabel('Mostrar Cancelar', { exact: true }).uncheck();
  await page.getByRole('button', { name: 'Guardar preferencias', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Otra persona cambió' })).toBeVisible();
  await expect(page.getByLabel('Mostrar Cancelar', { exact: true })).not.toBeChecked();
  await expect(page.getByRole('button', { name: 'Guardar preferencias', exact: true })).toBeDisabled();
  expect(policy()).toMatchObject({ email_enabled: false, require_email: false, show_cancel: true, revision: afterSave.revision + 1 });
  expect(audits()).toBe(2);
  await page.getByRole('link', { name: 'Recargar configuración', exact: true }).click();
  await expect(page.getByLabel('Mostrar Cancelar', { exact: true })).toBeChecked();
  native = await browser.newContext({ javaScriptEnabled: false });
  await native.addCookies(await context.cookies());
  const noJsPage = await native.newPage();
  await noJsPage.goto(base + '/odonto/configuracion/correo');
  await noJsPage.getByLabel('Pedir email obligatorio al reservar online').check();
  await noJsPage.getByRole('button', { name: 'Guardar preferencias', exact: true }).click();
  await expect(noJsPage.getByRole('status').filter({ hasText: 'Se guardaron' })).toBeVisible();
  expect(policy()).toMatchObject({ email_enabled: false, require_email: true, sender_verified: false });
  expect(audits()).toBe(3);
  // Appointment emails are not answered (plan 12.35): the page asks for no reply contact.
  await page.goto('/odonto/configuracion/correo');
  await expect(page.getByLabel('Correo donde recibir las respuestas de los pacientes')).toHaveCount(0);
  // This runs as the person against real SQL: it reached production failing for everyone,
  // because every test above it stopped at a mocked call.
  const appointmentId = randomUUID(), deliveryId = randomUUID();
  f.sql(`begin;
   do $$ declare p uuid; s uuid; r uuid; begin
    insert into public.services(business_id,name,duration_minutes) values('${businessId}','Consulta sintética',30) returning id into s;
    insert into public.professionals(business_id,name) values('${businessId}','Profesional sintético') returning id into r;
    insert into public.professional_services(business_id,professional_id,service_id) values('${businessId}',r,s);
    insert into public.patients(owner_id,business_id,full_name,email) values('${ownerId}','${businessId}','Paciente sintético','paciente-correo@example.test') returning id into p;
    insert into public.appointments(id,business_id,patient_id,service_id,professional_id,starts_at,ends_at,blocking_starts_at,blocking_ends_at,status,source,service_name_snapshot,professional_name_snapshot,duration_minutes_snapshot)
    values('${appointmentId}','${businessId}',p,s,r,date_trunc('hour',now())+interval '10 days',date_trunc('hour',now())+interval '10 days 30 minutes',date_trunc('hour',now())+interval '10 days',date_trunc('hour',now())+interval '10 days 30 minutes','reserved','manual','Consulta sintética','Profesional sintético',30);
    insert into private.appointment_email_deliveries(id,business_id,appointment_id,purpose,dedupe_key,schedule_revision,state,due_at,expires_at,started_at)
    values('${deliveryId}','${businessId}','${appointmentId}','booking_receipt','e2e:uncertain:${deliveryId}',1,'uncertain',now()-interval '1 hour',now()+interval '1 day',now()-interval '1 hour');
   end $$; commit;`);
  await page.goto(`/odonto/turnos/${appointmentId}`);
  const deliveries = page.locator('[data-email-deliveries]');
  await expect(deliveries).toContainText('En comprobación');
  await deliveries.getByRole('button', { name: 'Reenviar igual', exact: true }).click();
  await expect(page.getByText('El correo vuelve a salir en unos minutos.')).toBeVisible();
  expect(f.sql(`select state||':'||(duplicate_risk_accepted_by='${ownerId}')::text from private.appointment_email_deliveries where id='${deliveryId}';`)).toBe('retry:true');
  expect(issues).toEqual([]);
  expect(pageErrors.unexpected()).toEqual([]);
  await health.assertAndAttach(info, 'email-preferences-render-health');
  await info.attach('email-preferences-proof', { contentType: 'application/json', body: Buffer.from(JSON.stringify({ independentSettings: true, currentReadiness: true, conflictPreservesDraft: true, nativeSave: true, issues, pageErrors })) });
 } finally {
  await native?.close();
  f.sql(`delete from public.businesses where id='${businessId}';`);
  expect(f.sql(`select count(*) from public.businesses where id='${businessId}';`)).toBe('0');
  if (ownerId) {
   const removed = await f.admin.auth.admin.deleteUser(ownerId);
   expect(removed.error).toBeNull();
  }
 }
});
