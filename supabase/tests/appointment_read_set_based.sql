-- Reading appointments is evaluated once per statement (20261020030000). For every
-- role, the appointments, allocations and booking contexts visible through their
-- policies, and the allocations of the internal availability window, are exactly
-- those the single-row rule user_can_read_appointment approves; reading a practice's
-- week evaluates that rule zero times instead of once per row. Synthetic data only;
-- everything is rolled back.
begin;
select extensions.plan(6);

create temporary table read_business(label text primary key, id uuid not null, service uuid not null);
create temporary table read_actor(label text primary key, user_id uuid not null, business text);
create temporary table read_appointment(label text primary key, business text not null, id uuid not null);
create temporary table read_window(label text primary key, business uuid not null, service uuid not null, professionals uuid[] not null,
 from_date date not null, to_date date not null, revision bigint not null);
grant select on read_business, read_actor, read_appointment, read_window to authenticated;

do $$
declare
 b1 uuid:=gen_random_uuid(); b2 uuid:=gen_random_uuid(); s1 uuid:=gen_random_uuid(); s2 uuid:=gen_random_uuid();
 u_owner uuid:=gen_random_uuid(); u_admin uuid:=gen_random_uuid(); u_reception uuid:=gen_random_uuid(); u_readonly uuid:=gen_random_uuid();
 u_professional uuid:=gen_random_uuid(); u_support uuid:=gen_random_uuid(); u_stranger uuid:=gen_random_uuid();
 u_owner2 uuid:=gen_random_uuid(); u_professional2 uuid:=gen_random_uuid();
 p_linked uuid:=gen_random_uuid(); p_other uuid:=gen_random_uuid(); p_restricted uuid:=gen_random_uuid();
 v_integration uuid; v_patient uuid; v_appointment uuid;
 v_start timestamptz:=date_trunc('day',now())+interval '2 days 9 hours';
begin
 insert into auth.users(id,email) select id,'appointment-read-'||id||'@example.test'
 from unnest(array[u_owner,u_admin,u_reception,u_readonly,u_professional,u_support,u_stranger,u_owner2,u_professional2]) id;
 insert into public.businesses(id,name,slug,industry,timezone) values(b1,'Turnos uno',b1::text,'other','America/Argentina/Buenos_Aires'),
  (b2,'Turnos dos',b2::text,'other','America/Argentina/Buenos_Aires');
 update public.business_subscriptions set commercial_access_enabled=true,is_permanent=true,subscription_status='active',
  paid_until=null,grace_until=null,restricted_until=null,archived_at=null where business_id in (b1,b2);
 insert into public.business_users(business_id,user_id,role,status,accepted_at) values
  (b1,u_owner,'owner','active',now()),(b1,u_admin,'admin','active',now()),(b1,u_reception,'reception','active',now()),
  (b1,u_readonly,'readonly','active',now()),(b1,u_professional,'professional','active',now()),
  (b2,u_owner2,'owner','active',now()),(b2,u_professional2,'professional','active',now());
 insert into public.account_assistance_support_users(user_id,email) values(u_support,'appointment-read-support-'||u_support||'@example.test');
 insert into public.account_assistance_grants(business_id,requested_by_user_id,support_user_id,expires_at) values(b1,u_owner,u_support,now()+interval '1 hour');
 insert into public.professionals(id,business_id,name) values(p_linked,b1,'Profesional vinculado'),(p_other,b1,'Otra profesional'),
  (p_restricted,b2,'Profesional restringido');
 insert into public.professional_users(business_id,user_id,professional_id) values(b1,u_professional,p_linked),(b2,u_professional2,p_restricted);
 insert into public.services(id,business_id,name,duration_minutes) values(s1,b1,'Consulta',30),(s2,b2,'Consulta',30);
 insert into public.professional_services(business_id,professional_id,service_id) values(b1,p_linked,s1),(b1,p_other,s1),(b2,p_restricted,s2);
 -- Inactive: an active integration needs allowed origins, and a context only needs its integration.
 insert into public.booking_integrations(business_id,name) values(b1,'Sitio de lectura') returning id into v_integration;
 -- 1-3 belong to the linked professional, 4-7 to a colleague, and 8 to the colleague
 -- with the linked professional as a second allocation (a joint appointment).
 for i in 1..8 loop
  insert into public.patients(owner_id,business_id,full_name) values(u_owner,b1,'Paciente turno '||i) returning id into v_patient;
  insert into public.appointments(business_id,patient_id,service_id,professional_id,starts_at,ends_at,blocking_starts_at,blocking_ends_at,
   status,source,service_name_snapshot,professional_name_snapshot,duration_minutes_snapshot)
  values(b1,v_patient,s1,case when i<=3 then p_linked else p_other end,v_start+make_interval(hours=>i),v_start+make_interval(hours=>i,mins=>30),
   v_start+make_interval(hours=>i),v_start+make_interval(hours=>i,mins=>30),'reserved','manual','Consulta','Profesional',30)
  returning id into v_appointment;
  insert into read_appointment values('a'||i,'b1',v_appointment);
  if i=8 then
   insert into public.appointment_professionals(business_id,appointment_id,professional_id,position,is_primary)
   values(b1,v_appointment,p_linked,1,false);
  end if;
  -- A public booking context for one appointment of each professional.
  if i in (1,5) then
   insert into public.appointment_booking_contexts(appointment_id,business_id,integration_id,integration_revision,contract_version,
    theme_snapshot,entry_point,modality,context_fingerprint)
   values(v_appointment,b1,v_integration,1,1,'cita-suite','public_page','in_person',repeat('a',64));
  end if;
 end loop;
 for i in 1..2 loop
  insert into public.patients(owner_id,business_id,full_name) values(u_owner2,b2,'Paciente restringido '||i) returning id into v_patient;
  insert into public.appointments(business_id,patient_id,service_id,professional_id,starts_at,ends_at,blocking_starts_at,blocking_ends_at,
   status,source,service_name_snapshot,professional_name_snapshot,duration_minutes_snapshot)
  values(b2,v_patient,s2,p_restricted,v_start+make_interval(hours=>i),v_start+make_interval(hours=>i,mins=>30),
   v_start+make_interval(hours=>i),v_start+make_interval(hours=>i,mins=>30),'reserved','manual','Consulta','Profesional',30)
  returning id into v_appointment;
  insert into read_appointment values('b'||i,'b2',v_appointment);
 end loop;
 -- Restricted afterwards: owners keep the restricted read of patients, but no one operates
 -- the agenda, so nobody reads its appointments.
 update public.business_subscriptions set commercial_access_enabled=true,is_permanent=false,subscription_status='restricted',
  paid_until=now()-interval '20 days',grace_until=now()-interval '10 days',restricted_until=now()+interval '30 days',archived_at=null where business_id=b2;
 insert into read_business values('b1',b1,s1),('b2',b2,s2);
 insert into read_actor values('owner',u_owner,'b1'),('admin',u_admin,'b1'),('reception',u_reception,'b1'),('readonly',u_readonly,'b1'),
  ('professional',u_professional,'b1'),('support',u_support,'b1'),('stranger',u_stranger,null),
  ('restricted owner',u_owner2,'b2'),('restricted professional',u_professional2,'b2');
 insert into read_window select 'b1',b1,s1,array[p_linked,p_other],(v_start at time zone 'America/Argentina/Buenos_Aires')::date,
  (v_start at time zone 'America/Argentina/Buenos_Aires')::date+1,v.revision from private.availability_configuration_versions v where v.business_id=b1;
end $$;

-- 1. Reading a practice's week, its allocations, its booking contexts and its internal
-- availability window evaluates the single-row rule zero times.
set local track_functions='all';
do $$
declare
 -- Resolved by name so the per-row failure, not a missing helper, is what shows
 -- before the fix; check 6 requires the helpers on their own.
 v_rule regprocedure:='public.user_can_read_appointment(uuid,uuid)'; v_readers regprocedure:=to_regprocedure('public.user_appointment_reader_business_ids()');
 v_rule_before bigint; v_readers_before bigint; v_week bigint; v_allocations bigint; v_contexts bigint; v_blocks integer; w record;
begin
 select * into strict w from read_window where label='b1';
 perform set_config('request.jwt.claim.sub',(select user_id::text from read_actor where label='owner'),true);
 perform set_config('request.jwt.claim.role','authenticated',true);
 v_rule_before:=coalesce(pg_stat_get_xact_function_calls(v_rule),0);
 v_readers_before:=coalesce(pg_stat_get_xact_function_calls(v_readers),0);
 execute 'set local role authenticated';
 select count(*) into v_week from public.appointments where business_id=w.business and starts_at>=now() and starts_at<now()+interval '7 days';
 select count(*) into v_allocations from public.appointment_professionals where business_id=w.business;
 select count(*) into v_contexts from public.appointment_booking_contexts where business_id=w.business;
 select (public.get_availability_window(w.business,false,w.service,w.professionals,w.from_date,w.to_date,w.revision)->'counts'->>'blocks')::integer into v_blocks;
 execute 'reset role';
 if coalesce(v_week<>8 or v_allocations<>9 or v_contexts<>2 or v_blocks<>9,true) then
  raise exception 'TEST_OWNER_READ_COUNTS % % % %',v_week,v_allocations,v_contexts,v_blocks;
 end if;
 if coalesce(coalesce(pg_stat_get_xact_function_calls(v_rule),0)-v_rule_before<>0,true) then
  raise exception 'TEST_PER_ROW_RULE_EVALUATED %',coalesce(pg_stat_get_xact_function_calls(v_rule),0)-v_rule_before;
 end if;
 if v_readers is not null and coalesce(coalesce(pg_stat_get_xact_function_calls(v_readers),0)-v_readers_before>6,true) then
  raise exception 'TEST_PRACTICE_SET_PER_ROW %',coalesce(pg_stat_get_xact_function_calls(v_readers),0)-v_readers_before;
 end if;
end $$;
select extensions.pass('reading a practice week, its allocations, contexts and availability window evaluates the single-row rule zero times');

-- 2. Each policy shows every role exactly the rows the single-row rule approves.
do $$
declare actor record; v_reference uuid[]; v_policy uuid[];
begin
 for actor in select * from read_actor order by label loop
  perform set_config('request.jwt.claim.sub',actor.user_id::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  -- Appointments.
  select coalesce(array_agg(a.id order by a.id),'{}') into v_reference from public.appointments a
  where a.business_id in (select id from read_business) and public.user_can_read_appointment(a.business_id,a.id);
  execute 'set local role authenticated';
  select coalesce(array_agg(a.id order by a.id),'{}') into v_policy from public.appointments a where a.business_id in (select id from read_business);
  execute 'reset role';
  if v_policy is distinct from v_reference then raise exception 'TEST_APPOINTMENTS_POLICY % reference % policy %',actor.label,v_reference,v_policy; end if;
  -- Allocations.
  select coalesce(array_agg(p.id order by p.id),'{}') into v_reference from public.appointment_professionals p
  where p.business_id in (select id from read_business) and public.user_can_read_appointment(p.business_id,p.appointment_id);
  execute 'set local role authenticated';
  select coalesce(array_agg(p.id order by p.id),'{}') into v_policy from public.appointment_professionals p where p.business_id in (select id from read_business);
  execute 'reset role';
  if v_policy is distinct from v_reference then raise exception 'TEST_ALLOCATIONS_POLICY % reference % policy %',actor.label,v_reference,v_policy; end if;
  -- Booking contexts.
  select coalesce(array_agg(c.appointment_id order by c.appointment_id),'{}') into v_reference from public.appointment_booking_contexts c
  where c.business_id in (select id from read_business) and public.user_can_read_appointment(c.business_id,c.appointment_id);
  execute 'set local role authenticated';
  select coalesce(array_agg(c.appointment_id order by c.appointment_id),'{}') into v_policy from public.appointment_booking_contexts c
  where c.business_id in (select id from read_business);
  execute 'reset role';
  if v_policy is distinct from v_reference then raise exception 'TEST_CONTEXTS_POLICY % reference % policy %',actor.label,v_reference,v_policy; end if;
 end loop;
end $$;
select extensions.pass('appointments, allocations and booking contexts show each role exactly the rows the single-row rule approves');

-- 3. The expected visibility itself, so equivalence cannot hide a common mistake.
do $$
declare actor record; v_visible text[]; v_expected text[];
begin
 for actor in select * from read_actor order by label loop
  perform set_config('request.jwt.claim.sub',actor.user_id::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  execute 'set local role authenticated';
  select coalesce(array_agg(r.label order by r.label),'{}') into v_visible from public.appointments a join read_appointment r on r.id=a.id;
  execute 'reset role';
  v_expected:=case actor.label
   when 'professional' then array['a1','a2','a3','a8']
   when 'restricted professional' then '{}'::text[]
   when 'restricted owner' then '{}'::text[]
   when 'stranger' then '{}'::text[]
   else array['a1','a2','a3','a4','a5','a6','a7','a8']
  end;
  if v_visible is distinct from v_expected then raise exception 'TEST_VISIBILITY % expected % got %',actor.label,v_expected,v_visible; end if;
 end loop;
end $$;
select extensions.pass('owners, admins, support, reception and readonly read the agenda; professionals only their allocations; a practice that does not operate, nobody');

-- 4. The internal availability window blocks exactly the allocations the actor can read.
do $$
declare actor record; w record; v_reference uuid[]; v_window uuid[];
begin
 select * into strict w from read_window where label='b1';
 for actor in select * from read_actor where business='b1' order by label loop
  perform set_config('request.jwt.claim.sub',actor.user_id::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  select coalesce(array_agg(p.id order by p.id),'{}') into v_reference from public.appointment_professionals p
  where p.business_id=w.business and public.user_can_read_appointment(p.business_id,p.appointment_id);
  execute 'set local role authenticated';
  select coalesce(array_agg((block->>'id')::uuid order by (block->>'id')::uuid),'{}') into v_window
  from jsonb_array_elements(public.get_availability_window(w.business,false,w.service,w.professionals,w.from_date,w.to_date,w.revision)->'blocks') block;
  execute 'reset role';
  if v_window is distinct from v_reference then raise exception 'TEST_WINDOW % reference % window %',actor.label,v_reference,v_window; end if;
  if actor.label='professional' and cardinality(v_window)<>5 then raise exception 'TEST_WINDOW_PROFESSIONAL %',v_window; end if;
 end loop;
end $$;
select extensions.pass('the internal availability window blocks exactly the allocations each role can read');

-- 5. A practice that stops operating hides its agenda on the next statement.
do $$
declare v_before bigint; v_after bigint; b uuid:=(select id from read_business where label='b1');
begin
 perform set_config('request.jwt.claim.sub',(select user_id::text from read_actor where label='reception'),true);
 perform set_config('request.jwt.claim.role','authenticated',true);
 execute 'set local role authenticated';
 select count(*) into v_before from public.appointments where business_id=b;
 execute 'reset role';
 update public.business_subscriptions set commercial_access_enabled=true,is_permanent=false,subscription_status='restricted',
  paid_until=now()-interval '20 days',grace_until=now()-interval '10 days',restricted_until=now()+interval '30 days',archived_at=null where business_id=b;
 execute 'set local role authenticated';
 select count(*) into v_after from public.appointments where business_id=b;
 execute 'reset role';
 if coalesce(v_before<>8 or v_after<>0,true) then raise exception 'TEST_OPERATION_STATE % %',v_before,v_after; end if;
end $$;
select extensions.pass('a practice that stops operating hides its agenda on the next statement');

-- 6. The new helpers are callable only by signed-in users and the server.
select extensions.ok(
 case when to_regprocedure('public.user_appointment_reader_business_ids()') is null or to_regprocedure('public.user_allocated_appointment_ids()') is null
 then false else
  not has_function_privilege('anon','public.user_appointment_reader_business_ids()','execute')
  and not has_function_privilege('anon','public.user_allocated_appointment_ids()','execute')
  and has_function_privilege('authenticated','public.user_appointment_reader_business_ids()','execute')
  and has_function_privilege('authenticated','public.user_allocated_appointment_ids()','execute') end,
 'the set helpers are not executable anonymously');

select * from extensions.finish();
rollback;
