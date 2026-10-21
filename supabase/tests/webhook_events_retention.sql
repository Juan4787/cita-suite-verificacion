-- Webhook events are operational records: Mercado Pago notifications with a valid
-- signature (their payload included) and the WhatsApp ones of the discarded channel.
-- They are kept 180 days, except a Mercado Pago event that still requires attention,
-- through the database's own schedule, and no API role can run the pruning.
-- Synthetic data only; everything is rolled back.
begin;
select extensions.plan(3);

create temporary table retention_event(label text primary key, id uuid not null);

-- 1. Old events are removed; recent ones and those that still require attention stay.
do $$
declare v_prune regprocedure:=to_regprocedure('private.prune_webhook_events()'); v_removed integer;
begin
 with inserted as (
  insert into public.mp_webhook_events(received_at,topic,processing_status,requires_attention,signature_valid)
  values(now()-interval '181 days','payment','processed',false,true),(now()-interval '181 days','payment','error',true,true),
   (now()-interval '179 days','payment','processed',false,true)
  returning id,requires_attention,received_at
 )
 insert into retention_event
 select case when requires_attention then 'mp attention' when received_at<now()-interval '180 days' then 'mp old' else 'mp recent' end,id from inserted;
 with inserted as (
  insert into public.whatsapp_webhook_events(event_type,payload,processed,received_at)
  values('message','{}',true,now()-interval '181 days'),('message','{}',true,now()-interval '179 days')
  returning id,received_at
 )
 insert into retention_event
 select case when received_at<now()-interval '180 days' then 'whatsapp old' else 'whatsapp recent' end,id from inserted;
 if v_prune is null then raise exception 'TEST_WEBHOOK_RETENTION_MISSING'; end if;
 execute 'select private.prune_webhook_events()' into v_removed;
 if coalesce(v_removed<2
  or exists(select 1 from public.mp_webhook_events e join retention_event r on r.id=e.id where r.label='mp old')
  or exists(select 1 from public.whatsapp_webhook_events e join retention_event r on r.id=e.id where r.label='whatsapp old')
  or (select count(*) from public.mp_webhook_events e join retention_event r on r.id=e.id where r.label in ('mp attention','mp recent'))<>2
  or not exists(select 1 from public.whatsapp_webhook_events e join retention_event r on r.id=e.id where r.label='whatsapp recent'),true) then
  raise exception 'TEST_WEBHOOK_RETENTION %',v_removed;
 end if;
end $$;
select extensions.pass('webhook events older than 180 days are removed, except those that still require attention');

-- 2. The database schedules the pruning itself, once a day.
do $$
begin
 if to_regnamespace('cron') is null or not exists(select 1 from cron.job where jobname='cita-suite-webhook-events-retention'
  and command='select private.prune_webhook_events()') then
  raise exception 'TEST_WEBHOOK_RETENTION_SCHEDULE';
 end if;
end $$;
select extensions.pass('the database schedules the pruning of webhook events');

-- 3. No API role can run the pruning.
select extensions.ok(
 case when to_regprocedure('private.prune_webhook_events()') is null then false else not exists(
  select 1 from unnest(array['anon','authenticated','service_role']) api_role
  where has_function_privilege(api_role,'private.prune_webhook_events()','execute')) end,
 'no API role can run the pruning of webhook events');

select * from extensions.finish();
rollback;
