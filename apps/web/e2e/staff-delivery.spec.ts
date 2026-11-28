import { expect, test, type Locator } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { must } from './helpers/fixture-db';
import { ownedAppointmentFixture } from './helpers/owned-appointment-fixture';
import { loginWithSharedSession } from './helpers/shared-auth';
import { observeRenderHealth } from './helpers/render-health';
import { layoutIssues, type LayoutIssue } from './helpers/layout-usability';
import { alignTaskForCapture } from './helpers/task-capture';
import { expectRenderedTheme } from './helpers/theme';
import { whatsappDraft } from './helpers/whatsapp-draft';

// No host-managed browser is exposed. Hosted Playwright uses owned fixtures,
// real Auth/PostgREST and actual POSTs. External WhatsApp navigation is intercepted;
// this verifies preparation, never a send or provider delivery.
test('@candidate-behavior staff delivery: explicit preparation, contact revocation and atomic manual coverage', async ({ page, context }, info) => {
 test.setTimeout(180_000);
 const f = ownedAppointmentFixture(), origin = new URL(process.env.E2E_BASE_URL!);
 if (origin.hostname !== '127.0.0.1' || origin.protocol !== 'http:') throw new Error('Owned loopback app required');
 const reminderId = randomUUID(), depositId = randomUUID(), cancelledId = randomUUID(), patientId = randomUUID();
 const owner = f.sql(`select user_id from public.business_users where business_id='${f.businessId}' and role='owner' and status='active' limit 1;`);
 expect(owner).toMatch(/^[a-f0-9-]{36}$/);
 const assignment = await must(f.admin.from('professional_services').select('service_id,professional_id').eq('business_id', f.businessId).limit(1).single());
 expect(f.sql(`select count(*) from public.deposit_policies where business_id='${f.businessId}';`)).toBe('0');
 const automation = f.sql('select enabled::text from private.deposit_automation where singleton;');
 expect(['true','false']).toContain(automation);
 const health = await observeRenderHealth(page), issues: LayoutIssue[] = [];
 const counts = () => f.sql(`select jsonb_build_array(
  (select count(*) from private.appointment_management_capabilities where business_id='${f.businessId}' and appointment_id in ('${reminderId}','${depositId}','${cancelledId}')),
  (select count(*) from public.audit_logs where business_id='${f.businessId}' and entity_id in ('${reminderId}','${depositId}','${cancelledId}')),
  (select count(*) from public.appointments where id='${reminderId}' and whatsapp_reminder_opened_at is not null),
  (select count(*) from public.appointment_deposits where appointment_id='${depositId}' and reminder_opened_at is not null));`);
 // The packaged release sets Secure cookies, and the request API leaves them out on plain HTTP.
 const session = async () => ({ cookie: (await context.cookies()).map(({ name, value }) => `${name}=${value}`).join('; ') });
 const openDraft = async (button: Locator) => {
  const target = await whatsappDraft(context, button), message = target.searchParams.get('text') ?? '';
  expect(target.searchParams.get('phone') ?? target.pathname.slice(1)).toBe('5493425048271');
  return { message };
 };
 const open = async (button: Locator) => {
  const { message } = await openDraft(button);
  const token = /\/gestion\/([a-f0-9]{64})/.exec(message)?.[1];
  expect(token, 'Message must contain a newly prepared management capability').toBeTruthy();
  expect(message).not.toContain('/turno/');
  return { path: '/gestion/' + token, message };
 };
 try {
  f.sql(`begin;
   insert into public.patients(id,business_id,owner_id,full_name,phone_e164,email)
    values('${patientId}','${f.businessId}','${owner}','Paciente sintético de entrega','+5493425048271','delivery-before@example.test');
   insert into public.appointments(id,business_id,patient_id,service_id,professional_id,starts_at,ends_at,status,source,service_name_snapshot,professional_name_snapshot,duration_minutes_snapshot)
    select '${reminderId}','${f.businessId}','${patientId}','${assignment.service_id}','${assignment.professional_id}',t.starts,t.starts+make_interval(mins=>s.duration_minutes),'reserved','manual','Consulta sintética','Profesional sintético',s.duration_minutes
    from public.businesses b,public.services s,lateral(select ((now() at time zone b.timezone)::date+1+time '14:00') at time zone b.timezone as starts)t where b.id='${f.businessId}' and s.id='${assignment.service_id}';
   insert into public.deposit_policies(business_id,enabled,auto_cancel_enabled,amount_mode,fixed_amount,transfer_details)
    values('${f.businessId}',true,false,'fixed',40000,'Alias sintético de entrega');
   update private.deposit_automation set enabled=true;
   insert into public.appointments(id,business_id,patient_id,service_id,professional_id,starts_at,ends_at,status,source,service_name_snapshot,professional_name_snapshot,duration_minutes_snapshot)
    select '${depositId}','${f.businessId}','${patientId}','${assignment.service_id}','${assignment.professional_id}',t.starts,t.starts+make_interval(mins=>s.duration_minutes),'reserved','manual','Consulta sintética','Profesional sintético',s.duration_minutes
    from public.businesses b,public.services s,lateral(select ((now() at time zone b.timezone)::date+5+time '14:00') at time zone b.timezone as starts)t where b.id='${f.businessId}' and s.id='${assignment.service_id}';
   update public.deposit_policies set auto_cancel_enabled=true where business_id='${f.businessId}';
   insert into public.appointments(id,business_id,patient_id,service_id,professional_id,starts_at,ends_at,status,source,created_at,service_name_snapshot,professional_name_snapshot,duration_minutes_snapshot)
    select '${cancelledId}','${f.businessId}','${patientId}','${assignment.service_id}','${assignment.professional_id}',t.starts,t.starts+make_interval(mins=>s.duration_minutes),'reserved','manual',now()-interval '7 days','Consulta sintética','Profesional sintético',s.duration_minutes
    from public.businesses b,public.services s,lateral(select case when extract(hour from now() at time zone b.timezone)<15
     then ((now() at time zone b.timezone)::date+1+time '20:00') at time zone b.timezone
     else ((now() at time zone b.timezone)::date+2+time '07:00') at time zone b.timezone end as starts)t where b.id='${f.businessId}' and s.id='${assignment.service_id}';
   commit;
   select private.expire_unpaid_deposits();`);
  expect(f.sql(`select a.status||':'||d.status from public.appointments a join public.appointment_deposits d on d.appointment_id=a.id where a.id='${cancelledId}';`)).toBe('cancelled:expired');
  await loginWithSharedSession(page, { email: f.email, password: f.password });
  const unchanged = counts(), legacy = f.sql(`select confirmation_token from public.appointments where id='${depositId}';`);
  await page.goto(`/odonto/turnos/${depositId}?created=1`);
  await expect(page.getByRole('button', { name: 'Enviar enlace de activación', exact: true })).toBeVisible();
  expect(await page.content()).not.toContain(legacy); expect(counts()).toBe(unchanged);
  for (const endpoint of [`/odonto/senas/abrir/${depositId}`, `/odonto/recordatorios/abrir/${reminderId}`]) {
   const reply = await context.request.get(endpoint, { maxRedirects: 0, headers: await session() });
   expect(reply.status()).toBe(303); expect(reply.headers().location).toContain('aviso=actualizar');
  }
  expect(counts()).toBe(unchanged);
  const first = await open(page.getByRole('button', { name: 'Enviar enlace de activación', exact: true }));
  const viewer = await context.newPage();
  try {
   await viewer.goto(first.path + '?accion=cancelar');
   const oldCancel = await viewer.locator('form[action="?/cancel"]').evaluate(form =>
    Object.fromEntries([...new FormData(form as HTMLFormElement)].map(([key,value]) => [key,String(value)])));
   f.sql(`update public.patients set email='delivery-corrected@example.test' where business_id='${f.businessId}' and id='${patientId}';`);
   await viewer.reload();
   await expect(viewer.getByText('No encontramos un turno asociado a este enlace.')).toBeVisible();
   await expect(viewer.locator('form[action="?/cancel"]')).toHaveCount(0);
   expect(await viewer.content()).not.toContain('Paciente sintético de entrega');
   const beforeRejected = counts();
   const rejected = await context.request.post(first.path + '?/cancel', { form: oldCancel, headers: { origin: origin.origin, accept: 'application/json' } });
   expect(counts()).toBe(beforeRejected);
   expect(f.sql(`select status from public.appointments where id='${depositId}';`)).toBe('reserved');
   expect(rejected.status()).toBe(200);
   expect(await rejected.json()).toMatchObject({ type: 'failure', status: 409 });
   const nativeRejected = await context.request.post(first.path + '?/cancel', { form: oldCancel, headers: { origin: origin.origin, accept: 'text/html' } });
   expect(counts()).toBe(beforeRejected); expect(nativeRejected.status()).toBe(409);
  } finally { await viewer.close(); }
  await page.reload();
  const corrected = await open(page.getByRole('button', { name: 'Enviar enlace de activación', exact: true }));
  expect(corrected.path).not.toBe(first.path);
  const currentView = await context.request.get(corrected.path + '?accion=cancelar');
  expect(currentView.status()).toBe(200); expect(await currentView.text()).toContain('Sí, cancelar turno');
  expect(f.sql(`select count(*) from public.audit_logs where entity_id='${depositId}' and action='appointment.management_link_prepared' and user_id='${owner}';`)).toBe('2');

  await page.goto('/odonto/senas');
  const depositRow = page.locator(`[data-deposit-row="${depositId}"]`);
  const depositForm = depositRow.getByRole('button', { name: 'Pedir seña por WhatsApp', exact: true }).locator('..');
  const reviewedDeposit = await depositForm.locator('[name="expected_revision"]').inputValue();
  const requested = await open(depositRow.getByRole('button', { name: 'Pedir seña por WhatsApp', exact: true }));
  expect(requested.message).toContain('Alias sintético de entrega'); expect(requested.message).not.toContain('se libera automáticamente');
  expect(f.sql(`select (reminder_opened_at is not null)::text from public.appointment_deposits where appointment_id='${depositId}';`)).toBe('true');
  const afterDeposit = counts();
  const duplicate = await context.request.post(`/odonto/senas/abrir/${depositId}`, { form: { expected_revision: reviewedDeposit }, headers: { origin: origin.origin, ...await session() }, maxRedirects: 0 });
  expect(duplicate.status()).toBe(303); expect(duplicate.headers().location).toContain('aviso=ya_abierto'); expect(counts()).toBe(afterDeposit);

  await page.reload();
  const closedRow = page.locator(`[data-deposit-row="${cancelledId}"]`), beforeClosedDraft = counts();
  const closed = await openDraft(closedRow.getByRole('button', { name: 'Avisar a la persona', exact: true }));
  expect(closed.message).toContain('se canceló porque no registramos la seña');
  expect(closed.message).not.toMatch(/\/gestion\/|\/turno\/|reprogramar|confirmar turno/i);
  expect(counts()).toBe(beforeClosedDraft);
  await expect(closedRow.getByRole('button', { name: 'Confirmar seña', exact: true })).toHaveCount(0);
  await page.goto('/odonto/recordatorios');
  const reminderForm = page.locator(`form[action*="/recordatorios/abrir/${reminderId}"]`);
  const reminderRow = reminderForm.locator('xpath=ancestor::div[contains(@class,"ux-soft-card")][1]');
  const revealReminder = async () => {
   const details = page.locator('details.ux-card');
   if ((await details.count()) > 0 && !(await reminderRow.isVisible())) {
    await details.locator('summary').click();
   }
  };
  const review = await reminderForm.locator('[name="expected_revision"]').inputValue();
  await revealReminder();
  await open(reminderForm.getByRole('button', { name: 'Enviar WhatsApp', exact: true }));
  expect(f.sql(`select (whatsapp_reminder_opened_at is not null and whatsapp_reminder_opened_by='${owner}')::text from public.appointments where id='${reminderId}';`)).toBe('true');
  await page.reload();
  await revealReminder();
  const marked = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/odonto/recordatorios');
  await reminderRow.getByRole('button', { name: 'Marcar como enviado', exact: true }).click();
  expect((await marked).status()).toBe(200);
  await revealReminder();
  await expect(reminderRow.getByText(/^Enviado /)).toBeVisible();
  expect(f.sql(`select (whatsapp_reminder_marked_sent_at is not null and whatsapp_reminder_marked_sent_by='${owner}')::text from public.appointments where id='${reminderId}';`)).toBe('true');
  const afterMark = counts();
  const replay = await context.request.post('/odonto/recordatorios?/mark_sent&dia=manana', { form: { appointment_id: reminderId, expected_revision: review }, headers: { origin: origin.origin, ...await session() } });
  expect(replay.status()).toBe(200); expect(counts()).toBe(afterMark);
  expect(f.sql(`select count(*) from public.audit_logs where entity_id='${reminderId}' and action='reminder.whatsapp_marked_sent' and user_id='${owner}';`)).toBe('1');
  for (const [path, label] of [[`/odonto/turnos/${depositId}?created=1`,'delivery-detail'], ['/odonto/senas','delivery-deposits'], ['/odonto/recordatorios','delivery-reminders']]) {
   for (const theme of ['light','dark'] as const) {
    await context.addCookies([{ name: 'cita-theme', value: theme, url: origin.origin }]);
    await page.goto(path);
    await expectRenderedTheme(page,theme);
    for (const width of [320,390,768,1280,1600]) {
     await page.setViewportSize({ width, height: 900 });
     issues.push(...await layoutIssues(page,'main a:visible, main button:visible, main input:visible, main textarea:visible','main'));
     await alignTaskForCapture(label === 'delivery-deposits' ? page.locator(`[data-deposit-row="${depositId}"]`) : label === 'delivery-detail' ? page.locator('#activation-title') : page.getByRole('main').getByRole('heading', { name: 'Turnos para recordar', level: 1, exact: true }));
     await page.screenshot({ path: info.outputPath(`${label}-${theme}-${width}.jpg`), type: 'jpeg', quality: 65 });
    }
   }
  }
  expect(issues).toEqual([]); await health.assertAndAttach(info,'staff-delivery-health');
  await info.attach('staff-delivery-proof', { body: JSON.stringify({ actualAuthAndSql: true, getDoesNotIssue: true,
   legacyNotSerialized: true, correctedContactRevokesOldCapability: true, explicitNewCapabilityWorks: true,
   pendingDepositPreparedAtomically: true, duplicateNeedsExplicitReview: true, reminderOpeningAndManualAssertionPersisted: true,
   manualAssertionReplayHasOneAudit: true, automaticCancellationNoticeUsesCurrentReadWithoutNewCapability: true, issues, externalSend: false }), contentType: 'application/json' });
 } finally {
  f.sql(`begin; delete from public.appointments where business_id='${f.businessId}' and id in ('${reminderId}','${depositId}','${cancelledId}');
   delete from public.patients where business_id='${f.businessId}' and id='${patientId}';
   delete from public.deposit_policies where business_id='${f.businessId}';
   update private.deposit_automation set enabled=${automation}; commit;`);
  expect(f.sql(`select count(*) from public.appointments where id in ('${reminderId}','${depositId}','${cancelledId}');`)).toBe('0');
  expect(f.sql(`select count(*) from public.patients where id='${patientId}';`)).toBe('0');
 }
});
