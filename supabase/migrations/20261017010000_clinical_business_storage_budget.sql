begin;

-- Individual maxima share the project budget; no capacity is preallocated.
alter table public.clinical_storage_budget
  add column default_business_max_bytes bigint not null default 100000000
    check (default_business_max_bytes between 1 and 9007199254740991),
  add column uploads_enabled boolean not null default true,
  add column policy_revision integer not null default 1 check (policy_revision>0);

create table public.clinical_business_storage_budget (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  max_bytes bigint not null check (max_bytes between 1 and 9007199254740991),
  used_bytes bigint not null default 0 check (used_bytes >= 0),
  reserved_bytes bigint not null default 0 check (reserved_bytes >= 0),
  uploads_enabled boolean not null default true,
  policy_revision integer not null default 1 check (policy_revision>0),
  updated_at timestamptz not null default now()
);
alter table public.clinical_business_storage_budget enable row level security;
revoke all on public.clinical_business_storage_budget from public, anon, authenticated, service_role;
grant select on public.clinical_business_storage_budget to service_role;

-- Existing clinics previously shared the global maximum without an individual
-- limit. Preserve that applicable maximum rather than silently reducing it.
insert into public.clinical_business_storage_budget(business_id,max_bytes)
select b.id, g.max_bytes from public.businesses b cross join public.clinical_storage_budget g;

alter table public.patient_radiographs
  add constraint patient_radiographs_business_id_id_key unique (business_id,id);
alter table public.clinical_upload_slots add column business_id uuid;
update public.clinical_upload_slots s set business_id=f.business_id
from public.patient_radiographs f where f.id=s.file_id;
alter table public.clinical_upload_slots alter column business_id set not null;
alter table public.clinical_upload_slots
  add constraint clinical_upload_slots_business_file_fkey foreign key(business_id,file_id)
    references public.patient_radiographs(business_id,id) on delete restrict;
create index clinical_upload_slots_business_expiry on public.clinical_upload_slots(business_id,expires_at);

-- A known clinical namespace remains attributable even after a file's metadata
-- is removed. Unknown namespaces still count globally and are reported by the
-- reconciler; inventing an owner would conceal external/unattributed objects.
create function private.clinical_storage_business(p_bucket text,p_path text)
returns uuid language sql stable security definer set search_path=pg_catalog,pg_temp as $$
  select b.id from public.businesses b
  where b.id=case when p_bucket='patient-clinical-files'
    and split_part(p_path,'/',1) ~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
    then split_part(p_path,'/',1)::uuid else null end
$$;
create function private.clinical_object_bytes(p_metadata jsonb)
returns bigint language sql immutable set search_path=pg_catalog,pg_temp as $$
  select case when p_metadata->>'size' ~ '^[0-9]{1,18}$'
    then (p_metadata->>'size')::bigint else 0::bigint end
$$;

create function private.lock_clinical_business_budget(p_business_id uuid,p_require_upload boolean default false)
returns void language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare account public.clinical_business_storage_budget%rowtype;
begin
  perform private.clinical_budget_lock();
  select * into account from public.clinical_business_storage_budget where business_id=p_business_id for update;
  if not found then raise exception 'CLINICAL_STORAGE_ACCOUNT_MISSING'; end if;
  if p_require_upload and (not account.uploads_enabled or not (
    select uploads_enabled from public.clinical_storage_budget where singleton
  )) then raise exception 'CLINICAL_DOCUMENTS_DISABLED'; end if;
end $$;

create function private.initialize_clinical_business_budget()
returns trigger language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
  perform private.clinical_budget_lock();
  insert into public.clinical_business_storage_budget(business_id,max_bytes)
    select new.id,default_business_max_bytes from public.clinical_storage_budget where singleton;
  if not found then raise exception 'CLINICAL_STORAGE_ACCOUNT_MISSING'; end if;
  return new;
end $$;
create trigger cita_initialize_clinical_budget after insert on public.businesses
  for each row execute function private.initialize_clinical_business_budget();

create function private.check_clinical_activation()
returns trigger language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
  if new.patient_documents_enabled and (tg_op='INSERT' or not old.patient_documents_enabled) then
    perform private.lock_clinical_business_budget(new.id,true);
  end if;
  return new;
end $$;
-- Alphabetic ordering ensures initialization precedes validation on INSERT.
create trigger cita_validate_clinical_activation after insert or update of patient_documents_enabled on public.businesses
  for each row execute function private.check_clinical_activation();

create function private.check_new_clinical_file_budget()
returns trigger language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
  if new.storage_provider='supabase_storage' and new.status='uploading' then
    perform private.lock_clinical_business_budget(new.business_id,true);
  end if;
  return new;
end $$;
create trigger cita_clinical_file_budget before insert on public.patient_radiographs
  for each row execute function private.check_new_clinical_file_budget();

create function private.guard_clinical_budget_reduction()
returns trigger language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
  perform private.clinical_budget_lock();
  if new.max_bytes is distinct from old.max_bytes and new.max_bytes<new.used_bytes+new.reserved_bytes then
    raise exception 'CLINICAL_STORAGE_COMMITTED';
  end if;
  return new;
end $$;
create trigger cita_global_budget_reduction before update of max_bytes on public.clinical_storage_budget
  for each row execute function private.guard_clinical_budget_reduction();
create trigger cita_business_budget_reduction before update of max_bytes on public.clinical_business_storage_budget
  for each row execute function private.guard_clinical_budget_reduction();

create or replace function private.release_expired_clinical_reservations()
returns void language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare released bigint; cutoff timestamptz:=clock_timestamp(); item record;
begin
  perform private.clinical_budget_lock();
  for item in select business_id,sum(reserved_bytes)::bigint as bytes
    from public.clinical_upload_slots where expires_at<=cutoff and reserved_bytes>0
    group by business_id order by business_id loop
    perform private.lock_clinical_business_budget(item.business_id);
    update public.clinical_business_storage_budget set reserved_bytes=reserved_bytes-item.bytes,updated_at=cutoff
      where business_id=item.business_id;
  end loop;
  select coalesce(sum(reserved_bytes),0) into released from public.clinical_upload_slots where expires_at<=cutoff;
  update public.clinical_upload_slots set reserved_bytes=0 where expires_at<=cutoff and reserved_bytes<>0;
  update public.clinical_storage_budget set reserved_bytes=reserved_bytes-released,updated_at=cutoff where singleton;
  delete from public.clinical_upload_slots s where s.expires_at<=cutoff
    and not exists(select 1 from storage.objects o where o.bucket_id=s.bucket and o.name=s.path);
end $$;

-- Patient accounting is intentionally different from the pessimistic ledger:
-- actual objects + declared pending originals, never five MB per pending URL.
create function private.check_patient_document_budget(p_appointment_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare actual_bytes bigint; pending_bytes bigint; documents bigint;
begin
  select coalesce(sum(private.clinical_object_bytes(o.metadata)),0) into actual_bytes
    from public.patient_radiographs f join storage.objects o
      on o.bucket_id=f.storage_bucket and o.name in(f.storage_path,f.thumbnail_path)
    where f.appointment_id=p_appointment_id and f.source='patient';
  select coalesce(sum(f.bytes),0) into pending_bytes from public.patient_radiographs f
    where f.appointment_id=p_appointment_id and f.source='patient' and f.status='uploading'
      and exists(select 1 from public.clinical_upload_slots s where s.file_id=f.id and s.expires_at>clock_timestamp())
      and not exists(select 1 from storage.objects o where o.bucket_id=f.storage_bucket and o.name=f.storage_path
        and private.clinical_object_bytes(o.metadata)>0);
  select count(*) into documents from public.patient_radiographs f
    where f.appointment_id=p_appointment_id and f.source='patient' and (
      f.status in('ready','trashed') or exists(select 1 from public.clinical_upload_slots s
        where s.file_id=f.id and s.expires_at>clock_timestamp()));
  if actual_bytes+pending_bytes>10000000 or documents>3 then raise exception 'CLINICAL_PATIENT_QUOTA'; end if;
end $$;

create or replace function private.reserve_clinical_document(p_file_id uuid)
returns void language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare file public.patient_radiographs%rowtype; path_value text; additional bigint:=0; target_reserved bigint;
begin
  perform private.clinical_budget_lock();
  select * into file from public.patient_radiographs where id=p_file_id;
  if not found or file.status<>'uploading' then return; end if;
  perform private.lock_clinical_business_budget(file.business_id,true);
  perform private.release_expired_clinical_reservations();
  perform 1 from public.patient_radiographs where id=p_file_id for update;
  foreach path_value in array array_remove(array[file.storage_path,file.thumbnail_path],null) loop
    target_reserved:=case when exists(select 1 from storage.objects where bucket_id=file.storage_bucket and name=path_value
      and private.clinical_object_bytes(metadata)>0) then 0 else 5000000 end;
    if not exists(select 1 from public.clinical_upload_slots where bucket=file.storage_bucket and path=path_value) then
      additional:=additional+target_reserved;
    else
      select additional+target_reserved-reserved_bytes into additional from public.clinical_upload_slots
        where bucket=file.storage_bucket and path=path_value;
    end if;
    insert into public.clinical_upload_slots(bucket,path,file_id,business_id,expires_at,reserved_bytes)
      values(file.storage_bucket,path_value,file.id,file.business_id,clock_timestamp()+interval '2 hours 15 minutes',target_reserved)
      on conflict(bucket,path) do update set expires_at=greatest(public.clinical_upload_slots.expires_at,excluded.expires_at),reserved_bytes=excluded.reserved_bytes;
  end loop;
  if exists(select 1 from public.clinical_storage_budget where singleton and used_bytes+reserved_bytes+additional>max_bytes)
    or exists(select 1 from public.clinical_business_storage_budget where business_id=file.business_id
      and used_bytes+reserved_bytes+additional>max_bytes) then raise exception 'CLINICAL_STORAGE_QUOTA'; end if;
  update public.clinical_storage_budget set reserved_bytes=reserved_bytes+additional,updated_at=clock_timestamp() where singleton;
  update public.clinical_business_storage_budget set reserved_bytes=reserved_bytes+additional,updated_at=clock_timestamp()
    where business_id=file.business_id;
  if file.source='patient' then perform private.check_patient_document_budget(file.appointment_id); end if;
end $$;

create or replace function private.track_storage_budget()
returns trigger language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare
  old_bytes bigint:=0; new_bytes bigint:=0; old_business uuid; new_business uuid;
  released bigint:=0; rearmed bigint:=0; old_slot public.clinical_upload_slots%rowtype;
  new_slot public.clinical_upload_slots%rowtype; file public.patient_radiographs%rowtype; business uuid; delta bigint;
begin
  perform private.clinical_budget_lock();
  if tg_op<>'INSERT' then
    old_bytes:=private.clinical_object_bytes(old.metadata);
    old_business:=private.clinical_storage_business(old.bucket_id,old.name);
  end if;
  if tg_op<>'DELETE' then
    new_bytes:=private.clinical_object_bytes(new.metadata);
    new_business:=private.clinical_storage_business(new.bucket_id,new.name);
  end if;
  for business in select distinct value from unnest(array[old_business,new_business]) value where value is not null order by value loop
    perform private.lock_clinical_business_budget(business);
  end loop;
  if tg_op<>'DELETE' then
    if new.bucket_id='patient-clinical-files' then
      if octet_length(coalesce(to_jsonb(new)->'user_metadata','{}'::jsonb)::text)>4096
        and (tg_op='INSERT' or (to_jsonb(new)->'user_metadata') is distinct from (to_jsonb(old)->'user_metadata'))
        or octet_length(coalesce(new.metadata,'{}'::jsonb)::text)>4096
        and (tg_op='INSERT' or new.metadata is distinct from old.metadata) then
        raise exception 'CLINICAL_DOCUMENT_METADATA_TOO_LARGE';
      end if;
      if new_bytes>5000000 and new_bytes>old_bytes then raise exception 'RADIOGRAPH_SIZE_INVALID'; end if;
    end if;
    select * into new_slot from public.clinical_upload_slots where bucket=new.bucket_id and path=new.name;
    select * into file from public.patient_radiographs f where f.storage_bucket=new.bucket_id
      and new.name in(f.storage_path,f.thumbnail_path);
    if found and file.status='failed' and new_bytes>0 then raise exception 'CLINICAL_UPLOAD_CLOSED'; end if;
    if new_bytes>0 and new_slot.path is not null then
      released:=new_slot.reserved_bytes;
      update public.clinical_upload_slots set reserved_bytes=0 where bucket=new_slot.bucket and path=new_slot.path;
    end if;
  end if;
  -- Removing an object does not revoke its signed upload URL. Back its maximum
  -- until the original expiration + margin, including a rename or size reset.
  if tg_op<>'INSERT' and (tg_op='DELETE' or new.bucket_id is distinct from old.bucket_id
    or new.name is distinct from old.name or new_bytes=0) then
    select * into old_slot from public.clinical_upload_slots
      where bucket=old.bucket_id and path=old.name and expires_at>clock_timestamp();
    if found then
      rearmed:=5000000-old_slot.reserved_bytes;
      update public.clinical_upload_slots set reserved_bytes=5000000 where bucket=old_slot.bucket and path=old_slot.path;
    end if;
  end if;
  update public.clinical_storage_budget set used_bytes=used_bytes-old_bytes+new_bytes,
    reserved_bytes=reserved_bytes-released+rearmed,updated_at=clock_timestamp() where singleton;
  for business in select distinct value from unnest(array[old_business,new_business]) value where value is not null order by value loop
    update public.clinical_business_storage_budget set
      used_bytes=used_bytes-case when business=old_business then old_bytes else 0 end+case when business=new_business then new_bytes else 0 end,
      reserved_bytes=reserved_bytes-case when business=new_business then released else 0 end+case when business=old_business then rearmed else 0 end,
      updated_at=clock_timestamp() where business_id=business;
    delta:=case when business=new_business then new_bytes-released else 0 end
      +case when business=old_business then rearmed-old_bytes else 0 end;
    if delta>0 and exists(select 1 from public.clinical_business_storage_budget
      where business_id=business and used_bytes+reserved_bytes>max_bytes) then raise exception 'CLINICAL_STORAGE_QUOTA'; end if;
  end loop;
  if new_bytes-old_bytes-released+rearmed>0 and exists(
    select 1 from public.clinical_storage_budget where singleton and used_bytes+reserved_bytes>max_bytes)
    then raise exception 'CLINICAL_STORAGE_QUOTA'; end if;
  if tg_op<>'DELETE' and file.source='patient' then perform private.check_patient_document_budget(file.appointment_id); end if;
  return null;
end $$;
-- AFTER observes the actual new object and lease state for patient accounting.
-- Raising still rolls back the entire Storage metadata transaction.
drop trigger cita_storage_budget on storage.objects;
create trigger cita_storage_budget after insert or update or delete on storage.objects
  for each row execute function private.track_storage_budget();

create function public.reconcile_clinical_storage_budget(p_max_businesses integer default 1000)
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
  update public.clinical_upload_slots s set reserved_bytes=case when s.expires_at>cutoff and not exists(
    select 1 from storage.objects o where o.bucket_id=s.bucket and o.name=s.path and private.clinical_object_bytes(o.metadata)>0)
    then 5000000 else 0 end;
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

create function public.set_clinical_storage_defaults(p_actor_id uuid,p_default_business_max_bytes bigint,p_uploads_enabled boolean,p_expected_revision integer default null)
returns void language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
  perform private.require_clinical_file_service_call();
  perform private.clinical_budget_lock();
  if p_actor_id is null or p_default_business_max_bytes is null or p_uploads_enabled is null then raise exception 'CLINICAL_STORAGE_POLICY_INVALID'; end if;
  if p_expected_revision is not null and not exists(select 1 from public.clinical_storage_budget
    where singleton and policy_revision=p_expected_revision) then raise exception 'CLINICAL_STORAGE_POLICY_CHANGED'; end if;
  update public.clinical_storage_budget set default_business_max_bytes=p_default_business_max_bytes,
    uploads_enabled=p_uploads_enabled,policy_revision=policy_revision+1,updated_at=clock_timestamp() where singleton;
  insert into public.audit_logs(user_id,action,entity_type,metadata)
    values(p_actor_id,'clinical_storage.defaults_changed','clinical_storage_budget',
      jsonb_build_object('default_business_max_bytes',p_default_business_max_bytes,'uploads_enabled',p_uploads_enabled));
end $$;
create function public.set_business_clinical_storage_policy(p_actor_id uuid,p_business_id uuid,p_max_bytes bigint,p_uploads_enabled boolean,p_expected_revision integer default null)
returns void language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
  perform private.require_clinical_file_service_call();
  perform private.lock_clinical_business_budget(p_business_id);
  if p_actor_id is null or p_max_bytes is null or p_uploads_enabled is null then raise exception 'CLINICAL_STORAGE_POLICY_INVALID'; end if;
  if p_expected_revision is not null and not exists(select 1 from public.clinical_business_storage_budget
    where business_id=p_business_id and policy_revision=p_expected_revision) then raise exception 'CLINICAL_STORAGE_POLICY_CHANGED'; end if;
  update public.clinical_business_storage_budget set max_bytes=p_max_bytes,uploads_enabled=p_uploads_enabled,policy_revision=policy_revision+1,
    updated_at=clock_timestamp() where business_id=p_business_id;
  insert into public.audit_logs(business_id,user_id,action,entity_type,entity_id,metadata)
    values(p_business_id,p_actor_id,'clinical_storage.business_policy_changed','clinical_business_storage_budget',p_business_id,
      jsonb_build_object('max_bytes',p_max_bytes,'uploads_enabled',p_uploads_enabled));
end $$;

create function public.clinical_document_uploads_enabled(p_business_id uuid)
returns boolean language plpgsql stable security definer set search_path=pg_catalog,pg_temp as $$
declare enabled boolean;
begin
  perform private.require_clinical_file_service_call();
  select g.uploads_enabled and b.uploads_enabled into enabled from public.clinical_storage_budget g
    cross join public.clinical_business_storage_budget b where g.singleton and b.business_id=p_business_id;
  if not found then raise exception 'CLINICAL_STORAGE_ACCOUNT_MISSING'; end if;
  return enabled;
end $$;

-- Storage signs first; the server observes the actual token expiration and
-- extends protection before exposing either URL to a browser. Initial leases
-- already back their full permitted size throughout that network round-trip.
create function public.protect_clinical_upload_urls(p_bucket text,p_paths text[],p_expires_at timestamptz)
returns void language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare v_file_id uuid; v_business_id uuid; matches integer; distinct_files integer;
begin
  perform private.require_clinical_file_service_call();
  perform private.clinical_budget_lock();
  if p_bucket is distinct from 'patient-clinical-files' or p_paths is null or cardinality(p_paths) not between 1 and 2
    or p_expires_at is null or not isfinite(p_expires_at) or p_expires_at<=clock_timestamp() then
    raise exception 'CLINICAL_UPLOAD_PROTECTION_INVALID';
  end if;
  select count(*),count(distinct s.file_id),min(s.file_id::text)::uuid into matches,distinct_files,v_file_id
    from public.clinical_upload_slots s where s.bucket=p_bucket and s.path=any(p_paths);
  if matches<>cardinality(p_paths) or distinct_files<>1 then raise exception 'CLINICAL_UPLOAD_PROTECTION_INVALID'; end if;
  select business_id into v_business_id from public.patient_radiographs where id=v_file_id;
  perform private.lock_clinical_business_budget(v_business_id);
  perform 1 from public.patient_radiographs f where f.id=v_file_id and f.status='uploading' for update;
  if not found or exists(select 1 from public.clinical_upload_slots s where s.file_id=v_file_id and s.path=any(p_paths)
    and (s.expires_at<=clock_timestamp() or s.reserved_bytes<>case when exists(select 1 from storage.objects o
      where o.bucket_id=s.bucket and o.name=s.path and private.clinical_object_bytes(o.metadata)>0) then 0 else 5000000 end)) then
    raise exception 'CLINICAL_UPLOAD_PROTECTION_INVALID';
  end if;
  update public.clinical_upload_slots s set expires_at=greatest(s.expires_at,p_expires_at+interval '15 minutes')
    where s.bucket=p_bucket and s.path=any(p_paths) and s.file_id=v_file_id;
end $$;

-- New functions have no implicit PUBLIC execution; only the trusted backend
-- can administer defaults/exceptions or reconcile the complete project.
revoke all on function private.clinical_storage_business(text,text),private.clinical_object_bytes(jsonb),
  private.lock_clinical_business_budget(uuid,boolean),private.initialize_clinical_business_budget(),
  private.check_clinical_activation(),private.check_new_clinical_file_budget(),private.guard_clinical_budget_reduction(),
  private.check_patient_document_budget(uuid) from public,anon,authenticated,service_role;
revoke all on function public.reconcile_clinical_storage_budget(integer),
  public.clinical_document_uploads_enabled(uuid),
  public.protect_clinical_upload_urls(text,text[],timestamptz),
  public.set_clinical_storage_defaults(uuid,bigint,boolean,integer),public.set_business_clinical_storage_policy(uuid,uuid,bigint,boolean,integer)
  from public,anon,authenticated,service_role;
grant execute on function public.reconcile_clinical_storage_budget(integer),
  public.clinical_document_uploads_enabled(uuid),
  public.protect_clinical_upload_urls(text,text[],timestamptz),
  public.set_clinical_storage_defaults(uuid,bigint,boolean,integer),public.set_business_clinical_storage_policy(uuid,uuid,bigint,boolean,integer) to service_role;

-- Preserve the public settings contract, acquiring the shared budget before
-- the business row so activation cannot reverse the upload lock order.
create or replace function public.save_public_practice_settings(p_business_id uuid,p_settings jsonb,p_expected_updated_at timestamptz)
returns void language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
begin
  perform private.clinical_budget_lock();
  if not coalesce(public.user_can_manage_business(p_business_id),false) or not public.business_allows_operation(p_business_id)
    or jsonb_typeof(p_settings) is distinct from 'object' or octet_length(p_settings::text)>4096 then raise exception 'CARE_ACCESS_DENIED'; end if;
  if coalesce((p_settings->>'whatsapp_contact_enabled')::boolean,false)
    and coalesce(p_settings->>'whatsapp_phone','') !~ '^\+[1-9][0-9]{5,14}$' then raise exception 'CARE_PHONE_INVALID'; end if;
  perform 1 from public.businesses where id=p_business_id and updated_at is not distinct from p_expected_updated_at for update;
  if not found then raise exception 'CARE_CONFIGURATION_CHANGED'; end if;
  update public.businesses set updated_at=clock_timestamp(),
    patient_documents_enabled=coalesce((p_settings->>'patient_documents_enabled')::boolean,false),
    public_contact_enabled=coalesce((p_settings->>'public_contact_enabled')::boolean,false),
    whatsapp_contact_enabled=coalesce((p_settings->>'whatsapp_contact_enabled')::boolean,false),
    whatsapp_phone=nullif(p_settings->>'whatsapp_phone',''),whatsapp_message=nullif(trim(p_settings->>'whatsapp_message'),'')
    where id=p_business_id;
  insert into public.audit_logs(business_id,user_id,action,entity_type,entity_id)
    values(p_business_id,auth.uid(),'business.public_practice_settings_saved','business',p_business_id);
end $$;

create or replace function public.get_clinical_storage_budget(p_business_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare account public.clinical_business_storage_budget%rowtype;
begin
  if not coalesce(public.user_can_manage_business(p_business_id),false) then raise exception 'RADIOGRAPH_ACCESS_DENIED'; end if;
  perform private.lock_clinical_business_budget(p_business_id);
  perform private.release_expired_clinical_reservations();
  select * into account from public.clinical_business_storage_budget where business_id=p_business_id;
  return (select jsonb_build_object('database_bytes',pg_database_size(current_database()),
    'monthly_authorized_download_bytes',(select coalesce(sum(private.clinical_object_bytes(jsonb_build_object('size',metadata->'bytes'))),0)
      from public.audit_logs where business_id=p_business_id and action='radiograph.original_access_granted'
        and created_at>=date_trunc('month',statement_timestamp() at time zone 'UTC') at time zone 'UTC'),
    'used_bytes',used_bytes,'reserved_bytes',reserved_bytes,'max_bytes',max_bytes,
    'percentage',round(100.0*(used_bytes+reserved_bytes)/max_bytes,1),'uploads_enabled',uploads_enabled,
    'business',jsonb_build_object('used_bytes',account.used_bytes,'reserved_bytes',account.reserved_bytes,
      'max_bytes',account.max_bytes,'uploads_enabled',account.uploads_enabled))
    from public.clinical_storage_budget where singleton);
end $$;

create or replace function public.get_public_booking_information(p_token text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,pg_temp as $$
declare a public.appointments%rowtype; s jsonb; initial public.appointment_intake_responses%rowtype;
  latest public.appointment_intake_submissions%rowtype; documents_enabled boolean;
begin
  a:=private.booking_information_appointment(p_token);
  select schema_snapshot into s from public.appointment_patient_information_contexts where appointment_id=a.id;
  select * into initial from public.appointment_intake_responses where appointment_id=a.id and patient_id=a.patient_id;
  select * into latest from public.appointment_intake_submissions where appointment_id=a.id and patient_id=a.patient_id order by sequence_no desc limit 1;
  select b.patient_documents_enabled and q.uploads_enabled and g.uploads_enabled into documents_enabled
    from public.businesses b join public.clinical_business_storage_budget q on q.business_id=b.id
      cross join public.clinical_storage_budget g where b.id=a.business_id and g.singleton;
  return jsonb_build_object('documents_enabled',coalesce(documents_enabled,false),
    'theme',coalesce((select theme_snapshot from public.appointment_booking_contexts where appointment_id=a.id),'cita-suite'),
    'schema',s,'schema_hash',encode(extensions.digest(s::text,'sha256'),'hex'),
    'answers',coalesce(latest.answers,initial.answers,'{}'),'comment',coalesce(latest.free_comment,initial.free_comment,''),
    'version',coalesce(latest.id::text,'initial'));
end $$;

-- Set initial counters from the complete existing catalog, preserving any
-- previously applicable maximum and any amount already committed above it.
do $$
begin
  perform set_config('request.jwt.claim.role','service_role',true);
  perform public.reconcile_clinical_storage_budget();
  update public.clinical_business_storage_budget set max_bytes=greatest(max_bytes,used_bytes+reserved_bytes);
end $$;
notify pgrst,'reload schema';
commit;
