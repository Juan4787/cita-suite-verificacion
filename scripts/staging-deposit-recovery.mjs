import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { STAGING_PROJECT_REF, stagingConnection, stagingPsql, psqlDiagnostics } from './lib/staging-database.mjs';
import { STAGING_APP_ORIGIN, stagingSupabaseKey } from './lib/staging-deploy.mjs';
import { assertHostedIntegrationResources } from './lib/verification-resources.mjs';

// One explicitly owned staging practice. Never uses a production connection or existing practice.
const [mode, revision] = process.argv.slice(2);
if (!['seed', 'check', 'cleanup'].includes(mode) || (mode === 'check' && !/^[a-f0-9]{40}$/.test(revision ?? ''))
 || process.argv.length !== (mode === 'check' ? 4 : 3)) throw new Error('Usage: staging-deposit-recovery.mjs seed|cleanup | check <served SHA>');
if (mode === 'check') assertHostedIntegrationResources();
const root = fileURLToPath(new URL('../', import.meta.url));
const database = stagingConnection(process.env.CITA_STAGING_DATABASE_URL);
const serviceKey = stagingSupabaseKey([{ name: 'service_role', type: 'legacy', api_key: process.env.CITA_STAGING_SERVICE_ROLE_KEY }], 'service_role');
const api = `https://${STAGING_PROJECT_REF}.supabase.co`;
const email = 'deposit-recovery-owner@cita-suite-staging.test';
const password = createHash('sha256').update(serviceKey + ':deposit-recovery-staging').digest('hex') + 'aA1!';
const id = label => { const h = createHash('md5').update('cita-deposit-recovery-20261030:' + label).digest('hex');
 return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20)}`; };
const b = id('business'), p = id('professional'), s = id('service'), excluded = id('excluded'), patient = id('patient');
const sql = (text, write = false) => {
 const result = stagingPsql(database, ['-Atq', '-f', '-'], { input: `${write ? 'begin;' : 'begin transaction read only;'}
 set local lock_timeout='5s'; set local statement_timeout='30s';
 ${text}
 commit;`, options: '-c application_name=cita_staging_deposit_recovery' });
 if (result.error || result.status !== 0) throw new Error('STAGING_DEPOSIT_SQL_FAILED\n' + psqlDiagnostics(result.stderr));
 return result.stdout.trim();
};
const json = text => JSON.parse(sql(text));
async function auth(path, method, body) {
 const response = await fetch(`${api}/auth/v1/admin/${path}`, { method, signal: AbortSignal.timeout(30_000),
  headers: { apikey: serviceKey, authorization: `Bearer ${serviceKey}`, 'content-type': 'application/json' },
  ...(body ? { body: JSON.stringify(body) } : {}) });
 if (!response.ok) throw new Error(`STAGING_DEPOSIT_AUTH_FAILED_${response.status}`);
 return response.json();
}
const ownership = () => json(`select json_build_object(
 'business', (select slug from public.businesses where id='${b}'),
 'owners', (select coalesce(json_agg(u.user_id), '[]'::json) from public.business_users u join auth.users a on a.id=u.user_id
  where u.business_id='${b}' and a.email='${email}' and u.role='owner'),
 'members', (select count(*) from public.business_users where business_id='${b}'),
 'otherMemberships', (select count(*) from public.business_users u join auth.users a on a.id=u.user_id where a.email='${email}' and u.business_id<>'${b}'),
 'documents', (select count(*) from public.patient_radiographs where business_id='${b}'))::text;`);
const requireOwner = () => { const own = ownership();
 if (own.business !== 'deposit-recovery-20261030' || own.owners.length !== 1 || own.members !== 1 || own.otherMemberships !== 0 || own.documents !== 0)
  throw new Error('STAGING_DEPOSIT_OWNERSHIP_NOT_VERIFIED');
 return own.owners[0]; };
const state = () => json(`select json_build_object('globalOff', (select enabled is false from private.deposit_automation where singleton),
 'policy', (select count(*) from public.deposit_policies where business_id='${b}' and enabled and not auto_cancel_enabled and fixed_amount=40000),
 'exclusions', (select count(*) from public.deposit_service_exclusions where business_id='${b}'),
 'slots', (select count(*) from public.appointment_slot_releases where business_id='${b}'),
 'deposits', (select coalesce(json_agg(json_build_array(a.status,d.status,d.amount) order by a.id), '[]'::json)
  from public.appointments a join public.appointment_deposits d on d.appointment_id=a.id where a.business_id='${b}'))::text;`);
const expectedDeposits = ['pending','paid','waived'].map(status => ({ id: id(status), row: [status === 'pending' ? 'reserved' : 'confirmed',status,40000] }))
 .sort((a,b) => a.id.localeCompare(b.id)).map(item => item.row);
function verifyState() { const result = state();
 if (result.globalOff !== true || result.policy !== 1 || result.exclusions !== 1 || result.slots !== 1 || JSON.stringify(result.deposits) !== JSON.stringify(expectedDeposits))
  throw new Error('STAGING_DEPOSIT_STATE_NOT_VERIFIED');
 return result;
}
const receipt = { projectRef: STAGING_PROJECT_REF, mode, revision: revision ?? null, startedAt: new Date().toISOString(), ok: false };
let browser;
try {
 if (mode === 'seed') {
  const before = json(`select json_build_object('businesses',(select count(*) from public.businesses where id='${b}' or slug='deposit-recovery-20261030'),
   'owners',(select count(*) from auth.users where email='${email}'), 'globalOff',(select enabled is false from private.deposit_automation where singleton))::text;`);
  if (before.businesses !== 0 || before.owners !== 0 || before.globalOff !== true) throw new Error('STAGING_DEPOSIT_SEED_NOT_EMPTY_OR_STOPPED');
  const user = await auth('users','POST',{ email, password, email_confirm: true });
  const owner = user.id;
  if (!/^[a-f0-9-]{36}$/.test(owner ?? '')) throw new Error('STAGING_DEPOSIT_OWNER_INVALID');
  try {
   sql(`insert into public.businesses(id,name,slug,industry,timezone) values('${b}','Ensayo de recuperación de señas','deposit-recovery-20261030','other','America/Argentina/Cordoba');
    update public.business_subscriptions set commercial_access_enabled=true,is_permanent=true,subscription_status='active',paid_until=null,grace_until=null,restricted_until=null,archived_at=null where business_id='${b}';
    insert into public.business_users(business_id,user_id,role,status,accepted_at) values('${b}','${owner}','owner','active',now());
    insert into public.professionals(id,business_id,name) values('${p}','${b}','Profesional sintética de recuperación');
    insert into public.services(id,business_id,name,duration_minutes) values('${s}','${b}','Consulta sintética',60),('${excluded}','${b}','Prestación sin seña',60);
    insert into public.professional_services(business_id,professional_id,service_id) values('${b}','${p}','${s}'),('${b}','${p}','${excluded}');
    insert into public.availability_rules(business_id,professional_id,weekday,start_time,end_time,slot_interval_minutes,break_minutes)
     select '${b}','${p}',n,'09:00','17:00',60,0 from generate_series(0,6) n;
    insert into public.patients(id,owner_id,business_id,full_name) values('${patient}','${owner}','${b}','Paciente sintética de recuperación');
    insert into public.deposit_policies(business_id,enabled,auto_cancel_enabled,amount_mode,fixed_amount,transfer_details)
     values('${b}',true,false,'fixed',40000,'Datos sintéticos del ensayo');
    insert into public.deposit_service_exclusions(business_id,service_id) values('${b}','${excluded}');
    -- Only this transaction sees ON; no hosted job or other practice can observe it.
    update private.deposit_automation set enabled=true where singleton;
    ${['pending','paid','waived','released'].map((label,index) => `insert into public.appointments(id,business_id,patient_id,patient_name_at_booking,service_id,professional_id,
     starts_at,ends_at,blocking_starts_at,blocking_ends_at,status,source,service_name_snapshot,professional_name_snapshot,duration_minutes_snapshot,created_at)
     select '${id(label)}','${b}','${patient}','Paciente sintética de recuperación','${label === 'released' ? excluded : s}','${p}',t,t+interval '1 hour',t,t+interval '1 hour',
     'reserved','manual','Consulta sintética','Profesional sintética de recuperación',60,now()-interval '1 hour'
     from (select ((current_date+10)::text||' ${9+index}:00')::timestamp at time zone 'America/Argentina/Cordoba' as t) timing;`).join('\n')}
    update public.appointment_deposits set status='paid',recorded_at=now(),recorded_by='${owner}' where appointment_id='${id('paid')}';
    update public.appointment_deposits set status='waived',waived_reason='staff',recorded_at=now(),recorded_by='${owner}' where appointment_id='${id('waived')}';
    update public.appointments set status='confirmed',confirmed_at=now() where id in ('${id('paid')}','${id('waived')}');
    update public.appointments set status='cancelled',cancelled_at=now(),cancelled_by_user_id='${owner}' where id='${id('released')}';
    update private.deposit_automation set enabled=false where singleton;`, true);
  } catch (error) { await auth(`users/${owner}`,'DELETE'); throw error; }
  receipt.state = verifyState();
 } else {
  const owner = requireOwner();
  if (mode === 'cleanup') {
   sql(`delete from public.appointments where business_id='${b}'; delete from public.booking_integrations where business_id='${b}';
    delete from public.businesses where id='${b}';
    do $$declare r record; n bigint; begin
     for r in select c.table_schema,c.table_name from information_schema.columns c join information_schema.tables t
      on t.table_schema=c.table_schema and t.table_name=c.table_name where c.column_name='business_id'
      and c.table_schema in ('public','private') and t.table_type='BASE TABLE' loop
      execute format('select count(*) from %I.%I where business_id=%L',r.table_schema,r.table_name,'${b}') into n;
      if n<>0 then raise exception 'STAGING_DEPOSIT_CLEANUP_ROWS'; end if;
     end loop;
    end $$;`, true);
   await auth(`users/${owner}`,'DELETE');
   receipt.remaining = json(`select json_build_object('businesses',(select count(*) from public.businesses where id='${b}'),
    'owners',(select count(*) from auth.users where email='${email}'))::text;`);
   if (receipt.remaining.businesses !== 0 || receipt.remaining.owners !== 0) throw new Error('STAGING_DEPOSIT_CLEANUP_INCOMPLETE');
  } else {
   receipt.before = verifyState();
   const served = await (await fetch(`${STAGING_APP_ORIGIN}/_app/version.json`, { signal: AbortSignal.timeout(20_000) })).json();
   if (served.version !== revision) throw new Error('STAGING_DEPOSIT_REVISION_MISMATCH');
   const require = createRequire(join(root,'apps/web/package.json'));
   const { chromium, expect } = require('@playwright/test');
   browser = await chromium.launch({ headless: true });
   const page = await browser.newPage({ viewport: { width: 1280,height: 900 } });
   page.setDefaultTimeout(20_000);
   const pageErrors = [], failedResponses = [];
   page.on('pageerror',error => pageErrors.push(error.name));
   page.on('response',response => { if (response.status() >= 500) failedResponses.push(response.status()); });
   await page.goto(`${STAGING_APP_ORIGIN}/login`);
   await page.getByLabel('Correo electrónico').fill(email);await page.getByLabel('Contraseña').fill(password);
   await Promise.all([page.waitForURL(url => !url.pathname.startsWith('/login')),page.getByRole('button',{name:'Ingresar',exact:true}).click()]);
   for (const [label,text] of [['pending','Seña pendiente'],['paid','Seña recibida'],['waived','Seña exceptuada']]) {
    await page.goto(`${STAGING_APP_ORIGIN}/odonto/turnos/${id(label)}`);
    const panel=page.locator('[data-deposit-panel]');await expect(panel.getByText(text,{exact:true})).toBeVisible();
   }
   await page.goto(`${STAGING_APP_ORIGIN}/odonto/turnos/${id('pending')}`);
   const panel=page.locator('[data-deposit-panel]');
   await panel.getByRole('button',{name:'Confirmar seña',exact:true}).click();
   await expect(panel.getByText('Seña recibida',{exact:true})).toBeVisible();
   const paid=json(`select json_build_object('status',a.status,'deposit',d.status) from public.appointments a join public.appointment_deposits d on d.appointment_id=a.id where a.id='${id('pending')}';`);
   if (paid.status !== 'confirmed' || paid.deposit !== 'paid') throw new Error('STAGING_DEPOSIT_PAID_NOT_PERSISTED');
   await panel.locator('summary').filter({hasText:'Deshacer'}).click();
   await panel.getByRole('button',{name:'Sí, deshacer el registro',exact:true}).click();
   await expect(panel.getByText('Seña pendiente',{exact:true})).toBeVisible();
   receipt.after=verifyState();receipt.paidAndReopened=true;
   receipt.audit=json(`select json_build_object('paid',(select count(*) from public.audit_logs where entity_id='${id('pending')}' and action='appointment.deposit_paid'),
    'reopened',(select count(*) from public.audit_logs where entity_id='${id('pending')}' and action='appointment.deposit_reopened'))::text;`);
   if (receipt.audit.paid < 1 || receipt.audit.reopened < 1) throw new Error('STAGING_DEPOSIT_AUDIT_MISSING');
   receipt.render={pageErrors,failedResponses};
   if (pageErrors.length || failedResponses.length) throw new Error('STAGING_DEPOSIT_RENDER_FAILED');
  }
 }
 receipt.ok=true;
} catch(error) { receipt.error=String(error.message).replaceAll(password,'[secret]').replaceAll(serviceKey,'[secret]');process.exitCode=1; }
finally {
 if(browser) await browser.close();
 receipt.finishedAt=new Date().toISOString();mkdirSync(join(root,'.verification'),{recursive:true});
 writeFileSync(join(root,`.verification/staging-deposit-recovery-${mode}${revision ? '-'+revision : ''}.json`),JSON.stringify(receipt,null,2)+'\n');
 console.log(JSON.stringify(receipt,null,2));
}
