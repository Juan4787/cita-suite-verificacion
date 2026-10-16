-- Auth claims are simulated here; authenticated RLS/RPC privileges are real.
-- Each statement revalidates the actor, as independent HTTP requests would.
begin;
select extensions.plan(17);

create temporary table context_fixture (
 actor uuid, owner_a uuid, owner_b uuid, business_a uuid, business_b uuid,
 patient_a uuid, patient_b uuid, membership uuid
);
grant select on context_fixture to authenticated;
do $$
declare
 actor uuid := gen_random_uuid(); owner_a uuid := gen_random_uuid(); owner_b uuid := gen_random_uuid();
 a uuid; b uuid; pa uuid; pb uuid; membership uuid;
begin
 insert into auth.users(id,email) values
  (actor,'context-actor-'||actor||'@example.test'),
  (owner_a,'context-owner-'||owner_a||'@example.test'),
  (owner_b,'context-owner-'||owner_b||'@example.test');
 insert into public.businesses(name,slug,industry) values('Synthetic A','context-a-'||actor,'other') returning id into a;
 insert into public.businesses(name,slug,industry) values('Synthetic B','context-b-'||actor,'other') returning id into b;
 update public.business_subscriptions set commercial_access_enabled=true,is_permanent=true,subscription_status='active',
  paid_until=null,grace_until=null,restricted_until=null,archived_at=null where business_id in(a,b);
 insert into public.business_users(business_id,user_id,role,status,accepted_at)
  values(a,owner_a,'owner','active',now()),(b,owner_b,'owner','active',now());
 insert into public.business_users(business_id,user_id,role,status,accepted_at)
  values(a,actor,'admin','active',now()) returning id into membership;
 insert into public.patients(business_id,owner_id,full_name) values(a,owner_a,'Synthetic A') returning id into pa;
 insert into public.patients(business_id,owner_id,full_name) values(b,owner_b,'Synthetic B') returning id into pb;
 insert into context_fixture values(actor,owner_a,owner_b,a,b,pa,pb,membership);
end $$;

select extensions.ok(not has_function_privilege('anon','public.list_user_business_contexts()','execute'),'anonymous cannot list contexts');
set local role authenticated;
select set_config('request.jwt.claim.sub',(select actor::text from context_fixture),true);
select extensions.is(public.user_business_role((select business_b from context_fixture)),null::text,'actor has no foreign role');
select extensions.is((select count(*) from public.list_user_business_contexts()),1::bigint,'only own context is returned');
select extensions.is((select count(*) from public.patients where business_id=(select business_a from context_fixture)),1::bigint,'own patient is visible');
select extensions.is((select count(*) from public.patients where business_id=(select business_b from context_fixture)),0::bigint,'foreign patient is hidden by RLS');
select extensions.throws_ok(
 $$select public.upsert_patient_clinical_profile_safely(business_b,patient_b,'synthetic rejected change') from context_fixture$$,
 'P0001','CLINICAL_PROFILE_DENIED','direct RPC cannot mutate another clinic');
select extensions.throws_ok(
 $$select public.upsert_patient_clinical_profile_safely(business_a,patient_b,'synthetic rejected change') from context_fixture$$,
 'P0001','PATIENT_NOT_FOUND','manipulated patient identifier cannot cross clinics');
select extensions.lives_ok(
 $$select public.upsert_patient_clinical_profile_safely(business_a,patient_a,'synthetic authorized change') from context_fixture$$,
 'positive control: active admin can update the own profile');

select set_config('request.jwt.claim.sub',(select owner_a::text from context_fixture),true);
select extensions.lives_ok(
 $$select public.update_business_role_access(membership,'readonly') from context_fixture$$,'owner changes role through the real RPC');
select set_config('request.jwt.claim.sub',(select actor::text from context_fixture),true);
select extensions.is((select role from public.list_user_business_contexts()),'readonly','next context immediately reflects the new role');
select extensions.throws_ok(
 $$select public.upsert_patient_clinical_profile_safely(business_a,patient_a,'synthetic rejected change') from context_fixture$$,
 'P0001','CLINICAL_PROFILE_DENIED','readonly cannot modify the clinical profile');
select extensions.is((select count(*) from public.patients where business_id=(select business_a from context_fixture)),1::bigint,'readonly retains authorized basic reading');

select set_config('request.jwt.claim.sub',(select owner_a::text from context_fixture),true);
select extensions.lives_ok(
 $$select public.remove_business_role_access(membership) from context_fixture$$,'owner revokes access through the real RPC');
select set_config('request.jwt.claim.sub',(select actor::text from context_fixture),true);
select extensions.is((select count(*) from public.list_user_business_contexts()),0::bigint,'revoked membership disappears immediately');
select extensions.is((select count(*) from public.patients where business_id=(select business_a from context_fixture)),0::bigint,'revocation immediately removes RLS reading');
select extensions.is(public.user_can_manage_business((select business_a from context_fixture)),false,'authorization helpers deny an absent role explicitly');
select extensions.throws_ok(
 $$select public.upsert_patient_clinical_profile_safely(business_a,patient_a,'synthetic rejected change') from context_fixture$$,
 'P0001','CLINICAL_PROFILE_DENIED','a revoked actor cannot use direct clinical RPCs');

reset role;
select * from extensions.finish();
rollback;
