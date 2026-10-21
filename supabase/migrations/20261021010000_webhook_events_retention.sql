-- Webhook events are operational records, not product history: the Mercado Pago
-- notifications with a valid signature, payload included, and those of the discarded
-- WhatsApp channel. Nothing removed them. They are kept 180 days, long enough to
-- review a payment, except a Mercado Pago event that still requires attention, and
-- pruned by the database's own schedule like the other retained records: work of the
-- database only, bounded per run. The audit log and the patient profile changes are
-- product history the app shows, and are kept.
begin;

create function private.prune_webhook_events() returns integer
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare v_mp integer; v_whatsapp integer;
begin
 delete from public.mp_webhook_events where id in (
  select e.id from public.mp_webhook_events e
  where e.received_at<clock_timestamp()-interval '180 days' and not e.requires_attention order by e.received_at limit 20000);
 get diagnostics v_mp=row_count;
 delete from public.whatsapp_webhook_events where id in (
  select e.id from public.whatsapp_webhook_events e
  where e.received_at<clock_timestamp()-interval '180 days' order by e.received_at limit 20000);
 get diagnostics v_whatsapp=row_count;
 return v_mp+v_whatsapp;
end $$;

revoke all on function private.prune_webhook_events() from public,anon,authenticated,service_role;

do $$
declare
 v_job_id bigint;
begin
 if to_regnamespace('cron') is null then
  raise exception 'WEBHOOK_EVENTS_CRON_UNAVAILABLE';
 end if;
 for v_job_id in select jobid from cron.job where jobname='cita-suite-webhook-events-retention' loop
  perform cron.unschedule(v_job_id);
 end loop;
 perform cron.schedule('cita-suite-webhook-events-retention','53 4 * * *','select private.prune_webhook_events()');
end;
$$;

commit;
