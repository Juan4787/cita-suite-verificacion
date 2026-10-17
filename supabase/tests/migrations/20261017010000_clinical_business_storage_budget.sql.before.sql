-- Committed synthetic pre-upgrade state. Runs only in the owned disposable DB.
begin;
insert into auth.users(id,email) values('6a000000-0000-4000-8000-000000000003','storage-upgrade@example.test');
insert into public.businesses(id,name,slug,industry) values('6a000000-0000-4000-8000-000000000001','Synthetic storage upgrade','synthetic-storage-upgrade','other');
insert into public.patients(id,business_id,owner_id,full_name)
  values('6a000000-0000-4000-8000-000000000002','6a000000-0000-4000-8000-000000000001','6a000000-0000-4000-8000-000000000003','Synthetic storage upgrade patient');
insert into public.patient_radiographs(id,business_id,patient_id,status,storage_provider,storage_bucket,storage_path,mime_type,bytes,sha256)
  select f,'6a000000-0000-4000-8000-000000000001','6a000000-0000-4000-8000-000000000002','uploading','supabase_storage','patient-clinical-files',
    '6a000000-0000-4000-8000-000000000001/6a000000-0000-4000-8000-000000000002/'||f::text||'/original.pdf','application/pdf',3500000,repeat('a',64)
  from unnest(array['6a000000-0000-4000-8000-000000000004'::uuid,'6a000000-0000-4000-8000-000000000005'::uuid]) f;
select private.reserve_clinical_document(id) from public.patient_radiographs where business_id='6a000000-0000-4000-8000-000000000001';
insert into storage.objects(bucket_id,name,metadata)
  select storage_bucket,storage_path,'{"size":3500000,"mimetype":"application/pdf"}' from public.patient_radiographs
  where id='6a000000-0000-4000-8000-000000000004';
commit;
