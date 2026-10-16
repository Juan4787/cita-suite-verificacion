-- Real RLS/RPC checks with simulated Auth claims; synthetic transaction only.
begin;
select extensions.plan(34);
create temporary table clinical_write_fixture (
 owner_id uuid, reception_id uuid, professional_user uuid, a uuid, b uuid,
 patient_id uuid, foreign_patient uuid, professional_id uuid, foreign_professional uuid,
 entry_id uuid, modify_entry uuid, delete_entry uuid
);
grant select on clinical_write_fixture to authenticated;
do $$
declare
 owner_id uuid:=gen_random_uuid(); reception_id uuid:=gen_random_uuid(); professional_user uuid:=gen_random_uuid();
 a uuid:=gen_random_uuid(); b uuid:=gen_random_uuid(); pa uuid:=gen_random_uuid(); pb uuid:=gen_random_uuid();
 pro uuid:=gen_random_uuid(); foreign_pro uuid:=gen_random_uuid(); entry_id uuid:=gen_random_uuid();
 modify_entry uuid:=gen_random_uuid(); delete_entry uuid:=gen_random_uuid();
begin
 insert into auth.users(id,email) values(owner_id,owner_id||'@example.test'),(reception_id,reception_id||'@example.test'),(professional_user,professional_user||'@example.test');
 insert into public.businesses(id,name,slug,industry) values(a,'Synthetic clinical A',a::text,'other'),(b,'Synthetic clinical B',b::text,'other');
 update public.business_subscriptions set commercial_access_enabled=true,is_permanent=true,subscription_status='active',paid_until=null,grace_until=null,restricted_until=null,archived_at=null where business_id in(a,b);
 insert into public.business_users(business_id,user_id,role,status,accepted_at) values(a,owner_id,'owner','active',now()),(a,reception_id,'reception','active',now()),(a,professional_user,'professional','active',now());
 insert into public.professionals(id,business_id,name) values(pro,a,'Synthetic author'),(foreign_pro,b,'Synthetic foreign author');
 insert into public.professional_users(business_id,user_id,professional_id) values(a,professional_user,pro);
 insert into public.patients(id,business_id,owner_id,full_name) values(pa,a,owner_id,'Synthetic A'),(pb,b,owner_id,'Synthetic B');
 insert into public.professional_patient_links(business_id,patient_id,professional_id) values(a,pa,pro);
 insert into public.clinical_entries(id,business_id,patient_id,owner_id,created_by_user_id,entry_type,description)
 values(entry_id,a,pa,owner_id,owner_id,'Consulta','Original'),(modify_entry,a,pa,owner_id,owner_id,'Consulta','Modify control'),(delete_entry,a,pa,owner_id,owner_id,'Consulta','Delete control');
 insert into public.patient_clinical_profiles(business_id,patient_id,allergies) values(a,pa,'Synthetic historical allergy');
 insert into public.clinical_entry_costs(business_id,clinical_entry_id,amount) values(a,entry_id,15000.50);
 insert into clinical_write_fixture values(owner_id,reception_id,professional_user,a,b,pa,pb,pro,foreign_pro,entry_id,modify_entry,delete_entry);
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub',(select reception_id::text from clinical_write_fixture),true);
select extensions.is(public.user_can_operate_business((select a from clinical_write_fixture)),true,'reception retains operational access');
select extensions.is((select count(*) from public.clinical_entries where business_id=(select a from clinical_write_fixture)),0::bigint,'reception cannot read clinical history directly');
select extensions.is((select count(*) from public.patient_clinical_profiles where business_id=(select a from clinical_write_fixture)),0::bigint,'reception cannot read the clinical profile');
select extensions.throws_ok($test$select public.create_clinical_entry_safely(a,patient_id,'Consulta','Rejected reception RPC') from clinical_write_fixture$test$,'P0001','CLINICAL_ENTRY_DENIED','clinical RPC denies reception');
select extensions.throws_ok($test$insert into public.clinical_entries(business_id,patient_id,entry_type,description) select a,patient_id,'Consulta','Rejected direct insertion' from clinical_write_fixture$test$,'42501',null,'direct table insertion cannot bypass the clinical role');
with changed as (update public.clinical_entries set description='Rejected direct change' where id=(select modify_entry from clinical_write_fixture) returning id)
 select extensions.is(count(*),0::bigint,'reception cannot directly update clinical history') from changed;
with changed as (delete from public.clinical_entries where id=(select delete_entry from clinical_write_fixture) returning id)
 select extensions.is(count(*),0::bigint,'reception cannot directly delete clinical history') from changed;

select set_config('request.jwt.claim.sub',(select owner_id::text from clinical_write_fixture),true);
select extensions.is((select count(*) from public.clinical_entries where id=(select entry_id from clinical_write_fixture)),1::bigint,'owner retains clinical reading');
select extensions.lives_ok($test$update public.clinical_entries set description='Authorized correction' where id=(select entry_id from clinical_write_fixture)$test$,'owner retains clinical content correction');
select extensions.throws_ok($test$update public.clinical_entries set created_by_user_id=(select reception_id from clinical_write_fixture) where id=(select entry_id from clinical_write_fixture)$test$,'42501','CLINICAL_PROVENANCE_IMMUTABLE','authenticated writes cannot forge the original user');
select extensions.throws_ok($test$update public.clinical_entries set created_by_professional_id=(select foreign_professional from clinical_write_fixture) where id=(select entry_id from clinical_write_fixture)$test$,'42501','CLINICAL_PROVENANCE_IMMUTABLE','authenticated writes cannot forge professional authorship');
select extensions.throws_ok($test$update public.clinical_entries set owner_id=(select reception_id from clinical_write_fixture) where id=(select entry_id from clinical_write_fixture)$test$,'42501','CLINICAL_PROVENANCE_IMMUTABLE','legacy ownership provenance is preserved');
select extensions.ok((select created_by_user_id=(select owner_id from clinical_write_fixture) and created_by_professional_id is null and owner_id=(select owner_id from clinical_write_fixture) from public.clinical_entries where id=(select entry_id from clinical_write_fixture)),'rejected writes preserve the original author');
select extensions.throws_ok($test$insert into public.clinical_entries(business_id,patient_id,entry_type,description) select b,foreign_patient,'Consulta','Rejected foreign insertion' from clinical_write_fixture$test$,'42501',null,'a known foreign patient identifier gives no clinical access');

-- Role changes use the actual administrative RPC; readonly keeps its existing
-- history access, without gaining the separately protected clinical profile.
select public.update_business_role_access((select id from public.business_users where business_id=(select a from clinical_write_fixture) and user_id=(select reception_id from clinical_write_fixture)),'readonly');
select set_config('request.jwt.claim.sub',(select reception_id::text from clinical_write_fixture),true);
select extensions.is((select count(*) from public.clinical_entries where business_id=(select a from clinical_write_fixture)),3::bigint,'readonly retains authorized historical reading');
select extensions.is((select count(*) from public.patient_clinical_profiles where business_id=(select a from clinical_write_fixture)),0::bigint,'readonly does not gain clinical profile access');

-- Restricted is historical read only for owner/admin; archived closes reads.
reset role;
select set_config('request.jwt.claim.sub','',true);
update public.business_subscriptions set is_permanent=false,subscription_status='restricted',paid_until=now()-interval '3 days',grace_until=now()-interval '1 day',restricted_until=now()+interval '10 days',archived_at=null where business_id=(select a from clinical_write_fixture);
set local role authenticated;
select set_config('request.jwt.claim.sub',(select owner_id::text from clinical_write_fixture),true);
select extensions.is((select count(*) from public.clinical_entries where business_id=(select a from clinical_write_fixture)),3::bigint,'restricted owner retains historical entries');
select extensions.is((select count(*) from public.patient_clinical_profiles where business_id=(select a from clinical_write_fixture)),1::bigint,'restricted owner retains the historical profile');
select extensions.is((select amount from public.clinical_entry_costs where clinical_entry_id=(select entry_id from clinical_write_fixture)),15000.50::numeric,'restricted owner retains historical costs exactly');
with changed as (update public.clinical_entries set description='Rejected restricted update' where id=(select entry_id from clinical_write_fixture) returning id)
 select extensions.is(count(*),0::bigint,'restricted reading does not enable direct writes') from changed;
select extensions.throws_ok($test$select public.create_clinical_entry_safely(a,patient_id,'Consulta','Rejected restricted RPC') from clinical_write_fixture$test$,'P0001','BUSINESS_ACCESS_RESTRICTED','restricted reading does not enable clinical creation RPC');
reset role;
select set_config('request.jwt.claim.sub','',true);
-- Maintenance may be delayed: an expired window must close direct reading
-- without depending on subscription_status being refreshed by a scheduler.
update public.business_subscriptions set restricted_until=now()-interval '1 hour' where business_id=(select a from clinical_write_fixture);
set local role authenticated;
select set_config('request.jwt.claim.sub',(select owner_id::text from clinical_write_fixture),true);
select extensions.is(public.business_allows_owner_restricted_read((select a from clinical_write_fixture)),false,'expired historical access ignores a stale restricted label');
select extensions.is((select count(*) from public.patients where business_id=(select a from clinical_write_fixture)),0::bigint,'expired historical access closes basic patient reading');
select extensions.is((select count(*) from public.clinical_entries where business_id=(select a from clinical_write_fixture)),0::bigint,'expired historical access closes clinical history');
select extensions.is((select count(*) from public.patient_clinical_profiles where business_id=(select a from clinical_write_fixture)),0::bigint,'expired historical access closes the clinical profile');
select extensions.is((select count(*) from public.clinical_entry_costs where business_id=(select a from clinical_write_fixture)),0::bigint,'expired historical access closes historical costs');
reset role;
select set_config('request.jwt.claim.sub','',true);
update public.business_subscriptions set subscription_status='archived',archived_at=now() where business_id=(select a from clinical_write_fixture);
set local role authenticated;
select set_config('request.jwt.claim.sub',(select owner_id::text from clinical_write_fixture),true);
select extensions.is((select count(*) from public.clinical_entries where business_id=(select a from clinical_write_fixture)),0::bigint,'archived closes clinical history reading');
select extensions.is((select count(*) from public.patient_clinical_profiles where business_id=(select a from clinical_write_fixture)),0::bigint,'archived closes clinical profile reading');
select extensions.is((select count(*) from public.clinical_entry_costs where business_id=(select a from clinical_write_fixture)),0::bigint,'archived closes historical cost reading');
reset role;
select set_config('request.jwt.claim.sub','',true);
update public.business_subscriptions set is_permanent=true,subscription_status='active',paid_until=null,grace_until=null,restricted_until=null,archived_at=null where business_id=(select a from clinical_write_fixture);
set local role authenticated;

select set_config('request.jwt.claim.sub',(select professional_user::text from clinical_write_fixture),true);
select extensions.lives_ok($test$select public.create_clinical_entry_with_result_safely(a,patient_id,'Consulta','Professional positive control') from clinical_write_fixture$test$,'linked professional retains the real creation RPC');
select extensions.ok(exists(select 1 from public.clinical_entries where description='Professional positive control' and created_by_professional_id=(select professional_id from clinical_write_fixture)),'professional RPC preserves normalized provenance');
reset role;
select set_config('request.jwt.claim.sub','',true);
select extensions.throws_ok($test$insert into public.clinical_entries(business_id,patient_id,created_by_professional_id,entry_type,description) select a,patient_id,foreign_professional,'Consulta','Rejected foreign provenance' from clinical_write_fixture$test$,'23503','CLINICAL_AUTHOR_TENANT_MISMATCH','privileged insertion cannot assign a foreign professional');
select extensions.lives_ok($test$delete from public.professionals where id=(select professional_id from clinical_write_fixture)$test$,'historical author identifiers do not introduce a new deletion restriction');
select extensions.lives_ok($test$update public.clinical_entries set description='Historical correction' where description='Professional positive control'$test$,'unchanged historical author references survive later content corrections');

select * from extensions.finish();
rollback;
