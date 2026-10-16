-- Synthetic schema-contract test in the owned disposable database only.
-- Disable USER triggers transactionally to prove FK enforcement independently
-- of application guards. Internal FK/CHECK/exclusion constraints stay enabled.
-- Existing role/RLS suites test authorization with all normal triggers enabled.
begin;
select extensions.plan(41);
alter table public.access_grants disable trigger user;
alter table public.appointments disable trigger user;
alter table public.clinical_entries disable trigger user;
alter table public.clinical_entry_costs disable trigger user;
alter table public.follow_ups disable trigger user;
alter table public.google_review_requests disable trigger user;
alter table public.mp_webhook_events disable trigger user;
alter table public.patient_clinical_profiles disable trigger user;
alter table public.patient_profile_change_events disable trigger user;
alter table public.patient_radiographs disable trigger user;
alter table public.professional_patient_links disable trigger user;
alter table public.push_delivery_attempts disable trigger user;
alter table public.push_subscriptions disable trigger user;

create temporary table relation_fixture (
 owner_a uuid,owner_b uuid,a uuid,b uuid,pa uuid,pb uuid,pra uuid,prb uuid,
 aa uuid,ab uuid,sa uuid,sb uuid,da uuid,db uuid,ra uuid,rb uuid,
 ea uuid,eb uuid,cost uuid,profile uuid,change uuid,radio uuid,follow_up uuid,link uuid,webhook uuid,ga uuid,gb uuid
);
do $fixture$
declare
 owner_a uuid:=gen_random_uuid(); owner_b uuid:=gen_random_uuid();
 a uuid:=gen_random_uuid();b uuid:=gen_random_uuid();pa uuid:=gen_random_uuid();pb uuid:=gen_random_uuid();
 pra uuid:=gen_random_uuid();prb uuid:=gen_random_uuid();service_a uuid:=gen_random_uuid();service_b uuid:=gen_random_uuid();
 aa uuid:=gen_random_uuid();ab uuid:=gen_random_uuid();sa uuid:=gen_random_uuid();sb uuid:=gen_random_uuid();
 device_a uuid:=gen_random_uuid();device_b uuid:=gen_random_uuid();da uuid:=gen_random_uuid();db uuid:=gen_random_uuid();
 ra uuid:=gen_random_uuid();rb uuid:=gen_random_uuid();ea uuid:=gen_random_uuid();eb uuid:=gen_random_uuid();
 cost uuid:=gen_random_uuid();profile uuid:=gen_random_uuid();change uuid:=gen_random_uuid();radio uuid:=gen_random_uuid();
 follow_up uuid:=gen_random_uuid();link uuid:=gen_random_uuid();webhook uuid:=gen_random_uuid();ga uuid:=gen_random_uuid();gb uuid:=gen_random_uuid();
 starts timestamptz:=now()+interval '30 days';
begin
 insert into auth.users(id,email) values(owner_a,'relation-a-'||owner_a||'@example.test'),(owner_b,'relation-b-'||owner_b||'@example.test');
 insert into public.businesses(id,name,slug,industry) values(a,'Synthetic relations A','relation-a-'||a,'other'),(b,'Synthetic relations B','relation-b-'||b,'other');
 insert into public.business_users(business_id,user_id,role,status) values(a,owner_a,'owner','active'),(b,owner_b,'owner','active');
 insert into public.patients(id,business_id,owner_id,full_name) values(pa,a,owner_a,'Synthetic A'),(pb,b,owner_b,'Synthetic B');
 insert into public.professionals(id,business_id,name) values(pra,a,'Synthetic A'),(prb,b,'Synthetic B');
 insert into public.services(id,business_id,name,duration_minutes) values(service_a,a,'Synthetic A',30),(service_b,b,'Synthetic B',30);
 insert into public.appointments(id,business_id,patient_id,professional_id,service_id,starts_at,ends_at,blocking_starts_at,blocking_ends_at,status,source,service_name_snapshot,professional_name_snapshot,duration_minutes_snapshot)
 values(aa,a,pa,pra,service_a,starts,starts+interval '30 minutes',starts,starts+interval '30 minutes','reserved','manual','Synthetic A','Synthetic A',30),
 (ab,b,pb,prb,service_b,starts,starts+interval '30 minutes',starts,starts+interval '30 minutes','reserved','manual','Synthetic B','Synthetic B',30);
 insert into public.clinical_entries(id,business_id,patient_id,entry_type,description) values(ea,a,pa,'Consulta','Synthetic A'),(eb,b,pb,'Consulta','Synthetic B');
 insert into public.clinical_entry_costs(id,business_id,clinical_entry_id,amount) values(cost,a,ea,15000.50);
 insert into public.patient_clinical_profiles(id,business_id,patient_id) values(profile,a,pa);
 insert into public.patient_profile_change_events(id,business_id,patient_id,changed_by_professional_id,changed_by_name,summary) values(change,a,pa,pra,'Synthetic A','Synthetic change');
 insert into public.patient_radiographs(id,owner_id,business_id,patient_id,status,drive_file_id,original_filename,storage_provider,created_by)
 values(radio,owner_a,a,pa,'ready','synthetic-legacy','synthetic.jpg','google_drive_legacy',owner_a);
 insert into public.follow_ups(id,business_id,patient_id,assigned_professional_id,remind_on) values(follow_up,a,pa,pra,current_date+1);
 insert into public.professional_patient_links(id,business_id,patient_id,professional_id) values(link,a,pa,pra);
 insert into public.push_devices(id,endpoint,p256dh,auth) values(device_a,'https://push.example.test/'||device_a,'synthetic','synthetic'),(device_b,'https://push.example.test/'||device_b,'synthetic','synthetic');
 insert into public.push_subscriptions(id,business_id,appointment_id,device_id) values(sa,a,aa,device_a),(sb,b,ab,device_b);
 insert into public.push_delivery_attempts(id,business_id,appointment_id,subscription_id,kind,receipt_token_hash,expires_at)
 values(da,a,aa,sa,'review',repeat('a',64),starts),(db,b,ab,sb,'review',repeat('b',64),starts);
 insert into public.google_review_requests(id,business_id,patient_id,appointment_id,appointment_ends_at,scheduled_for,push_subscription_id,push_delivery_id)
 values(ra,a,pa,aa,starts+interval '30 minutes',starts+interval '150 minutes',sa,da),(rb,b,pb,ab,starts+interval '30 minutes',starts+interval '150 minutes',sb,db);
 update public.push_delivery_attempts set google_review_request_id=ra where id=da;
 update public.push_delivery_attempts set google_review_request_id=rb where id=db;
 insert into public.access_grants(id,business_id,operation,source,idempotency_key) values(ga,a,'grant_access','internal',ga::text),(gb,b,'grant_access','internal',gb::text);
 insert into public.mp_webhook_events(id,business_id,credited_grant_id,signature_valid,processing_status) values(webhook,a,ga,true,'processed');
 insert into relation_fixture values(owner_a,owner_b,a,b,pa,pb,pra,prb,aa,ab,sa,sb,da,db,ra,rb,ea,eb,cost,profile,change,radio,follow_up,link,webhook,ga,gb);
end $fixture$;

select extensions.ok((select convalidated and array_length(conkey,1)=2 from pg_constraint where conrelid='public.clinical_entries'::regclass and conname='clinical_entries_patient_id_fkey'),'clinical_entries_patient_id_fkey is validated and composite');
select extensions.throws_ok($test$update public.clinical_entries set patient_id=(select pb from relation_fixture) where id=(select ea from relation_fixture)$test$,'23503',null,'clinical_entries_patient_id_fkey rejects foreign clinic without USER triggers');
select extensions.ok((select convalidated and array_length(conkey,1)=2 from pg_constraint where conrelid='public.clinical_entry_costs'::regclass and conname='clinical_entry_costs_clinical_entry_id_fkey'),'clinical_entry_costs_clinical_entry_id_fkey is validated and composite');
select extensions.throws_ok($test$update public.clinical_entry_costs set clinical_entry_id=(select eb from relation_fixture) where id=(select cost from relation_fixture)$test$,'23503',null,'clinical_entry_costs_clinical_entry_id_fkey rejects foreign clinic without USER triggers');
select extensions.ok((select convalidated and array_length(conkey,1)=2 from pg_constraint where conrelid='public.follow_ups'::regclass and conname='follow_ups_assigned_professional_id_fkey'),'follow_ups_assigned_professional_id_fkey is validated and composite');
select extensions.throws_ok($test$update public.follow_ups set assigned_professional_id=(select prb from relation_fixture) where id=(select follow_up from relation_fixture)$test$,'23503',null,'follow_ups_assigned_professional_id_fkey rejects foreign clinic without USER triggers');
select extensions.ok((select convalidated and array_length(conkey,1)=2 from pg_constraint where conrelid='public.follow_ups'::regclass and conname='follow_ups_patient_id_fkey'),'follow_ups_patient_id_fkey is validated and composite');
select extensions.throws_ok($test$update public.follow_ups set patient_id=(select pb from relation_fixture) where id=(select follow_up from relation_fixture)$test$,'23503',null,'follow_ups_patient_id_fkey rejects foreign clinic without USER triggers');
select extensions.ok((select convalidated and array_length(conkey,1)=2 from pg_constraint where conrelid='public.google_review_requests'::regclass and conname='google_review_requests_push_delivery_id_fkey'),'google_review_requests_push_delivery_id_fkey is validated and composite');
select extensions.throws_ok($test$update public.google_review_requests set push_delivery_id=(select db from relation_fixture) where id=(select ra from relation_fixture)$test$,'23503',null,'google_review_requests_push_delivery_id_fkey rejects foreign clinic without USER triggers');
select extensions.ok((select convalidated and array_length(conkey,1)=2 from pg_constraint where conrelid='public.google_review_requests'::regclass and conname='google_review_requests_push_subscription_id_fkey'),'google_review_requests_push_subscription_id_fkey is validated and composite');
select extensions.throws_ok($test$update public.google_review_requests set push_subscription_id=(select sb from relation_fixture) where id=(select ra from relation_fixture)$test$,'23503',null,'google_review_requests_push_subscription_id_fkey rejects foreign clinic without USER triggers');
select extensions.ok((select convalidated and array_length(conkey,1)=2 from pg_constraint where conrelid='public.mp_webhook_events'::regclass and conname='mp_webhook_events_credited_grant_id_fkey'),'mp_webhook_events_credited_grant_id_fkey is validated and composite');
select extensions.throws_ok($test$update public.mp_webhook_events set credited_grant_id=(select gb from relation_fixture) where id=(select webhook from relation_fixture)$test$,'23503',null,'mp_webhook_events_credited_grant_id_fkey rejects foreign clinic without USER triggers');
select extensions.ok((select convalidated and array_length(conkey,1)=2 from pg_constraint where conrelid='public.patient_clinical_profiles'::regclass and conname='patient_clinical_profiles_patient_id_fkey'),'patient_clinical_profiles_patient_id_fkey is validated and composite');
select extensions.throws_ok($test$update public.patient_clinical_profiles set patient_id=(select pb from relation_fixture) where id=(select profile from relation_fixture)$test$,'23503',null,'patient_clinical_profiles_patient_id_fkey rejects foreign clinic without USER triggers');
select extensions.ok((select convalidated and array_length(conkey,1)=2 from pg_constraint where conrelid='public.patient_profile_change_events'::regclass and conname='patient_profile_change_events_changed_by_professional_id_fkey'),'patient_profile_change_events_changed_by_professional_id_fkey is validated and composite');
select extensions.throws_ok($test$update public.patient_profile_change_events set changed_by_professional_id=(select prb from relation_fixture) where id=(select change from relation_fixture)$test$,'23503',null,'patient_profile_change_events_changed_by_professional_id_fkey rejects foreign clinic without USER triggers');
select extensions.ok((select convalidated and array_length(conkey,1)=2 from pg_constraint where conrelid='public.patient_profile_change_events'::regclass and conname='patient_profile_change_events_patient_id_fkey'),'patient_profile_change_events_patient_id_fkey is validated and composite');
select extensions.throws_ok($test$update public.patient_profile_change_events set patient_id=(select pb from relation_fixture) where id=(select change from relation_fixture)$test$,'23503',null,'patient_profile_change_events_patient_id_fkey rejects foreign clinic without USER triggers');
select extensions.ok((select convalidated and array_length(conkey,1)=2 from pg_constraint where conrelid='public.patient_radiographs'::regclass and conname='patient_radiographs_patient_id_fkey'),'patient_radiographs_patient_id_fkey is validated and composite');
select extensions.throws_ok($test$update public.patient_radiographs set patient_id=(select pb from relation_fixture) where id=(select radio from relation_fixture)$test$,'23503',null,'patient_radiographs_patient_id_fkey rejects foreign clinic without USER triggers');
select extensions.ok((select convalidated and array_length(conkey,1)=2 from pg_constraint where conrelid='public.professional_patient_links'::regclass and conname='professional_patient_links_patient_id_fkey'),'professional_patient_links_patient_id_fkey is validated and composite');
select extensions.throws_ok($test$update public.professional_patient_links set patient_id=(select pb from relation_fixture) where id=(select link from relation_fixture)$test$,'23503',null,'professional_patient_links_patient_id_fkey rejects foreign clinic without USER triggers');
select extensions.ok((select convalidated and array_length(conkey,1)=2 from pg_constraint where conrelid='public.professional_patient_links'::regclass and conname='professional_patient_links_professional_id_fkey'),'professional_patient_links_professional_id_fkey is validated and composite');
select extensions.throws_ok($test$update public.professional_patient_links set professional_id=(select prb from relation_fixture) where id=(select link from relation_fixture)$test$,'23503',null,'professional_patient_links_professional_id_fkey rejects foreign clinic without USER triggers');
select extensions.ok((select convalidated and array_length(conkey,1)=2 from pg_constraint where conrelid='public.push_delivery_attempts'::regclass and conname='push_delivery_attempts_google_review_request_id_fkey'),'push_delivery_attempts_google_review_request_id_fkey is validated and composite');
select extensions.throws_ok($test$update public.push_delivery_attempts set google_review_request_id=(select rb from relation_fixture) where id=(select da from relation_fixture)$test$,'23503',null,'push_delivery_attempts_google_review_request_id_fkey rejects foreign clinic without USER triggers');
select extensions.ok((select convalidated and array_length(conkey,1)=2 from pg_constraint where conrelid='public.push_delivery_attempts'::regclass and conname='push_delivery_attempts_subscription_id_fkey'),'push_delivery_attempts_subscription_id_fkey is validated and composite');
select extensions.throws_ok($test$update public.push_delivery_attempts set subscription_id=(select sb from relation_fixture) where id=(select da from relation_fixture)$test$,'23503',null,'push_delivery_attempts_subscription_id_fkey rejects foreign clinic without USER triggers');
select extensions.ok((select convalidated and array_length(conkey,1)=2 from pg_constraint where conrelid='public.push_subscriptions'::regclass and conname='push_subscriptions_appointment_id_fkey'),'push_subscriptions_appointment_id_fkey is validated and composite');
select extensions.throws_ok($test$update public.push_subscriptions set appointment_id=(select ab from relation_fixture) where id=(select sa from relation_fixture)$test$,'23503',null,'push_subscriptions_appointment_id_fkey rejects foreign clinic without USER triggers');

select extensions.is((select amount from public.clinical_entry_costs where id=(select cost from relation_fixture)),15000.50::numeric,'positive control: rejected writes preserve historical cost');
select extensions.throws_ok($test$delete from public.professionals where id=(select pra from relation_fixture)$test$,'23503',null,'professional deletion still respects existing references');
select extensions.throws_ok($test$delete from public.patients where id=(select pa from relation_fixture)$test$,'23503',null,'clinical file RESTRICT is preserved');
select extensions.is((select count(*) from public.clinical_entries where id=(select ea from relation_fixture)),1::bigint,'failed parent deletion rolls back earlier cascades');
select extensions.lives_ok($test$delete from public.google_review_requests where id=(select rb from relation_fixture)$test$,'review deletion preserves nullable delivery relationship');
select extensions.ok((select business_id=(select b from relation_fixture) and google_review_request_id is null from public.push_delivery_attempts where id=(select db from relation_fixture)),'SET NULL clears only review reference, preserving clinic');
select extensions.lives_ok($test$delete from public.access_grants where id=(select ga from relation_fixture)$test$,'grant deletion preserves webhook history');
select extensions.ok((select business_id=(select a from relation_fixture) and credited_grant_id is null from public.mp_webhook_events where id=(select webhook from relation_fixture)),'SET NULL clears only credited grant, preserving clinic');
select extensions.lives_ok($test$delete from public.push_subscriptions where id=(select sa from relation_fixture)$test$,'subscription CASCADE and review SET NULL compose without clearing clinic');
select * from extensions.finish();
rollback;
