-- Stage 6: every scheduled event runs one job category inside a measured budget.
-- Batch claims share the queue fairly between practices: inside a claim every
-- practice gets one turn before any gets a second, and between claims the practice
-- served longest ago goes first. They carry a claim token so that only their owner
-- records the results, back off persistently after a failure and group context and
-- writes.
-- The legacy entry points keep their signatures behind a transition switch, so the
-- previous scheduler can be stopped without access to the host that runs it.
begin;
set local lock_timeout='5s';
set local statement_timeout='120s';

-- 1. Transition switch ---------------------------------------------------------

create table private.scheduled_job_settings(
 singleton boolean primary key default true check(singleton),
 legacy_entrypoints_enabled boolean not null default true,
 updated_at timestamptz not null default now()
);
insert into private.scheduled_job_settings(singleton) values(true);
revoke all on table private.scheduled_job_settings from public,anon,authenticated,service_role;

create function private.legacy_job_entrypoints_enabled() returns boolean
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select coalesce((select s.legacy_entrypoints_enabled from private.scheduled_job_settings s where s.singleton),false)
$$;
revoke all on function private.legacy_job_entrypoints_enabled() from public,anon,authenticated,service_role;

create function public.legacy_job_entrypoints_enabled() returns boolean
language sql stable security definer set search_path=pg_catalog,pg_temp as $$
 select private.legacy_job_entrypoints_enabled()
$$;

-- Release step "stop the previous scheduler": false makes every legacy claim return
-- nothing, whoever calls it. true restores it for a rollback.
create function public.set_legacy_job_entrypoints(p_enabled boolean) returns boolean
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 if p_enabled is null then raise exception 'LEGACY_JOB_SWITCH_INVALID'; end if;
 update private.scheduled_job_settings set legacy_entrypoints_enabled=p_enabled,updated_at=clock_timestamp() where singleton;
 return p_enabled;
end $$;

-- Rotation between practices across claims. The turn of a practice is computed
-- inside each claim only, so without this memory a practice served in the previous
-- claim would compete again on equal terms with practices that are still waiting.
create table private.job_queue_rotation(
 queue text not null check(queue in ('push','calendar','reviews')),
 business_id uuid not null references public.businesses(id) on delete cascade,
 last_claimed_at timestamptz not null,
 primary key(queue,business_id)
);
revoke all on table private.job_queue_rotation from public,anon,authenticated,service_role;

-- Records one turn for every practice served by a claim, once and at the end of the
-- claim, in practice order: concurrent claims lock the rotation rows in the same
-- order and cannot deadlock on them.
create function private.record_job_queue_turns(p_queue text,p_business_ids uuid[],p_at timestamptz) returns void
language sql security definer set search_path=pg_catalog,pg_temp as $$
 insert into private.job_queue_rotation as rotation(queue,business_id,last_claimed_at)
 select p_queue,served.business_id,p_at from (select distinct unnest(p_business_ids) as business_id) served
 order by served.business_id
 on conflict(queue,business_id) do update
  set last_claimed_at=greatest(rotation.last_claimed_at,excluded.last_claimed_at)
$$;
revoke all on function private.record_job_queue_turns(text,uuid[],timestamptz) from public,anon,authenticated,service_role;

-- 2. Push reminders --------------------------------------------------------------

alter table public.push_subscriptions
 add column push_24h_claim_token uuid,
 add column push_2h_claim_token uuid,
 add column push_24h_retry_at timestamptz,
 add column push_2h_retry_at timestamptz,
 add column push_24h_failures integer not null default 0 check(push_24h_failures>=0),
 add column push_2h_failures integer not null default 0 check(push_2h_failures>=0);

-- Legacy claim: same body, behind the switch.
create or replace function public.claim_due_push_reminders(
 claim_now timestamptz,
 claim_limit integer default 50
) returns table (
 subscription_id uuid,
 appointment_id uuid,
 business_id uuid,
 endpoint text,
 p256dh text,
 auth text,
 reminder_kind text
)
language plpgsql security definer set search_path=public,pg_catalog,pg_temp as $$
begin
 if not private.legacy_job_entrypoints_enabled() then return; end if;

 return query
 with due as (
  select subscription.id
  from public.push_subscriptions subscription
  join public.push_devices device on device.id = subscription.device_id
  join public.appointments appointment on appointment.id = subscription.appointment_id
  where subscription.detached_at is null
   and device.provider_gone_at is null
   and appointment.status in ('reserved', 'confirmed', 'reschedule_requested')
   and appointment.starts_at > claim_now + interval '2 hours'
   and appointment.starts_at <= claim_now + interval '24 hours'
   and subscription.push_24h_sent_at is null
   and (
    subscription.push_24h_claimed_at is null
    or subscription.push_24h_claimed_at < claim_now - interval '10 minutes'
   )
  order by subscription.id
  limit greatest(claim_limit, 1)
  for update of subscription skip locked
 )
 update public.push_subscriptions subscription
 set push_24h_claimed_at = claim_now, updated_at = claim_now
 from due, public.push_devices device
 where subscription.id = due.id
  and device.id = subscription.device_id
 returning
  subscription.id,
  subscription.appointment_id,
  subscription.business_id,
  device.endpoint,
  device.p256dh,
  device.auth,
  '24h'::text;

 return query
 with due as (
  select subscription.id
  from public.push_subscriptions subscription
  join public.push_devices device on device.id = subscription.device_id
  join public.appointments appointment on appointment.id = subscription.appointment_id
  where subscription.detached_at is null
   and device.provider_gone_at is null
   and appointment.status in ('reserved', 'confirmed', 'reschedule_requested')
   and appointment.starts_at > claim_now
   and appointment.starts_at <= claim_now + interval '2 hours'
   and subscription.push_2h_sent_at is null
   and (
    subscription.push_2h_claimed_at is null
    or subscription.push_2h_claimed_at < claim_now - interval '10 minutes'
   )
  order by subscription.id
  limit greatest(claim_limit, 1)
  for update of subscription skip locked
 )
 update public.push_subscriptions subscription
 set push_2h_claimed_at = claim_now, updated_at = claim_now
 from due, public.push_devices device
 where subscription.id = due.id
  and device.id = subscription.device_id
 returning
  subscription.id,
  subscription.appointment_id,
  subscription.business_id,
  device.endpoint,
  device.p256dh,
  device.auth,
  '2h'::text;
end;
$$;

-- A reschedule restarts both reminders against the new time, including waits.
create or replace function public.reset_push_reminders_on_reschedule()
returns trigger
language plpgsql security definer set search_path=public,pg_catalog,pg_temp as $$
begin
 update public.push_subscriptions subscription
 set
  push_24h_claimed_at = null,
  push_24h_sent_at = null,
  push_24h_claim_token = null,
  push_24h_retry_at = null,
  push_24h_failures = 0,
  push_2h_claimed_at = null,
  push_2h_sent_at = null,
  push_2h_claim_token = null,
  push_2h_retry_at = null,
  push_2h_failures = 0,
  updated_at = now()
 where subscription.appointment_id = new.id
  and subscription.detached_at is null;

 update public.push_delivery_attempts delivery
 set superseded_at = now(), updated_at = now()
 where delivery.appointment_id = new.id
  and delivery.kind <> 'test'
  and delivery.superseded_at is null;

 return new;
end;
$$;

-- Due reminder of each subscription: the 2 h window takes precedence over 24 h.
create function private.push_reminder_kind(p_starts_at timestamptz,p_now timestamptz) returns text
language sql immutable set search_path=pg_catalog,pg_temp as $$
 select case
  when p_starts_at>p_now and p_starts_at<=p_now+interval '2 hours' then '2h'
  when p_starts_at>p_now+interval '2 hours' and p_starts_at<=p_now+interval '24 hours' then '24h'
 end
$$;
revoke all on function private.push_reminder_kind(timestamptz,timestamptz) from public,anon,authenticated,service_role;

-- Fair claim: the first pending reminder of every practice, then the second, ...;
-- inside a turn the practice served longest ago, then the earliest appointment.
-- Returns no endpoint or keys: the context is read when each chunk is prepared,
-- right before the external effect.
create function public.claim_push_reminder_batch(p_now timestamptz,p_limit integer,p_claim_token uuid)
returns table(subscription_id uuid,reminder_kind text,business_id uuid,business_turn integer)
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare v record; v_claimed integer:=0; v_served uuid[]:='{}';
begin
 if p_now is null or p_claim_token is null or p_limit is null or p_limit not between 1 and 100 then
  raise exception 'PUSH_BATCH_CLAIM_INVALID';
 end if;
 for v in
  with due as (
   select s.id,s.business_id,a.starts_at,private.push_reminder_kind(a.starts_at,p_now) as kind,
    s.push_24h_sent_at,s.push_24h_claimed_at,s.push_24h_retry_at,
    s.push_2h_sent_at,s.push_2h_claimed_at,s.push_2h_retry_at
   from public.push_subscriptions s
   join public.push_devices d on d.id=s.device_id
   join public.appointments a on a.business_id=s.business_id and a.id=s.appointment_id
   where s.detached_at is null and d.provider_gone_at is null
    and a.status in ('reserved','confirmed','reschedule_requested')
    and a.starts_at>p_now and a.starts_at<=p_now+interval '24 hours'
  ), claimable as (
   select due.* from due
   where (due.kind='24h' and due.push_24h_sent_at is null
     and (due.push_24h_claimed_at is null or due.push_24h_claimed_at<p_now-interval '10 minutes')
     and (due.push_24h_retry_at is null or due.push_24h_retry_at<=p_now))
    or (due.kind='2h' and due.push_2h_sent_at is null
     and (due.push_2h_claimed_at is null or due.push_2h_claimed_at<p_now-interval '10 minutes')
     and (due.push_2h_retry_at is null or due.push_2h_retry_at<=p_now))
  )
  select c.id,c.business_id,c.kind,c.starts_at,
   row_number() over(partition by c.business_id order by c.starts_at,c.id)::integer as turn
  from claimable c
  left join private.job_queue_rotation r on r.queue='push' and r.business_id=c.business_id
  order by turn,r.last_claimed_at nulls first,c.starts_at,c.id
  limit p_limit*2
 loop
  exit when v_claimed>=p_limit;
  perform 1 from public.push_subscriptions s where s.id=v.id for update skip locked;
  if not found then continue; end if;
  -- Re-check under the lock: another claimer or a reschedule may have won.
  update public.push_subscriptions s set
   push_24h_claimed_at=case when v.kind='24h' then p_now else s.push_24h_claimed_at end,
   push_24h_claim_token=case when v.kind='24h' then p_claim_token else s.push_24h_claim_token end,
   push_2h_claimed_at=case when v.kind='2h' then p_now else s.push_2h_claimed_at end,
   push_2h_claim_token=case when v.kind='2h' then p_claim_token else s.push_2h_claim_token end,
   updated_at=p_now
  where s.id=v.id and s.detached_at is null and (
   (v.kind='24h' and s.push_24h_sent_at is null
    and (s.push_24h_claimed_at is null or s.push_24h_claimed_at<p_now-interval '10 minutes'))
   or (v.kind='2h' and s.push_2h_sent_at is null
    and (s.push_2h_claimed_at is null or s.push_2h_claimed_at<p_now-interval '10 minutes')));
  if not found then continue; end if;
  v_served:=v_served||v.business_id;
  v_claimed:=v_claimed+1;
  subscription_id:=v.id; reminder_kind:=v.kind; business_id:=v.business_id; business_turn:=v.turn;
  return next;
 end loop;
 perform private.record_job_queue_turns('push',v_served,p_now);
end $$;

-- Records the results of the chunk just sent and prepares the next one in one trip.
-- p_results: [{subscription_id, kind, delivery_id, outcome, status_code}], outcome in
--   accepted | gone | rejected | transient (a lost response is transient: the
--   provider may have delivered it; the per-appointment topic and notification tag
--   collapse a repeated reminder into one).
-- p_next: [{subscription_id, kind, receipt_token_hash}]; each prepared item gets its
--   delivery attempt and the live context after revalidating claim, device,
--   subscription and appointment window.
-- p_finish releases every claim of this token that was not completed.
create function public.advance_push_reminder_batch(p_claim_token uuid,p_now timestamptz,p_results jsonb,p_next jsonb,p_finish boolean default false)
returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare
 v_item jsonb; v_kind text; v_subscription uuid; v_row record; v_outcome text; v_status integer;
 v_delivery uuid; v_ttl integer; v_failures integer; v_hash text; v_count integer;
 v_completed integer:=0; v_released integer:=0; v_prepared jsonb:='[]'::jsonb; v_invalidated jsonb:='[]'::jsonb;
begin
 if p_claim_token is null or p_now is null
  or jsonb_typeof(coalesce(p_results,'[]'::jsonb))<>'array' or jsonb_typeof(coalesce(p_next,'[]'::jsonb))<>'array'
  or jsonb_array_length(coalesce(p_results,'[]'::jsonb))>100 or jsonb_array_length(coalesce(p_next,'[]'::jsonb))>100
 then raise exception 'PUSH_BATCH_ADVANCE_INVALID'; end if;

 for v_item in select value from jsonb_array_elements(coalesce(p_results,'[]'::jsonb)) loop
  v_kind:=v_item->>'kind'; v_outcome:=v_item->>'outcome';
  v_subscription:=(v_item->>'subscription_id')::uuid; v_delivery:=nullif(v_item->>'delivery_id','')::uuid;
  v_status:=nullif(v_item->>'status_code','')::integer;
  if v_kind not in ('24h','2h') or v_outcome not in ('accepted','gone','rejected','transient') then
   raise exception 'PUSH_BATCH_RESULT_INVALID';
  end if;
  select s.id,s.business_id,s.appointment_id,s.failed_count,d.endpoint,
   case when v_kind='24h' then s.push_24h_failures else s.push_2h_failures end as failures
  into v_row
  from public.push_subscriptions s join public.push_devices d on d.id=s.device_id
  where s.id=v_subscription
   and (case when v_kind='24h' then s.push_24h_claim_token else s.push_2h_claim_token end)=p_claim_token
   and (case when v_kind='24h' then s.push_24h_sent_at else s.push_2h_sent_at end) is null
  for update of s;
  -- A result for a claim this token no longer owns is stale: recording it would
  -- overwrite the owner's state.
  if not found then continue; end if;
  if v_outcome='accepted' then
   update public.push_subscriptions s set
    push_24h_sent_at=case when v_kind='24h' then p_now else s.push_24h_sent_at end,
    push_2h_sent_at=case when v_kind='2h' then p_now else s.push_2h_sent_at end,
    push_24h_claim_token=case when v_kind='24h' then null else s.push_24h_claim_token end,
    push_2h_claim_token=case when v_kind='2h' then null else s.push_2h_claim_token end,
    push_24h_retry_at=case when v_kind='24h' then null else s.push_24h_retry_at end,
    push_2h_retry_at=case when v_kind='2h' then null else s.push_2h_retry_at end,
    push_24h_failures=case when v_kind='24h' then 0 else s.push_24h_failures end,
    push_2h_failures=case when v_kind='2h' then 0 else s.push_2h_failures end,
    failed_count=0,updated_at=p_now
   where s.id=v_row.id;
   update public.push_delivery_attempts set accepted_at=p_now,push_service_status=v_status,updated_at=p_now
   where id=v_delivery and subscription_id=v_row.id and accepted_at is null and failed_at is null;
   insert into public.audit_logs(business_id,user_id,action,entity_type,entity_id,metadata)
   values(v_row.business_id,null,'appointment.push_sent','appointment',v_row.appointment_id,jsonb_build_object('reminder_kind',v_kind));
  else
   if v_outcome='gone' then
    perform public.mark_push_device_gone(v_row.endpoint,p_now);
    v_failures:=v_row.failures;
   else
    v_failures:=v_row.failures+1;
   end if;
   -- Persistent exponential wait (1, 2, 4 ... 60 minutes); the reminder window
   -- itself ends the retries.
   update public.push_subscriptions s set
    push_24h_claimed_at=case when v_kind='24h' then null else s.push_24h_claimed_at end,
    push_2h_claimed_at=case when v_kind='2h' then null else s.push_2h_claimed_at end,
    push_24h_claim_token=case when v_kind='24h' then null else s.push_24h_claim_token end,
    push_2h_claim_token=case when v_kind='2h' then null else s.push_2h_claim_token end,
    push_24h_failures=case when v_kind='24h' then v_failures else s.push_24h_failures end,
    push_2h_failures=case when v_kind='2h' then v_failures else s.push_2h_failures end,
    push_24h_retry_at=case when v_kind='24h' and v_outcome<>'gone' then p_now+make_interval(mins=>least(60,(2^least(v_failures-1,6))::integer)) else s.push_24h_retry_at end,
    push_2h_retry_at=case when v_kind='2h' and v_outcome<>'gone' then p_now+make_interval(mins=>least(60,(2^least(v_failures-1,6))::integer)) else s.push_2h_retry_at end,
    failed_count=case when v_outcome='gone' then s.failed_count else s.failed_count+1 end,
    updated_at=p_now
   where s.id=v_row.id;
   update public.push_delivery_attempts set failed_at=p_now,failure_kind=v_outcome,push_service_status=v_status,updated_at=p_now
   where id=v_delivery and subscription_id=v_row.id and accepted_at is null and failed_at is null;
  end if;
  v_completed:=v_completed+1;
 end loop;

 for v_item in select value from jsonb_array_elements(coalesce(p_next,'[]'::jsonb)) loop
  v_kind:=v_item->>'kind'; v_subscription:=(v_item->>'subscription_id')::uuid; v_hash:=v_item->>'receipt_token_hash';
  if v_kind not in ('24h','2h') or coalesce(v_hash,'') !~ '^[0-9a-f]{64}$' then
   raise exception 'PUSH_BATCH_PREPARE_INVALID';
  end if;
  select s.id,s.business_id,s.appointment_id,s.detached_at,d.endpoint,d.p256dh,d.auth,
   a.status,a.starts_at,a.confirmation_token,a.public_reminder_description_snapshot,b.name as business_name,b.timezone
  into v_row
  from public.push_subscriptions s
  join public.push_devices d on d.id=s.device_id
  join public.appointments a on a.business_id=s.business_id and a.id=s.appointment_id
  join public.businesses b on b.id=s.business_id
  where s.id=v_subscription
   and (case when v_kind='24h' then s.push_24h_claim_token else s.push_2h_claim_token end)=p_claim_token
   and (case when v_kind='24h' then s.push_24h_sent_at else s.push_2h_sent_at end) is null
  for update of s;
  if not found then
   v_invalidated:=v_invalidated||jsonb_build_array(jsonb_build_object('subscription_id',v_subscription,'kind',v_kind,'reason','claim_lost'));
   continue;
  end if;
  v_ttl:=least(case v_kind when '24h' then 86400 else 7200 end,floor(extract(epoch from v_row.starts_at-p_now))::integer);
  if v_row.detached_at is not null
   or v_row.status not in ('reserved','confirmed','reschedule_requested')
   or private.push_reminder_kind(v_row.starts_at,p_now) is distinct from v_kind or v_ttl<=0
  then
   -- Cancelled, rescheduled out of the window or detached: release without
   -- counting a failure; a later claim finds the reminder that still applies.
   update public.push_subscriptions s set
    push_24h_claimed_at=case when v_kind='24h' then null else s.push_24h_claimed_at end,
    push_2h_claimed_at=case when v_kind='2h' then null else s.push_2h_claimed_at end,
    push_24h_claim_token=case when v_kind='24h' then null else s.push_24h_claim_token end,
    push_2h_claim_token=case when v_kind='2h' then null else s.push_2h_claim_token end,
    updated_at=p_now
   where s.id=v_row.id;
   v_invalidated:=v_invalidated||jsonb_build_array(jsonb_build_object('subscription_id',v_subscription,'kind',v_kind,'reason','revalidation_failed'));
   continue;
  end if;
  begin
   -- A previous attempt without an outcome lost its response: record it as such.
   update public.push_delivery_attempts set failed_at=p_now,failure_kind='transient',updated_at=p_now
   where subscription_id=v_row.id and kind=v_kind and accepted_at is null and failed_at is null and superseded_at is null;
   -- The identity trigger checks the device under its own lock, so an endpoint the
   -- provider reported gone, before or during this call, is refused here.
   insert into public.push_delivery_attempts(business_id,appointment_id,subscription_id,kind,receipt_token_hash,expires_at,created_at,updated_at)
   values(v_row.business_id,v_row.appointment_id,v_row.id,v_kind,v_hash,p_now+make_interval(secs=>v_ttl),p_now,p_now)
   returning id into v_delivery;
  exception when raise_exception then
   if sqlerrm<>'PUSH_DEVICE_GONE' then raise; end if;
   update public.push_subscriptions s set
    push_24h_claimed_at=case when v_kind='24h' then null else s.push_24h_claimed_at end,
    push_2h_claimed_at=case when v_kind='2h' then null else s.push_2h_claimed_at end,
    push_24h_claim_token=case when v_kind='24h' then null else s.push_24h_claim_token end,
    push_2h_claim_token=case when v_kind='2h' then null else s.push_2h_claim_token end,
    updated_at=p_now
   where s.id=v_row.id;
   v_invalidated:=v_invalidated||jsonb_build_array(jsonb_build_object('subscription_id',v_subscription,'kind',v_kind,'reason','device_gone'));
   continue;
  end;
  v_prepared:=v_prepared||jsonb_build_array(jsonb_build_object(
   'subscription_id',v_row.id,'kind',v_kind,'business_id',v_row.business_id,'appointment_id',v_row.appointment_id,
   'delivery_id',v_delivery,'endpoint',v_row.endpoint,'p256dh',v_row.p256dh,'auth',v_row.auth,'ttl_seconds',v_ttl,
   'starts_at',v_row.starts_at,'confirmation_token',v_row.confirmation_token,
   'reminder_description',v_row.public_reminder_description_snapshot,
   'business_name',v_row.business_name,'business_timezone',v_row.timezone));
 end loop;

 if p_finish then
  update public.push_subscriptions s set push_24h_claimed_at=null,push_24h_claim_token=null,updated_at=p_now
  where s.push_24h_claim_token=p_claim_token and s.push_24h_sent_at is null;
  get diagnostics v_count=row_count;
  v_released:=v_count;
  update public.push_subscriptions s set push_2h_claimed_at=null,push_2h_claim_token=null,updated_at=p_now
  where s.push_2h_claim_token=p_claim_token and s.push_2h_sent_at is null;
  get diagnostics v_count=row_count;
  v_released:=v_released+v_count;
 end if;

 return jsonb_build_object('completed',v_completed,'released',v_released,'prepared',v_prepared,'invalidated',v_invalidated);
end $$;

-- 3. Google Calendar -------------------------------------------------------------

alter table public.appointment_google_calendar_events add column claim_token uuid;

-- Legacy claim: same body, behind the switch.
create or replace function public.claim_google_calendar_sync_jobs(
 claim_now timestamptz,
 claim_limit integer default 20
) returns table (event_row_id uuid)
language sql security definer set search_path=public,pg_catalog,pg_temp as $$
 with due as (
  select event_link.id
  from public.appointment_google_calendar_events event_link
  where private.legacy_job_entrypoints_enabled()
   and event_link.sync_status in ('pending_create', 'pending_update', 'pending_delete')
   and event_link.next_attempt_at <= claim_now
   and (
    event_link.claimed_at is null
    or event_link.claimed_at < claim_now - interval '10 minutes'
   )
  order by event_link.next_attempt_at, event_link.created_at
  limit greatest(1, least(coalesce(claim_limit, 20), 100))
  for update skip locked
 )
 update public.appointment_google_calendar_events event_link
 set claimed_at = claim_now,
  last_attempt_at = claim_now,
  updated_at = claim_now
 from due
 where event_link.id = due.id
 returning event_link.id;
$$;

-- Fair claim with the definition of each item: event link and the encrypted
-- refresh token of its connection. The appointment itself is read right before the
-- provider calls, so cancellations and reschedules are revalidated there.
create function public.claim_google_calendar_sync_batch(p_now timestamptz,p_limit integer,p_claim_token uuid)
returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare v record; v_event public.appointment_google_calendar_events%rowtype; v_connection record;
 v_items jsonb:='[]'::jsonb; v_claimed integer:=0; v_served uuid[]:='{}';
begin
 if p_now is null or p_claim_token is null or p_limit is null or p_limit not between 1 and 100 then
  raise exception 'GOOGLE_CALENDAR_BATCH_CLAIM_INVALID';
 end if;
 for v in
  select e.id,row_number() over(partition by e.business_id order by e.next_attempt_at,e.created_at,e.id)::integer as turn,
   e.next_attempt_at,e.created_at
  from public.appointment_google_calendar_events e
  left join private.job_queue_rotation r on r.queue='calendar' and r.business_id=e.business_id
  where e.sync_status in ('pending_create','pending_update','pending_delete') and e.next_attempt_at<=p_now
   and (e.claimed_at is null or e.claimed_at<p_now-interval '10 minutes')
  order by turn,r.last_claimed_at nulls first,e.next_attempt_at,e.created_at,e.id
  limit p_limit*2
 loop
  exit when v_claimed>=p_limit;
  perform 1 from public.appointment_google_calendar_events e where e.id=v.id for update skip locked;
  if not found then continue; end if;
  update public.appointment_google_calendar_events e
  set claimed_at=p_now,claim_token=p_claim_token,last_attempt_at=p_now,updated_at=p_now
  where e.id=v.id and e.sync_status in ('pending_create','pending_update','pending_delete') and e.next_attempt_at<=p_now
   and (e.claimed_at is null or e.claimed_at<p_now-interval '10 minutes')
  returning e.* into v_event;
  if not found then continue; end if;
  select c.refresh_token_ciphertext,c.revoked_at into v_connection
  from public.google_calendar_connections c where c.id=v_event.connection_id;
  v_served:=v_served||v_event.business_id;
  v_claimed:=v_claimed+1;
  v_items:=v_items||jsonb_build_array(jsonb_build_object(
   'event_row_id',v_event.id,'business_id',v_event.business_id,'appointment_id',v_event.appointment_id,
   'connection_id',v_event.connection_id,'calendar_id',v_event.calendar_id,'event_id',v_event.event_id,
   'sync_status',v_event.sync_status,'synced_sequence',v_event.synced_sequence,'attempt_count',v_event.attempt_count,
   'business_turn',v.turn,'refresh_token_ciphertext',v_connection.refresh_token_ciphertext,
   'connection_revoked_at',v_connection.revoked_at));
 end loop;
 perform private.record_job_queue_turns('calendar',v_served,p_now);
 return v_items;
end $$;

-- Records a chunk of outcomes with the existing per-event transitions.
-- p_results: [{event_row_id, outcome, google_event_id, synced_sequence, failure_category,
--   error_code, next_attempt_at}], outcome in synced | deleted | failed | delete_requested.
-- A malformed result is a defect of the caller and rejects the whole chunk; a result
-- for a claim this token no longer holds is reported as stale. p_finish releases
-- every claim of this token still held.
create function public.complete_google_calendar_sync_batch(p_claim_token uuid,p_now timestamptz,p_results jsonb,p_finish boolean default false)
returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare v_item jsonb; v_id uuid; v_outcome text; v_status text; v_removed uuid; v_appointment uuid;
 v_results jsonb:='[]'::jsonb; v_released integer:=0;
begin
 if p_claim_token is null or p_now is null or jsonb_typeof(coalesce(p_results,'[]'::jsonb))<>'array'
  or jsonb_array_length(coalesce(p_results,'[]'::jsonb))>100
 then raise exception 'GOOGLE_CALENDAR_BATCH_COMPLETE_INVALID'; end if;
 if exists(
  select 1 from jsonb_array_elements(coalesce(p_results,'[]'::jsonb)) item(value)
  where jsonb_typeof(item.value)<>'object'
   or coalesce(item.value->>'event_row_id','') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or coalesce(item.value->>'outcome','') not in ('synced','deleted','failed','delete_requested')
   or (item.value->>'outcome'='synced' and (jsonb_typeof(item.value->'google_event_id') is distinct from 'string'
    or jsonb_typeof(item.value->'synced_sequence') is distinct from 'number'))
   or (item.value->>'outcome'='failed' and (jsonb_typeof(item.value->'failure_category') is distinct from 'string'
    or jsonb_typeof(item.value->'next_attempt_at') is distinct from 'string'))
 ) then raise exception 'GOOGLE_CALENDAR_BATCH_RESULT_INVALID'; end if;
 for v_item in select value from jsonb_array_elements(coalesce(p_results,'[]'::jsonb)) loop
  v_id:=(v_item->>'event_row_id')::uuid; v_outcome:=v_item->>'outcome'; v_removed:=null;
  select e.appointment_id into v_appointment from public.appointment_google_calendar_events e
  where e.id=v_id and e.claim_token=p_claim_token for update;
  if not found then
   v_results:=v_results||jsonb_build_array(jsonb_build_object('event_row_id',v_id,'status','stale'));
   continue;
  end if;
  if v_outcome='synced' then
   v_status:=public.complete_google_calendar_event_sync(v_id,v_item->>'google_event_id',(v_item->>'synced_sequence')::integer,p_now);
  elsif v_outcome='deleted' then
   v_removed:=public.complete_google_calendar_event_delete(v_id,p_now);
   v_status:='deleted';
  elsif v_outcome='failed' then
   v_status:=public.fail_google_calendar_event_sync(v_id,v_item->>'failure_category',v_item->>'error_code',(v_item->>'next_attempt_at')::timestamptz,p_now);
  else
   perform public.request_google_calendar_event_deletion(v_appointment,p_now);
   -- The deletion runs on the next event instead of waiting for the claim to expire.
   update public.appointment_google_calendar_events set claimed_at=null where id=v_id;
   v_status:='pending_delete';
  end if;
  update public.appointment_google_calendar_events set claim_token=null where id=v_id;
  v_results:=v_results||jsonb_build_array(jsonb_build_object('event_row_id',v_id,'status',v_status,'removed_connection_id',v_removed));
 end loop;
 if p_finish then
  update public.appointment_google_calendar_events set claimed_at=null,claim_token=null,updated_at=p_now
  where claim_token=p_claim_token;
  get diagnostics v_released=row_count;
 end if;
 return jsonb_build_object('results',v_results,'released',v_released);
end $$;

-- 4. Google review requests ------------------------------------------------------

-- One implementation for the legacy and the batch claim. The only change to the
-- previous body is the order: one turn per practice, then the practice served
-- longest ago, then the scheduled time.
create function private.claim_google_review_requests(
 claim_now timestamptz,
 claim_limit integer
)
returns table (
 request_id uuid,
 claim_token uuid,
 business_id uuid,
 patient_id uuid,
 appointment_id uuid,
 appointment_ends_at timestamptz,
 scheduled_for timestamptz,
 subscription_id uuid,
 endpoint text,
 p256dh text,
 auth text,
 confirmation_token text
)
language plpgsql security definer set search_path=public,pg_catalog,pg_temp as $$
declare
 v_candidate record;
 v_context record;
 v_target record;
 v_state public.google_review_patient_delivery_state%rowtype;
 v_claim_token uuid;
 v_claimed integer := 0;
 v_served uuid[] := '{}';
begin
 if claim_now is null then
  raise exception 'GOOGLE_REVIEW_CLAIM_TIME_REQUIRED';
 end if;

 for v_candidate in
  select ranked.id
  from (
   select request.id, request.scheduled_for, request.created_at, rotation.last_claimed_at,
    row_number() over (
     partition by request.business_id
     order by request.scheduled_for, request.created_at, request.id
    ) as turn
   from public.google_review_requests request
   left join private.job_queue_rotation rotation
    on rotation.queue = 'reviews' and rotation.business_id = request.business_id
   where request.status = 'pending'
    and request.scheduled_for <= claim_now
    and (request.next_attempt_at is null or request.next_attempt_at <= claim_now)
  ) ranked
  order by ranked.turn, ranked.last_claimed_at nulls first, ranked.scheduled_for, ranked.created_at, ranked.id
  limit greatest(claim_limit, 1) * 4
 loop
  exit when v_claimed >= greatest(claim_limit, 1);

  perform 1
  from public.google_review_requests request
  where request.id = v_candidate.id
   and request.status = 'pending'
   and request.scheduled_for <= claim_now
   and (request.next_attempt_at is null or request.next_attempt_at <= claim_now)
  for update skip locked;
  if not found then
   continue;
  end if;

  select
   request.id,
   request.business_id,
   request.patient_id,
   request.appointment_id,
   request.appointment_ends_at,
   request.scheduled_for,
   appointment.ends_at as current_ends_at,
   appointment.patient_id as current_patient_id,
   appointment.status as appointment_status,
   appointment.confirmation_token,
   settings.enabled as setting_enabled,
   settings.review_url
  into v_context
  from public.google_review_requests request
  join public.appointments appointment
   on appointment.business_id = request.business_id
   and appointment.id = request.appointment_id
  left join public.google_review_settings settings
   on settings.business_id = request.business_id
  where request.id = v_candidate.id;

  if not found then
   continue;
  end if;

  if v_context.appointment_status = 'cancelled' then
   update public.google_review_requests request
   set status = 'cancelled', status_reason = 'appointment_cancelled', updated_at = claim_now
   where request.id = v_candidate.id;
   continue;
  end if;

  if v_context.appointment_status not in ('reserved', 'confirmed', 'reschedule_requested')
   or v_context.current_patient_id is distinct from v_context.patient_id
   or v_context.current_ends_at is distinct from v_context.appointment_ends_at
  then
   update public.google_review_requests request
   set status = 'superseded', status_reason = 'appointment_changed', updated_at = claim_now
   where request.id = v_candidate.id;
   continue;
  end if;

  if v_context.setting_enabled is distinct from true
   or nullif(trim(v_context.review_url), '') is null
  then
   update public.google_review_requests request
   set status = 'cancelled', status_reason = 'setting_unavailable', updated_at = claim_now
   where request.id = v_candidate.id;
   continue;
  end if;

  select
   subscription.id,
   device.endpoint,
   device.p256dh,
   device.auth
  into v_target
  from public.push_subscriptions subscription
  join public.push_devices device on device.id = subscription.device_id
  where subscription.business_id = v_context.business_id
   and subscription.appointment_id = v_context.appointment_id
   and subscription.detached_at is null
   and device.provider_gone_at is null
  order by device.last_seen_at desc, subscription.updated_at desc, subscription.id
  limit 1;

  if not found then
   update public.google_review_requests request
   set status = 'skipped', status_reason = 'notifications_unavailable', updated_at = claim_now
   where request.id = v_candidate.id;
   continue;
  end if;

  insert into public.google_review_patient_delivery_state (
   business_id,
   patient_id,
   created_at,
   updated_at
  )
  values (
   v_context.business_id,
   v_context.patient_id,
   claim_now,
   claim_now
  )
  on conflict on constraint google_review_patient_delivery_state_pkey do nothing;

  select state.*
  into v_state
  from public.google_review_patient_delivery_state state
  where state.business_id = v_context.business_id
   and state.patient_id = v_context.patient_id
  for update;

  if v_state.last_sent_at is not null
   and v_state.last_sent_at > claim_now - interval '180 days'
  then
   update public.google_review_requests request
   set status = 'skipped', status_reason = 'patient_cooldown', updated_at = claim_now
   where request.id = v_candidate.id;
   continue;
  end if;

  if v_state.active_request_id is not null
   and v_state.active_request_id <> v_context.id
   and v_state.claim_expires_at is not null
   and v_state.claim_expires_at > claim_now
  then
   continue;
  end if;

  v_claim_token := gen_random_uuid();

  update public.google_review_patient_delivery_state state
  set
   active_request_id = v_context.id,
   claim_expires_at = claim_now + interval '10 minutes',
   updated_at = claim_now
  where state.business_id = v_context.business_id
   and state.patient_id = v_context.patient_id;

  update public.google_review_requests request
  set
   status = 'claimed',
   status_reason = null,
   claim_token = v_claim_token,
   claimed_at = claim_now,
   claim_expires_at = claim_now + interval '10 minutes',
   attempt_count = request.attempt_count + 1,
   push_subscription_id = v_target.id,
   updated_at = claim_now
  where request.id = v_context.id;

  v_served := v_served || v_context.business_id;
  v_claimed := v_claimed + 1;
  request_id := v_context.id;
  claim_token := v_claim_token;
  business_id := v_context.business_id;
  patient_id := v_context.patient_id;
  appointment_id := v_context.appointment_id;
  appointment_ends_at := v_context.appointment_ends_at;
  scheduled_for := v_context.scheduled_for;
  subscription_id := v_target.id;
  endpoint := v_target.endpoint;
  p256dh := v_target.p256dh;
  auth := v_target.auth;
  confirmation_token := v_context.confirmation_token;
  return next;
 end loop;
 perform private.record_job_queue_turns('reviews', v_served, claim_now);
end;
$$;

create or replace function public.claim_due_google_review_requests(
 claim_now timestamptz,
 claim_limit integer default 20
)
returns table (
 request_id uuid,
 claim_token uuid,
 business_id uuid,
 patient_id uuid,
 appointment_id uuid,
 appointment_ends_at timestamptz,
 scheduled_for timestamptz,
 subscription_id uuid,
 endpoint text,
 p256dh text,
 auth text,
 confirmation_token text
)
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 if not private.legacy_job_entrypoints_enabled() then return; end if;
 return query select claimed.* from private.claim_google_review_requests(claim_now, claim_limit) claimed;
end;
$$;

create function public.claim_google_review_request_batch(
 claim_now timestamptz,
 claim_limit integer
)
returns table (
 request_id uuid,
 claim_token uuid,
 business_id uuid,
 patient_id uuid,
 appointment_id uuid,
 appointment_ends_at timestamptz,
 scheduled_for timestamptz,
 subscription_id uuid,
 endpoint text,
 p256dh text,
 auth text,
 confirmation_token text
)
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 if claim_limit is null or claim_limit not between 1 and 100 then
  raise exception 'GOOGLE_REVIEW_BATCH_CLAIM_INVALID';
 end if;
 return query select claimed.* from private.claim_google_review_requests(claim_now, claim_limit) claimed;
end;
$$;

-- 5. Abandoned clinical uploads --------------------------------------------------

-- One implementation for the owner's manual cleanup (one practice) and the
-- scheduled cleanup (all practices, one turn per practice). Releases expired
-- reservations first, marks abandoned uploads failed and returns the object paths
-- for Storage API removal. Never touches confirmed files.
create function private.claim_expired_clinical_uploads(p_business_id uuid,p_limit integer)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare ids uuid[]:='{}'; v record;
begin
 perform private.release_expired_clinical_reservations();
 for v in
  select ranked.id from (
   select f.id,f.created_at,row_number() over(partition by f.business_id order by f.created_at,f.id) as turn
   from public.patient_radiographs f
   where (p_business_id is null or f.business_id=p_business_id) and f.storage_provider='supabase_storage'
    and f.status in ('uploading','failed') and f.created_at<clock_timestamp()-interval '2 hours 15 minutes'
    and (exists(select 1 from storage.objects o where o.bucket_id=f.storage_bucket and o.name in (f.storage_path,f.thumbnail_path))
     or exists(select 1 from public.clinical_upload_slots s where s.file_id=f.id))
    and not exists(select 1 from public.clinical_upload_slots s where s.file_id=f.id and s.expires_at>clock_timestamp())
  ) ranked
  order by ranked.turn,ranked.created_at,ranked.id
  limit p_limit
 loop
  -- Re-checked under the lock, as the previous single statement did.
  perform 1 from public.patient_radiographs f where f.id=v.id and f.status in ('uploading','failed')
   and not exists(select 1 from public.clinical_upload_slots s where s.file_id=f.id and s.expires_at>clock_timestamp())
  for update;
  if found then ids:=ids||v.id; end if;
 end loop;
 update public.patient_radiographs set status='failed',failure_code='expired_upload' where id=any(ids);
 return coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'bucket',f.storage_bucket,'paths',array_remove(array[f.storage_path,f.thumbnail_path],null)))
   from public.patient_radiographs f where f.id=any(ids)),'[]'::jsonb)
  ||coalesce((select jsonb_agg(jsonb_build_object('id',unused.id,'bucket',unused.bucket,'paths',unused.paths)) from (
   select grouped.id,grouped.bucket,grouped.paths from (
    select f.id,f.business_id,s.bucket,array_agg(s.path) as paths,min(s.expires_at) as expired_at,
     row_number() over(partition by f.business_id order by min(s.expires_at),f.id) as turn
    from public.clinical_upload_slots s join public.patient_radiographs f on f.id=s.file_id
    join storage.objects o on o.bucket_id=s.bucket and o.name=s.path
    where (p_business_id is null or f.business_id=p_business_id) and f.status='ready' and s.expires_at<=clock_timestamp()
     and s.path<>f.storage_path and s.path is distinct from f.thumbnail_path
    group by f.id,f.business_id,s.bucket
   ) grouped order by grouped.turn,grouped.expired_at,grouped.id limit p_limit) unused),'[]'::jsonb);
end $$;

create or replace function public.claim_expired_clinical_uploads(p_business_id uuid,p_actor_id uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 perform private.require_clinical_file_service_call();perform private.clinical_budget_lock();
 if not coalesce(private.clinical_file_actor_business_role(p_business_id,p_actor_id) in ('owner','admin'),false) then raise exception 'RADIOGRAPH_ACCESS_DENIED';end if;
 return private.claim_expired_clinical_uploads(p_business_id,30);
end $$;

create function public.claim_abandoned_clinical_uploads(p_limit integer) returns jsonb
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
 perform private.require_clinical_file_service_call();perform private.clinical_budget_lock();
 if p_limit is null or p_limit not between 1 and 200 then raise exception 'CLINICAL_CLEANUP_LIMIT_INVALID';end if;
 return private.claim_expired_clinical_uploads(null,p_limit);
end $$;

-- 6. Push telemetry retention ----------------------------------------------------

-- Database-only maintenance stays in pg_cron, like the other integrity jobs: it
-- needs no Worker budget. Same 90-day retention the push job used to apply.
create function private.prune_push_delivery_telemetry() returns integer
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare v_count integer;
begin
 delete from public.push_delivery_attempts where id in (
  select a.id from public.push_delivery_attempts a
  where a.created_at<clock_timestamp()-interval '90 days' order by a.created_at limit 5000);
 get diagnostics v_count=row_count;
 return v_count;
end $$;

do $$
declare
 v_job_id bigint;
begin
 if to_regnamespace('cron') is null then
  raise exception 'PUSH_TELEMETRY_CRON_UNAVAILABLE';
 end if;
 for v_job_id in select jobid from cron.job where jobname='cita-suite-push-telemetry-retention' loop
  perform cron.unschedule(v_job_id);
 end loop;
 perform cron.schedule('cita-suite-push-telemetry-retention','41 4 * * *','select private.prune_push_delivery_telemetry()');
end;
$$;

-- 7. Privileges ------------------------------------------------------------------

revoke all on function public.legacy_job_entrypoints_enabled() from public,anon,authenticated;
revoke all on function public.set_legacy_job_entrypoints(boolean) from public,anon,authenticated;
revoke all on function public.claim_push_reminder_batch(timestamptz,integer,uuid) from public,anon,authenticated;
revoke all on function public.advance_push_reminder_batch(uuid,timestamptz,jsonb,jsonb,boolean) from public,anon,authenticated;
revoke all on function public.claim_google_calendar_sync_batch(timestamptz,integer,uuid) from public,anon,authenticated;
revoke all on function public.complete_google_calendar_sync_batch(uuid,timestamptz,jsonb,boolean) from public,anon,authenticated;
revoke all on function private.claim_google_review_requests(timestamptz,integer) from public,anon,authenticated,service_role;
revoke all on function public.claim_google_review_request_batch(timestamptz,integer) from public,anon,authenticated;
revoke all on function private.claim_expired_clinical_uploads(uuid,integer) from public,anon,authenticated,service_role;
revoke all on function public.claim_abandoned_clinical_uploads(integer) from public,anon,authenticated;
revoke all on function private.prune_push_delivery_telemetry() from public,anon,authenticated,service_role;
grant execute on function public.legacy_job_entrypoints_enabled() to service_role;
grant execute on function public.set_legacy_job_entrypoints(boolean) to service_role;
grant execute on function public.claim_push_reminder_batch(timestamptz,integer,uuid) to service_role;
grant execute on function public.advance_push_reminder_batch(uuid,timestamptz,jsonb,jsonb,boolean) to service_role;
grant execute on function public.claim_google_calendar_sync_batch(timestamptz,integer,uuid) to service_role;
grant execute on function public.complete_google_calendar_sync_batch(uuid,timestamptz,jsonb,boolean) to service_role;
grant execute on function public.claim_google_review_request_batch(timestamptz,integer) to service_role;
grant execute on function public.claim_abandoned_clinical_uploads(integer) to service_role;

notify pgrst,'reload schema';
commit;
