-- Hosted Supabase loads safeupdate in every PostgREST session: an UPDATE or DELETE
-- without WHERE fails, also inside the functions a request calls. These suites
-- connect directly, without that guard, so this one loads it and calls, as the
-- server role, the backend entry points the scheduled jobs reach through PostgREST.
-- Found on staging: the storage reconciliation updated every upload slot without a
-- condition and failed with SQLSTATE 21000. Everything is rolled back.
begin;
select extensions.plan(10);
load 'safeupdate';

-- Without this the calls below would pass whatever they contain.
select extensions.throws_ok($$update public.clinical_storage_budget set updated_at=updated_at$$,
 '21000','UPDATE requires a WHERE clause','the hosted guard against unqualified writes is active in this session');

set local role service_role;
select set_config('request.jwt.claim.role','service_role',true);
select extensions.lives_ok($$select public.reconcile_clinical_storage_budget(1000)$$,
 'the storage reconciliation runs under the hosted request guard');
select extensions.lives_ok($$select * from public.claim_push_reminder_batch(now(),100,gen_random_uuid())$$,
 'the push claim runs under the hosted request guard');
select extensions.lives_ok($$select public.advance_push_reminder_batch(gen_random_uuid(),now(),'[]','[]',true)$$,
 'the push advance and finish run under the hosted request guard');
select extensions.lives_ok($$select public.claim_google_calendar_sync_batch(now(),100,gen_random_uuid())$$,
 'the calendar claim runs under the hosted request guard');
select extensions.lives_ok($$select public.complete_google_calendar_sync_batch(gen_random_uuid(),now(),'[]',true)$$,
 'the calendar completion runs under the hosted request guard');
select extensions.lives_ok($$select * from public.claim_google_review_request_batch(now(),100)$$,
 'the review claim runs under the hosted request guard');
select extensions.lives_ok($$select public.claim_abandoned_clinical_uploads(200)$$,
 'the abandoned upload cleanup runs under the hosted request guard');
select extensions.lives_ok($$select public.set_legacy_job_entrypoints(public.legacy_job_entrypoints_enabled())$$,
 'the transition switch runs under the hosted request guard');
select extensions.ok(public.legacy_job_entrypoints_enabled(), 'the switch keeps its state');

select * from extensions.finish();
rollback;
