-- Queue scenarios of the plan, in simulated time on the real claims: 25 practices
-- with five pending items each plus one practice with a long queue that starts
-- first. Each run claims what one scheduled run can afford and records the
-- results; the per-practice wait is measured from the first run. Run capacity
-- comes from the job budget and is fixed by the unit tests of each batch:
-- push 28 (Free) and 100 (Paid) reminders, calendar 10 (Free) and 84 (Paid)
-- events per run. CPU and network time of a deployed Worker are measured in
-- staging, not here. Synthetic data only; everything is rolled back.
begin;
select extensions.plan(6);

create temporary table scenario_clinic(label text primary key,business uuid not null,professional uuid not null,service uuid not null,owner uuid not null,connection uuid not null,big boolean not null);
create temporary table scenario_item(subscription uuid primary key,event uuid not null,label text not null,appointment uuid not null,starts_at timestamptz not null);
create temporary table scenario_log(queue text not null,run integer not null,label text not null);

create function pg_temp.add_scenario_clinic(p_label text,p_big boolean) returns void language plpgsql as $$
declare v_owner uuid:=gen_random_uuid(); v_business uuid; v_professional uuid; v_service uuid; v_connection uuid;
begin
 insert into auth.users(id,email) values(v_owner,'scenario-'||v_owner||'@example.test');
 insert into public.businesses(name,slug,industry,timezone)
 values('Escenario '||p_label,'scenario-'||gen_random_uuid(),'odontology','America/Argentina/Buenos_Aires') returning id into v_business;
 insert into public.services(business_id,name,duration_minutes) values(v_business,'Consulta',30) returning id into v_service;
 insert into public.professionals(business_id,name) values(v_business,'Profesional '||p_label) returning id into v_professional;
 insert into public.professional_services(business_id,professional_id,service_id) values(v_business,v_professional,v_service);
 insert into public.google_calendar_connections(oauth_client_key,google_subject,refresh_token_ciphertext)
 values(repeat('k',64),'scenario-'||gen_random_uuid(),'ciphertext-'||repeat('z',20)) returning id into v_connection;
 insert into scenario_clinic values(p_label,v_business,v_professional,v_service,v_owner,v_connection,p_big);
end $$;

-- One pending reminder and one pending calendar event per appointment.
create function pg_temp.add_scenario_item(p_label text,p_starts timestamptz,p_minutes integer,p_event_due timestamptz) returns void language plpgsql as $$
declare c record; v_patient uuid; v_appointment uuid; v_subscription uuid; v_event uuid;
begin
 select * into strict c from scenario_clinic where label=p_label;
 insert into public.patients(owner_id,business_id,full_name) values(c.owner,c.business,'Paciente '||p_label) returning id into v_patient;
 insert into public.appointments(business_id,patient_id,service_id,professional_id,starts_at,ends_at,blocking_starts_at,blocking_ends_at,
  status,source,service_name_snapshot,professional_name_snapshot,duration_minutes_snapshot)
 values(c.business,v_patient,c.service,c.professional,p_starts,p_starts+make_interval(mins=>p_minutes),p_starts,p_starts+make_interval(mins=>p_minutes),
  'reserved','manual','Consulta','Profesional '||p_label,p_minutes)
 returning id into v_appointment;
 select saved.subscription_id into strict v_subscription
 from public.save_appointment_push_subscription(c.business,v_appointment,'https://push.example/scenario-'||gen_random_uuid(),'key-s','auth-s','Android test',statement_timestamp()) saved;
 insert into public.appointment_google_calendar_events(business_id,appointment_id,connection_id,sync_status,next_attempt_at,created_at)
 values(c.business,v_appointment,c.connection,'pending_create',p_event_due,p_event_due) returning id into v_event;
 insert into scenario_item values(v_subscription,v_event,p_label,v_appointment,p_starts);
end $$;

-- One scheduled push run every five simulated minutes: claim, prepare, deliver.
create function pg_temp.simulate_push(p_queue text,p_start timestamptz,p_limit integer,p_runs integer) returns void language plpgsql as $$
declare v_now timestamptz; v_token uuid; v_next jsonb; v_prepared jsonb; v_results jsonb;
begin
 for run in 0..p_runs-1 loop
  v_now:=p_start+make_interval(mins=>5*run);
  v_token:=gen_random_uuid();
  select coalesce(jsonb_agg(jsonb_build_object('subscription_id',c.subscription_id,'kind',c.reminder_kind,
   'receipt_token_hash',encode(sha256(convert_to(c.subscription_id::text||':'||run,'UTF8')),'hex'))),'[]'::jsonb)
  into v_next from public.claim_push_reminder_batch(v_now,p_limit,v_token) c;
  v_prepared:=public.advance_push_reminder_batch(v_token,v_now,'[]',v_next)->'prepared';
  select coalesce(jsonb_agg(jsonb_build_object('subscription_id',p->>'subscription_id','kind',p->>'kind',
   'delivery_id',p->>'delivery_id','outcome','accepted','status_code',201)),'[]'::jsonb)
  into v_results from jsonb_array_elements(v_prepared) p;
  perform public.advance_push_reminder_batch(v_token,v_now,v_results,'[]',true);
  insert into scenario_log select p_queue,run,i.label from jsonb_array_elements(v_prepared) p join scenario_item i on i.subscription=(p->>'subscription_id')::uuid;
 end loop;
end $$;

-- One scheduled calendar run every five simulated minutes: claim and record the sync.
create function pg_temp.simulate_calendar(p_queue text,p_start timestamptz,p_limit integer,p_runs integer) returns void language plpgsql as $$
declare v_now timestamptz; v_token uuid; v_claimed jsonb; v_results jsonb;
begin
 for run in 0..p_runs-1 loop
  v_now:=p_start+make_interval(mins=>5*run);
  v_token:=gen_random_uuid();
  v_claimed:=public.claim_google_calendar_sync_batch(v_now,p_limit,v_token);
  select coalesce(jsonb_agg(jsonb_build_object('event_row_id',e->>'event_row_id','outcome','synced',
   'google_event_id','evt'||md5(e->>'event_row_id'),'synced_sequence',0)),'[]'::jsonb)
  into v_results from jsonb_array_elements(v_claimed) e;
  perform public.complete_google_calendar_sync_batch(v_token,v_now,v_results,true);
  insert into scenario_log select p_queue,run,i.label from jsonb_array_elements(v_claimed) e join scenario_item i on i.event=(e->>'event_row_id')::uuid;
 end loop;
end $$;

-- Per-practice measurements of one queue: minutes until each practice's first and
-- last item, and the same first start if the queue were served by time alone.
create function pg_temp.scenario_report(p_queue text,p_limit integer) returns jsonb language sql as $$
 with per_clinic as (
  select c.label,c.big,min(l.run)*5 as first_minutes,max(l.run)*5 as last_minutes,count(l.run) as items
  from scenario_clinic c left join scenario_log l on l.label=c.label and l.queue=p_queue group by c.label,c.big
 ), by_time as (
  select i.label,((row_number() over(order by i.starts_at,i.subscription)-1)/p_limit)*5 as minutes from scenario_item i
 )
 select jsonb_build_object(
  'queue',p_queue,'runCapacity',p_limit,
  'ordinaryFirstStartMaxMinutes',(select max(first_minutes) from per_clinic where not big),
  'ordinaryCompletedMinutes',(select max(last_minutes) from per_clinic where not big),
  'largeQueueFirstStartMinutes',(select first_minutes from per_clinic where big),
  'largeQueueCompletedMinutes',(select last_minutes from per_clinic where big),
  'itemsProcessed',(select sum(items) from per_clinic),
  'itemsPending',(select count(*) from scenario_item)-(select sum(items) from per_clinic),
  'timeOrderedOrdinaryFirstStartMaxMinutes',(select max(f.start_minutes) from (select label,min(minutes) as start_minutes from by_time group by label) f
    where f.label in (select label from per_clinic where not big))
 )
$$;

do $$
declare v_t timestamptz:=date_trunc('minute',statement_timestamp())+interval '60 days';
begin
 perform pg_temp.add_scenario_clinic('GRANDE',true);
 -- The large queue starts first and is due first: served by time alone, it would take every run.
 for i in 0..149 loop perform pg_temp.add_scenario_item('GRANDE',v_t+make_interval(mins=>5*i),5,v_t-interval '8 hours 30 minutes'+make_interval(secs=>i)); end loop;
 for clinic in 1..25 loop
  perform pg_temp.add_scenario_clinic('C'||clinic,false);
  for i in 0..4 loop perform pg_temp.add_scenario_item('C'||clinic,v_t+interval '13 hours'+make_interval(mins=>30*i),30,v_t-interval '8 hours 1 minute'); end loop;
 end loop;
 perform set_config('cita.scenario.start',(v_t-interval '8 hours')::text,true);
end $$;

-- Free push: 28 reminders per run.
select pg_temp.simulate_push('push-free',current_setting('cita.scenario.start')::timestamptz,28,12);
select extensions.diag('queue-scenario '||pg_temp.scenario_report('push-free',28)::text);
select extensions.ok((pg_temp.scenario_report('push-free',28)->>'ordinaryFirstStartMaxMinutes')::integer<=10
 and (pg_temp.scenario_report('push-free',28)->>'timeOrderedOrdinaryFirstStartMaxMinutes')::integer>10
 and (pg_temp.scenario_report('push-free',28)->>'largeQueueFirstStartMinutes')::integer=0
 and (pg_temp.scenario_report('push-free',28)->>'itemsPending')::integer=0,
 'Free push: every practice starts within ten minutes beside a long queue that, ordered by time alone, would delay them');

-- Paid push: 100 reminders per run, after resetting the same queue.
update public.push_subscriptions s set push_24h_sent_at=null,push_24h_claimed_at=null,push_24h_claim_token=null,updated_at=now()
where s.id in (select subscription from scenario_item);
select pg_temp.simulate_push('push-paid',current_setting('cita.scenario.start')::timestamptz,100,4);
select extensions.diag('queue-scenario '||pg_temp.scenario_report('push-paid',100)::text);
select extensions.ok((pg_temp.scenario_report('push-paid',100)->>'ordinaryFirstStartMaxMinutes')::integer=0
 and (pg_temp.scenario_report('push-paid',100)->>'itemsPending')::integer=0,
 'Paid push: every practice starts in the first run');

-- Free calendar: 10 events per run.
select pg_temp.simulate_calendar('calendar-free',current_setting('cita.scenario.start')::timestamptz,10,30);
select extensions.diag('queue-scenario '||pg_temp.scenario_report('calendar-free',10)::text);
select extensions.ok((pg_temp.scenario_report('calendar-free',10)->>'ordinaryFirstStartMaxMinutes')::integer<=10
 and (pg_temp.scenario_report('calendar-free',10)->>'largeQueueFirstStartMinutes')::integer=0
 and (pg_temp.scenario_report('calendar-free',10)->>'itemsPending')::integer=0,
 'Free calendar: every practice starts within ten minutes beside the long queue');

-- Paid calendar: 84 events per run, after resetting the same queue.
update public.appointment_google_calendar_events e set sync_status='pending_create',event_id=null,synced_sequence=-1,claimed_at=null,claim_token=null,
 attempt_count=0,next_attempt_at=current_setting('cita.scenario.start')::timestamptz-interval '1 minute',updated_at=now()
where e.id in (select event from scenario_item);
select pg_temp.simulate_calendar('calendar-paid',current_setting('cita.scenario.start')::timestamptz,84,5);
select extensions.diag('queue-scenario '||pg_temp.scenario_report('calendar-paid',84)::text);
select extensions.ok((pg_temp.scenario_report('calendar-paid',84)->>'ordinaryFirstStartMaxMinutes')::integer=0
 and (pg_temp.scenario_report('calendar-paid',84)->>'itemsPending')::integer=0,
 'Paid calendar: every practice starts in the first run');

-- Each item was processed exactly once per scenario and stayed in its practice.
select extensions.ok(not exists(
 select 1 from scenario_log l group by l.queue having count(*)<>(select count(*) from scenario_item)
) and (select count(distinct queue) from scenario_log)=4,
 'every scenario processed each pending item exactly once');
select extensions.ok((select count(*) from public.push_subscriptions s join scenario_item i on i.subscription=s.id where s.push_24h_sent_at is null)=0
 and (select count(*) from public.appointment_google_calendar_events e join scenario_item i on i.event=e.id where e.sync_status<>'active')=0,
 'the queues end with every reminder sent and every event active');

select * from extensions.finish();
rollback;
