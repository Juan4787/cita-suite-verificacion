import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { must, write } from './helpers/fixture-db';
import { ownedAppointmentFixture } from './helpers/owned-appointment-fixture';
import { loginWithSharedSession } from './helpers/shared-auth';
import { layoutIssues, type LayoutIssue } from './helpers/layout-usability';
import { alignTaskForCapture } from './helpers/task-capture';
import { observeRenderHealth } from './helpers/render-health';

async function matrix(page: Page, info: TestInfo, label: string, issues: Array<LayoutIssue & { screen: string; width: number }>) {
 const first = issues.length;
 for (const width of [320, 390, 768, 1280, 1600]) {
  await page.setViewportSize({ width, height: 900 });
  issues.push(...(await layoutIssues(page, 'main a:visible, main button:visible, main input:visible, main select:visible', 'main'))
   .map(issue => ({ ...issue, screen: label, width })));
  await alignTaskForCapture(page.locator('[data-slot-release-alert]'));
  await page.screenshot({ path: info.outputPath(`${label}-${width}.jpg`), type: 'jpeg', quality: 65 });
 }
 await info.attach(`${label}-layout`, { body: JSON.stringify({ widths: [320, 390, 768, 1280, 1600], issues: issues.slice(first) }), contentType: 'application/json' });
 await page.setViewportSize({ width: 1280, height: 900 });
}

test('appointment slots released: real cancellation, reassignment, occupation and hiding keep availability consistent', {
 tag: '@candidate-behavior'
}, async ({ page }, info) => {
 test.setTimeout(240_000);
 const f = ownedAppointmentFixture();
 const health = await observeRenderHealth(page);
 const link = await must(f.admin.from('professional_services').select('professional_id, service_id').eq('business_id', f.businessId).limit(1).single());
 const professional = await must(f.admin.from('professionals').select('name').eq('business_id', f.businessId).eq('id', link.professional_id).single());
 const service = await must(f.admin.from('services').select('name, duration_minutes').eq('id', link.service_id).eq('business_id', f.businessId).single());
 const business = await must(f.admin.from('businesses').select('timezone').eq('id', f.businessId).single());
 const owner = await must(f.admin.from('business_users').select('user_id').eq('business_id', f.businessId).eq('role', 'owner').single());
 const date = new Intl.DateTimeFormat('sv-SE', { timeZone: business.timezone }).format(new Date(Date.now() + 5 * 86_400_000));
 const startsAt = new Date(f.sql("select (:'date'||' 09:00')::timestamp at time zone (select timezone from public.businesses where id=:'business'::uuid);", { date })).toISOString();
 const endsAt = new Date(Date.parse(startsAt) + service.duration_minutes * 60_000).toISOString();
 const suffix = [...randomUUID().slice(0, 8)].map(char => String.fromCharCode(97 + parseInt(char, 16))).join('');
 const patientName = `Paciente de horario liberado ${suffix}`;
 const patientPhone = '3425' + String(Date.now() % 1_000_000).padStart(6, '0');
 const longName = 'Profesional de nombre y apellido compuestos para revisar el horario liberado en una pantalla pequeña';
 let patientId: string | null = null;
 const appointmentIds: string[] = [];
 const issues: Array<LayoutIssue & { screen: string; width: number }> = [];
 const base = `/odonto/agenda?${new URLSearchParams({ date, status: 'reserved' })}`;
 const cancelThroughUI = async (id: string) => {
  await page.goto(`/odonto/turnos/${id}`);
  await page.locator('summary').filter({ hasText: /^Cancelar turno$/ }).click();
  await page.getByRole('checkbox', { name: 'Confirmo que quiero cancelar este turno.', exact: true }).check();
  await page.getByRole('button', { name: 'Cancelar turno', exact: true }).click();
  expect((await must(f.admin.from('appointments').select('status').eq('business_id', f.businessId).eq('id', id).single())).status).toBe('cancelled');
 };
 try {
  await write(f.admin.from('professionals').update({ name: longName }).eq('business_id', f.businessId).eq('id', link.professional_id));
  const patient = await must(f.admin.from('patients').insert({ business_id: f.businessId, owner_id: owner.user_id, full_name: patientName,
   phone: patientPhone, phone_e164: '+549' + patientPhone }).select('id').single());
  patientId = patient.id;
  // Age belongs only to this owned synthetic fixture. No real half-hour wait is needed.
  const appointment = await must(f.admin.from('appointments').insert({ business_id: f.businessId, patient_id: patient.id,
   service_id: link.service_id, professional_id: link.professional_id, starts_at: startsAt, ends_at: endsAt,
   blocking_starts_at: startsAt, blocking_ends_at: endsAt, status: 'reserved', source: 'manual',
   service_name_snapshot: service.name, professional_name_snapshot: longName, duration_minutes_snapshot: service.duration_minutes,
   patient_name_at_booking: patientName,
   created_at: new Date(Date.now() - 3_600_000).toISOString() }).select('id').single());
  appointmentIds.push(appointment.id);
  await loginWithSharedSession(page, { email: f.email, password: f.password });
  await cancelThroughUI(appointment.id);
  const release = await must(f.admin.from('appointment_slot_releases').select('id, reason, starts_at, professional_id')
   .eq('business_id', f.businessId).eq('appointment_id', appointment.id).single());
  expect(release).toMatchObject({ reason: 'practice_cancelled', professional_id: link.professional_id });
  expect(new Date(release.starts_at).toISOString()).toBe(startsAt);
  await page.goto(base);
  const row = page.locator(`[data-slot-release="${release.id}"]`);
  await expect(row).toContainText(longName);
  await expect(row).toContainText('Canceló el consultorio');
  await matrix(page, info, 'horario-liberado', issues);
  await page.getByRole('combobox', { name: 'Ver próximos días', exact: true }).selectOption('30');
  await page.locator('[data-slot-release-alert]').getByRole('button', { name: 'Actualizar', exact: true }).click();
  await expect(page).toHaveURL(/dias_liberados=30/);
  expect(new URL(page.url()).searchParams.get('status')).toBe('reserved');
  await expect(row).toBeVisible();
  const give = row.getByRole('link', { name: 'Dar este horario', exact: true });
  await give.focus();await expect(give).toBeFocused();await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: '¿Para quién es el turno?', exact: true })).toBeVisible();
  expect(await page.locator('input[name="time"]').inputValue()).toBe('09:00');
  await page.getByRole('button', { name: /Buscar paciente/ }).click();
  await page.getByLabel('Buscar por nombre, teléfono o DNI', { exact: true }).fill(patientName);
  await page.getByRole('button', { name: new RegExp(patientName) }).click();
  await page.getByRole('button', { name: 'Confirmar turno', exact: true }).click();
  await expect(page).toHaveURL(url => /^\/odonto\/turnos\/[0-9a-f-]+$/.test(url.pathname)
   && url.searchParams.get('created') === '1' && url.searchParams.get('from_date') === date);
  const replacementId = new URL(page.url()).pathname.split('/').at(-1)!;
  appointmentIds.push(replacementId);
  const replacement = await must(f.admin.from('appointments').select('id, status, starts_at, patient_id').eq('business_id', f.businessId).eq('id', replacementId).single());
  expect(replacement).toMatchObject({ status: 'reserved', patient_id: patient.id });
  expect(new Date(replacement.starts_at).toISOString()).toBe(startsAt);
  await page.goto(base);
  await expect(row).toHaveCount(0); // The occupied interval disappears without hiding it.

  // A second genuine release after a synthetic occupancy age tests hiding and availability.
  f.sql("update public.appointments set created_at=clock_timestamp()-interval '1 hour' where business_id=:'business'::uuid and id=:'appointment'::uuid;", { appointment: replacementId });
  await cancelThroughUI(replacementId);
  const second = await must(f.admin.from('appointment_slot_releases').select('id').eq('business_id', f.businessId).eq('appointment_id', replacementId).single());
  await page.goto(base);
  const secondRow = page.locator(`[data-slot-release="${second.id}"]`);
  await expect(secondRow).toBeVisible();await expect(row).toHaveCount(0);
  await secondRow.getByRole('button', { name: 'Ocultar', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Aviso ocultado. El horario sigue disponible para reservar.');
  await expect(secondRow).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '¿Para quién es el turno?', exact: true })).toHaveCount(0);
  const hidden = await must(f.admin.from('appointment_slot_releases').select('hidden_at, hidden_by').eq('id', second.id).eq('business_id', f.businessId).single());
  expect(hidden.hidden_at).not.toBeNull();expect(hidden.hidden_by).toBe(owner.user_id);
  expect(await must(f.admin.from('audit_logs').select('id').eq('business_id', f.businessId).eq('action', 'appointment.slot_release_hidden').eq('entity_id', replacementId))).toHaveLength(1);
  for (const theme of ['light', 'dark']) {
   await page.goto(`/embed/v1/${f.integrationKey}?${new URLSearchParams({ service_id: link.service_id, professional_id: link.professional_id, date, modality: 'in_person', color_mode: theme })}`);
   await expect(page.getByRole('link', { name: '09:00', exact: true })).toBeVisible();
  }
  await health.assertAndAttach(info, 'slot-release-real-browser-health');
  expect(issues).toEqual([]);
 } finally {
  f.sql(`begin;
   delete from public.audit_logs where business_id=:'business'::uuid and (entity_id=:'patient'::uuid or entity_id in (select id from public.appointments where business_id=:'business'::uuid and patient_id=:'patient'::uuid));
   delete from public.appointments where business_id=:'business'::uuid and patient_id=:'patient'::uuid;
   delete from public.patients where business_id=:'business'::uuid and id=:'patient'::uuid;
   update public.professionals set name=:'previous_name' where business_id=:'business'::uuid and id=:'professional'::uuid;
   commit;`, { patient: patientId ?? '00000000-0000-0000-0000-000000000000', previous_name: professional.name, professional: link.professional_id });
  expect((await must(f.admin.from('professionals').select('name').eq('business_id', f.businessId).eq('id', link.professional_id).single())).name).toBe(professional.name);
  if (patientId) expect(await must(f.admin.from('patients').select('id').eq('business_id', f.businessId).eq('id', patientId))).toHaveLength(0);
  if (appointmentIds.length) {
   expect(await must(f.admin.from('appointments').select('id').eq('business_id', f.businessId).in('id', appointmentIds))).toHaveLength(0);
   expect(await must(f.admin.from('appointment_slot_releases').select('id').eq('business_id', f.businessId).in('appointment_id', appointmentIds))).toHaveLength(0);
  }
 }
});
