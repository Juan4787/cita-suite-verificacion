-- Canonical role RPC compatibility and rollback, real SQL/simulated Auth.
begin;
select extensions.no_plan();
create temporary table team_access_fixture(actor uuid,target uuid,reception uuid,business_id uuid,profile uuid,replacement uuid,pending_profile uuid,pending_email text);
grant select on team_access_fixture to authenticated;
do $fixture$
declare a uuid:=gen_random_uuid();t uuid:=gen_random_uuid();r uuid:=gen_random_uuid();b uuid:=gen_random_uuid();p uuid:=gen_random_uuid();q uuid:=gen_random_uuid();x uuid:=gen_random_uuid();e text:=gen_random_uuid()||'@example.test';
begin
 insert into auth.users(id,email) values(a,a||'@example.test'),(t,t||'@example.test'),(r,r||'@example.test');
 insert into public.allowed_emails(email,enabled) values(a||'@example.test',true),(t||'@example.test',true),(r||'@example.test',true);
 insert into public.businesses(id,name,slug,industry) values(b,'Synthetic team access transactions',b::text,'other');
 update public.business_subscriptions set commercial_access_enabled=true,is_permanent=true,subscription_status='active',paid_until=null,grace_until=null,restricted_until=null,archived_at=null where business_id=b;
 insert into public.business_users(business_id,user_id,role,status,accepted_at) values(b,a,'owner','active',now()),(b,t,'owner','active',now()),(b,r,'reception','active',now());
 insert into public.professionals(id,business_id,name,is_public) values(p,b,'Synthetic owner attending',true),(q,b,'Synthetic replacement',true),(x,b,'Synthetic pending attending',false);
 insert into public.professional_users(business_id,user_id,professional_id) values(b,t,p);
 insert into team_access_fixture values(a,t,r,b,p,q,x,e);
end $fixture$;
select extensions.ok(has_function_privilege('authenticated','public.upsert_business_role_access(uuid,text,text,uuid)','execute'),'canonical authenticated RPC remains callable');
select extensions.ok(has_function_privilege('service_role','public.upsert_business_role_access(uuid,text,text,uuid)','execute'),'existing trusted service-role privilege is preserved');
set local role authenticated;
select set_config('request.jwt.claim.sub',(select actor::text from team_access_fixture),true);
select extensions.is((select status from team_access_fixture f cross join lateral public.upsert_business_role_access(f.business_id,f.target||'@example.test','owner',null)),'already_active','owner role replay retains the attending profile');
select extensions.is((select professional_id from public.professional_users where user_id=(select target from team_access_fixture)),(select profile from team_access_fixture),'existing owner attending profile is retained');
select extensions.lives_ok($test$select public.upsert_business_role_access(business_id,target||'@example.test','admin',null) from team_access_fixture$test$,'owner may change another owner to admin while retaining a clinic owner');
select extensions.is((select professional_id from public.professional_users where user_id=(select target from team_access_fixture)),(select profile from team_access_fixture),'admin keeps its attending profile after role change');
select extensions.throws_ok($test$select public.upsert_business_role_access(business_id,target||'@example.test','reception',profile) from team_access_fixture$test$,'P0001','PROFESSIONAL_ROLE_NOT_SUPPORTED','reception cannot be assigned a professional profile');
select extensions.is((select role from public.business_users where user_id=(select target from team_access_fixture)),'admin','invalid profile request preserves the prior role');
select extensions.lives_ok($test$select public.upsert_business_role_access(business_id,pending_email,'admin',pending_profile) from team_access_fixture$test$,'owner may invite an admin with an attending profile');
select extensions.is((select count(*) from team_access_fixture f cross join lateral public.list_business_role_access(f.business_id) access where access.email=f.pending_email and access.status='pending' and access.role='admin' and access.professional_id=f.pending_profile),1::bigint,'pending admin association is persisted');
select extensions.is((select is_public from public.professionals where id=(select pending_profile from team_access_fixture)),false,'pending admin profile stays hidden');
select set_config('request.jwt.claim.sub',(select reception::text from team_access_fixture),true);
select extensions.throws_ok($test$select public.upsert_business_role_access(business_id,pending_email,'professional',pending_profile) from team_access_fixture$test$,'P0001','BUSINESS_MANAGE_DENIED','reception cannot use the canonical role mutation');
reset role;
create function private.cita_access_assignment_failure() returns trigger language plpgsql set search_path=pg_catalog,pg_temp as $$
begin if new.professional_id=(select replacement from team_access_fixture) then raise exception 'TEAM_ACCESS_SYNTHETIC_ASSIGNMENT_FAILURE'; end if; return new; end $$;
create trigger cita_access_assignment_failure before insert on public.professional_users for each row execute function private.cita_access_assignment_failure();
set local role authenticated;
select set_config('request.jwt.claim.sub',(select actor::text from team_access_fixture),true);
select extensions.throws_ok($test$select public.upsert_business_role_access(business_id,target||'@example.test','owner',replacement) from team_access_fixture$test$,'P0001','TEAM_ACCESS_SYNTHETIC_ASSIGNMENT_FAILURE','assignment failure rolls back the membership and previous link deletion');
select extensions.is((select role from public.business_users where user_id=(select target from team_access_fixture)),'admin','failed assignment preserves the previous access role');
select extensions.is((select professional_id from public.professional_users where user_id=(select target from team_access_fixture)),(select profile from team_access_fixture),'failed assignment restores the prior professional link');
reset role;
select extensions.is((select count(*) from public.business_user_invites where email=(select pending_email from team_access_fixture) and status='pending' and professional_id=(select pending_profile from team_access_fixture)),1::bigint,'privileged readback independently confirms the persisted invitation');
select * from extensions.finish();
rollback;
