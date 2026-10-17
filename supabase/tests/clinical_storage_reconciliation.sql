-- Catalog reconciliation proof. Synthetic metadata only, not physical S3 proof.
begin;
select extensions.plan(14);
create temporary table reconcile_fixture(business_id uuid, patient_id uuid, pending_id uuid, other_bucket text);
do $$
declare business uuid:=gen_random_uuid(); patient uuid:=gen_random_uuid(); actor uuid:=gen_random_uuid();
  file_id uuid; pending uuid:=gen_random_uuid(); state text; amount bigint:=0; original text; thumbnail text;
begin
  perform set_config('request.jwt.claim.role','service_role',true);
  insert into auth.users(id,email) values(actor,actor||'@example.test');
  insert into public.businesses(id,name,slug,industry) values(business,'Synthetic reconciliation',business::text,'other');
  insert into public.patients(id,business_id,owner_id,full_name) values(patient,business,actor,'Synthetic reconciliation patient');
  foreach state in array array['uploading','failed','trashed','ready'] loop
    file_id:=gen_random_uuid(); amount:=amount+100;
    original:=business::text||'/'||patient::text||'/'||file_id::text||'/original.png';
    thumbnail:=case when state='ready' then business::text||'/'||patient::text||'/'||file_id::text||'/thumbnail.webp' else null end;
    insert into public.patient_radiographs(id,business_id,patient_id,status,storage_provider,storage_bucket,storage_path,thumbnail_path,mime_type,bytes,sha256,ready_at)
      values(file_id,business,patient,'uploading','supabase_storage','patient-clinical-files',original,thumbnail,'image/png',amount,repeat('a',64),clock_timestamp());
    insert into storage.objects(bucket_id,name,metadata)
      values('patient-clinical-files',original,jsonb_build_object('size',amount,'mimetype','image/png'));
    if thumbnail is not null then
      insert into storage.objects(bucket_id,name,metadata) values('patient-clinical-files',thumbnail,'{"size":50,"mimetype":"image/webp"}');
    end if;
    -- A failed file can already occupy space; setting failed does not erase it.
    update public.patient_radiographs set status=state where id=file_id;
  end loop;
  insert into public.patient_radiographs(id,business_id,patient_id,status,storage_provider,storage_bucket,storage_path,mime_type,bytes,sha256,created_at)
    values(pending,business,patient,'uploading','supabase_storage','patient-clinical-files',
      business::text||'/'||patient::text||'/'||pending::text||'/original.pdf','application/pdf',100,repeat('a',64),clock_timestamp()-interval '1 day');
  perform private.reserve_clinical_document(pending);
  -- Known namespace without a file row, unknown namespace, other bucket and
  -- unknown size all remain visible to the reconciler rather than disappearing.
  insert into storage.objects(bucket_id,name,metadata) values
    ('patient-clinical-files',business::text||'/untracked/original.pdf','{"size":600}'),
    ('patient-clinical-files','synthetic-unassigned-'||business::text,'{"size":700}'),
    ('patient-clinical-files','synthetic-unknown-size-'||business::text,'{}');
  insert into storage.buckets(id,name,public) values('reconcile-'||business::text,'reconcile-'||business::text,false);
  insert into storage.objects(bucket_id,name,metadata) values('reconcile-'||business::text,'synthetic-other-bucket','{"size":1000}');
  insert into reconcile_fixture values(business,patient,pending,'reconcile-'||business::text);
end $$;
-- External changes may invalidate counters. Rebuild derived values, never files.
update public.clinical_storage_budget set used_bytes=123,reserved_bytes=123 where singleton;
update public.clinical_business_storage_budget set used_bytes=123,reserved_bytes=123 where business_id=(select business_id from reconcile_fixture);
create temporary table reconciliation_result as select public.reconcile_clinical_storage_budget() as result;
select extensions.is((select used_bytes from public.clinical_business_storage_budget where business_id=(select business_id from reconcile_fixture)),1650::bigint,'clinic includes stored pending, failed, trashed, ready, derived and untracked namespace bytes');
select extensions.is((select used_bytes from public.clinical_storage_budget where singleton),3350::bigint,'global includes other buckets and unattributed objects');
select extensions.is((select reserved_bytes from public.clinical_business_storage_budget where business_id=(select business_id from reconcile_fixture)),5000000::bigint,'old abandoned row with a renewed valid URL retains its full clinic protection');
select extensions.is((select reserved_bytes from public.clinical_storage_budget where singleton),5000000::bigint,'renewed abandoned upload also retains global protection');
select extensions.is((select (result->>'unattributed_bytes')::bigint from reconciliation_result),1700::bigint,'unattributed bytes are explicitly reported');
select extensions.is((select (result->>'unknown_size_objects')::bigint from reconciliation_result),1::bigint,'unknown object size is reported rather than claimed physically empty');
select extensions.is((select count(distinct status) from public.patient_radiographs where business_id=(select business_id from reconcile_fixture)),4::bigint,'all four file states survive reconciliation');
select extensions.is((select max_bytes from public.clinical_storage_budget where singleton),700000000::bigint,'reconciliation preserves global capacity');
select extensions.is((select max_bytes from public.clinical_business_storage_budget where business_id=(select business_id from reconcile_fixture)),100000000::bigint,'reconciliation preserves the clinic maximum');
select public.reconcile_clinical_storage_budget();
select extensions.is((select used_bytes from public.clinical_storage_budget where singleton),3350::bigint,'repeating reconciliation does not double charge any object');
-- Model external counter corruption followed by an unsafe administrative limit.
-- The reconciler must expose that overcommit without deleting data or raising limits.
update public.clinical_storage_budget set used_bytes=0,reserved_bytes=0,max_bytes=1 where singleton;
update public.clinical_business_storage_budget set used_bytes=0,reserved_bytes=0,max_bytes=1 where business_id=(select business_id from reconcile_fixture);
update reconciliation_result set result=public.reconcile_clinical_storage_budget();
select extensions.is((select (result->>'over_global_limit')::boolean from reconciliation_result),true,'existing global overcommit is explicit');
select extensions.is((select (result->>'over_business_limit')::bigint from reconciliation_result),1::bigint,'existing clinic overcommit is explicit');
select extensions.is((select count(*) from public.patient_radiographs where business_id=(select business_id from reconcile_fixture)),5::bigint,'overcommit never deletes files or the outstanding upload');
select extensions.is((select used_bytes+reserved_bytes from public.clinical_storage_budget where singleton),5003350::bigint,'overcommit preserves the full actual and protected usage');
select * from extensions.finish();
rollback;
