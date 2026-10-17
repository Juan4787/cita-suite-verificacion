-- Reproduce an in-flight server request: its preflight was allowed, but the
-- actor's role changed before the service-role RPC reached PostgreSQL.
-- Only synthetic data, rolled back; claims model separate HTTP statements.
begin;
select extensions.plan(17);

create temporary table appointment_actor_fixture (
 business_id uuid, owner_id uuid, actor_id uuid, membership_id uuid,
 patient_id uuid, service_id uuid, professional_ids uuid[], request_key text
);
grant select on appointment_actor_fixture to authenticated, service_role;
do $$
declare
 owner_id uuid := gen_random_uuid(); actor_id uuid := gen_random_uuid();
 biz uuid; membership uuid; patient uuid; service uuid; pro1 uuid; pro2 uuid;
begin
 insert into auth.users(id,email) values
  (owner_id,'appointment-owner-'||owner_id||'@example.test'),
  (actor_id,'appointment-actor-'||actor_id||'@example.test');
 insert into public.businesses(name,slug,industry,timezone)
  values('Synthetic appointment authorization','appointment-actor-'||actor_id,'other','UTC') returning id into biz;
 update public.business_subscriptions set commercial_access_enabled=true,is_permanent=true,subscription_status='active',
  paid_until=null,grace_until=null,restricted_until=null,archived_at=null where business_id=biz;
 insert into public.business_users(business_id,user_id,role,status,accepted_at)
  values(biz,owner_id,'owner','active',now());
 insert into public.business_users(business_id,user_id,role,status,accepted_at)
  values(biz,actor_id,'admin','active',now()) returning id into membership;
 insert into public.patients(business_id,owner_id,full_name)
  values(biz,owner_id,'Synthetic appointment patient') returning id into patient;
 insert into public.services(business_id,name,duration_minutes,buffer_before_minutes,buffer_after_minutes)
  values(biz,'Synthetic appointment service',30,0,0) returning id into service;
 insert into public.professionals(business_id,name) values(biz,'Synthetic professional one') returning id into pro1;
 insert into public.professionals(business_id,name) values(biz,'Synthetic professional two') returning id into pro2;
 insert into public.professional_services(business_id,professional_id,service_id)
  values(biz,pro1,service),(biz,pro2,service);
 insert into appointment_actor_fixture values(biz,owner_id,actor_id,membership,patient,service,array[pro1,pro2],gen_random_uuid()::text);
end $$;

-- Fixture convenience only: SECURITY INVOKER, public production RPC unchanged.
create function pg_temp.create_actor_appointment(slot integer, joint boolean default false, replay boolean default false)
returns uuid language sql as $$
 select created.id from appointment_actor_fixture f,
 lateral public.create_appointment_with_patient_identity(
  f.business_id,'existing',f.patient_id,null,null,null,null,false,f.actor_id,f.service_id,
  case when joint then f.professional_ids else f.professional_ids[1:1] end,
  date_trunc('day',statement_timestamp())+interval '45 days 9 hours'+make_interval(hours=>slot),
  null,f.actor_id,false,'manual','unknown',false,
  case when slot=0 then f.request_key else 'a3000000-0000-4000-8000-'||lpad(slot::text,12,'0') end,replay
 ) created;
$$;

select extensions.ok(has_function_privilege('service_role',
 'public.create_appointment_with_patient_identity(uuid,text,uuid,text,text,text,text,boolean,uuid,uuid,uuid[],timestamptz,text,uuid,boolean,text,text,boolean,text,boolean)','execute'),
 'trusted server can invoke the atomic creation RPC');
select extensions.ok(not has_function_privilege('authenticated',
 'public.create_appointment_with_patient_identity(uuid,text,uuid,text,text,text,text,boolean,uuid,uuid,uuid[],timestamptz,text,uuid,boolean,text,text,boolean,text,boolean)','execute'),
 'authenticated callers cannot forge the server actor argument');
select extensions.ok(not has_function_privilege('anon',
 'public.create_appointment_with_patient_identity(uuid,text,uuid,text,text,text,text,boolean,uuid,uuid,uuid[],timestamptz,text,uuid,boolean,text,text,boolean,text,boolean)','execute'),
 'anonymous callers cannot forge the server actor argument');

set local role authenticated;
select set_config('request.jwt.claim.sub',(select actor_id::text from appointment_actor_fixture),true);
select extensions.is(public.user_can_operate_business((select business_id from appointment_actor_fixture)),true,
 'preflight: admin is allowed before the role change');
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role service_role;
select extensions.lives_ok('select pg_temp.create_actor_appointment(0)', 'positive control: server creates an authorized admin appointment');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub',(select owner_id::text from appointment_actor_fixture),true);
select extensions.lives_ok('select public.update_business_role_access(membership_id,''readonly'') from appointment_actor_fixture',
 'owner downgrades the actor through the real role RPC');
select set_config('request.jwt.claim.sub',(select actor_id::text from appointment_actor_fixture),true);
select extensions.is(public.user_business_role((select business_id from appointment_actor_fixture)),'readonly','role change is visible before the server call');
select extensions.is(public.user_can_operate_business((select business_id from appointment_actor_fixture)),false,
 'a new application preflight would now deny the actor');
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role service_role;
select extensions.throws_ok('select pg_temp.create_actor_appointment(1)','P0001','APPOINTMENT_CREATOR_INVALID',
 'the in-flight manual creation must revalidate the current role in SQL');
select extensions.throws_ok('select pg_temp.create_actor_appointment(2,true)','P0001','APPOINTMENT_CREATOR_INVALID',
 'joint creation cannot bypass the changed actor role');
select extensions.throws_ok('select pg_temp.create_actor_appointment(0,false,true)','P0001','APPOINTMENT_CREATOR_INVALID',
 'idempotent recovery must not expose the appointment after the actor loses permission');
select extensions.is((select count(*) from public.appointments where business_id=(select business_id from appointment_actor_fixture)),1::bigint,
 'denied operations leave the original appointment only');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub',(select owner_id::text from appointment_actor_fixture),true);
select extensions.lives_ok('select public.update_business_role_access(membership_id,''reception'') from appointment_actor_fixture',
 'owner restores an operational role through the real RPC');
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role service_role;
select extensions.lives_ok('select pg_temp.create_actor_appointment(3,true)',
 'positive control: reception can still create joint appointments');
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub',(select owner_id::text from appointment_actor_fixture),true);
select extensions.lives_ok('select public.remove_business_role_access(membership_id) from appointment_actor_fixture',
 'owner removes the actor through the real RPC');
reset role;
select set_config('request.jwt.claim.sub','',true);
set local role service_role;
select extensions.throws_ok('select pg_temp.create_actor_appointment(0,false,true)','P0001','APPOINTMENT_CREATOR_INVALID',
 'recovery is also denied after membership removal');
select extensions.is((select count(*) from public.appointments where business_id=(select business_id from appointment_actor_fixture)),2::bigint,
 'authorization failures do not create an appointment or replace legitimate ones');
reset role;
select * from extensions.finish();
rollback;
