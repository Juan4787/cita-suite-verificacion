-- Public booking attempts keep a phone, a hash of the address and the user agent of
-- every public booking and management-link attempt. Only the limits read them, over
-- the last ten and thirty minutes. They are kept seven days, like the other server
-- limit events, through the database's own schedule, and the pruning cannot be
-- called by any API role. Synthetic data only; everything is rolled back.
begin;
select extensions.plan(3);

create temporary table retention_attempt(label text primary key, id uuid not null);

-- 1. Attempts older than seven days are removed; the rest stay, whatever their action.
do $$
declare v_business uuid:=gen_random_uuid(); v_prune regprocedure:=to_regprocedure('private.prune_public_booking_attempts()'); v_removed integer;
begin
 insert into public.businesses(id,name,slug,industry) values(v_business,'Retención de intentos',v_business::text,'other');
 with inserted as (
  insert into public.public_booking_attempts(business_id,phone_e164,ip_hash,action,success,user_agent,created_at)
  values(v_business,'+5491100000001',repeat('a',64),'booking_create',true,'sintético',now()-interval '8 days'),
   (v_business,'+5491100000002',repeat('b',64),'token_cancel',false,'sintético',now()-interval '7 days 1 minute'),
   (v_business,'+5491100000003',repeat('c',64),'booking_create',false,'sintético',now()-interval '6 days 23 hours'),
   (v_business,'+5491100000004',repeat('d',64),'booking_create',true,'sintético',now()-interval '5 minutes')
  returning id,phone_e164
 )
 insert into retention_attempt
 select case phone_e164 when '+5491100000001' then 'old booking' when '+5491100000002' then 'old token'
  when '+5491100000003' then 'recent' else 'within limits' end,id from inserted;
 if v_prune is null then raise exception 'TEST_ATTEMPTS_RETENTION_MISSING'; end if;
 execute 'select private.prune_public_booking_attempts()' into v_removed;
 if coalesce(v_removed<2
  or exists(select 1 from public.public_booking_attempts a join retention_attempt r on r.id=a.id where r.label like 'old%')
  or (select count(*) from public.public_booking_attempts a join retention_attempt r on r.id=a.id where r.label in ('recent','within limits'))<>2,true) then
  raise exception 'TEST_ATTEMPTS_RETENTION %',v_removed;
 end if;
end $$;
select extensions.pass('public booking attempts older than seven days are removed and recent ones stay');

-- 2. The database schedules the pruning itself, once a day.
do $$
begin
 if to_regnamespace('cron') is null or not exists(select 1 from cron.job where jobname='cita-suite-public-booking-attempts-retention'
  and command='select private.prune_public_booking_attempts()') then
  raise exception 'TEST_ATTEMPTS_RETENTION_SCHEDULE';
 end if;
end $$;
select extensions.pass('the database schedules the pruning of public booking attempts');

-- 3. No API role can run the pruning.
select extensions.ok(
 case when to_regprocedure('private.prune_public_booking_attempts()') is null then false else not exists(
  select 1 from unnest(array['anon','authenticated','service_role']) api_role
  where has_function_privilege(api_role,'private.prune_public_booking_attempts()','execute')) end,
 'no API role can run the pruning of public booking attempts');

select * from extensions.finish();
rollback;
