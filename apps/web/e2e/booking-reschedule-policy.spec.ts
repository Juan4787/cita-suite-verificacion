import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { forgetPublicBookingAttempts } from './helpers/fixture-db';
import { ownedAppointmentFixture } from './helpers/owned-appointment-fixture';
import { layoutIssues, type LayoutIssue } from './helpers/layout-usability';
import { pageErrorCollector } from './helpers/render-health';
import { applyThemeInPage, expectRenderedTheme } from './helpers/theme';
import { alignTaskForCapture } from './helpers/task-capture';

// Existing sequential hosted Playwright fallback: no approved host browser.
// Actual public POST/SQL, no provider delivery or real recipients.
test('@candidate-behavior isolated informed booking: stale policy, atomic retry and responsive disclosure', async ({ page, browser }, info) => {
 test.setTimeout(150_000);
 const f = ownedAppointmentFixture();
 await forgetPublicBookingAttempts(f.admin);
 const businessId = randomUUID(), ownerId = randomUUID(), serviceId = randomUUID(), professionalId = randomUUID();
 const slug = `informed-booking-${businessId}`;
 const original: unknown = JSON.parse(f.sql(`select jsonb_build_object('deposit',(select enabled from private.deposit_automation where singleton),
  'reschedule',(select reschedule_enabled from private.appointment_management_runtime where singleton));`));
 if (typeof original !== 'object' || original === null || !('deposit' in original) || typeof original.deposit !== 'boolean' ||
  !('reschedule' in original) || typeof original.reschedule !== 'boolean') throw new Error('Invalid informed booking switch snapshot');
 const issues: LayoutIssue[] = [];
 const pageErrors = pageErrorCollector();
 const formCheckpoints: unknown[] = [];
 const browserEvents: string[] = [];
 let releaseScripts: () => void = () => {};
 pageErrors.watch(page);
 page.on('framenavigated', frame => { if (frame === page.mainFrame()) browserEvents.push('main-frame-navigation'); });
 page.on('request', request => { if (request.method() === 'POST') browserEvents.push('post'); });
 page.on('console', message => { if (message.type() === 'warning' && /hydration|svelte/.test(message.text())) browserEvents.push(message.text().slice(0, 800)); });
 try {
  f.sql(`begin;
   insert into auth.users(id,email) values('${ownerId}','informed-owner-${ownerId}@example.test');
   insert into public.businesses(id,name,slug,industry,timezone,public_booking_enabled,max_booking_days_ahead)
    values('${businessId}','Consultorio de reserva informada','${slug}','other','UTC',true,90);
   update public.business_subscriptions set commercial_access_enabled=true,is_permanent=true,subscription_status='active',paid_until=null,grace_until=null,restricted_until=null,archived_at=null where business_id='${businessId}';
   insert into public.business_users(business_id,user_id,role,status,accepted_at) values('${businessId}','${ownerId}','owner','active',now());
   insert into public.professionals(id,business_id,name,is_public) values('${professionalId}','${businessId}','Profesional de reserva informada',true);
   insert into public.services(id,business_id,name,duration_minutes,is_public) values('${serviceId}','${businessId}','Consulta de reserva informada',30,true);
   insert into public.professional_services(business_id,professional_id,service_id) values('${businessId}','${professionalId}','${serviceId}');
   insert into public.availability_rules(business_id,professional_id,weekday,start_time,end_time,slot_interval_minutes,break_minutes)
    select '${businessId}','${professionalId}',day,'08:00','18:00',30,0 from generate_series(0,6) day;
   insert into public.deposit_policies(business_id,enabled,auto_cancel_enabled,amount_mode,fixed_amount,transfer_details)
    values('${businessId}',true,true,'fixed',40000,'Alias sintético sin cuenta bancaria');
   update private.deposit_automation set enabled=true;
   update private.appointment_management_runtime set reschedule_enabled=true;
   select public.operator_set_business_email_sender('${businessId}','informed-${businessId}.cita-suite.com.ar','verified');
   update public.appointment_email_policies set require_deposit_on_reschedule=false,previous_deposit_disposition='credit',revision=revision+1 where business_id='${businessId}';
   select set_config('request.jwt.claim.sub','${ownerId}',true);
   select public.save_professional_booking_form('${businessId}','${professionalId}',0,
    '[{"id":"preference","label":"Preferencia de contacto","kind":"choice","required":false,"options":["Mañana","Tarde"]},
      {"id":"birth","label":"Fecha de nacimiento","kind":"text","required":false,"maxLength":10,"patientField":"birth_date"}]'::jsonb);
   commit;`);
  const date = f.sql("select (now() at time zone 'UTC')::date+25;");
  const native = await browser.newContext({ javaScriptEnabled: false });
  let slotUrl = '';
  try {
   const nativePage = await native.newPage();
   await nativePage.goto(`/reservar/${slug}?service_id=${serviceId}&professional_id=${professionalId}&date=${date}`);
   await nativePage.getByRole('link', { name: /^\d{2}:\d{2}$/ }).first().click();
   slotUrl = nativePage.url();
   const nativeSlot = new URL(nativePage.url()).searchParams.get('slot');
   const nativeAttempt = await nativePage.locator('[name="idempotency_key"]').inputValue();
   await nativePage.getByLabel('Nombre y apellido', { exact: true }).fill('Paciente Nativo de Prueba');
   await nativePage.getByLabel('Teléfono de contacto', { exact: true }).fill('1234');
   await nativePage.getByLabel('Correo electrónico', { exact: true }).fill('Native+Retry@Example.test');
   const rejected = nativePage.waitForResponse(response => response.request().method() === 'POST');
   await nativePage.getByRole('button', { name: 'Confirmar reserva', exact: true }).click();
   expect((await rejected).status()).toBe(400);
   await expect(nativePage.getByRole('alert')).toContainText(/teléfono/i);
   await expect(nativePage.getByLabel('Nombre y apellido', { exact: true })).toHaveValue('Paciente Nativo de Prueba');
   await expect(nativePage.getByLabel('Correo electrónico', { exact: true })).toHaveValue('Native+Retry@Example.test');
   await expect(nativePage.locator('[name="idempotency_key"]')).toHaveValue(nativeAttempt);
   expect(new URL(nativePage.url()).searchParams.get('slot')).toBe(nativeSlot);
   expect(new URL(nativePage.url()).searchParams.get('date')).toBe(date);
   expect(f.sql(`select count(*) from public.appointments where business_id='${businessId}';`)).toBe('0');
  } finally { await native.close(); }
  // Make early typing deterministic: the native SSR form is usable while its
  // application scripts are delayed. Observe the standard submit-listener
  // registration to know when progressive enhancement has actually attached.
  // This has to be the first load of the page: WebKit serves modules it already
  // loaded from memory, past any route, and they would start the app at once.
  await page.addInitScript(() => {
   const descriptor = Object.getOwnPropertyDescriptor(EventTarget.prototype, 'addEventListener');
   if (!descriptor || typeof descriptor.value !== 'function') throw new Error('Missing native listener descriptor');
   const original = descriptor.value;
   Object.defineProperty(EventTarget.prototype, 'addEventListener', { ...descriptor,
    value: function(this: EventTarget, ...args: Parameters<EventTarget['addEventListener']>) {
     const result = Reflect.apply(original, this, args);
     if (this instanceof HTMLFormElement && this.classList.contains('patient-booking-form') && args[0] === 'submit')
      this.dataset.bookingEnhanced = 'true';
     return result;
    }
   });
  });
  const scriptGate = new Promise<void>(resolve => { releaseScripts = resolve; });
  const delayScripts = async (route: import('@playwright/test').Route) => {
   if (route.request().resourceType() === 'script') await scriptGate;
   await route.continue();
  };
  await page.route('**/*', delayScripts);
  await page.goto(slotUrl, { waitUntil: 'commit' });
  await page.getByLabel('Nombre y apellido', { exact: true }).fill('Paciente   Reserva   Informada');
  await page.getByLabel('Teléfono de contacto', { exact: true }).fill('3425048230');
  await page.getByLabel('Correo electrónico', { exact: true }).fill('Informed+Booking@Example.test');
  await page.getByLabel('Comentario', { exact: true }).fill('Comentario previo al inicio de JavaScript');
  const preference = page.getByLabel('Preferencia de contacto', { exact: true });
  const preferenceName = await preference.getAttribute('name');
  const birthName = await page.getByLabel('Fecha de nacimiento', { exact: true }).getAttribute('name');
  expect(preferenceName).toMatch(/^intake_/); expect(birthName).toMatch(/^intake_/);
  await preference.selectOption('Tarde');
  await page.getByLabel('Fecha de nacimiento', { exact: true }).fill('1990-01-02');
  releaseScripts();
  await expect(page.locator('.patient-booking-form')).toHaveAttribute('data-booking-enhanced', 'true');
  await page.unroute('**/*', delayScripts);
  await expect(page.getByLabel('Nombre y apellido', { exact: true })).toHaveValue('Paciente   Reserva   Informada');
  await expect(page.getByLabel('Teléfono de contacto', { exact: true })).toHaveValue('3425048230');
  await expect(page.getByLabel('Correo electrónico', { exact: true })).toHaveValue('Informed+Booking@Example.test');
  await expect(page.getByLabel('Comentario', { exact: true })).toHaveValue('Comentario previo al inicio de JavaScript');
  expect(await page.locator('.patient-booking-form').evaluate((form, names) => {
   const data = new FormData(form as HTMLFormElement);
   return names.map(name => data.get(name!));
  }, [preferenceName, birthName])).toEqual(['Tarde', '1990-01-02']);
  await page.getByLabel('Nombre y apellido', { exact: true }).focus();
  await page.getByLabel('Correo electrónico', { exact: true }).focus();
  await expect(page.getByLabel('Nombre y apellido', { exact: true })).toHaveValue('Paciente Reserva Informada');
  const confirm = page.getByRole('button', { name: 'Confirmar reserva', exact: true });
  const attempt = await page.locator('[name="idempotency_key"]').inputValue();
  const notice = page.locator('[data-reschedule-policy-notice]');
  await expect(notice).toContainText('seguirá a cuenta');
  await expect(notice).toContainText('no se pedirá una nueva');
  const initial = JSON.parse(await page.locator('[name="reschedule_policy_terms"]').inputValue());
  expect(initial).toMatchObject({ schema_version: 1, require_deposit_on_reschedule: false, previous_deposit_disposition: 'credit' });
  // Bounded temporary diagnosis: preserve the original setters/reset behavior.
  // Locate whether a framework assignment, native reset or navigation clears
  // already entered fields; never refill them to conceal that failure.
  await page.evaluate(() => {
   const traces: unknown[] = [];
   Reflect.set(window, '__informedBookingTraces', traces);
   const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
   if (!descriptor?.get || !descriptor.set) throw new Error('Missing native input descriptor');
   const get = descriptor.get, set = descriptor.set;
   Object.defineProperty(HTMLInputElement.prototype, 'value', { ...descriptor, set(this: HTMLInputElement, value: string) {
    if (['patient_name','patient_phone','patient_email'].includes(this.name) && get.call(this) && value === '' && traces.length < 30)
     traces.push({ kind: 'empty-assignment', field: this.name, stack: new Error().stack?.slice(0, 2500) });
    set.call(this, value);
   } });
   const reset = HTMLFormElement.prototype.reset;
   HTMLFormElement.prototype.reset = function() {
    if (this.classList.contains('patient-booking-form') && traces.length < 30) traces.push({ kind: 'native-reset', stack: new Error().stack?.slice(0, 2500) });
    return reset.call(this);
   };
  });
  const checkpoint = async (stage: string) => { formCheckpoints.push({ stage, values: await page.locator('.patient-booking-form').evaluate((element: HTMLFormElement) => {
   const form = new FormData(element); return Object.fromEntries(['patient_name','patient_phone','patient_email'].map(key => [key,form.get(key)]));
  }) }); };
  await checkpoint('filled');
  expect(await notice.evaluate((element) => {
   const submit = element.closest('form')?.querySelector('button[type="submit"]');
   return Boolean(submit && element.compareDocumentPosition(submit) & Node.DOCUMENT_POSITION_FOLLOWING);
  })).toBe(true);
  for (const theme of ['light', 'dark'] as const) {
   await applyThemeInPage(page, theme); await expectRenderedTheme(page, theme);
   for (const width of [320, 390, 768, 1280, 1600]) {
    await page.setViewportSize({ width, height: 900 });
    await alignTaskForCapture(notice);
    issues.push(...await layoutIssues(page, '.patient-booking-form button:visible, .patient-booking-form input:visible', '.patient-booking-form'));
    await page.screenshot({ path: info.outputPath(`informed-booking-${theme}-${width}.jpg`), type: 'jpeg', quality: 65 });
    await checkpoint(`${theme}-${width}`);
   }
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  f.sql(`begin; select set_config('request.jwt.claim.sub','${ownerId}',true);
   select public.save_appointment_email_policy('${businessId}',jsonb_build_object('email_enabled',true,'require_email',true,'show_cancel',true,'show_reschedule',true,
    'require_deposit_on_reschedule',true,'previous_deposit_disposition','forfeit'),${initial.policy_revision}); commit;`);
  await confirm.click();
  await expect(page.getByText(/Las condiciones para reprogramar cambiaron mientras reservabas/)).toBeVisible();
  expect(f.sql(`select jsonb_build_array((select count(*) from public.patients where business_id='${businessId}'),(select count(*) from public.appointments where business_id='${businessId}'),
   (select count(*) from private.public_booking_email_contacts where business_id='${businessId}'),(select count(*) from public.audit_logs where business_id='${businessId}' and entity_type='appointment'));`)).toBe('[0, 0, 0, 0]');
  await expect(page.getByLabel('Nombre y apellido', { exact: true })).toHaveValue('Paciente Reserva Informada');
  await expect(page.getByLabel('Correo electrónico', { exact: true })).toHaveValue('Informed+Booking@Example.test');
  await expect(page.locator('[name="idempotency_key"]')).toHaveValue(attempt);
  // The failure refreshes only the offer; the filled fields and operation key
  // remain available for a deliberate second confirmation.
  await expect(notice).toContainText('no se aplicará'); await expect(notice).toContainText('se pedirá una nueva');
  const acceptedAttempt = await page.locator('[name="idempotency_key"]').inputValue();
  expect(acceptedAttempt).toBe(attempt);
  await confirm.click();
  await expect(page).toHaveURL(/\/turno\//);
  expect(f.sql(`select jsonb_build_array((select count(*) from public.appointments where business_id='${businessId}'),
   (select count(*) from public.appointment_management_states where business_id='${businessId}' and terms_acknowledged and require_deposit_on_reschedule and previous_deposit_disposition='forfeit'),
   (select count(*) from public.appointment_deposit_requirements where business_id='${businessId}' and is_current and status='pending' and amount=40000),
   (select count(*) from public.audit_logs where business_id='${businessId}' and action='appointment.reschedule_policy_informed'),
   (select count(*) from public.appointments where business_id='${businessId}' and creation_request_key='${acceptedAttempt}'));`)).toBe('[1, 1, 1, 1, 1]');
  // Exercise the consequence of the actual initial disclosure; do not seed
  // terms_acknowledged as the older management fixtures intentionally do.
  const appointmentId = f.sql(`select id from public.appointments where business_id='${businessId}';`);
  expect(appointmentId).toMatch(/^[a-f0-9-]{36}$/);
  f.sql(`begin; select set_config('request.jwt.claim.sub','${ownerId}',true);
   select public.set_appointment_deposit('${businessId}','${appointmentId}','paid',
    (select revision from public.appointment_deposits where appointment_id='${appointmentId}'),null); commit;`);
  await page.reload();
  const moneyState = () => f.sql(`select jsonb_build_array(a.starts_at,a.status,
   (select jsonb_agg(jsonb_build_array(status,amount,allocation,is_current) order by ordinal) from public.appointment_deposit_requirements where appointment_id=a.id))
   from public.appointments a where a.id='${appointmentId}';`);
  const beforeMove = moneyState();
  await page.getByRole('link', { name: 'Reprogramar turno', exact: true }).click();
  const targetDate = f.sql(`select to_char(starts_at::date+1,'YYYY-MM-DD') from public.appointments where id='${appointmentId}';`);
  await page.locator('[name="fecha"]').fill(targetDate);
  await page.getByRole('button', { name: 'Ver horarios', exact: true }).click();
  await page.locator('[aria-label="Horarios disponibles"] a').first().click();
  await expect(page.getByText(/La seña anterior de.*dejará de aplicarse/)).toBeVisible();
  await expect(page.getByText(/Nueva seña pendiente/)).toBeVisible();
  expect(moneyState()).toBe(beforeMove);
  await page.getByRole('button', { name: 'Confirmar reprogramación', exact: true }).click();
  await expect(page.getByText('La reprogramación quedó registrada.', { exact: true })).toBeVisible();
  expect(f.sql(`select jsonb_build_array((select status from public.appointments where id='${appointmentId}'),
   (select count(*) from public.appointment_deposit_requirements where appointment_id='${appointmentId}' and status='paid' and allocation='forfeited'),
   (select count(*) from public.appointment_deposit_requirements where appointment_id='${appointmentId}' and is_current and status='pending' and amount=40000));`)).toBe('["reserved", 1, 1]');
  await page.getByRole('link', { name: 'Cancelar turno', exact: true }).click();
  await page.getByRole('button', { name: 'Sí, cancelar turno', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Turno cancelado', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Cancelar turno', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Reprogramar turno', exact: true })).toHaveCount(0);
  expect(pageErrors.unexpected()).toEqual([]); expect(issues).toEqual([]);
  await info.attach('informed-booking-proof', { body: JSON.stringify({ actualPublicPost: true, staleRejectedAtomically: true, attemptAndAliasPreserved: true, freshTermsPersisted: true,
   noJavaScriptFailureRetainsSelectionAndDraft: true, earlyNativeInputRetained: true, earlyChoiceAndBirthDateRetained: true, enhancementObservedViaSubmitListener: true,
   paymentRecordedBySqlCommand: true, actualInformedReschedule: true, originalPaymentRetainedAsForfeited: true, oneNewPendingDeposit: true, cancelledHasNeitherAction: true, issues, pageErrors }), contentType: 'application/json' });
 } finally {
  releaseScripts();
  try {
   await info.attach('informed-booking-form-diagnosis', { body: JSON.stringify({ formCheckpoints, browserEvents,
   traces: await page.evaluate(() => Reflect.get(window, '__informedBookingTraces') ?? []) }), contentType: 'application/json' });
  } finally {
   f.sql(`begin; delete from public.appointments where business_id='${businessId}'; delete from public.businesses where id='${businessId}'; delete from auth.users where id='${ownerId}';
    update private.deposit_automation set enabled=${original.deposit}; update private.appointment_management_runtime set reschedule_enabled=${original.reschedule}; commit;`);
   expect(f.sql(`select count(*) from public.businesses where id='${businessId}';`)).toBe('0');
  }
 }
});
