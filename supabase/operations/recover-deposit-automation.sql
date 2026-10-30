-- Run only against the explicitly selected restored database, before serving it.
-- A dump restores schema/data, not the pg_cron registrations from migration DO blocks.
begin;
create extension if not exists pg_cron;
update private.deposit_automation set enabled = false where singleton;
do $$
declare v_job_id bigint;
begin
 for v_job_id in select jobid from cron.job where jobname in ('cita-suite-deposit-expiry','cita-suite-cron-history-retention') loop
  perform cron.unschedule(v_job_id);
 end loop;
 perform cron.schedule('cita-suite-deposit-expiry','*/5 * * * *','select private.expire_unpaid_deposits()');
 perform cron.schedule('cita-suite-cron-history-retention','37 5 * * *',
  'delete from cron.job_run_details where end_time < now() - interval ''14 days''');
end $$;
commit;
