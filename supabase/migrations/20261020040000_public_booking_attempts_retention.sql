-- Public booking attempts keep a phone, a hash of the address and the user agent of
-- every public booking and management-link attempt, and nothing removed them. Only
-- the limits read them, over the last ten and thirty minutes. They are kept seven
-- days, like the server limit events, and pruned by the database's own schedule,
-- as the push telemetry is: work of the database only, without Worker budget.
-- Bounded per run, so a long history is cleared over a few days without a large
-- single delete.
begin;

create function private.prune_public_booking_attempts() returns integer
language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare v_count integer;
begin
 delete from public.public_booking_attempts where id in (
  select a.id from public.public_booking_attempts a
  where a.created_at<clock_timestamp()-interval '7 days' order by a.created_at limit 20000);
 get diagnostics v_count=row_count;
 return v_count;
end $$;

revoke all on function private.prune_public_booking_attempts() from public,anon,authenticated,service_role;

do $$
declare
 v_job_id bigint;
begin
 if to_regnamespace('cron') is null then
  raise exception 'PUBLIC_BOOKING_ATTEMPTS_CRON_UNAVAILABLE';
 end if;
 for v_job_id in select jobid from cron.job where jobname='cita-suite-public-booking-attempts-retention' loop
  perform cron.unschedule(v_job_id);
 end loop;
 perform cron.schedule('cita-suite-public-booking-attempts-retention','47 4 * * *','select private.prune_public_booking_attempts()');
end;
$$;

commit;
