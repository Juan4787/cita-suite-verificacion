-- Whole user tasks, real SQL/triggers with simulated Auth claims. Rolled back.
begin;
select extensions.no_plan();
create temporary table team_onboarding_fixture(actor uuid,admin_user uuid,other_admin uuid,reception uuid,business_id uuid,profile uuid,failed_profile uuid,pending_email text,failure_email text);
grant select on team_onboarding_fixture to authenticated;
do $fixture$
declare a uuid:=gen_random_uuid();u uuid:=gen_random_uuid();v uuid:=gen_random_uuid();r uuid:=gen_random_uuid();b uuid:=gen_random_uuid();p uuid:=gen_random_uuid();q uuid:=gen_random_uuid();
begin
 insert into auth.users(id,email) values(a,a||'@example.test'),(u,u||'@example.test'),(v,v||'@example.test'),(r,r||'@example.test');
 insert into public.allowed_emails(email,enabled) values(a||'@example.test',true),(u||'@example.test',true),(v||'@example.test',true),(r||'@example.test',true);
 insert into public.businesses(id,name,slug,industry) values(b,'Synthetic atomic team onboarding',b::text,'other');
 update public.business_subscriptions set commercial_access_enabled=true,is_permanent=true,subscription_status='active',paid_until=null,grace_until=null,restricted_until=null,archived_at=null where business_id=b;
 insert into public.business_users(business_id,user_id,role,status,accepted_at) values(b,a,'owner','active',now()),(b,u,'admin','active',now()),(b,v,'admin','active',now()),(b,r,'reception','active',now());
 insert into team_onboarding_fixture values(a,u,v,r,b,p,q,gen_random_uuid()||'@example.test',gen_random_uuid()||'@example.test');
end $fixture$;
create function pg_temp.team_profile_configuration(p_id uuid,p_email text) returns jsonb language sql as $$
 select jsonb_build_object('professionalId',p_id,'email',p_email,'role','professional','name','Synthetic configured professional','specialty','Synthetic specialty',
 'serviceIds','[]'::jsonb,'newServices',jsonb_build_array(jsonb_build_object('name','Synthetic additional service','duration_minutes',30,'price_label','20000')),
 'blocks',jsonb_build_array(jsonb_build_object('weekdays',jsonb_build_array(1),'ranges',jsonb_build_array(jsonb_build_object('start','09:00','end','12:00')),'slot_interval_minutes',15,'break_minutes',15,'service_scope','all','service_ids','[]'::jsonb)), 'exception',null);
$$;
select extensions.ok(not has_function_privilege('anon','public.create_team_member_profile(uuid,jsonb)','execute'),'anonymous cannot create an attending access');
select extensions.ok(not has_function_privilege('authenticated','private.assign_team_default_services(uuid,uuid)','execute'),'defaults cannot be mutated through the private helper directly');
set local role authenticated;
select set_config('request.jwt.claim.sub',(select actor::text from team_onboarding_fixture),true);
select extensions.is((select public.create_team_member_profile(business_id,pg_temp.team_profile_configuration(profile,pending_email))->>'status' from team_onboarding_fixture),'pending','new professional account is invited inside the configuration transaction');
select extensions.is((select count(*) from public.professionals where id=(select profile from team_onboarding_fixture)),1::bigint,'professional is actually persisted');
select extensions.is((select is_public from public.professionals where id=(select profile from team_onboarding_fixture)),false,'invited professional stays hidden');
select extensions.is((select count(*) from public.professional_services where professional_id=(select profile from team_onboarding_fixture)),3::bigint,'two defaults and one additional service are assigned');
select extensions.is((select count(*) from public.availability_rules where professional_id=(select profile from team_onboarding_fixture)),1::bigint,'weekly schedule is persisted');
select extensions.is((select count(*) from team_onboarding_fixture f cross join lateral public.list_business_role_access(f.business_id) access where access.email=f.pending_email and access.status='pending' and access.professional_id=f.profile),1::bigint,'invitation carries the configured professional');
select extensions.ok((select l.metadata->>'name'='Synthetic configured professional' and l.metadata->>'email'=f.pending_email and jsonb_array_length(l.metadata->'service_ids')=3 and l.metadata->'schedule_blocks'->0->>'breakMinutes'='15' from public.audit_logs l,team_onboarding_fixture f where l.entity_id=f.profile and l.action='professional.created'),'atomic onboarding retains the original audit snapshot fields');
select extensions.throws_ok($test$select public.create_team_member_profile(business_id,pg_temp.team_profile_configuration(failed_profile,failure_email)||jsonb_build_object('serviceIds',jsonb_build_array(gen_random_uuid()))) from team_onboarding_fixture$test$,'P0001','INVALID_SERVICE_ASSIGNMENT','a foreign or missing service aborts the whole configuration');
select extensions.is((select count(*) from public.professionals where id=(select failed_profile from team_onboarding_fixture)),0::bigint,'failed service validation leaves no profile');
select extensions.throws_ok($test$select public.create_team_member_profile(business_id,pg_temp.team_profile_configuration(failed_profile,failure_email)||jsonb_build_object('newServices',jsonb_build_array(jsonb_build_object('name','Synthetic invalid duration','duration_minutes',30.5)))) from team_onboarding_fixture$test$,'P0001','NEW_SERVICE_DURATION_INVALID','fractional service duration is rejected before successful onboarding');
select extensions.is((select count(*) from public.services where business_id=(select business_id from team_onboarding_fixture)),3::bigint,'failed configuration does not leave additional services');
select set_config('request.jwt.claim.sub',(select reception::text from team_onboarding_fixture),true);
select extensions.throws_ok($test$select public.create_team_member_profile(business_id,pg_temp.team_profile_configuration(failed_profile,failure_email)) from team_onboarding_fixture$test$,'P0001','TEAM_ACCESS_DENIED','reception cannot bypass access UI with the onboarding RPC');
reset role;
create function private.cita_onboarding_invite_failure() returns trigger language plpgsql set search_path=pg_catalog,pg_temp as $$
begin if new.email=(select failure_email from team_onboarding_fixture) then raise exception 'TEAM_ONBOARDING_SYNTHETIC_INVITE_FAILURE'; end if; return new; end $$;
create trigger cita_onboarding_invite_failure before insert on public.business_user_invites for each row execute function private.cita_onboarding_invite_failure();
set local role authenticated;
select set_config('request.jwt.claim.sub',(select actor::text from team_onboarding_fixture),true);
select extensions.throws_ok($test$select public.create_team_member_profile(business_id,pg_temp.team_profile_configuration(failed_profile,failure_email)) from team_onboarding_fixture$test$,'P0001','TEAM_ONBOARDING_SYNTHETIC_INVITE_FAILURE','failure at the final invitation rolls back profile, services and hours');
select extensions.is((select count(*) from public.professionals where id=(select failed_profile from team_onboarding_fixture)),0::bigint,'final failure leaves no profile');
select extensions.is((select count(*) from public.availability_rules where professional_id=(select failed_profile from team_onboarding_fixture)),0::bigint,'final failure leaves no weekly rules');
select extensions.is((select count(*) from public.services where business_id=(select business_id from team_onboarding_fixture)),3::bigint,'final failure leaves no new service');
reset role;
select extensions.is((select count(*) from public.allowed_emails where email=(select failure_email from team_onboarding_fixture)),0::bigint,'privileged readback confirms no allowed account survives the final failure');
drop trigger cita_onboarding_invite_failure on public.business_user_invites;
drop function private.cita_onboarding_invite_failure();
set local role authenticated;
select extensions.lives_ok($test$select public.make_team_member_attending(business_id,(select id from public.business_users where user_id=admin_user),'Synthetic attending admin') from team_onboarding_fixture$test$,'existing admin gets an attending profile atomically');
select extensions.is((select role from public.business_users where user_id=(select admin_user from team_onboarding_fixture)),'admin','becoming attending preserves admin access');
select extensions.is((select count(*) from public.professional_services ps join public.professional_users pu on pu.business_id=ps.business_id and pu.professional_id=ps.professional_id where pu.user_id=(select admin_user from team_onboarding_fixture)),2::bigint,'attending admin has both required default services');
select extensions.is((select p.is_public from public.professionals p join public.professional_users pu on pu.professional_id=p.id and pu.business_id=p.business_id where pu.user_id=(select admin_user from team_onboarding_fixture)),true,'active admin attending profile is public');
select extensions.ok((select l.metadata->>'user_id'=f.admin_user::text and l.metadata->>'email'=f.admin_user||'@example.test' and l.metadata->>'role'='admin' and l.metadata->>'account_status'='active' and l.metadata->>'name'='Synthetic attending admin' from public.audit_logs l join public.professional_users pu on pu.professional_id=l.entity_id cross join team_onboarding_fixture f where pu.user_id=f.admin_user and l.action='professional.created_attending'),'attending conversion retains identity, role and status audit provenance');
select extensions.throws_ok($test$select public.make_team_member_attending(business_id,(select id from public.business_users where user_id=admin_user),'Synthetic duplicate attending') from team_onboarding_fixture$test$,'P0001','TEAM_PROFILE_ALREADY_EXISTS','repetition cannot create a second profile');
reset role;
create function private.cita_onboarding_defaults_failure() returns trigger language plpgsql set search_path=pg_catalog,pg_temp as $$
begin if exists(select 1 from public.professionals where id=new.professional_id and name='Synthetic defaults failure') then raise exception 'TEAM_ONBOARDING_SYNTHETIC_DEFAULTS_FAILURE'; end if; return new; end $$;
create trigger cita_onboarding_defaults_failure before insert on public.professional_services for each row execute function private.cita_onboarding_defaults_failure();
set local role authenticated;
select extensions.throws_ok($test$select public.make_team_member_attending(business_id,(select id from public.business_users where user_id=other_admin),'Synthetic defaults failure') from team_onboarding_fixture$test$,'P0001','TEAM_ONBOARDING_SYNTHETIC_DEFAULTS_FAILURE','failure to assign defaults cannot report a successful attending conversion');
select extensions.is((select count(*) from public.professional_users where user_id=(select other_admin from team_onboarding_fixture)),0::bigint,'failed conversion leaves no user link');
select extensions.is((select count(*) from public.professionals where name='Synthetic defaults failure' and business_id=(select business_id from team_onboarding_fixture)),0::bigint,'failed conversion leaves no profile');
reset role;
create function private.cita_onboarding_audit_failure() returns trigger language plpgsql set search_path=pg_catalog,pg_temp as $$
begin if new.action='professional.created' and new.entity_id=(select failed_profile from team_onboarding_fixture) then raise exception 'TEAM_ONBOARDING_SYNTHETIC_AUDIT_FAILURE'; end if;return new;end $$;
create trigger cita_onboarding_audit_failure before insert on public.audit_logs for each row execute function private.cita_onboarding_audit_failure();
set local role authenticated;
select set_config('request.jwt.claim.sub',(select actor::text from team_onboarding_fixture),true);
select extensions.throws_ok($test$select public.create_team_member_profile(business_id,pg_temp.team_profile_configuration(failed_profile,failure_email)) from team_onboarding_fixture$test$,'P0001','TEAM_ONBOARDING_SYNTHETIC_AUDIT_FAILURE','audit failure also rolls back the complete onboarding task');
reset role;
select extensions.ok((select not exists(select 1 from public.professionals where id=f.failed_profile) and not exists(select 1 from public.business_user_invites where email=f.failure_email) and not exists(select 1 from public.allowed_emails where email=f.failure_email) and (select count(*) from public.services where business_id=f.business_id)=3 from team_onboarding_fixture f),'audit failure leaves no profile, invite, allowed email or additional service');
select * from extensions.finish();
rollback;
