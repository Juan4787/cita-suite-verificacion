-- Hosted Supabase rejects an UPDATE or DELETE without WHERE inside a PostgREST
-- request (safeupdate), also in the functions the request calls. The storage
-- reconciliation rewrote every upload slot unconditionally, so the scheduled job
-- failed on staging with SQLSTATE 21000 ("UPDATE requires a WHERE clause"). Same
-- signature, privileges and result; it now writes only the slots that change.
begin;
create or replace function public.reconcile_clinical_storage_budget(p_max_businesses integer default 1000)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare cutoff timestamptz:=clock_timestamp(); business uuid; unattributed bigint; unknown_sizes bigint;
begin
  perform private.require_clinical_file_service_call();
  perform private.clinical_budget_lock();
  if p_max_businesses is null or p_max_businesses not between 1 and 1000 or
    (select count(*) from public.clinical_business_storage_budget)>p_max_businesses then
    raise exception 'CLINICAL_RECONCILIATION_LIMIT';
  end if;
  for business in select business_id from public.clinical_business_storage_budget order by business_id loop
    perform private.lock_clinical_business_budget(business);
  end loop;
  -- A live upload URL without its object keeps the pessimistic 5 MB; any other slot
  -- holds nothing. Only the slots whose reservation changes are written.
  with expected as (
    select slot.bucket,slot.path,case when slot.expires_at>cutoff and not exists(
      select 1 from storage.objects o where o.bucket_id=slot.bucket and o.name=slot.path and private.clinical_object_bytes(o.metadata)>0)
      then 5000000 else 0 end as reserved_bytes
    from public.clinical_upload_slots slot
  ) update public.clinical_upload_slots s set reserved_bytes=expected.reserved_bytes
    from expected where expected.bucket=s.bucket and expected.path=s.path and expected.reserved_bytes<>s.reserved_bytes;
  with object_totals as (
    select private.clinical_storage_business(bucket_id,name) as business_id,
      sum(private.clinical_object_bytes(metadata))::bigint as bytes from storage.objects group by 1
  ), pending_totals as (
    select business_id,sum(reserved_bytes)::bigint as bytes from public.clinical_upload_slots group by business_id
  ), totals as (
    select b.business_id,coalesce(o.bytes,0) as used_bytes,coalesce(p.bytes,0) as reserved_bytes
      from public.clinical_business_storage_budget b left join object_totals o using(business_id)
        left join pending_totals p using(business_id)
  ) update public.clinical_business_storage_budget b set used_bytes=t.used_bytes,reserved_bytes=t.reserved_bytes,
    updated_at=cutoff from totals t where t.business_id=b.business_id;
  update public.clinical_storage_budget set
    used_bytes=(select coalesce(sum(private.clinical_object_bytes(metadata)),0) from storage.objects),
    reserved_bytes=(select coalesce(sum(reserved_bytes),0) from public.clinical_upload_slots),updated_at=cutoff where singleton;
  select coalesce(sum(private.clinical_object_bytes(o.metadata)),0) into unattributed from storage.objects o
    where private.clinical_storage_business(o.bucket_id,o.name) is null;
  select count(*) into unknown_sizes from storage.objects where coalesce(metadata->>'size','') !~ '^[0-9]{1,18}$';
  -- Represent overcommit honestly. Reconciliation never raises a quota or
  -- deletes a valid object to make an inaccurate counter look consistent.
  return jsonb_build_object('unattributed_bytes',unattributed,'unknown_size_objects',unknown_sizes,'over_global_limit',(
    select used_bytes+reserved_bytes>max_bytes from public.clinical_storage_budget where singleton),
    'over_business_limit',(select count(*) from public.clinical_business_storage_budget where used_bytes+reserved_bytes>max_bytes));
end $$;
notify pgrst,'reload schema';
commit;
