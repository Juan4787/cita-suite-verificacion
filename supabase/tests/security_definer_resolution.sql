-- Actual RLS and SECURITY DEFINER calls under a synthetic authenticated role.
-- Malicious temporary tables exist only in this rolled-back disposable test.
begin;
select extensions.plan(23);
do $fixture$
declare
 actor uuid:=gen_random_uuid(); business uuid:=gen_random_uuid(); professional uuid:=gen_random_uuid();
 linked uuid:=gen_random_uuid(); unlinked uuid:=gen_random_uuid();
begin
 insert into auth.users(id,email) values(actor,actor||'@example.test');
 insert into public.businesses(id,name,slug,industry) values(business,'Synthetic resolution',business::text,'other');
 update public.business_subscriptions set commercial_access_enabled=true,is_permanent=true,subscription_status='active',paid_until=null,grace_until=null,restricted_until=null,archived_at=null where business_id=business;
 insert into public.business_users(business_id,user_id,role,status,accepted_at) values(business,actor,'professional','active',now());
 insert into public.professionals(id,business_id,name) values(professional,business,'Synthetic professional');
 insert into public.professional_users(business_id,user_id,professional_id) values(business,actor,professional);
 insert into public.patients(id,business_id,owner_id,full_name) values(linked,business,actor,'Synthetic linked'),(unlinked,business,actor,'Synthetic unlinked');
 insert into public.professional_patient_links(business_id,patient_id,professional_id) values(business,linked,professional);
 insert into public.patient_clinical_profiles(business_id,patient_id,allergies) values(business,linked,'Synthetic authorized'),(business,unlinked,'Synthetic private');
 insert into public.clinical_entries(business_id,patient_id,owner_id,entry_type,description) values(business,unlinked,actor,'Consulta','Synthetic unlinked clinical history');
 perform set_config('cita.tests.shadow.actor',actor::text,true);
 perform set_config('cita.tests.shadow.business',business::text,true);
 perform set_config('cita.tests.shadow.professional',professional::text,true);
 perform set_config('cita.tests.shadow.linked',linked::text,true);
 perform set_config('cita.tests.shadow.unlinked',unlinked::text,true);
end $fixture$;

set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('cita.tests.shadow.actor'),true);
select extensions.ok(has_database_privilege(current_user,current_database(),'TEMP'),'the negative scenario uses the actual temporary-table privilege');
create temporary table professional_patient_links(business_id uuid,patient_id uuid,professional_id uuid,is_active boolean);
create temporary table professional_users(business_id uuid,user_id uuid,professional_id uuid);
insert into pg_temp.professional_patient_links values(current_setting('cita.tests.shadow.business')::uuid,current_setting('cita.tests.shadow.unlinked')::uuid,current_setting('cita.tests.shadow.professional')::uuid,true);
insert into pg_temp.professional_users values(current_setting('cita.tests.shadow.business')::uuid,current_setting('cita.tests.shadow.actor')::uuid,current_setting('cita.tests.shadow.professional')::uuid);

select extensions.is(public.user_has_active_professional_patient_link(current_setting('cita.tests.shadow.business')::uuid,current_setting('cita.tests.shadow.unlinked')::uuid),false,'a temporary relation cannot forge a professional patient link');
select extensions.is((select count(*) from public.patients where id=current_setting('cita.tests.shadow.unlinked')::uuid),0::bigint,'temporary relations cannot expose an unlinked basic patient');
select extensions.is((select count(*) from public.patient_clinical_profiles where patient_id=current_setting('cita.tests.shadow.unlinked')::uuid),0::bigint,'temporary relations cannot expose an unlinked clinical profile');
select extensions.is((select count(*) from public.clinical_entries where patient_id=current_setting('cita.tests.shadow.unlinked')::uuid),0::bigint,'temporary relations cannot expose unlinked clinical history');
select extensions.is(public.user_has_active_professional_patient_link(current_setting('cita.tests.shadow.business')::uuid,current_setting('cita.tests.shadow.linked')::uuid),true,'the real professional link remains authorized');
select extensions.is((select count(*) from public.patients where id=current_setting('cita.tests.shadow.linked')::uuid),1::bigint,'the real linked patient remains visible');
select extensions.is((select count(*) from public.patient_clinical_profiles where patient_id=current_setting('cita.tests.shadow.linked')::uuid),1::bigint,'the real linked clinical profile remains visible');
reset role;
select extensions.ok((select count(*)>0 and bool_and(coalesce((select split_part(setting,'=',2) ~ '(^|,)[[:space:]]*pg_temp[[:space:]]*$' or split_part(setting,'=',2)='""' from unnest(p.proconfig) setting where setting like 'search_path=%'),false)) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private') and p.prosecdef and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e')),'application privileged functions explicitly resolve temporary schemas last, or keep the strictest empty path');
-- A schema is trusted only if untrusted API roles cannot create objects in it.
-- Verify effective privileges (including PUBLIC inheritance), not just ACL text.
select extensions.is(has_schema_privilege(actor,namespace,'CREATE'),false,
 format('%s cannot create objects in trusted schema %s',actor,namespace))
from unnest(array['anon','authenticated']) actor
cross join unnest(array['public','private','extensions','storage','auth','realtime','pg_catalog']) namespace;
select * from extensions.finish();
rollback;
