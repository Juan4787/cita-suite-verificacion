-- Real functions/RLS with simulated Auth claims in a rolled-back synthetic fixture.
begin;
select extensions.plan(17);
create temporary table date_edit_fixture(owner_id uuid,reception_id uuid,professional_user uuid,
 business_id uuid,foreign_business uuid,patient_id uuid,foreign_patient uuid,entry_id uuid,professional_entry uuid);
grant select on date_edit_fixture to authenticated;
do $fixture$
declare
 o uuid:=gen_random_uuid(); r uuid:=gen_random_uuid(); u uuid:=gen_random_uuid();
 b uuid:=gen_random_uuid(); f uuid:=gen_random_uuid(); p uuid:=gen_random_uuid(); q uuid:=gen_random_uuid();
 e uuid:=gen_random_uuid(); pe uuid:=gen_random_uuid(); pro uuid:=gen_random_uuid();
begin
 insert into auth.users(id,email) values(o,o||'@example.test'),(r,r||'@example.test'),(u,u||'@example.test');
 insert into public.businesses(id,name,slug,industry) values(b,'Synthetic clinical dates',b::text,'other'),(f,'Synthetic foreign dates',f::text,'other');
 update public.business_subscriptions set commercial_access_enabled=true,is_permanent=true,subscription_status='active',paid_until=null,grace_until=null,restricted_until=null,archived_at=null where business_id in(b,f);
 insert into public.business_users(business_id,user_id,role,status,accepted_at) values(b,o,'owner','active',now()),(b,r,'reception','active',now()),(b,u,'professional','active',now());
 insert into public.professionals(id,business_id,name) values(pro,b,'Synthetic author');
 insert into public.professional_users(business_id,user_id,professional_id) values(b,u,pro);
 insert into public.patients(id,business_id,owner_id,full_name) values(p,b,o,'Synthetic patient'),(q,f,o,'Synthetic foreign patient');
 insert into public.professional_patient_links(business_id,patient_id,professional_id) values(b,p,pro);
 insert into public.clinical_entries(id,business_id,patient_id,owner_id,created_by_user_id,created_by_professional_id,entry_type,description,created_at,locked_after)
 values(e,b,p,o,o,null,'Consulta','Original',now()-interval '2 days',now()-interval '1 day'),
 (pe,b,p,u,u,pro,'Consulta','Professional original',now(),now()+interval '24 hours');
 insert into public.clinical_entry_costs(business_id,clinical_entry_id,amount) values(b,e,15000.50);
 insert into date_edit_fixture values(o,r,u,b,f,p,q,e,pe);
end $fixture$;
select extensions.ok(not has_function_privilege('anon','public.update_clinical_entry_with_date_safely(uuid,uuid,uuid,text,text,timestamptz,text,text,numeric)','execute'),'anonymous cannot edit dates');
select extensions.ok(has_function_privilege('authenticated','public.update_clinical_entry_safely(uuid,uuid,uuid,text,text,text,text,numeric)','execute'),'legacy editing contract and privilege are preserved');
set local role authenticated;
select set_config('request.jwt.claim.sub',(select owner_id::text from date_edit_fixture),true);
select extensions.lives_ok($test$select public.update_clinical_entry_with_date_safely(business_id,patient_id,entry_id,'Consulta','Date corrected',now()-interval '3 days',null,null,15000.50) from date_edit_fixture$test$,'owner can correct the existing date');
select extensions.is((select created_at from public.clinical_entries where id=(select entry_id from date_edit_fixture)),now()-interval '3 days','the accepted date is persisted');
select extensions.is((select amount from public.clinical_entry_costs where clinical_entry_id=(select entry_id from date_edit_fixture)),15000.50::numeric,'historical decimal cost survives unchanged');
select extensions.is((select locked_after from public.clinical_entries where id=(select entry_id from date_edit_fixture)),now()-interval '1 day','changing the date does not extend the editing deadline');
select extensions.throws_ok($test$select public.update_clinical_entry_with_date_safely(business_id,patient_id,entry_id,'Consulta','Rejected future date',now()+interval '1 day',null,null,90000) from date_edit_fixture$test$,'P0001','INVALID_CLINICAL_ENTRY_DATE','future date is rejected');
select extensions.is((select description from public.clinical_entries where id=(select entry_id from date_edit_fixture)),'Date corrected','failed date rolls back the earlier content update');
select extensions.is((select amount from public.clinical_entry_costs where clinical_entry_id=(select entry_id from date_edit_fixture)),15000.50::numeric,'failed date rolls back the earlier cost update');
select extensions.throws_ok($test$select public.update_clinical_entry_with_date_safely(business_id,foreign_patient,entry_id,'Consulta','Rejected foreign scope',now()) from date_edit_fixture$test$,'P0001','CLINICAL_ENTRY_NOT_FOUND','foreign patient identifier cannot redirect the update');
select set_config('request.jwt.claim.sub',(select reception_id::text from date_edit_fixture),true);
select extensions.throws_ok($test$select public.update_clinical_entry_with_date_safely(business_id,patient_id,entry_id,'Consulta','Rejected reception',now()) from date_edit_fixture$test$,'P0001','CLINICAL_ENTRY_DENIED','reception cannot use the new entry point');
select set_config('request.jwt.claim.sub',(select professional_user::text from date_edit_fixture),true);
select extensions.lives_ok($test$select public.update_clinical_entry_with_date_safely(business_id,patient_id,professional_entry,'Consulta','Professional correction',date_trunc('minute',now())) from date_edit_fixture$test$,'authorized professional retains content editing');
select extensions.is((select created_at from public.clinical_entries where id=(select professional_entry from date_edit_fixture)),now(),'professional edit keeps seconds and actual creation instant');
select extensions.throws_ok($test$select public.update_clinical_entry_with_date_safely(business_id,patient_id,professional_entry,'Consulta','Rejected professional date',now()-interval '2 hours') from date_edit_fixture$test$,'P0001','CLINICAL_ENTRY_DATE_EDIT_DENIED','professional cannot replace the creation instant');
select extensions.is((select description from public.clinical_entries where id=(select professional_entry from date_edit_fixture)),'Professional correction','denied professional date rolls back content');
reset role;
update public.business_subscriptions set is_permanent=false,subscription_status='restricted',paid_until=now()-interval '2 days',grace_until=now()-interval '1 day',restricted_until=now()+interval '10 days' where business_id=(select business_id from date_edit_fixture);
set local role authenticated;
select set_config('request.jwt.claim.sub',(select owner_id::text from date_edit_fixture),true);
select extensions.throws_ok($test$select public.update_clinical_entry_with_date_safely(business_id,patient_id,entry_id,'Consulta','Rejected restricted',now()) from date_edit_fixture$test$,'P0001','BUSINESS_ACCESS_RESTRICTED','new entry point preserves commercial write denial');
select extensions.is((select description from public.clinical_entries where id=(select entry_id from date_edit_fixture)),'Date corrected','rejected restricted update preserves the row');
reset role;
select * from extensions.finish();
rollback;
