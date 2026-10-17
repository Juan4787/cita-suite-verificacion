create extension if not exists pgtap with schema extensions;
begin;
-- Only these synthetic catalog rows exist; no physical object is being deleted.
set local storage.allow_delete_query='true';
select extensions.plan(6);
select extensions.is((select max_bytes from public.clinical_business_storage_budget where business_id='6a000000-0000-4000-8000-000000000001'),700000000::bigint,'upgrade preserves the previously applicable maximum');
select extensions.is((select used_bytes from public.clinical_business_storage_budget where business_id='6a000000-0000-4000-8000-000000000001'),3500000::bigint,'upgrade preserves and attributes the stored object');
select extensions.is((select reserved_bytes from public.clinical_business_storage_budget where business_id='6a000000-0000-4000-8000-000000000001'),5000000::bigint,'upgrade preserves full backing for the pending URL');
select extensions.is((select count(*) from public.clinical_upload_slots where business_id='6a000000-0000-4000-8000-000000000001'),2::bigint,'upgrade attributes both stored and pending leases');
select extensions.ok((select bool_and(expires_at>clock_timestamp()+interval '2 hours') from public.clinical_upload_slots where business_id='6a000000-0000-4000-8000-000000000001'),'upgrade retains the existing expiration protection');
select extensions.is((select count(*) from storage.objects where name like '6a000000-0000-4000-8000-000000000001/%'),1::bigint,'upgrade does not delete a valid object');
select * from extensions.finish();
-- Cleanup exactly the seeded namespace; later suites start without its usage.
update public.clinical_upload_slots set expires_at=clock_timestamp()-interval '1 second'
  where business_id='6a000000-0000-4000-8000-000000000001';
select private.release_expired_clinical_reservations();
delete from storage.objects where bucket_id='patient-clinical-files' and name like '6a000000-0000-4000-8000-000000000001/%';
delete from public.clinical_upload_slots where business_id='6a000000-0000-4000-8000-000000000001';
delete from public.patient_radiographs where business_id='6a000000-0000-4000-8000-000000000001';
delete from public.businesses where id='6a000000-0000-4000-8000-000000000001';
delete from auth.users where id='6a000000-0000-4000-8000-000000000003';
commit;
