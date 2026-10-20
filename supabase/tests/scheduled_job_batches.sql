-- Stage 6 batch contracts for the scheduled jobs: fair claims between practices,
-- claim ownership and expiry, persistent backoff, revalidation right before the
-- external effect, idempotent results, abandoned upload cleanup, telemetry
-- retention, the legacy switch and least privilege. Every claim and result takes
-- its time explicitly, so queue age is simulated without waiting. Synthetic data
-- only; everything is rolled back.
begin;
-- Metadata-only Storage rows, as in the other clinical file suites.
set local storage.allow_delete_query='true';
select extensions.plan(7);

create temporary table batch_fixture(label text primary key,business uuid not null,service uuid not null,professional uuid not null,owner uuid not null);
create temporary table batch_push(label text primary key,business uuid not null,appointment uuid not null,subscription uuid not null,endpoint text not null);
create temporary table batch_calendar(label text primary key,business uuid not null,appointment uuid not null,event uuid not null);

create function pg_temp.batch_business(p_label text) returns uuid language plpgsql as $$
declare v_owner uuid:=gen_random_uuid(); v_business uuid; v_service uuid; v_professional uuid;
begin
 insert into auth.users(id,email) values(v_owner,'batch-'||v_owner||'@example.test');
 insert into public.businesses(name,slug,industry,timezone)
 values('Lote '||p_label,'batch-'||gen_random_uuid(),'odontology','America/Argentina/Buenos_Aires')
 returning id into v_business;
 insert into public.services(business_id,name,duration_minutes) values(v_business,'Consulta',30) returning id into v_service;
 insert into public.professionals(business_id,name) values(v_business,'Profesional '||p_label) returning id into v_professional;
 insert into public.professional_services(business_id,professional_id,service_id) values(v_business,v_professional,v_service);
 insert into batch_fixture values(p_label,v_business,v_service,v_professional,v_owner);
 return v_business;
end $$;

-- One patient per appointment: review requests are serialized per patient.
create function pg_temp.batch_appointment(p_label text,p_starts timestamptz,p_minutes integer) returns uuid language plpgsql as $$
declare f record; v_patient uuid; v_id uuid;
begin
 select * into strict f from batch_fixture where label=p_label;
 insert into public.patients(owner_id,business_id,full_name) values(f.owner,f.business,'Paciente '||p_label) returning id into v_patient;
 insert into public.appointments(business_id,patient_id,service_id,professional_id,starts_at,ends_at,blocking_starts_at,blocking_ends_at,
  status,source,service_name_snapshot,professional_name_snapshot,duration_minutes_snapshot)
 values(f.business,v_patient,f.service,f.professional,p_starts,p_starts+make_interval(mins=>p_minutes),p_starts,p_starts+make_interval(mins=>p_minutes),
  'reserved','manual','Consulta','Profesional '||p_label,p_minutes)
 returning id into v_id;
 return v_id;
end $$;

create function pg_temp.batch_reminder(p_business text,p_label text,p_starts timestamptz,p_minutes integer) returns uuid language plpgsql as $$
declare v_appointment uuid; v_business uuid; v_subscription uuid;
 v_endpoint text:='https://push.example/batch-'||p_label||'-'||gen_random_uuid();
begin
 v_appointment:=pg_temp.batch_appointment(p_business,p_starts,p_minutes);
 select business into strict v_business from batch_fixture where label=p_business;
 select saved.subscription_id into strict v_subscription
 from public.save_appointment_push_subscription(v_business,v_appointment,v_endpoint,'key-'||p_label,'auth-'||p_label,'Android test',statement_timestamp()) saved;
 insert into batch_push values(p_label,v_business,v_appointment,v_subscription,v_endpoint);
 return v_subscription;
end $$;

create function pg_temp.sub(p_label text) returns uuid language sql as $$ select subscription from batch_push where label=p_label $$;
create function pg_temp.next_item(p_label text,p_kind text,p_hash_char text) returns jsonb language sql as $$
 select jsonb_build_array(jsonb_build_object('subscription_id',pg_temp.sub(p_label),'kind',p_kind,'receipt_token_hash',repeat(p_hash_char,64)))
$$;
create function pg_temp.result_item(p_label text,p_kind text,p_delivery uuid,p_outcome text,p_status integer) returns jsonb language sql as $$
 select jsonb_build_array(jsonb_build_object('subscription_id',pg_temp.sub(p_label),'kind',p_kind,'delivery_id',p_delivery,'outcome',p_outcome,'status_code',p_status))
$$;
create function pg_temp.calendar_event(p_label text) returns uuid language sql as $$ select event from batch_calendar where label=p_label $$;

-- 1. Push reminders ---------------------------------------------------------------
do $$
declare
 v_t timestamptz:=date_trunc('minute',statement_timestamp())+interval '30 days';
 v_now timestamptz:=v_t-interval '18 hours';
 v_at timestamptz;
 v_a uuid; v_b uuid; v_c uuid;
 v_tok1 uuid:=gen_random_uuid(); v_tok2 uuid:=gen_random_uuid(); v_tok3 uuid:=gen_random_uuid(); v_tok4 uuid:=gen_random_uuid();
 v_tok5 uuid:=gen_random_uuid(); v_tok6 uuid:=gen_random_uuid(); v_tok7 uuid:=gen_random_uuid();
 v_claim record; v_state record; v_first uuid[]; v_second uuid[]; v_third uuid[]; v_ids uuid[];
 v_result jsonb; v_item jsonb; v_delivery uuid; v_lost uuid; v_count integer;
begin
 v_a:=pg_temp.batch_business('A'); v_b:=pg_temp.batch_business('B'); v_c:=pg_temp.batch_business('C');
 -- A has a long queue that starts first; B and C have a little work later on.
 for i in 0..11 loop perform pg_temp.batch_reminder('A','A'||i,v_t+make_interval(mins=>10*i),10); end loop;
 perform pg_temp.batch_reminder('B','B0',v_t+interval '3 hours',30);
 perform pg_temp.batch_reminder('B','B1',v_t+interval '3 hours 30 minutes',30);
 perform pg_temp.batch_reminder('C','C0',v_t+interval '4 hours',30);

 -- Fair claim. Ordered by time alone, the first five would all belong to A.
 select array_agg(c.subscription_id) as ids,
  count(*) filter (where c.business_id=v_a) as a,count(*) filter (where c.business_id=v_b) as b,count(*) filter (where c.business_id=v_c) as c,
  bool_and(c.reminder_kind='24h') as all_24h,max(c.business_turn) as max_turn,
  bool_and(c.business_id=(select p.business from batch_push p where p.subscription=c.subscription_id)) as own_business
 into v_claim
 from public.claim_push_reminder_batch(v_now,5,v_tok1) c;
 if coalesce(cardinality(v_claim.ids)<>5 or v_claim.a<>2 or v_claim.b<>2 or v_claim.c<>1 or not v_claim.all_24h
  or v_claim.max_turn<>2 or not v_claim.own_business,true) then
  raise exception 'TEST_PUSH_CLAIM_NOT_FAIR %',row_to_json(v_claim);
 end if;
 v_first:=v_claim.ids;
 if coalesce((select array_agg(x order by x::text) from unnest(v_first) x) is distinct from
  (select array_agg(p.subscription order by p.subscription::text) from batch_push p where p.label in ('A0','A1','B0','B1','C0')),true) then
  raise exception 'TEST_PUSH_CLAIM_WRONG_ITEMS';
 end if;
 if coalesce(exists(select 1 from public.push_subscriptions s where s.id=any(v_first)
  and (s.push_24h_claim_token is distinct from v_tok1 or s.push_24h_claimed_at is distinct from v_now or s.push_2h_claim_token is not null)),true) then
  raise exception 'TEST_PUSH_CLAIM_STATE';
 end if;

 -- A live claim is never taken by another claimer; the rest of the queue is.
 select array_agg(c.subscription_id) into v_second from public.claim_push_reminder_batch(v_now+interval '5 minutes',50,v_tok2) c;
 if coalesce(cardinality(v_second)<>10 or v_second&&v_first,true) then raise exception 'TEST_PUSH_LIVE_CLAIM_TAKEN'; end if;

 -- Finishing releases only the claims of its own token.
 v_result:=public.advance_push_reminder_batch(v_tok2,v_now+interval '6 minutes','[]','[]',true);
 if coalesce((v_result->>'released')::integer<>10 or (v_result->>'completed')::integer<>0,true) then raise exception 'TEST_PUSH_FINISH_COUNT %',v_result; end if;
 if coalesce(exists(select 1 from public.push_subscriptions s where s.id=any(v_second) and (s.push_24h_claimed_at is not null or s.push_24h_claim_token is not null))
  or exists(select 1 from public.push_subscriptions s where s.id=any(v_first) and s.push_24h_claim_token is distinct from v_tok1),true) then
  raise exception 'TEST_PUSH_FINISH_SCOPE';
 end if;

 -- An abandoned claim is recovered after ten minutes; the late results of its
 -- previous owner are stale and change nothing.
 select array_agg(c.subscription_id) into v_third from public.claim_push_reminder_batch(v_now+interval '11 minutes',50,v_tok3) c;
 if coalesce(cardinality(v_third)<>15 or not v_third@>v_first,true) then raise exception 'TEST_PUSH_EXPIRED_CLAIM_NOT_RECOVERED'; end if;
 v_result:=public.advance_push_reminder_batch(v_tok1,v_now+interval '12 minutes',
  (select jsonb_agg(jsonb_build_object('subscription_id',x,'kind','24h','delivery_id',null,'outcome','accepted','status_code',201)) from unnest(v_first) x),'[]');
 if coalesce((v_result->>'completed')::integer<>0 or exists(select 1 from public.push_subscriptions s where s.id=any(v_first)
  and (s.push_24h_sent_at is not null or s.push_24h_claim_token is distinct from v_tok3)),true) then
  raise exception 'TEST_PUSH_STALE_RESULT_APPLIED';
 end if;

 -- Preparing returns the live context and tracks the attempt before the send.
 v_at:=v_now+interval '12 minutes';
 v_result:=public.advance_push_reminder_batch(v_tok3,v_at,'[]',pg_temp.next_item('A0','24h','a'));
 v_item:=v_result->'prepared'->0;
 if coalesce(jsonb_array_length(v_result->'prepared')<>1 or jsonb_array_length(v_result->'invalidated')<>0
  or v_item->>'business_name'<>'Lote A' or (v_item->>'business_id')::uuid<>v_a
  or v_item->>'endpoint'<>(select endpoint from batch_push where label='A0')
  or (v_item->>'ttl_seconds')::integer<>extract(epoch from v_t-v_at)::integer
  or v_item->>'confirmation_token' is null or v_item->>'business_timezone'<>'America/Argentina/Buenos_Aires',true) then
  raise exception 'TEST_PUSH_PREPARED_CONTEXT %',v_result;
 end if;
 v_delivery:=(v_item->>'delivery_id')::uuid;
 if coalesce(not exists(select 1 from public.push_delivery_attempts d where d.id=v_delivery and d.subscription_id=pg_temp.sub('A0')
  and d.kind='24h' and d.receipt_token_hash=repeat('a',64) and d.accepted_at is null and d.failed_at is null
  and d.expires_at=v_at+make_interval(secs=>(v_item->>'ttl_seconds')::integer)),true) then
  raise exception 'TEST_PUSH_ATTEMPT_NOT_TRACKED';
 end if;

 -- An accepted result is recorded once, with its audit entry, even if repeated.
 v_at:=v_now+interval '13 minutes';
 v_result:=public.advance_push_reminder_batch(v_tok3,v_at,pg_temp.result_item('A0','24h',v_delivery,'accepted',201),'[]');
 select * into v_state from public.push_subscriptions where id=pg_temp.sub('A0');
 if coalesce((v_result->>'completed')::integer<>1 or v_state.push_24h_sent_at is distinct from v_at or v_state.push_24h_claim_token is not null
  or v_state.push_24h_failures<>0 or v_state.push_24h_retry_at is not null,true) then
  raise exception 'TEST_PUSH_ACCEPTED_STATE %',v_result;
 end if;
 if coalesce(not exists(select 1 from public.push_delivery_attempts where id=v_delivery and accepted_at=v_at and push_service_status=201),true) then
  raise exception 'TEST_PUSH_ACCEPTANCE_NOT_TRACKED';
 end if;
 v_result:=public.advance_push_reminder_batch(v_tok3,v_at+interval '1 minute',pg_temp.result_item('A0','24h',v_delivery,'accepted',201),'[]');
 select count(*) into v_count from public.audit_logs where action='appointment.push_sent' and entity_id=(select appointment from batch_push where label='A0');
 if coalesce((v_result->>'completed')::integer<>0 or v_count<>1
  or (select push_24h_sent_at from public.push_subscriptions where id=pg_temp.sub('A0')) is distinct from v_at,true) then
  raise exception 'TEST_PUSH_RESULT_NOT_IDEMPOTENT';
 end if;

 -- A failed send waits persistently and exponentially, and the wait is respected.
 v_at:=v_now+interval '15 minutes';
 v_result:=public.advance_push_reminder_batch(v_tok3,v_at,'[]',pg_temp.next_item('A1','24h','b'));
 v_delivery:=(v_result->'prepared'->0->>'delivery_id')::uuid;
 v_result:=public.advance_push_reminder_batch(v_tok3,v_at,pg_temp.result_item('A1','24h',v_delivery,'transient',503),'[]');
 select * into v_state from public.push_subscriptions where id=pg_temp.sub('A1');
 if coalesce(v_state.push_24h_failures<>1 or v_state.push_24h_retry_at is distinct from v_at+interval '1 minute'
  or v_state.push_24h_claimed_at is not null or v_state.push_24h_claim_token is not null or v_state.push_24h_sent_at is not null,true) then
  raise exception 'TEST_PUSH_BACKOFF_STATE';
 end if;
 if coalesce(not exists(select 1 from public.push_delivery_attempts where id=v_delivery and failed_at=v_at and failure_kind='transient' and push_service_status=503),true) then
  raise exception 'TEST_PUSH_FAILURE_NOT_TRACKED';
 end if;
 if coalesce(exists(select 1 from public.claim_push_reminder_batch(v_at+interval '30 seconds',100,v_tok4) c where c.subscription_id=pg_temp.sub('A1')),true) then
  raise exception 'TEST_PUSH_BACKOFF_IGNORED';
 end if;
 select array_agg(c.subscription_id) into v_ids from public.claim_push_reminder_batch(v_at+interval '61 seconds',100,v_tok4) c;
 if coalesce(v_ids is distinct from array[pg_temp.sub('A1')],true) then raise exception 'TEST_PUSH_RETRY_NOT_CLAIMED %',v_ids; end if;
 v_at:=v_at+interval '2 minutes';
 v_result:=public.advance_push_reminder_batch(v_tok4,v_at,'[]',pg_temp.next_item('A1','24h','c'));
 v_delivery:=(v_result->'prepared'->0->>'delivery_id')::uuid;
 v_result:=public.advance_push_reminder_batch(v_tok4,v_at,pg_temp.result_item('A1','24h',v_delivery,'rejected',400),'[]');
 select * into v_state from public.push_subscriptions where id=pg_temp.sub('A1');
 if coalesce(v_state.push_24h_failures<>2 or v_state.push_24h_retry_at is distinct from v_at+interval '2 minutes',true) then
  raise exception 'TEST_PUSH_BACKOFF_NOT_EXPONENTIAL';
 end if;
 -- The wait is capped at one hour. A lost response carries no status code.
 update public.push_subscriptions set push_24h_failures=9 where id=pg_temp.sub('A1');
 v_at:=v_at+interval '2 minutes';
 select array_agg(c.subscription_id) into v_ids from public.claim_push_reminder_batch(v_at,100,v_tok4) c;
 if coalesce(v_ids is distinct from array[pg_temp.sub('A1')],true) then raise exception 'TEST_PUSH_RETRY_AFTER_WAIT %',v_ids; end if;
 v_result:=public.advance_push_reminder_batch(v_tok4,v_at,'[]',pg_temp.next_item('A1','24h','d'));
 v_delivery:=(v_result->'prepared'->0->>'delivery_id')::uuid;
 v_result:=public.advance_push_reminder_batch(v_tok4,v_at,pg_temp.result_item('A1','24h',v_delivery,'transient',null),'[]');
 select * into v_state from public.push_subscriptions where id=pg_temp.sub('A1');
 if coalesce(v_state.push_24h_failures<>10 or v_state.push_24h_retry_at is distinct from v_at+interval '60 minutes',true) then
  raise exception 'TEST_PUSH_BACKOFF_NOT_CAPPED';
 end if;

 -- A response lost with the process: the expired claim is recovered and the
 -- unresolved attempt is recorded as transient before the new one is tracked.
 v_result:=public.advance_push_reminder_batch(v_tok3,v_now+interval '20 minutes','[]',pg_temp.next_item('A2','24h','e'));
 v_lost:=(v_result->'prepared'->0->>'delivery_id')::uuid;
 select array_agg(c.subscription_id) into v_ids from public.claim_push_reminder_batch(v_now+interval '22 minutes',100,v_tok5) c;
 if coalesce(not v_ids@>array[pg_temp.sub('A2'),pg_temp.sub('A3'),pg_temp.sub('A4'),pg_temp.sub('B0'),pg_temp.sub('C0')]
  or pg_temp.sub('A0')=any(v_ids) or pg_temp.sub('A1')=any(v_ids),true) then
  raise exception 'TEST_PUSH_RECOVERY_SET %',v_ids;
 end if;
 v_result:=public.advance_push_reminder_batch(v_tok5,v_now+interval '22 minutes','[]',pg_temp.next_item('A2','24h','f'));
 if coalesce(not exists(select 1 from public.push_delivery_attempts where id=v_lost and failed_at=v_now+interval '22 minutes' and failure_kind='transient')
  or (v_result->'prepared'->0->>'delivery_id')::uuid=v_lost,true) then
  raise exception 'TEST_PUSH_LOST_RESPONSE_NOT_RECORDED %',v_result;
 end if;

 -- Revalidation right before the external effect: a cancellation releases the
 -- claim without a send, and a reschedule restarts both reminders and their waits.
 update public.appointments set status='cancelled' where id=(select appointment from batch_push where label='A3');
 v_result:=public.advance_push_reminder_batch(v_tok5,v_now+interval '23 minutes','[]',pg_temp.next_item('A3','24h','1'));
 if coalesce(jsonb_array_length(v_result->'prepared')<>0 or v_result->'invalidated'->0->>'reason'<>'revalidation_failed'
  or exists(select 1 from public.push_delivery_attempts where subscription_id=pg_temp.sub('A3'))
  or (select push_24h_claim_token from public.push_subscriptions where id=pg_temp.sub('A3')) is not null,true) then
  raise exception 'TEST_PUSH_CANCELLED_NOT_REVALIDATED %',v_result;
 end if;
 update public.push_subscriptions set push_24h_failures=3,push_24h_retry_at=v_now+interval '40 minutes' where id=pg_temp.sub('A4');
 update public.appointments set starts_at=starts_at+interval '3 days',ends_at=ends_at+interval '3 days',
  blocking_starts_at=blocking_starts_at+interval '3 days',blocking_ends_at=blocking_ends_at+interval '3 days'
 where id=(select appointment from batch_push where label='A4');
 select * into v_state from public.push_subscriptions where id=pg_temp.sub('A4');
 if coalesce(v_state.push_24h_claim_token is not null or v_state.push_24h_claimed_at is not null
  or v_state.push_24h_failures<>0 or v_state.push_24h_retry_at is not null,true) then
  raise exception 'TEST_PUSH_RESCHEDULE_DID_NOT_RESET';
 end if;
 v_result:=public.advance_push_reminder_batch(v_tok5,v_now+interval '23 minutes','[]',pg_temp.next_item('A4','24h','2'));
 if coalesce(jsonb_array_length(v_result->'prepared')<>0 or v_result->'invalidated'->0->>'reason'<>'claim_lost',true) then
  raise exception 'TEST_PUSH_RESCHEDULED_CLAIM_KEPT %',v_result;
 end if;

 -- Unreachable devices: gone before the send, and gone as the send result. The
 -- context of each practice stays its own.
 perform public.mark_push_device_gone((select endpoint from batch_push where label='C0'),v_now+interval '23 minutes');
 v_result:=public.advance_push_reminder_batch(v_tok5,v_now+interval '24 minutes','[]',pg_temp.next_item('C0','24h','3'));
 if coalesce(jsonb_array_length(v_result->'prepared')<>0 or v_result->'invalidated'->0->>'reason'<>'device_gone'
  or exists(select 1 from public.push_delivery_attempts where subscription_id=pg_temp.sub('C0'))
  or (select push_24h_claim_token from public.push_subscriptions where id=pg_temp.sub('C0')) is not null,true) then
  raise exception 'TEST_PUSH_GONE_DEVICE_PREPARED %',v_result;
 end if;
 v_result:=public.advance_push_reminder_batch(v_tok5,v_now+interval '24 minutes','[]',pg_temp.next_item('B0','24h','4'));
 v_item:=v_result->'prepared'->0;
 if coalesce(v_item->>'business_name'<>'Lote B' or (v_item->>'business_id')::uuid<>v_b,true) then raise exception 'TEST_PUSH_CONTEXT_CROSSED_PRACTICES %',v_result; end if;
 v_result:=public.advance_push_reminder_batch(v_tok5,v_now+interval '24 minutes',pg_temp.result_item('B0','24h',(v_item->>'delivery_id')::uuid,'gone',410),'[]');
 select * into v_state from public.push_subscriptions where id=pg_temp.sub('B0');
 if coalesce(v_state.push_24h_failures<>0 or v_state.push_24h_retry_at is not null or v_state.push_24h_claim_token is not null or v_state.push_24h_sent_at is not null
  or (select provider_gone_at from public.push_devices where endpoint=(select endpoint from batch_push where label='B0')) is distinct from v_now+interval '24 minutes'
  or not exists(select 1 from public.push_delivery_attempts where id=(v_item->>'delivery_id')::uuid and failure_kind='gone' and push_service_status=410),true) then
  raise exception 'TEST_PUSH_GONE_RESULT_STATE';
 end if;

 -- A reminder whose window changes between claim and send is released, and the
 -- reminder that now applies is claimed instead.
 v_at:=v_now+interval '25 minutes';
 perform pg_temp.batch_business('D');
 perform pg_temp.batch_reminder('D','D0',v_at+interval '2 hours 1 minute',30);
 if coalesce((select array_agg(c.reminder_kind) from public.claim_push_reminder_batch(v_at,100,v_tok6) c) is distinct from array['24h'],true) then
  raise exception 'TEST_PUSH_24H_CLAIM_EXPECTED';
 end if;
 v_result:=public.advance_push_reminder_batch(v_tok6,v_at+interval '2 minutes','[]',pg_temp.next_item('D0','24h','5'));
 if coalesce(jsonb_array_length(v_result->'prepared')<>0 or v_result->'invalidated'->0->>'reason'<>'revalidation_failed',true) then
  raise exception 'TEST_PUSH_WINDOW_NOT_REVALIDATED %',v_result;
 end if;
 if coalesce((select array_agg(c.reminder_kind) from public.claim_push_reminder_batch(v_at+interval '3 minutes',100,v_tok7) c) is distinct from array['2h'],true) then
  raise exception 'TEST_PUSH_2H_NOT_CLAIMED';
 end if;
 select * into v_state from public.push_subscriptions where id=pg_temp.sub('D0');
 if coalesce(v_state.push_2h_claim_token is distinct from v_tok7 or v_state.push_24h_claim_token is not null or v_state.push_24h_sent_at is not null,true) then
  raise exception 'TEST_PUSH_2H_CLAIM_STATE';
 end if;

 -- Malformed or unbounded input is a caller defect and is rejected.
 begin
  perform public.advance_push_reminder_batch(v_tok7,v_at,jsonb_build_array(jsonb_build_object(
   'subscription_id',pg_temp.sub('D0'),'kind','1h','delivery_id',null,'outcome','accepted','status_code',201)),'[]');
  raise exception 'TEST_PUSH_INVALID_RESULT_ACCEPTED';
 exception when raise_exception then if sqlerrm<>'PUSH_BATCH_RESULT_INVALID' then raise; end if; end;
 begin
  perform public.advance_push_reminder_batch(v_tok7,v_at,'[]',jsonb_build_array(jsonb_build_object(
   'subscription_id',pg_temp.sub('D0'),'kind','2h','receipt_token_hash','not-a-hash')));
  raise exception 'TEST_PUSH_INVALID_NEXT_ACCEPTED';
 exception when raise_exception then if sqlerrm<>'PUSH_BATCH_PREPARE_INVALID' then raise; end if; end;
 begin
  perform public.claim_push_reminder_batch(v_at,101,v_tok7);
  raise exception 'TEST_PUSH_UNBOUNDED_CLAIM_ACCEPTED';
 exception when raise_exception then if sqlerrm<>'PUSH_BATCH_CLAIM_INVALID' then raise; end if; end;

 -- The transition switch stops the legacy claim, whoever calls it, and restores
 -- it for a rollback. The batch claim belongs to the new scheduler.
 begin
  perform public.set_legacy_job_entrypoints(null);
  raise exception 'TEST_LEGACY_SWITCH_NULL_ACCEPTED';
 exception when raise_exception then if sqlerrm<>'LEGACY_JOB_SWITCH_INVALID' then raise; end if; end;
 if coalesce(not public.legacy_job_entrypoints_enabled(),true) then raise exception 'TEST_LEGACY_SWITCH_DEFAULT_OFF'; end if;
 perform public.set_legacy_job_entrypoints(false);
 if coalesce(public.legacy_job_entrypoints_enabled()
  or exists(select 1 from public.claim_due_push_reminders(v_now+interval '40 minutes',100)),true) then
  raise exception 'TEST_LEGACY_PUSH_NOT_STOPPED';
 end if;
 if coalesce(not exists(select 1 from public.claim_push_reminder_batch(v_now+interval '40 minutes',1,gen_random_uuid())),true) then
  raise exception 'TEST_BATCH_PUSH_STOPPED_BY_SWITCH';
 end if;
 perform public.set_legacy_job_entrypoints(true);
 select array_agg(c.subscription_id) into v_ids from public.claim_due_push_reminders(v_now+interval '40 minutes',100) c;
 if coalesce(v_ids is null or pg_temp.sub('A0')=any(v_ids) or pg_temp.sub('B0')=any(v_ids) or pg_temp.sub('A3')=any(v_ids),true) then
  raise exception 'TEST_LEGACY_PUSH_RESTORED_STATE %',v_ids;
 end if;
 if coalesce(exists(select 1 from public.claim_push_reminder_batch(v_now+interval '2 hours',100,gen_random_uuid()) c
  where c.subscription_id in (pg_temp.sub('A0'),pg_temp.sub('B0'),pg_temp.sub('C0'),pg_temp.sub('A3'))),true) then
  raise exception 'TEST_PUSH_FINISHED_REMINDER_CLAIMED_AGAIN';
 end if;
end $$;
select extensions.pass('push batches share the queue fairly, keep claim ownership, back off and revalidate before sending');

-- 2. Google Calendar ---------------------------------------------------------------
do $$
declare
 v_now timestamptz:=date_trunc('minute',statement_timestamp())+interval '40 days';
 v_ca uuid; v_cb uuid; v_cc uuid; v_connection uuid; v_lonely uuid; v_app uuid; v_id uuid;
 v_tok1 uuid:=gen_random_uuid(); v_tok2 uuid:=gen_random_uuid(); v_tok3 uuid:=gen_random_uuid(); v_tok4 uuid:=gen_random_uuid();
 v_items jsonb; v_result jsonb; v_event record;
begin
 v_ca:=pg_temp.batch_business('CA'); v_cb:=pg_temp.batch_business('CB'); v_cc:=pg_temp.batch_business('CC');
 insert into public.google_calendar_connections(oauth_client_key,google_subject,refresh_token_ciphertext)
 values(repeat('k',64),'subject-'||gen_random_uuid(),'ciphertext-'||repeat('x',20)) returning id into v_connection;
 insert into public.google_calendar_connections(oauth_client_key,google_subject,refresh_token_ciphertext)
 values(repeat('k',64),'subject-'||gen_random_uuid(),'ciphertext-'||repeat('y',20)) returning id into v_lonely;
 -- CA's queue is the oldest; CB and CC each have one later event.
 for i in 0..4 loop
  v_app:=pg_temp.batch_appointment('CA',v_now+make_interval(days=>1,mins=>30*i),30);
  insert into public.appointment_google_calendar_events(business_id,appointment_id,connection_id,sync_status,next_attempt_at,created_at)
  values(v_ca,v_app,v_connection,'pending_create',v_now-make_interval(mins=>60-i),v_now-make_interval(mins=>60-i)) returning id into v_id;
  insert into batch_calendar values('CA'||i,v_ca,v_app,v_id);
 end loop;
 v_app:=pg_temp.batch_appointment('CB',v_now+interval '1 day',30);
 insert into public.appointment_google_calendar_events(business_id,appointment_id,connection_id,sync_status,next_attempt_at,created_at)
 values(v_cb,v_app,v_connection,'pending_create',v_now-interval '10 minutes',v_now-interval '10 minutes') returning id into v_id;
 insert into batch_calendar values('CB0',v_cb,v_app,v_id);
 v_app:=pg_temp.batch_appointment('CC',v_now+interval '1 day',30);
 insert into public.appointment_google_calendar_events(business_id,appointment_id,connection_id,sync_status,next_attempt_at,created_at)
 values(v_cc,v_app,v_lonely,'pending_create',v_now-interval '5 minutes',v_now-interval '5 minutes') returning id into v_id;
 insert into batch_calendar values('CC0',v_cc,v_app,v_id);

 -- Fair claim with each item's definition and connection; ordered by time alone,
 -- the three would belong to CA.
 v_items:=public.claim_google_calendar_sync_batch(v_now,3,v_tok1);
 if coalesce(jsonb_array_length(v_items)<>3
  or (select array_agg(i->>'event_row_id' order by i->>'event_row_id') from jsonb_array_elements(v_items) i) is distinct from
   (select array_agg(c.event::text order by c.event::text) from batch_calendar c where c.label in ('CA0','CB0','CC0'))
  or exists(select 1 from jsonb_array_elements(v_items) i where (i->>'business_turn')::integer<>1 or i->>'sync_status'<>'pending_create'
   or i->>'refresh_token_ciphertext' is null or i->>'connection_revoked_at' is not null
   or (i->>'business_id')::uuid<>(select c.business from batch_calendar c where c.event=(i->>'event_row_id')::uuid)),true) then
  raise exception 'TEST_CALENDAR_CLAIM_NOT_FAIR %',v_items;
 end if;
 if coalesce(exists(select 1 from public.appointment_google_calendar_events e join batch_calendar c on c.event=e.id where c.label in ('CA0','CB0','CC0')
  and (e.claim_token is distinct from v_tok1 or e.claimed_at is distinct from v_now or e.last_attempt_at is distinct from v_now)),true) then
  raise exception 'TEST_CALENDAR_CLAIM_STATE';
 end if;
 v_items:=public.claim_google_calendar_sync_batch(v_now+interval '1 minute',100,v_tok2);
 if coalesce(jsonb_array_length(v_items)<>4 or exists(select 1 from jsonb_array_elements(v_items) i where (i->>'business_id')::uuid<>v_ca
  or (i->>'event_row_id')::uuid=pg_temp.calendar_event('CA0')),true) then
  raise exception 'TEST_CALENDAR_LIVE_CLAIM_TAKEN %',v_items;
 end if;

 -- Results go through the existing transitions.
 v_result:=public.complete_google_calendar_sync_batch(v_tok1,v_now+interval '2 minutes',jsonb_build_array(
  jsonb_build_object('event_row_id',pg_temp.calendar_event('CB0'),'outcome','synced','google_event_id','evtcb00001',
   'synced_sequence',(select a.calendar_sequence from public.appointments a where a.id=(select appointment from batch_calendar where label='CB0'))),
  jsonb_build_object('event_row_id',pg_temp.calendar_event('CC0'),'outcome','failed','failure_category','transient','error_code','HTTP_503',
   'next_attempt_at',v_now+interval '7 minutes'),
  jsonb_build_object('event_row_id',pg_temp.calendar_event('CA0'),'outcome','delete_requested')));
 if coalesce((select jsonb_agg(r->>'status' order by r->>'status') from jsonb_array_elements(v_result->'results') r)
  is distinct from '["active","pending_create","pending_delete"]'::jsonb,true) then
  raise exception 'TEST_CALENDAR_RESULTS %',v_result;
 end if;
 select * into v_event from public.appointment_google_calendar_events where id=pg_temp.calendar_event('CB0');
 if coalesce(v_event.sync_status<>'active' or v_event.event_id<>'evtcb00001' or v_event.claim_token is not null or v_event.claimed_at is not null,true) then
  raise exception 'TEST_CALENDAR_SYNCED_STATE';
 end if;
 select * into v_event from public.appointment_google_calendar_events where id=pg_temp.calendar_event('CC0');
 if coalesce(v_event.sync_status<>'pending_create' or v_event.next_attempt_at<>v_now+interval '7 minutes' or v_event.attempt_count<>1
  or v_event.claimed_at is not null or v_event.claim_token is not null or v_event.last_error_code<>'HTTP_503',true) then
  raise exception 'TEST_CALENDAR_RETRY_STATE';
 end if;
 select * into v_event from public.appointment_google_calendar_events where id=pg_temp.calendar_event('CA0');
 if coalesce(v_event.sync_status<>'pending_delete' or v_event.claimed_at is not null or v_event.claim_token is not null
  or v_event.next_attempt_at<>v_now+interval '2 minutes',true) then
  raise exception 'TEST_CALENDAR_DELETE_STATE';
 end if;
 -- The requested deletion runs on the next event, without waiting for the claim.
 v_items:=public.claim_google_calendar_sync_batch(v_now+interval '3 minutes',100,v_tok3);
 if coalesce(jsonb_array_length(v_items)<>1 or (v_items->0->>'event_row_id')::uuid<>pg_temp.calendar_event('CA0') or v_items->0->>'sync_status'<>'pending_delete',true) then
  raise exception 'TEST_CALENDAR_DELETE_NOT_IMMEDIATE %',v_items;
 end if;
 -- Late results of a token that lost the claim are stale and change nothing.
 v_result:=public.complete_google_calendar_sync_batch(v_tok1,v_now+interval '4 minutes',
  jsonb_build_array(jsonb_build_object('event_row_id',pg_temp.calendar_event('CA0'),'outcome','deleted')));
 if coalesce(v_result->'results'->0->>'status'<>'stale'
  or not exists(select 1 from public.appointment_google_calendar_events where id=pg_temp.calendar_event('CA0') and claim_token=v_tok3),true) then
  raise exception 'TEST_CALENDAR_STALE_RESULT_APPLIED %',v_result;
 end if;
 -- Deleting the last event of a connection removes it, for revocation after commit.
 v_items:=public.claim_google_calendar_sync_batch(v_now+interval '8 minutes',100,v_tok4);
 if coalesce(jsonb_array_length(v_items)<>1 or (v_items->0->>'event_row_id')::uuid<>pg_temp.calendar_event('CC0'),true) then
  raise exception 'TEST_CALENDAR_RETRY_NOT_DUE %',v_items;
 end if;
 v_result:=public.complete_google_calendar_sync_batch(v_tok4,v_now+interval '9 minutes',
  jsonb_build_array(jsonb_build_object('event_row_id',pg_temp.calendar_event('CC0'),'outcome','deleted')),true);
 if coalesce(v_result->'results'->0->>'status'<>'deleted' or (v_result->'results'->0->>'removed_connection_id')::uuid is distinct from v_lonely
  or exists(select 1 from public.google_calendar_connections where id=v_lonely) or (v_result->>'released')::integer<>0,true) then
  raise exception 'TEST_CALENDAR_DELETE_RESULT %',v_result;
 end if;
 -- Finishing releases only the token's own remaining claims.
 v_result:=public.complete_google_calendar_sync_batch(v_tok2,v_now+interval '9 minutes','[]',true);
 if coalesce((v_result->>'released')::integer<>4
  or exists(select 1 from public.appointment_google_calendar_events e join batch_calendar c on c.event=e.id
   where c.label in ('CA1','CA2','CA3','CA4') and (e.claimed_at is not null or e.claim_token is not null))
  or not exists(select 1 from public.appointment_google_calendar_events where id=pg_temp.calendar_event('CA0') and claim_token=v_tok3),true) then
  raise exception 'TEST_CALENDAR_FINISH_SCOPE %',v_result;
 end if;
 -- A malformed result is a caller defect: the whole chunk is rejected.
 begin
  perform public.complete_google_calendar_sync_batch(v_tok3,v_now+interval '10 minutes',jsonb_build_array(
   jsonb_build_object('event_row_id',pg_temp.calendar_event('CA0'),'outcome','deleted'),
   jsonb_build_object('event_row_id',pg_temp.calendar_event('CA1'),'outcome','synced')));
  raise exception 'TEST_CALENDAR_MALFORMED_ACCEPTED';
 exception when raise_exception then if sqlerrm<>'GOOGLE_CALENDAR_BATCH_RESULT_INVALID' then raise; end if; end;
 if coalesce(not exists(select 1 from public.appointment_google_calendar_events where id=pg_temp.calendar_event('CA0') and claim_token=v_tok3 and sync_status='pending_delete'),true) then
  raise exception 'TEST_CALENDAR_MALFORMED_PARTIAL';
 end if;
 begin
  perform public.claim_google_calendar_sync_batch(v_now,0,v_tok4);
  raise exception 'TEST_CALENDAR_UNBOUNDED_CLAIM_ACCEPTED';
 exception when raise_exception then if sqlerrm<>'GOOGLE_CALENDAR_BATCH_CLAIM_INVALID' then raise; end if; end;
 -- The legacy claim is behind the switch.
 perform public.set_legacy_job_entrypoints(false);
 if coalesce(exists(select 1 from public.claim_google_calendar_sync_jobs(v_now+interval '30 minutes',100)),true) then
  raise exception 'TEST_LEGACY_CALENDAR_NOT_STOPPED';
 end if;
 perform public.set_legacy_job_entrypoints(true);
 if coalesce(not exists(select 1 from public.claim_google_calendar_sync_jobs(v_now+interval '30 minutes',100)),true) then
  raise exception 'TEST_LEGACY_CALENDAR_NOT_RESTORED';
 end if;
end $$;
select extensions.pass('calendar batches share the queue fairly and record results through the existing transitions');

-- 3. Google review requests ----------------------------------------------------
do $$
declare
 v_base timestamptz:=date_trunc('minute',statement_timestamp())+interval '50 days';
 v_now timestamptz:=v_base+interval '1 day';
 v_ra uuid; v_rb uuid; v_claimed record; v_count integer;
begin
 v_ra:=pg_temp.batch_business('RA'); v_rb:=pg_temp.batch_business('RB');
 insert into public.google_review_settings(business_id,enabled,review_url)
 values(v_ra,true,'https://g.page/r/test/review'),(v_rb,true,'https://g.page/r/test/review');
 for i in 0..2 loop perform pg_temp.batch_reminder('RA','RA'||i,v_base+make_interval(mins=>30*i),30); end loop;
 perform pg_temp.batch_reminder('RB','RB0',v_base+interval '5 hours',30);
 if coalesce((select count(*) from public.google_review_requests where business_id in (v_ra,v_rb) and status='pending')<>4,true) then
  raise exception 'TEST_REVIEW_FIXTURE_NOT_SCHEDULED';
 end if;
 -- Ordered by time alone, both would belong to RA.
 select count(*) as total,count(*) filter (where c.business_id=v_ra) as ra,count(*) filter (where c.business_id=v_rb) as rb
 into v_claimed from public.claim_google_review_request_batch(v_now,2) c;
 if coalesce(v_claimed.total<>2 or v_claimed.ra<>1 or v_claimed.rb<>1,true) then raise exception 'TEST_REVIEW_CLAIM_NOT_FAIR %',row_to_json(v_claimed); end if;
 begin
  perform public.claim_google_review_request_batch(v_now,0);
  raise exception 'TEST_REVIEW_UNBOUNDED_CLAIM_ACCEPTED';
 exception when raise_exception then if sqlerrm<>'GOOGLE_REVIEW_BATCH_CLAIM_INVALID' then raise; end if; end;
 -- The legacy claim is the same implementation, behind the switch.
 perform public.set_legacy_job_entrypoints(false);
 if coalesce(exists(select 1 from public.claim_due_google_review_requests(v_now,20)),true) then raise exception 'TEST_LEGACY_REVIEWS_NOT_STOPPED'; end if;
 perform public.set_legacy_job_entrypoints(true);
 select count(*) into v_count from public.claim_due_google_review_requests(v_now,20);
 if coalesce(v_count<>2,true) then raise exception 'TEST_LEGACY_REVIEWS_NOT_RESTORED %',v_count; end if;
end $$;
select extensions.pass('review requests are claimed with one turn per practice by both entry points');

-- 4. Abandoned clinical uploads ----------------------------------------------------
do $$
declare
 v_ua uuid:=gen_random_uuid(); v_ub uuid:=gen_random_uuid(); v_actor_a uuid:=gen_random_uuid(); v_actor_b uuid:=gen_random_uuid();
 v_patient_a uuid:=gen_random_uuid(); v_patient_b uuid:=gen_random_uuid();
 v_files uuid[]:='{}'; v_upload record; v_ready record; v_without_object uuid; v_items jsonb; v_unused text;
begin
 insert into auth.users(id,email) values(v_actor_a,v_actor_a||'@example.test'),(v_actor_b,v_actor_b||'@example.test');
 insert into public.businesses(id,name,slug,industry) values(v_ua,'Synthetic cleanup A',v_ua::text,'other'),(v_ub,'Synthetic cleanup B',v_ub::text,'other');
 update public.business_subscriptions set commercial_access_enabled=true,is_permanent=true,subscription_status='active',
  paid_until=null,grace_until=null,restricted_until=null,archived_at=null where business_id in(v_ua,v_ub);
 insert into public.business_users(business_id,user_id,role,status,accepted_at) values(v_ua,v_actor_a,'owner','active',now()),(v_ub,v_actor_b,'owner','active',now());
 insert into public.patients(id,business_id,owner_id,full_name)
 values(v_patient_a,v_ua,v_actor_a,'Synthetic cleanup patient A'),(v_patient_b,v_ub,v_actor_b,'Synthetic cleanup patient B');
 perform set_config('request.jwt.claim.role','service_role',true);
 -- Three abandoned uploads in A, all older than the one in B; each left an object.
 for i in 0..3 loop
  select * into v_upload from public.begin_patient_radiograph_upload(
   case when i<3 then v_actor_a else v_actor_b end,case when i<3 then v_ua else v_ub end,case when i<3 then v_patient_a else v_patient_b end,
   gen_random_uuid(),'abandoned.pdf','application/pdf',100,repeat('a',64));
  insert into storage.objects(bucket_id,name,metadata) values(v_upload.storage_bucket,v_upload.storage_path,'{"size":100,"mimetype":"application/pdf"}');
  update public.clinical_upload_slots set expires_at=clock_timestamp()-interval '1 minute' where file_id=v_upload.radiograph_id;
  update public.patient_radiographs set created_at=clock_timestamp()-make_interval(hours=>6-i) where id=v_upload.radiograph_id;
  v_files:=v_files||v_upload.radiograph_id;
 end loop;
 -- An expired URL in B that never received an object only holds a reservation.
 select * into v_upload from public.begin_patient_radiograph_upload(v_actor_b,v_ub,v_patient_b,gen_random_uuid(),'never.pdf','application/pdf',100,repeat('b',64));
 v_without_object:=v_upload.radiograph_id;
 update public.clinical_upload_slots set expires_at=clock_timestamp()-interval '1 minute' where file_id=v_without_object;
 update public.patient_radiographs set created_at=clock_timestamp()-interval '3 hours' where id=v_without_object;
 if coalesce((select reserved_bytes from public.clinical_business_storage_budget where business_id=v_ub)<>5000000,true) then
  raise exception 'TEST_UPLOAD_FIXTURE_RESERVATION';
 end if;
 -- A confirmed image in A whose unused preview URL expired.
 select * into v_ready from public.begin_patient_radiograph_upload(v_actor_a,v_ua,v_patient_a,gen_random_uuid(),'imagen.jpg','image/jpeg',100,repeat('d',64));
 v_unused:=v_ready.thumbnail_path;
 insert into storage.objects(bucket_id,name,metadata)
 values(v_ready.storage_bucket,v_ready.storage_path,'{"size":100,"mimetype":"image/jpeg"}'),(v_ready.storage_bucket,v_unused,'{"size":50,"mimetype":"image/jpeg"}');
 perform public.complete_patient_radiograph_upload(v_actor_a,v_ua,v_patient_a,v_ready.radiograph_id,100,'image/jpeg',false);
 update public.clinical_upload_slots set expires_at=clock_timestamp()-interval '1 minute' where file_id=v_ready.radiograph_id;

 v_items:=public.claim_abandoned_clinical_uploads(2);
 -- One turn per practice: the oldest of A and the one of B, not A's two oldest.
 if coalesce((select array_agg(i->>'id' order by i->>'id') from jsonb_array_elements(v_items) i where (i->>'id')::uuid=any(v_files))
  is distinct from (select array_agg(x::text order by x::text) from unnest(array[v_files[1],v_files[4]]) x),true) then
  raise exception 'TEST_UPLOAD_CLEANUP_NOT_FAIR %',v_items;
 end if;
 if coalesce((select count(*) from public.patient_radiographs where id in (v_files[1],v_files[4]) and status='failed' and failure_code='expired_upload')<>2
  or (select count(*) from public.patient_radiographs where id in (v_files[2],v_files[3]) and status='uploading')<>2,true) then
  raise exception 'TEST_UPLOAD_CLEANUP_STATE';
 end if;
 if coalesce(exists(select 1 from jsonb_array_elements(v_items) i where i->>'bucket' is null or jsonb_typeof(i->'paths')<>'array' or jsonb_array_length(i->'paths')=0),true) then
  raise exception 'TEST_UPLOAD_CLEANUP_ITEM_SHAPE %',v_items;
 end if;
 -- Expired reservations of every practice are released, without touching objects.
 if coalesce((select reserved_bytes from public.clinical_business_storage_budget where business_id=v_ub)<>0
  or exists(select 1 from public.clinical_upload_slots where file_id=v_without_object),true) then
  raise exception 'TEST_UPLOAD_RESERVATION_NOT_RELEASED';
 end if;
 -- A confirmed file is never released: only its unused preview path is returned.
 if coalesce(not exists(select 1 from jsonb_array_elements(v_items) i where (i->>'id')::uuid=v_ready.radiograph_id and i->'paths'=jsonb_build_array(v_unused))
  or not exists(select 1 from public.patient_radiographs where id=v_ready.radiograph_id and status='ready')
  or not exists(select 1 from storage.objects where bucket_id=v_ready.storage_bucket and name=v_ready.storage_path),true) then
  raise exception 'TEST_UPLOAD_CLEANUP_CONFIRMED_FILE %',v_items;
 end if;
 -- The owner's manual cleanup is the same implementation, limited to its practice.
 v_items:=public.claim_expired_clinical_uploads(v_ub,v_actor_b);
 if coalesce(jsonb_array_length(v_items)<>1 or (v_items->0->>'id')::uuid<>v_files[4],true) then raise exception 'TEST_UPLOAD_MANUAL_SCOPE %',v_items; end if;
 begin
  perform public.claim_expired_clinical_uploads(v_ub,v_actor_a);
  raise exception 'TEST_UPLOAD_FOREIGN_OWNER_ACCEPTED';
 exception when raise_exception then if sqlerrm<>'RADIOGRAPH_ACCESS_DENIED' then raise; end if; end;
 begin
  perform public.claim_abandoned_clinical_uploads(201);
  raise exception 'TEST_UPLOAD_UNBOUNDED_CLAIM_ACCEPTED';
 exception when raise_exception then if sqlerrm<>'CLINICAL_CLEANUP_LIMIT_INVALID' then raise; end if; end;
 perform set_config('request.jwt.claim.role','authenticated',true);
 begin
  perform public.claim_abandoned_clinical_uploads(10);
  raise exception 'TEST_UPLOAD_CLEANUP_WITHOUT_SERVER';
 exception when raise_exception then if sqlerrm<>'RADIOGRAPH_SERVER_REQUIRED' then raise; end if; end;
 perform set_config('request.jwt.claim.role','service_role',true);
end $$;
select extensions.pass('abandoned uploads of every practice are cleaned fairly and confirmed files are preserved');

-- 5. Push telemetry retention --------------------------------------------------
do $$
declare v_push record; v_old uuid; v_recent uuid; v_removed integer;
begin
 select * into strict v_push from batch_push where label='A5';
 insert into public.push_delivery_attempts(business_id,appointment_id,subscription_id,kind,receipt_token_hash,expires_at,created_at,updated_at)
 values(v_push.business,v_push.appointment,v_push.subscription,'test',repeat('7',64),clock_timestamp()-interval '91 days'+interval '5 minutes',
  clock_timestamp()-interval '91 days',clock_timestamp()-interval '91 days')
 returning id into v_old;
 insert into public.push_delivery_attempts(business_id,appointment_id,subscription_id,kind,receipt_token_hash,expires_at,created_at,updated_at)
 values(v_push.business,v_push.appointment,v_push.subscription,'test',repeat('8',64),clock_timestamp()-interval '89 days'+interval '5 minutes',
  clock_timestamp()-interval '89 days',clock_timestamp()-interval '89 days')
 returning id into v_recent;
 -- Its own statement: the checks below must see the rows after the deletion.
 v_removed:=private.prune_push_delivery_telemetry();
 if coalesce(v_removed<1 or exists(select 1 from public.push_delivery_attempts where id=v_old)
  or not exists(select 1 from public.push_delivery_attempts where id=v_recent),true) then
  raise exception 'TEST_PUSH_TELEMETRY_RETENTION';
 end if;
 if coalesce(not exists(select 1 from cron.job where jobname='cita-suite-push-telemetry-retention' and schedule='41 4 * * *'
  and command='select private.prune_push_delivery_telemetry()'),true) then
  raise exception 'TEST_PUSH_TELEMETRY_SCHEDULE';
 end if;
end $$;
select extensions.pass('push telemetry keeps 90 days through its own database schedule');

-- 6. Rotation between claims ------------------------------------------------------
-- Inside a claim every practice gets one turn; between claims, a practice still
-- waiting goes before the practices served by the previous claim, even when their
-- next items are more urgent. Ordered by turn and urgency alone, the third practice
-- of each queue would wait behind the other two. This section runs in its own
-- window, 20 days ahead, before the windows of the previous sections, so none of
-- their remaining items is due here.
do $$
declare
 v_t timestamptz:=date_trunc('minute',statement_timestamp())+interval '20 days';
 v_now timestamptz:=v_t-interval '18 hours';
 v_token uuid:=gen_random_uuid(); v_next jsonb; v_prepared jsonb; v_results jsonb; v_ids uuid[];
 v_items jsonb; v_label text; v_app uuid; v_event uuid; v_connection uuid; v_claimed record;
begin
 -- Push: RP and RQ have two reminders each; RR has one, for a later appointment.
 perform pg_temp.batch_business('RP'); perform pg_temp.batch_business('RQ'); perform pg_temp.batch_business('RR');
 perform pg_temp.batch_reminder('RP','RP0',v_t,10); perform pg_temp.batch_reminder('RP','RP1',v_t+interval '10 minutes',10);
 perform pg_temp.batch_reminder('RQ','RQ0',v_t,10); perform pg_temp.batch_reminder('RQ','RQ1',v_t+interval '10 minutes',10);
 perform pg_temp.batch_reminder('RR','RR0',v_t+interval '3 hours',10);
 -- First run: claim, prepare and deliver, as the scheduled job does.
 select coalesce(jsonb_agg(jsonb_build_object('subscription_id',c.subscription_id,'kind',c.reminder_kind,
  'receipt_token_hash',encode(sha256(convert_to(c.subscription_id::text,'UTF8')),'hex'))),'[]'::jsonb)
 into v_next from public.claim_push_reminder_batch(v_now,2,v_token) c;
 if coalesce((select array_agg(x->>'subscription_id' order by x->>'subscription_id') from jsonb_array_elements(v_next) x)
  is distinct from (select array_agg(p.subscription::text order by p.subscription::text) from batch_push p where p.label in ('RP0','RQ0')),true) then
  raise exception 'TEST_ROTATION_PUSH_FIRST_CLAIM %',v_next;
 end if;
 v_prepared:=public.advance_push_reminder_batch(v_token,v_now,'[]',v_next)->'prepared';
 select coalesce(jsonb_agg(jsonb_build_object('subscription_id',p->>'subscription_id','kind',p->>'kind',
  'delivery_id',p->>'delivery_id','outcome','accepted','status_code',201)),'[]'::jsonb)
 into v_results from jsonb_array_elements(v_prepared) p;
 if coalesce((public.advance_push_reminder_batch(v_token,v_now,v_results,'[]',true)->>'completed')::integer<>2,true) then
  raise exception 'TEST_ROTATION_PUSH_FIRST_RUN %',v_results;
 end if;
 -- Second run: RR goes before the second reminders of RP and RQ.
 select array_agg(c.subscription_id) into v_ids from public.claim_push_reminder_batch(v_now+interval '5 minutes',2,gen_random_uuid()) c;
 if coalesce(cardinality(v_ids)<>2 or not pg_temp.sub('RR0')=any(v_ids),true) then
  raise exception 'TEST_ROTATION_PUSH_WAITING_PRACTICE_SKIPPED %',v_ids;
 end if;

 -- Calendar: CP and CQ have two pending events each; CR has one that became due later.
 perform pg_temp.batch_business('CP'); perform pg_temp.batch_business('CQ'); perform pg_temp.batch_business('CR');
 insert into public.google_calendar_connections(oauth_client_key,google_subject,refresh_token_ciphertext)
 values(repeat('k',64),'subject-'||gen_random_uuid(),'ciphertext-'||repeat('r',20)) returning id into v_connection;
 foreach v_label in array array['CP0','CP1','CQ0','CQ1','CR0'] loop
  v_app:=pg_temp.batch_appointment(left(v_label,2),v_t+make_interval(mins=>30*right(v_label,1)::integer),30);
  insert into public.appointment_google_calendar_events(business_id,appointment_id,connection_id,sync_status,next_attempt_at,created_at)
  values((select business from batch_fixture where label=left(v_label,2)),v_app,v_connection,'pending_create',
   v_now-case when v_label='CR0' then interval '1 minute' when right(v_label,1)='0' then interval '30 minutes' else interval '20 minutes' end,v_now)
  returning id into v_event;
  insert into batch_calendar values(v_label,(select business from batch_fixture where label=left(v_label,2)),v_app,v_event);
 end loop;
 v_token:=gen_random_uuid();
 v_items:=public.claim_google_calendar_sync_batch(v_now,2,v_token);
 if coalesce((select array_agg(i->>'event_row_id' order by i->>'event_row_id') from jsonb_array_elements(v_items) i)
  is distinct from (select array_agg(c.event::text order by c.event::text) from batch_calendar c where c.label in ('CP0','CQ0')),true) then
  raise exception 'TEST_ROTATION_CALENDAR_FIRST_CLAIM %',v_items;
 end if;
 v_items:=public.complete_google_calendar_sync_batch(v_token,v_now,(select jsonb_agg(jsonb_build_object('event_row_id',i->>'event_row_id',
  'outcome','synced','google_event_id','evt'||md5(i->>'event_row_id'),'synced_sequence',0)) from jsonb_array_elements(v_items) i),true);
 if coalesce((select count(*) from jsonb_array_elements(v_items->'results') r where r->>'status'='active')<>2,true) then
  raise exception 'TEST_ROTATION_CALENDAR_FIRST_RUN %',v_items;
 end if;
 v_items:=public.claim_google_calendar_sync_batch(v_now+interval '5 minutes',2,gen_random_uuid());
 if coalesce(jsonb_array_length(v_items)<>2
  or not exists(select 1 from jsonb_array_elements(v_items) i where (i->>'event_row_id')::uuid=pg_temp.calendar_event('CR0')),true) then
  raise exception 'TEST_ROTATION_CALENDAR_WAITING_PRACTICE_SKIPPED %',v_items;
 end if;

 -- Reviews: VP and VQ have two due requests each; VR has one, scheduled later.
 perform pg_temp.batch_business('VP'); perform pg_temp.batch_business('VQ'); perform pg_temp.batch_business('VR');
 insert into public.google_review_settings(business_id,enabled,review_url)
 select f.business,true,'https://g.page/r/test/review' from batch_fixture f where f.label in ('VP','VQ','VR');
 perform pg_temp.batch_reminder('VP','VP0',v_t-interval '20 hours',30); perform pg_temp.batch_reminder('VP','VP1',v_t-interval '19 hours',30);
 perform pg_temp.batch_reminder('VQ','VQ0',v_t-interval '20 hours',30); perform pg_temp.batch_reminder('VQ','VQ1',v_t-interval '19 hours',30);
 perform pg_temp.batch_reminder('VR','VR0',v_t-interval '15 hours',30);
 select count(*) as total,
  count(*) filter (where c.business_id=(select business from batch_fixture where label='VP')) as vp,
  count(*) filter (where c.business_id=(select business from batch_fixture where label='VQ')) as vq
 into v_claimed from public.claim_google_review_request_batch(v_t,2) c;
 if coalesce(v_claimed.total<>2 or v_claimed.vp<>1 or v_claimed.vq<>1,true) then
  raise exception 'TEST_ROTATION_REVIEWS_FIRST_CLAIM %',row_to_json(v_claimed);
 end if;
 select count(*) as total,count(*) filter (where c.business_id=(select business from batch_fixture where label='VR')) as vr
 into v_claimed from public.claim_google_review_request_batch(v_t+interval '1 minute',2) c;
 if coalesce(v_claimed.total<>2 or v_claimed.vr<>1,true) then
  raise exception 'TEST_ROTATION_REVIEWS_WAITING_PRACTICE_SKIPPED %',row_to_json(v_claimed);
 end if;
end $$;
select extensions.pass('between claims, a practice still waiting goes before the practices served by the previous claim');

-- 7. Least privilege -------------------------------------------------------------
select extensions.ok(
 not exists(
  select 1 from unnest(array[
   'public.legacy_job_entrypoints_enabled()','public.set_legacy_job_entrypoints(boolean)',
   'public.claim_push_reminder_batch(timestamptz,integer,uuid)','public.advance_push_reminder_batch(uuid,timestamptz,jsonb,jsonb,boolean)',
   'public.claim_google_calendar_sync_batch(timestamptz,integer,uuid)','public.complete_google_calendar_sync_batch(uuid,timestamptz,jsonb,boolean)',
   'public.claim_google_review_request_batch(timestamptz,integer)','public.claim_abandoned_clinical_uploads(integer)']) fn
  cross join unnest(array['anon','authenticated']) api_role
  where has_function_privilege(api_role,fn,'execute'))
 and not exists(
  select 1 from unnest(array[
   'public.legacy_job_entrypoints_enabled()','public.set_legacy_job_entrypoints(boolean)',
   'public.claim_push_reminder_batch(timestamptz,integer,uuid)','public.advance_push_reminder_batch(uuid,timestamptz,jsonb,jsonb,boolean)',
   'public.claim_google_calendar_sync_batch(timestamptz,integer,uuid)','public.complete_google_calendar_sync_batch(uuid,timestamptz,jsonb,boolean)',
   'public.claim_google_review_request_batch(timestamptz,integer)','public.claim_abandoned_clinical_uploads(integer)']) fn
  where not has_function_privilege('service_role',fn,'execute'))
 and not exists(
  select 1 from unnest(array[
   'private.legacy_job_entrypoints_enabled()','private.push_reminder_kind(timestamptz,timestamptz)',
   'private.claim_google_review_requests(timestamptz,integer)','private.claim_expired_clinical_uploads(uuid,integer)',
   'private.prune_push_delivery_telemetry()','private.record_job_queue_turns(text,uuid[],timestamptz)']) fn
  cross join unnest(array['anon','authenticated','service_role']) api_role
  where has_function_privilege(api_role,fn,'execute'))
 and not exists(
  select 1 from unnest(array['anon','authenticated','service_role']) api_role
  cross join unnest(array['private.scheduled_job_settings','private.job_queue_rotation']) private_table
  where has_table_privilege(api_role,private_table,'select,insert,update,delete')),
 'scheduled job batches are executable only by the server role and the switch only through its function');

select * from extensions.finish();
rollback;
