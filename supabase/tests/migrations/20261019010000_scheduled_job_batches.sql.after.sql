-- The upgrade keeps the previous scheduler working until the release step stops it
-- and respects its in-flight claim. The claims below are rolled back; the seeded
-- namespace is then removed exactly.
begin;
select extensions.plan(5);
select extensions.ok(public.legacy_job_entrypoints_enabled(),'the previous scheduler keeps working until the release step stops it');
select extensions.ok((select push_24h_failures=0 and push_2h_failures=0 and push_24h_retry_at is null and push_2h_retry_at is null
  and push_24h_claim_token is null and push_24h_claimed_at is not null and failed_count=2
  from public.push_subscriptions where appointment_id='6b000000-0000-4000-8000-000000000006'),
  'existing subscriptions start without waits and keep their claim and history');
select extensions.is((select count(*) from public.claim_push_reminder_batch(now(),100,'6b000000-0000-4000-8000-0000000000a1') c
  join public.push_subscriptions s on s.id=c.subscription_id where s.appointment_id='6b000000-0000-4000-8000-000000000006'),0::bigint,
  'the batch claim does not take a reminder the previous scheduler claimed moments ago');
select extensions.is((select count(*) from public.claim_push_reminder_batch(now()+interval '11 minutes',100,'6b000000-0000-4000-8000-0000000000a2') c
  join public.push_subscriptions s on s.id=c.subscription_id where s.appointment_id='6b000000-0000-4000-8000-000000000006'),1::bigint,
  'an abandoned legacy claim is recovered after ten minutes');
select extensions.ok((select push_24h_claim_token='6b000000-0000-4000-8000-0000000000a2' from public.push_subscriptions
  where appointment_id='6b000000-0000-4000-8000-000000000006'),'the recovered claim belongs to its new token');
select * from extensions.finish();
rollback;
begin;
delete from public.push_subscriptions where appointment_id='6b000000-0000-4000-8000-000000000006';
delete from public.push_devices where endpoint='https://push.example/scheduled-upgrade';
delete from public.appointments where id='6b000000-0000-4000-8000-000000000006';
delete from public.patients where id='6b000000-0000-4000-8000-000000000005';
delete from public.professional_services where business_id='6b000000-0000-4000-8000-000000000002';
delete from public.professionals where id='6b000000-0000-4000-8000-000000000004';
delete from public.services where id='6b000000-0000-4000-8000-000000000003';
delete from public.businesses where id='6b000000-0000-4000-8000-000000000002';
delete from auth.users where id='6b000000-0000-4000-8000-000000000001';
commit;
