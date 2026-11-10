import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { must } from './helpers/fixture-db';
import { ownedAppointmentFixture } from './helpers/owned-appointment-fixture';
import { loginWithSharedSession } from './helpers/shared-auth';
import { observeRenderHealth } from './helpers/render-health';
import { layoutIssues, type LayoutIssue } from './helpers/layout-usability';
import { alignTaskForCapture } from './helpers/task-capture';

// Host Browser capability is absent. Use the existing sequential isolated CI
// browser, actual Auth/PostgREST and owned synthetic records. No email is sent.
test('@candidate-behavior staff management: coherent observation, stale write, uncertain receipt and native cancellation', async ({ page, context, browser }, info) => {
 test.setTimeout(180_000);
 const f = ownedAppointmentFixture();
 const origin = new URL(process.env.E2E_BASE_URL!);
 if (origin.hostname !== '127.0.0.1' || origin.protocol !== 'http:') throw new Error('Staff browser needs its owned loopback app');
 const appointmentId = randomUUID(), noJsId = randomUUID(), patientId = randomUUID();
 const ownerId = f.sql(`select user_id from public.business_users where business_id='${f.businessId}' and role='owner' and status='active' limit 1;`);
 expect(ownerId).toMatch(/^[a-f0-9-]{36}$/);
 const assignment = await must(f.admin.from('professional_services').select('service_id,professional_id').eq('business_id', f.businessId).limit(1).single());
 const issues: LayoutIssue[] = [];
 const health = await observeRenderHealth(page);
 let native: Awaited<ReturnType<typeof browser.newContext>> | null = null;
 const state = () => f.sql(`select jsonb_build_array(a.starts_at,a.ends_at,a.status,a.calendar_sequence,
  (select count(*) from public.audit_logs where entity_id=a.id),
  (select count(*) from private.appointment_management_operations where appointment_id=a.id))
  from public.appointments a where a.id='${appointmentId}';`);
 const observed = async () => Object.fromEntries(await page.locator('form[action="?/reschedule"]').evaluate(form =>
  [...new FormData(form as HTMLFormElement)].map(([key,value]) => [key,String(value)])));
 const matrix = async (screen: string) => {
  for (const theme of ['light','dark']) {
   await context.addCookies([{ name:'cita-theme',value:theme,url:origin.origin }]);
   await page.goto(`/odonto/turnos/${appointmentId}`);
   for (const width of [320,390,768,1280,1600]) {
    await page.setViewportSize({ width,height:900 });
    issues.push(...await layoutIssues(page,'main a:visible, main button:visible, main input:visible, main textarea:visible','main'));
    await alignTaskForCapture(page.locator('#reprogramar'));
    await page.screenshot({ path:info.outputPath(`${screen}-${theme}-${width}.jpg`),type:'jpeg',quality:65 });
   }
  }
  await page.setViewportSize({ width:1280,height:900 });
 };
 const choose = async () => {
  const response = page.waitForResponse(response => new URL(response.url()).pathname.endsWith(`/turnos/${appointmentId}/slots`));
  await page.locator('#reprogramar > summary').click();
  const batch = await (await response).json() as { slots: { time:string;starts_at:string }[];availabilityRevision:number;durationMinutes:number };
  const current = await must(f.admin.from('appointments').select('starts_at').eq('id',appointmentId).single());
  const slot = batch.slots.find(slot => Date.parse(slot.starts_at)!==Date.parse(current.starts_at));
  expect(slot,'Synthetic staff fixture must have another real slot').toBeTruthy();
  await page.getByRole('button',{ name:slot!.time,exact:true }).click();
  await expect(page.locator('[name="availability_revision"]')).toHaveValue(String(batch.availabilityRevision));
  await expect(page.getByText(`Duración de la consulta: ${batch.durationMinutes} minutos.`)).toBeVisible();
  return slot!;
 };
 try {
  f.sql(`begin;
   insert into public.patients(id,business_id,owner_id,full_name) values('${patientId}','${f.businessId}','${ownerId}','Paciente sintético de operación');
   insert into public.appointments(id,business_id,patient_id,service_id,professional_id,starts_at,ends_at,status,source,
    service_name_snapshot,professional_name_snapshot,duration_minutes_snapshot)
    select identifier,'${f.businessId}','${patientId}','${assignment.service_id}','${assignment.professional_id}',starts,starts+make_interval(mins=>s.duration_minutes),
     'reserved','manual','Consulta sintética','Profesional sintético',s.duration_minutes from public.businesses b,public.services s,
     (values ('${appointmentId}'::uuid,20),('${noJsId}'::uuid,22)) f(identifier,days),
     lateral (select ((now() at time zone b.timezone)::date+days+time '12:00') at time zone b.timezone as starts) t where b.id='${f.businessId}' and s.id='${assignment.service_id}' and s.business_id=b.id;
   commit;`);
  await loginWithSharedSession(page,{ email:f.email,password:f.password });
  await page.goto(`/odonto/turnos/${appointmentId}`);
  expect(new URL(page.url()).pathname).toBe(`/odonto/turnos/${appointmentId}`);
  // The actual PostgREST computed field must match the displayed row. SQL-only
  // invocation or generated types cannot establish this HTTP guarantee.
  const revision = f.sql(`select private.appointment_semantic_revision('${f.businessId}','${appointmentId}');`);
  await expect(page.locator('form[action="?/update_status"] [name="expected_revision"]')).toHaveValue(revision);
  const untouched = state();
  await matrix('staff-detail'); expect(state()).toBe(untouched);
  await choose();
  // Another writer changes only the time while preserving Reserved. The old
  // form must reject, rather than bless a fresh revision in the action.
  f.sql(`update public.appointments set starts_at=starts_at+interval '1 day',ends_at=ends_at+interval '1 day' where id='${appointmentId}';`);
  const concurrent = state();
  await page.getByRole('button',{ name:/^Reprogramar a las/ }).click();
  await expect(page.getByRole('alert')).toContainText('Este turno cambió');
  await expect(page.getByRole('alert')).toBeFocused();
  await expect(page.getByRole('alert')).toBeInViewport(); expect(state()).toBe(concurrent);
  await page.reload();
  // A click on «Reprogramar» before the page hydrates is lost: the browser opens the section and
  // `bind:open` closes it again without asking for slots (run 42916668842, 10 November 2026).
  await page.waitForLoadState('networkidle');
  const slot = await choose(), original = await observed();
  const path = `**/odonto/turnos/${appointmentId}?/reschedule`;
  let interrupted = false;
  await page.route(path,async route => {
   if (interrupted) return route.continue();
   interrupted = true;
   // Forward to the REAL action and commit, then destroy only the response.
   // This is an unreadable response, not a fake command success or rollback.
   const reply = await route.fetch(); expect(reply.status()).toBe(200);
   await route.fulfill({ status:200,contentType:'text/plain',body:'Respuesta interrumpida' });
  });
  await page.getByRole('button',{ name:/^Reprogramar a las/ }).click();
  await expect(page.getByRole('alert')).toContainText('No pudimos comprobar el resultado');
  await expect(page.getByRole('alert')).toBeFocused(); await expect(page.getByRole('alert')).toBeInViewport();
  expect(interrupted).toBe(true);
  const committed = await must(f.admin.from('appointments').select('starts_at').eq('id',appointmentId).single());
  expect(Date.parse(committed.starts_at)).toBe(Date.parse(slot.starts_at));
  const saved = state();
  const retry = page.getByRole('button',{ name:'Reintentar la misma acción' });
  expect(Object.fromEntries(await retry.locator('..').evaluate(form => [...new FormData(form as HTMLFormElement)].map(([k,v])=>[k,String(v)])))).toEqual(original);
  await retry.click();
  await expect(page.getByRole('status')).toContainText('Esta acción ya estaba guardada');
  expect(state()).toBe(saved);
  await page.unroute(path);
  // Explicit cancellation, including the unenhanced HTML contract.
  native = await browser.newContext({ javaScriptEnabled:false,baseURL:origin.origin,storageState:await context.storageState() });
  const nativePage = await native.newPage();
  await nativePage.goto(`/odonto/turnos/${noJsId}`);
  await nativePage.locator('summary').filter({ hasText:'Cancelar turno' }).click();
  await nativePage.getByRole('checkbox',{ name:'Confirmo que quiero cancelar este turno.' }).check();
  await nativePage.getByRole('button',{ name:'Cancelar turno',exact:true }).click();
  await expect(nativePage.getByRole('status')).toContainText('El turno quedó cancelado');
  expect((await must(f.admin.from('appointments').select('status').eq('id',noJsId).single())).status).toBe('cancelled');
  await expect(nativePage.locator('form[action="?/update_status"], form[action="?/reschedule"]')).toHaveCount(0);
  expect(issues).toEqual([]);
  await health.assertAndAttach(info,'staff-management-health');
  await info.attach('staff-management-scope',{ body:JSON.stringify({ actualAuthPostgrest:true,computedFieldHttp:true,
   staleStatePreserved:true,unreadableCommittedResponseRecovered:true,noJsCancellation:true,emailDelivery:false }),contentType:'application/json' });
 } finally {
  await native?.close();
  f.sql(`begin; delete from public.appointments where business_id='${f.businessId}' and id in ('${appointmentId}','${noJsId}');
   delete from public.patients where business_id='${f.businessId}' and id='${patientId}'; commit;`);
  expect(f.sql(`select count(*) from public.appointments where id in ('${appointmentId}','${noJsId}');`)).toBe('0');
 }
});
