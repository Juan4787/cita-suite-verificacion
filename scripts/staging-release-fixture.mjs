import { psqlDiagnostics, stagingConnection, stagingPsql } from './lib/staging-database.mjs';
import { STAGING_APP_ORIGIN, STAGING_NATALIA_ORIGIN, STAGING_RELEASE_PRACTICE as practice } from './lib/staging-deploy.mjs';

// The synthetic practice of the release verification on staging: Natalia's staging copy books
// into it through its own integration, and the shared link through the default one. Created once
// and kept, like a real practice; every later run only verifies it, so a drifted configuration
// fails the release instead of being repaired in silence. Its identities are fictitious.
if (process.argv.length !== 2) throw new Error('Usage: staging-release-fixture.mjs');
const url = stagingConnection(process.env.CITA_STAGING_DATABASE_URL);
const sharedKey = 'c3'.repeat(16);
const form = JSON.stringify([
	{ id: 'age', label: 'Edad', kind: 'text', required: true, maxLength: 3, patientField: 'age' },
	{ id: 'medication', label: 'Medicación', kind: 'textarea', required: false, maxLength: 1000, patientField: 'medication' },
	{ id: 'insurance', label: 'Obra social del perfil', kind: 'text', required: true, maxLength: 120, patientField: 'insurance' }
]);
const intake = JSON.stringify([
	{ id: 'insurance', label: 'Obra social y plan', kind: 'text', required: true, maxLength: 120 },
	{ id: 'labs', label: 'Estudios recientes', kind: 'boolean', required: false }
]);
const result = stagingPsql(url, ['-Atq', '-f', '-'], { options: '-c application_name=cita_suite_staging_release_fixture', input: `begin;
do $$
declare
 v_business uuid:='${practice.businessId}'; v_owner uuid:='${practice.ownerId}';
 v_service uuid:='${practice.serviceId}'; v_follow_up uuid:='${practice.followUpServiceId}'; v_professional uuid:='${practice.professionalId}';
begin
 if not exists(select 1 from public.businesses where id=v_business) then
  if exists(select 1 from public.businesses where slug='${practice.slug}') then raise exception 'RELEASE_PRACTICE_SLUG_TAKEN'; end if;
  insert into auth.users(id,email) values(v_owner,'${practice.ownerEmail}');
  insert into public.businesses(id,name,slug,industry,timezone,min_booking_notice_minutes,max_booking_days_ahead,address)
  values(v_business,'Consultorio de release','${practice.slug}','other','America/Argentina/Buenos_Aires',60,60,'Dirección sintética 123');
  update public.business_subscriptions set commercial_access_enabled=true,is_permanent=true,subscription_status='active',
   paid_until=null,grace_until=null,restricted_until=null,archived_at=null where business_id=v_business;
  insert into public.business_users(business_id,user_id,role,status,accepted_at) values(v_business,v_owner,'owner','active',now());
  insert into public.services(id,business_id,name,duration_minutes) values(v_service,v_business,'Consulta de prueba',30),(v_follow_up,v_business,'Seguimiento de prueba',30);
  insert into public.professionals(id,business_id,name) values(v_professional,v_business,'Profesional de release');
  insert into public.professional_services(business_id,professional_id,service_id) values(v_business,v_professional,v_service),(v_business,v_professional,v_follow_up);
  insert into public.professional_booking_forms(business_id,professional_id,fields) values(v_business,v_professional,'${form}');
  insert into public.service_price_policies(business_id,service_id,professional_id,base_amount,currency,base_month,first_adjustment_month,monthly_percentage,rounding_unit)
  values(v_business,v_service,v_professional,20000,'ARS',date_trunc('month',now())::date,(date_trunc('month',now())+interval '1 month')::date,2,1);
  insert into public.availability_rules(business_id,professional_id,weekday,start_time,end_time,slot_interval_minutes,break_minutes)
  select v_business,v_professional,n,'09:00','17:00',30,10 from generate_series(0,6) n;
  insert into public.booking_integrations(business_id,public_key,name,is_active,is_default,theme,allowed_origins,allowed_service_ids,allowed_professional_ids,allowed_modalities,intake_schema)
  values(v_business,'${practice.integrationKey}','Sitio de Natalia en staging',true,false,'natalia',array['${STAGING_NATALIA_ORIGIN}'],array[v_service,v_follow_up],array[v_professional],array['in_person'],'${intake}'),
   (v_business,'${sharedKey}','Enlace compartido',true,true,'cita-suite',array['${STAGING_APP_ORIGIN}'],'{}','{}',array['in_person'],'${intake}');
 end if;
end $$;
select json_build_object(
 'business',(select json_build_object('slug',b.slug,'active',s.commercial_access_enabled and s.subscription_status='active' and s.is_permanent)
  from public.businesses b join public.business_subscriptions s on s.business_id=b.id where b.id='${practice.businessId}'),
 'owner',(select count(*) from public.business_users where business_id='${practice.businessId}' and user_id='${practice.ownerId}' and role='owner' and status='active'),
 'assigned',(select count(*) from public.professional_services where business_id='${practice.businessId}' and professional_id='${practice.professionalId}'
  and service_id in ('${practice.serviceId}','${practice.followUpServiceId}')),
 'weekdays',(select count(distinct weekday) from public.availability_rules where business_id='${practice.businessId}' and professional_id='${practice.professionalId}'),
 'natalia',(select json_build_object('active',is_active,'theme',theme,'origins',allowed_origins) from public.booking_integrations
  where business_id='${practice.businessId}' and public_key='${practice.integrationKey}'),
 'shared',(select json_build_object('active',is_active,'default',is_default) from public.booking_integrations
  where business_id='${practice.businessId}' and public_key='${sharedKey}'))::text;
commit;` });
if (result.error || result.status !== 0) throw new Error('The staging release practice could not be ensured.\n' + psqlDiagnostics(result.stderr));
const state = JSON.parse(result.stdout.trim().split('\n').at(-1));
const expected = { business: { slug: practice.slug, active: true }, owner: 1, assigned: 2, weekdays: 7,
	natalia: { active: true, theme: 'natalia', origins: [STAGING_NATALIA_ORIGIN] }, shared: { active: true, default: true } };
if (JSON.stringify(state) !== JSON.stringify(expected))
	throw new Error('The staging release practice differs from the release contract: ' + JSON.stringify(state));
console.log('staging-release-fixture ' + JSON.stringify(state));
